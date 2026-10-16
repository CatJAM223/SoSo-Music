import { requestSignal } from '../../../shared/utils/requestSignal.ts';
import { desktopFetch } from './desktopFetch.ts';

export interface LastFmSimilarArtist {
  id: string | number;
  name: string;
  picture?: string;
  stat?: string;
}

export interface LastFmArtistInfo {
  name: string;
  bio: string;
  listeners?: string | number;
  playcount?: string | number;
  image?: string;
  tags?: string[];
  similarArtists?: LastFmSimilarArtist[];
}

export interface LastFmGenreTrack {
  title: string;
  artist: string;
}

export class LastFmService {
  private static API_URL = 'https://ws.audioscrobbler.com/2.0/';
  private static API_KEY = '';

  public static configureApiKey(key: string): void {
    this.API_KEY = key;
    this.cache.clear();
  }
  public static hasApiKey(): boolean {
    return Boolean(this.API_KEY);
  }
  private static DEFAULT_ART_HASH = '2a96cbd8b46e442fc41c2b86b821562f';

  private static cache = new Map<string, { value: any; expiresAt: number }>();
  private static CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
  private static MAX_CACHE_SIZE = 500;

  private static setCache(key: string, value: any): void {
    const now = Date.now();
    for (const [k, entry] of this.cache.entries()) {
      if (now >= entry.expiresAt) {
        this.cache.delete(k);
      }
    }
    if (this.cache.size >= this.MAX_CACHE_SIZE) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(key, { value, expiresAt: now + this.CACHE_TTL_MS });
  }

  private static async fetchJson(
    method: string,
    params: Record<string, string>,
    signal?: AbortSignal,
    required = false,
  ): Promise<any> {
    const apiKey = this.API_KEY;
    const safeMessage = (value: unknown) => String(value).split(apiKey).join('[redacted]');
    if (!apiKey) {
      if (required) throw new Error('Добавьте ключ Last.fm в Настройки → API.');
      return null;
    }
    const query = new URLSearchParams({
      method,
      api_key: apiKey,
      format: 'json',
      autocorrect: '1',
      ...params,
    });

    try {
      const res = await desktopFetch(`${this.API_URL}?${query.toString()}`, {
        headers: {
          'User-Agent': 'SoSoMusic/1.0 (https://github.com/SoSo-Music)',
          Accept: 'application/json',
        },
        signal: requestSignal(signal, 6000),
      });
      if (res.ok) {
        const json = await res.json();
        if (json?.error) {
          console.debug(`[LastFmService] API error for ${method}:`, safeMessage(json.message));
          if (required && Number(json.error) !== 6)
            throw new Error('Last.fm API: ' + safeMessage(json.message));
          return required ? { toptags: { tag: [] } } : null;
        }
        return json;
      }
    } catch (e) {
      signal?.throwIfAborted();
      const message = safeMessage(e instanceof Error ? e.message : e);
      if (required) throw new Error(message);
      console.debug(`[LastFmService] fetchJson notice for ${method}:`, message);
    }
    if (required) throw new Error('Last.fm request failed');
    return null;
  }

  public static async getGenreTracks(
    genre: string,
    signal?: AbortSignal,
  ): Promise<LastFmGenreTrack[]> {
    const tag = genre.trim().toLowerCase();
    if (!tag) return [];
    const cacheKey = 'genre-tracks:' + tag;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) return cached.value;
    const json = await this.fetchJson('tag.getTopTracks', { tag, limit: '50' }, signal);
    if (!json?.tracks) return [];
    const rows = Array.isArray(json.tracks.track) ? json.tracks.track : [json.tracks.track];
    const tracks = rows
      .flatMap((row: any) => {
        const title = typeof row?.name === 'string' ? row.name.trim().slice(0, 300) : '';
        const artist =
          typeof row?.artist?.name === 'string' ? row.artist.name.trim().slice(0, 200) : '';
        return title && artist ? [{ title, artist }] : [];
      })
      .slice(0, 50);
    this.setCache(cacheKey, tracks);
    return tracks;
  }

  public static async getTopTags(
    artist: string,
    title?: string,
    signal?: AbortSignal,
  ): Promise<string[]> {
    const json = await this.fetchJson(
      title ? 'track.getTopTags' : 'artist.getTopTags',
      { artist, ...(title ? { track: title } : {}) },
      signal,
      true,
    );
    if (!json?.toptags || typeof json.toptags !== 'object')
      throw new Error('Invalid Last.fm tag response');
    const tags: unknown = json.toptags.tag;
    const rows = Array.isArray(tags) ? tags : tags && typeof tags === 'object' ? [tags] : [];
    return rows
      .filter((tag) => typeof tag?.name === 'string' && Number(tag.count) > 0)
      .slice(0, 16)
      .map((tag) => tag.name.trim().slice(0, 80))
      .filter(Boolean);
  }

  private static extractImageUrl(images: any[]): string {
    if (!Array.isArray(images) || images.length === 0) return '';
    const preferredSizes = ['mega', 'extralarge', 'large', 'medium'];
    for (const size of preferredSizes) {
      const found = images.find((i) => i.size === size && i['#text']);
      if (found && found['#text'] && !found['#text'].includes(this.DEFAULT_ART_HASH)) {
        return found['#text'];
      }
    }
    const last = images.slice(-1)[0]?.['#text'] || '';
    return last.includes(this.DEFAULT_ART_HASH) ? '' : last;
  }

  public static cleanBioText(rawText?: string): string {
    if (!rawText) return '';
    return rawText
      .replace(/<a\s+href="[^"]*">.*?<\/a>/gi, '') // Strip Last.fm "Read more on Last.fm" links
      .replace(/<[^>]+>/g, '') // Strip HTML tags
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Get artist biography, play stats, tags, and similar artists
   */
  public static async getArtistInfo(
    artistName: string,
    signal?: AbortSignal,
  ): Promise<LastFmArtistInfo | null> {
    if (!artistName || !artistName.trim()) return null;
    const cleanName = artistName.trim();
    const cacheKey = `artist:${cleanName.toLowerCase()}`;

    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey);
      if (cached && Date.now() < cached.expiresAt) {
        return cached.value;
      }
    }

    const json = await this.fetchJson('artist.getinfo', { artist: cleanName }, signal);
    const artist = json?.artist;
    if (!artist || !artist.name) return null;

    const bioRaw = artist.bio?.summary || artist.bio?.content || '';
    const bio = this.cleanBioText(bioRaw);
    const image = this.extractImageUrl(artist.image);

    const tags = Array.isArray(artist.tags?.tag)
      ? artist.tags.tag.map((t: any) => t.name).filter(Boolean)
      : [];

    const similarArtists: LastFmSimilarArtist[] = [];
    if (Array.isArray(artist.similar?.artist)) {
      for (const sim of artist.similar.artist) {
        if (!sim || !sim.name) continue;
        similarArtists.push({
          id: `yt_art_${sim.name.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '_')}`,
          name: sim.name,
          picture: this.extractImageUrl(sim.image),
        });
      }
    }

    const result: LastFmArtistInfo = {
      name: artist.name,
      bio,
      listeners: artist.stats?.listeners,
      playcount: artist.stats?.playcount,
      image,
      tags,
      similarArtists: similarArtists.slice(0, 10),
    };

    this.setCache(cacheKey, result);
    return result;
  }

  /**
   * Get similar artists list ("Fans also like")
   */
  public static async getSimilarArtists(
    artistName: string,
    limit: number = 10,
    signal?: AbortSignal,
  ): Promise<LastFmSimilarArtist[]> {
    if (!artistName || !artistName.trim()) return [];
    const info = await this.getArtistInfo(artistName, signal);
    return info?.similarArtists?.slice(0, limit) || [];
  }

  /**
   * Get album metadata (release summary, tracks, cover)
   */
  public static async getAlbumInfo(artistName: string, albumTitle: string): Promise<any | null> {
    if (!artistName || !albumTitle) return null;
    const cacheKey = `album:${artistName.toLowerCase()}:${albumTitle.toLowerCase()}`;

    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey);
      if (cached && Date.now() < cached.expiresAt) {
        return cached.value;
      }
    }

    const json = await this.fetchJson('album.getinfo', { artist: artistName, album: albumTitle });
    const album = json?.album;
    if (!album) return null;

    const result = {
      title: album.title,
      artist: album.artist,
      cover: this.extractImageUrl(album.image),
      summary: this.cleanBioText(album.wiki?.summary || album.wiki?.content),
      releaseDate: album.releasedate || '',
      tracks: Array.isArray(album.tracks?.track)
        ? album.tracks.track.map((t: any) => ({
            name: t.name,
            duration: Number(t.duration) || 0,
          }))
        : [],
    };

    this.setCache(cacheKey, result);
    return result;
  }
}
