import {
  assertStreamResolveActive,
  currentStreamResolveSignal,
  streamWait,
  streamShared,
} from './streamResolveContext.ts';
import {
  isSoundCloudRestrictedTrack,
  isFullSoundCloudTranscoding,
  isSoundCloudPreviewUrl,
} from '../../../shared/utils/soundcloudPlayback.ts';
import {
  createStreamResolveError,
  getStreamResolveFailure,
} from '../../../shared/utils/streamResolveError.ts';
import { matchesImportedRecording } from '../../../shared/utils/recordingIdentity.ts';
import type {
  Album,
  Artist,
  ArtistDetails,
  AutocompleteSuggestion,
  Genre,
  StreamResolveOptions,
  Track,
} from '../../../shared/types/index.ts';
import { isArtistMatch, normalizeText } from '../../../shared/utils/artistParser.ts';
import { fixMojibake } from '../../../shared/utils/formatters.ts';
import { withSoundCloudClientId } from '../../../shared/utils/soundcloudUrl.ts';
import { SoundCloudTransport } from './soundcloudTransport.ts';
import { getGenreSearchConfig, trackHasGenreTag } from '../../../shared/utils/genreSearch.ts';
import { isYouTubeAudioStreamUrl } from '../../../shared/utils/audioUrlValidator.ts';
import { PlaybackLogger } from './playbackLogger.ts';
import {
  cleanSoundCloudPlaylistId,
  toSoundCloudHdCover,
  extractPlaylistCover,
  fetchSoundCloudPlaylistTrackDetails,
  hydrateSoundCloudPlaylistTracks,
  transformSCTrack,
} from '../../../shared/services/parsers/soundCloudParser.ts';

export class SoundCloudService {
  private static keyRequest: Promise<string> | null = null;
  private static pendingStreams = new Map<string, Promise<string>>();
  private static unavailableStreams = new Map<string, number>();
  // Cache with TTL: Map<key, { value: any, expiresAt: number }>
  private static cache = new Map<string, { value: any; expiresAt: number }>();
  private static MAX_CACHE_SIZE = 500;
  private static CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

  // Client IDs are loaded from env var (injected by Vite at build time).
  // Fallback to empty string forces runtime key discovery via getSoundCloudKey().
  // Never hardcode real keys in source — rotate them in .env.local instead.
  private static scClientId: string =
    (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_SC_CLIENT_ID) || '';
  private static lastKeyFetch = 0; // force fetch on first use when no env key

  private static customProxyUrl: string = '';

  static setCustomProxy(url: string) {
    this.customProxyUrl = (url || '').trim();
  }

  /** TTL-aware cache write: evicts expired entries before falling back to LRU eviction. */
  private static setCache(key: string, value: any): void {
    const now = Date.now();
    // First pass: evict all expired entries (free space without losing valid data)
    for (const [k, entry] of this.cache.entries()) {
      if (now >= entry.expiresAt) {
        this.cache.delete(k);
      }
    }
    // Second pass: LRU eviction if still at capacity
    if (this.cache.size >= this.MAX_CACHE_SIZE) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(key, { value, expiresAt: now + this.CACHE_TTL_MS });
  }

  /**
   * Network fetcher for SoundCloud API endpoints
   */
  private static async fetchWithRelay(
    endpoint: string,
    isRetry: boolean = false,
    retryTransient: boolean = false,
    signal?: AbortSignal,
    onStatus?: (status: number) => void,
    strict = retryTransient,
  ): Promise<any> {
    const currentEndpoint = this.scClientId
      ? withSoundCloudClientId(endpoint, this.scClientId)
      : endpoint;
    return SoundCloudTransport.fetchJson(
      currentEndpoint,
      this.customProxyUrl,
      () => this.getSoundCloudKey(true),
      isRetry,
      retryTransient,
      strict,
      signal,
      onStatus,
    );
  }

  /**
   * Dynamically retrieves a fresh SoundCloud public Client ID from web assets
   */
  public static async getSoundCloudKey(forceRefresh: boolean = false): Promise<string> {
    if (!forceRefresh && this.scClientId && Date.now() - this.lastKeyFetch < 3600000)
      return this.scClientId;
    if (this.keyRequest) return this.keyRequest;
    const request = this.fetchSoundCloudKey(forceRefresh);
    this.keyRequest = request;
    try {
      return await request;
    } finally {
      if (this.keyRequest === request) this.keyRequest = null;
    }
  }

  private static async fetchSoundCloudKey(forceRefresh: boolean): Promise<string> {
    const now = Date.now();
    if (!forceRefresh && this.scClientId && now - this.lastKeyFetch < 3600000) {
      return this.scClientId;
    }
    // Keep the previous key until a replacement succeeds; parallel callers share the refresh.

    try {
      const pageRes = await SoundCloudTransport.fetch('https://soundcloud.com/discover', {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        },
        signal: AbortSignal.timeout(3000),
      });
      if (!pageRes.ok) throw new Error(`Discover page returned status ${pageRes.status}`);
      const html = await pageRes.text();
      const scriptUrls = [
        ...html.matchAll(/src="(https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js)"/g),
      ].map((m) => m[1]);

      const controllers: AbortController[] = [];
      const jsPromises = scriptUrls.slice(-6).map(async (u) => {
        const controller = new AbortController();
        controllers.push(controller);
        const timer = setTimeout(() => controller.abort(), 2500);
        try {
          const jsRes = await SoundCloudTransport.fetch(u, { signal: controller.signal });
          if (!jsRes.ok) return null;
          const js = await jsRes.text();
          const match =
            js.match(/client_id:"([a-zA-Z0-9]{32})"/i) ||
            js.match(/client_id=([a-zA-Z0-9]{32})/i) ||
            js.match(/"client_id":"([a-zA-Z0-9]{32})"/i);
          return match ? match[1] : null;
        } catch {
          return null;
        } finally {
          clearTimeout(timer);
        }
      });

      // One valid asset is enough; a slow unrelated bundle must not delay playback.
      let found: string | null;
      try {
        found = await new Promise<string | null>((resolve) => {
          let pending = jsPromises.length;
          if (!pending) {
            resolve(null);
            return;
          }
          jsPromises.forEach((request) =>
            request.then((key) => {
              if (key) resolve(key);
              if (--pending === 0) resolve(null);
            }),
          );
        });
      } finally {
        controllers.forEach((controller) => controller.abort());
      }
      if (found) {
        this.scClientId = found;
        this.lastKeyFetch = now;
        return this.scClientId;
      }
    } catch (e) {
      console.debug('[SoundCloudService] Failed to scrape public client_id:', e);
    }

    const envKey =
      (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_SC_CLIENT_ID) ||
      (typeof process !== 'undefined' && process.env?.VITE_SC_CLIENT_ID) ||
      '';
    if (envKey) {
      this.scClientId = envKey;
      this.lastKeyFetch = now;
      return this.scClientId;
    }

    this.lastKeyFetch = 0;
    return this.scClientId || '';
  }

  /**
   * Converts SoundCloud API item into normalized SoSo Music Track model
   */
  public static transformSCTrack(item: any): Track | null {
    return transformSCTrack(item);
  }

  /**
   * Search tracks on SoundCloud
   */
  public static async search(
    query: string,
    limit: number = 30,
    signal?: AbortSignal,
  ): Promise<{ data: Track[]; total: number }> {
    assertStreamResolveActive();
    if (!query || !query.trim()) return { data: [], total: 0 };
    const cleanQ = query.trim();

    const cacheKey = `search:${cleanQ}:${limit}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.value;
    }

    signal?.throwIfAborted();
    try {
      const clientId = await streamShared(() => this.getSoundCloudKey());
      const url = `https://api-v2.soundcloud.com/search/tracks?q=${encodeURIComponent(cleanQ)}&client_id=${clientId}&limit=${limit}`;
      const json = await streamWait(
        this.fetchWithRelay(url, false, false, signal, undefined, true),
      );
      // A failed request is not an authoritative empty catalog; allow the next search to recover.
      if (!Array.isArray(json?.collection)) throw createStreamResolveError('provider');

      const items: any[] = json.collection;
      const tracks: Track[] = [];

      for (const item of items) {
        const transformed = this.transformSCTrack(item);
        if (transformed) {
          tracks.push(transformed);
        }
      }

      const result = { data: tracks, total: json?.total_results || tracks.length };
      this.setCache(cacheKey, result);
      return result;
    } catch (e) {
      assertStreamResolveActive();
      signal?.throwIfAborted();
      console.error('[SoundCloudService] Search error:', e);
      throw e;
    }
  }

  /**
   * Get Top Global Trending / Hit tracks
   */
  public static async getCharts(limit: number = 50): Promise<{ tracks: { data: Track[] } }> {
    const cacheKey = `charts:${limit}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.value;
    }

    try {
      const clientId = await this.getSoundCloudKey();
      const chartsUrl = `https://api-v2.soundcloud.com/charts?kind=top&genre=soundcloud%3Agenres%3Aall-music&client_id=${clientId}&limit=${limit}`;
      const json = await this.fetchWithRelay(chartsUrl);

      const items: any[] = json?.collection || [];
      const tracks: Track[] = [];

      for (const item of items) {
        const rawTrack = item?.track || item;
        const transformed = this.transformSCTrack(rawTrack);
        if (transformed) {
          const dur = transformed.duration || 0;
          if (dur > 720 || dur < 40) continue;
          const titleLower = transformed.title.toLowerCase();
          const artistLower = (
            typeof transformed.artist === 'object'
              ? transformed.artist?.name
              : transformed.artist || ''
          )
            .toLowerCase()
            .trim();
          if (
            titleLower.includes('10 hours') ||
            titleLower.includes('1 hour') ||
            titleLower.includes('podcast') ||
            titleLower.includes('type beat') ||
            titleLower.includes('karaoke') ||
            titleLower.includes('*billboard') ||
            titleLower.includes('rave hit*') ||
            artistLower === titleLower
          ) {
            continue;
          }
          tracks.push(transformed);
        }
      }

      // Fallback: If charts returned empty, use clean popular hits
      if (tracks.length === 0) {
        const fallbackUrl = `https://api-v2.soundcloud.com/search/tracks?q=${encodeURIComponent('Top Hits Popular')}&client_id=${clientId}&limit=${limit * 2}`;
        const fbJson = await this.fetchWithRelay(fallbackUrl);
        const fbItems: any[] = fbJson?.collection || [];
        for (const item of fbItems) {
          const transformed = this.transformSCTrack(item);
          if (transformed) {
            const dur = transformed.duration || 0;
            const tLower = transformed.title.toLowerCase();
            const aLower = (
              typeof transformed.artist === 'object'
                ? transformed.artist?.name
                : transformed.artist || ''
            )
              .toLowerCase()
              .trim();
            if (
              dur >= 60 &&
              dur <= 600 &&
              aLower !== tLower &&
              !tLower.includes('*billboard') &&
              !tLower.includes('10 hours')
            ) {
              tracks.push(transformed);
            }
          }
          if (tracks.length >= limit) break;
        }
      }

      const result = { tracks: { data: tracks } };
      this.setCache(cacheKey, result);
      return result;
    } catch (e) {
      console.error('[SoundCloudService] getCharts error:', e);
      return { tracks: { data: [] } };
    }
  }

  /**
   * Predefined genres with SoundCloud artwork and descriptions
   */
  public static async getGenres(): Promise<{ data: Genre[] }> {
    const genres: Genre[] = [
      {
        id: 1,
        name: 'Phonk & Drift',
        picture_medium: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=500&q=80',
        picture_big: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=800&q=80',
      },
      {
        id: 2,
        name: 'Hip-Hop & Rap',
        picture_medium: 'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=500&q=80',
        picture_big: 'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=800&q=80',
      },
      {
        id: 3,
        name: 'Русский Рэп & Хип-Хоп',
        picture_medium: 'https://images.unsplash.com/photo-1571266028243-3716f02d2d2e?w=500&q=80',
        picture_big: 'https://images.unsplash.com/photo-1571266028243-3716f02d2d2e?w=800&q=80',
      },
      {
        id: 4,
        name: 'Hyperpop & Glitchcore',
        picture_medium: 'https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?w=500&q=80',
        picture_big: 'https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?w=800&q=80',
      },
      {
        id: 5,
        name: 'Dance & EDM',
        picture_medium: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=500&q=80',
        picture_big: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=800&q=80',
      },
      {
        id: 6,
        name: 'Поп-музыка',
        picture_medium: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=500&q=80',
        picture_big: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=800&q=80',
      },
      {
        id: 7,
        name: 'Русская Поп-музыка',
        picture_medium: 'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?w=500&q=80',
        picture_big: 'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?w=800&q=80',
      },
      {
        id: 8,
        name: 'Рок & Альтернатива',
        picture_medium: 'https://images.unsplash.com/photo-1498038432885-c6f3f1b912ee?w=500&q=80',
        picture_big: 'https://images.unsplash.com/photo-1498038432885-c6f3f1b912ee?w=800&q=80',
      },
      {
        id: 9,
        name: 'Русский Рок',
        picture_medium: 'https://images.unsplash.com/photo-1464375117522-1311d6a5b81f?w=500&q=80',
        picture_big: 'https://images.unsplash.com/photo-1464375117522-1311d6a5b81f?w=800&q=80',
      },
      {
        id: 10,
        name: 'Метал & Кор',
        picture_medium: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=500&q=80',
        picture_big: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=800&q=80',
      },
      {
        id: 11,
        name: 'Lo-Fi Beats & Chill',
        picture_medium: 'https://images.unsplash.com/photo-1518609878373-06d740f60d8b?w=500&q=80',
        picture_big: 'https://images.unsplash.com/photo-1518609878373-06d740f60d8b?w=800&q=80',
      },
      {
        id: 12,
        name: 'House & Deep House',
        picture_medium: 'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?w=500&q=80',
        picture_big: 'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?w=800&q=80',
      },
      {
        id: 13,
        name: 'Techno & Rave',
        picture_medium: 'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=500&q=80',
        picture_big: 'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=800&q=80',
      },
      {
        id: 14,
        name: 'Synthwave & 80s',
        picture_medium: 'https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?w=500&q=80',
        picture_big: 'https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?w=800&q=80',
      },
      {
        id: 15,
        name: 'Инди & Пост-панк',
        picture_medium: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=500&q=80',
        picture_big: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=800&q=80',
      },
      {
        id: 16,
        name: 'Russian Doomer & Тоска',
        picture_medium: 'https://images.unsplash.com/photo-1571266028243-3716f02d2d2e?w=500&q=80',
        picture_big: 'https://images.unsplash.com/photo-1571266028243-3716f02d2d2e?w=800&q=80',
      },
      {
        id: 17,
        name: 'R&B & Soul',
        picture_medium: 'https://images.unsplash.com/photo-1445985543468-39086c88ff67?w=500&q=80',
        picture_big: 'https://images.unsplash.com/photo-1445985543468-39086c88ff67?w=800&q=80',
      },
      {
        id: 18,
        name: 'Trap & Drill',
        picture_medium: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=500&q=80',
        picture_big: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=800&q=80',
      },
      {
        id: 19,
        name: 'K-Pop & Asian Pop',
        picture_medium: 'https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?w=500&q=80',
        picture_big: 'https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?w=800&q=80',
      },
      {
        id: 20,
        name: 'Drum & Bass / Jungle',
        picture_medium: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=500&q=80',
        picture_big: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=800&q=80',
      },
      {
        id: 21,
        name: 'Cyberpunk & Midtempo',
        picture_medium: 'https://images.unsplash.com/photo-1518609878373-06d740f60d8b?w=500&q=80',
        picture_big: 'https://images.unsplash.com/photo-1518609878373-06d740f60d8b?w=800&q=80',
      },
      {
        id: 22,
        name: 'Акустика & Инди-фолк',
        picture_medium: 'https://images.unsplash.com/photo-1498038432885-c6f3f1b912ee?w=500&q=80',
        picture_big: 'https://images.unsplash.com/photo-1498038432885-c6f3f1b912ee?w=800&q=80',
      },
      {
        id: 23,
        name: 'Dubstep & Bass Drop',
        picture_medium: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=500&q=80',
        picture_big: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=800&q=80',
      },
      {
        id: 24,
        name: 'Jazz & Smooth Blues',
        picture_medium: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=500&q=80',
        picture_big: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=800&q=80',
      },
      {
        id: 25,
        name: 'Неоклассика & Piano',
        picture_medium: 'https://images.unsplash.com/photo-1518609878373-06d740f60d8b?w=500&q=80',
        picture_big: 'https://images.unsplash.com/photo-1518609878373-06d740f60d8b?w=800&q=80',
      },
      {
        id: 26,
        name: 'Reggae & Dub Roots',
        picture_medium: 'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=500&q=80',
        picture_big: 'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=800&q=80',
      },
      {
        id: 27,
        name: 'Hardstyle & Rawstyle',
        picture_medium: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=500&q=80',
        picture_big: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=800&q=80',
      },
      {
        id: 28,
        name: 'Punk Rock & Поп-панк',
        picture_medium: 'https://images.unsplash.com/photo-1498038432885-c6f3f1b912ee?w=500&q=80',
        picture_big: 'https://images.unsplash.com/photo-1498038432885-c6f3f1b912ee?w=800&q=80',
      },
      {
        id: 29,
        name: 'Witch House & Darkwave',
        picture_medium: 'https://images.unsplash.com/photo-1518609878373-06d740f60d8b?w=500&q=80',
        picture_big: 'https://images.unsplash.com/photo-1518609878373-06d740f60d8b?w=800&q=80',
      },
      {
        id: 30,
        name: 'Cloud Rap & Sad Trap',
        picture_medium: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=500&q=80',
        picture_big: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=800&q=80',
      },
      {
        id: 31,
        name: 'Shoegaze & Dream Pop',
        picture_medium: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=500&q=80',
        picture_big: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=800&q=80',
      },
      {
        id: 32,
        name: 'Eurodance 90s',
        picture_medium: 'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?w=500&q=80',
        picture_big: 'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?w=800&q=80',
      },
    ];
    return { data: genres };
  }

  /**
   * Get tracks by genre with official SoundCloud genre charts and strict filtering
   */
  public static async getGenreTracks(
    genreId: number | string,
    limit: number = 30,
  ): Promise<{ data: Track[] }> {
    const config = getGenreSearchConfig(genreId);
    if (!config) return { data: [] };

    const scSlug = config.soundCloudSlug;
    const chartTracks: Track[] = [];
    if (scSlug) {
      try {
        const clientId = await this.getSoundCloudKey();
        if (clientId) {
          const chartsUrl = `https://api-v2.soundcloud.com/charts?kind=top&genre=soundcloud%3Agenres%3A${scSlug}&client_id=${clientId}&limit=${limit * 2}`;
          const json = await this.fetchWithRelay(chartsUrl);
          const items: any[] = json?.collection || [];
          for (const item of items) {
            const rawTrack = item?.track || item;
            const transformed = this.transformSCTrack(rawTrack);
            if (transformed) {
              const dur = Number(transformed.duration) || 0;
              if (dur > 600 || (dur > 0 && dur < 40)) continue;
              const titleLower = (transformed.title || '').toLowerCase();
              if (
                /(\b\d+\s*hours?\b|\bloop\b|\bcontinuous mix\b|\bdj set\b|\blive set\b|\bmegamix\b|\bfull album\b|\bсборник\b|\b1 час\b)/i.test(
                  titleLower,
                )
              ) {
                continue;
              }
              chartTracks.push(transformed);
            }
          }

          if (chartTracks.length >= limit) {
            return { data: chartTracks.slice(0, limit) };
          }
        }
      } catch (err) {
        console.debug('[SoundCloudService] Genre chart fetch failed, falling back to search:', err);
      }
    }

    const searches = await Promise.allSettled(
      config.queries.map((query) => this.search(query, limit * 2)),
    );
    const seen = new Set<string>(chartTracks.map((track) => `${track.source}:${track.id}`));
    const matchingTracks = [...chartTracks];
    for (const search of searches) {
      if (search.status !== 'fulfilled') continue;
      for (const track of search.value.data || []) {
        if (!trackHasGenreTag(track, genreId)) continue;
        const key = `${track.source}:${track.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        matchingTracks.push(track);
      }
    }

    const cleanTracks = matchingTracks.filter((t: Track) => {
      const dur = Number(t.duration) || 0;
      if (dur > 600 || (dur > 0 && dur < 40)) return false;
      const titleLower = (t.title || '').toLowerCase();
      if (
        /(\b\d+\s*hours?\b|\bloop\b|\bcontinuous mix\b|\bdj set\b|\blive set\b|\bmegamix\b|\bfull album\b|\bсборник\b|\b1 час\b)/i.test(
          titleLower,
        )
      ) {
        return false;
      }
      return true;
    });

    return { data: cleanTracks.slice(0, limit) };
  }

  /**
   * Search Autocomplete Suggestions (Rich suggestions with title and artist)
   */
  public static async getAutocomplete(query: string): Promise<AutocompleteSuggestion[]> {
    if (!query || query.trim().length < 2) return [];
    const cleanQ = query.trim();

    try {
      const clientId = await this.getSoundCloudKey();
      const trackUrl = `https://api-v2.soundcloud.com/search/tracks?q=${encodeURIComponent(cleanQ)}&client_id=${clientId}&limit=6`;
      const userUrl = `https://api-v2.soundcloud.com/search/users?q=${encodeURIComponent(cleanQ)}&client_id=${clientId}&limit=2`;

      const [trackSettled, userSettled] = await Promise.allSettled([
        this.fetchWithRelay(trackUrl),
        this.fetchWithRelay(userUrl),
      ]);

      const suggestions: AutocompleteSuggestion[] = [];

      // Surfacing top matching artists first
      if (userSettled.status === 'fulfilled' && Array.isArray(userSettled.value?.collection)) {
        for (const user of userSettled.value.collection) {
          if (!user || !user.username) continue;
          const avatar = (user.avatar_url || '').replace('-large.', '-t300x300.');
          suggestions.push({
            id: `sc_art_${user.id}`,
            title: user.username,
            artist: 'Исполнитель',
            type: 'artist',
            source: 'soundcloud',
            picture: avatar || undefined,
          });
        }
      }

      // Track suggestions
      const items: any[] =
        trackSettled.status === 'fulfilled' && Array.isArray(trackSettled.value?.collection)
          ? trackSettled.value.collection
          : [];

      for (const item of items) {
        if (!item || !item.id || !item.title) continue;
        let artistName = item.user?.username || 'SoundCloud';
        let trackTitle = item.title;
        if (trackTitle.includes(' - ')) {
          const parts = trackTitle.split(' - ');
          if (parts.length >= 2) {
            artistName = parts[0].trim();
            trackTitle = parts.slice(1).join(' - ').trim();
          }
        }
        const artwork = (item.artwork_url || item.user?.avatar_url || '').replace(
          '-large.',
          '-t300x300.',
        );
        suggestions.push({
          id: item.id,
          title: trackTitle,
          artist: artistName,
          type: 'track',
          source: 'soundcloud',
          picture: artwork || undefined,
        });
      }

      // If fewer than 5 items, add query text suggestions
      if (suggestions.length < 5) {
        const queryUrl = `https://api-v2.soundcloud.com/search/queries?q=${encodeURIComponent(cleanQ)}&client_id=${clientId}&limit=5`;
        const qJson = await this.fetchWithRelay(queryUrl);
        const qItems: any[] = qJson?.collection || [];
        for (const q of qItems) {
          const text = q.query || q.output;
          if (text && !suggestions.some((s) => s.title.toLowerCase() === text.toLowerCase())) {
            suggestions.push({
              id: `q_${text}`,
              title: text,
              artist: 'Поиск',
              type: 'track',
            });
          }
        }
      }

      return suggestions.slice(0, 6);
    } catch (e) {
      return [];
    }
  }

  /**
   * Helper to resolve audio stream URL from a list of transcodings
   */
  private static streamEndpointKey(raw: string): string {
    try {
      const url = new URL(raw);
      url.searchParams.delete('client_id');
      return url.href;
    } catch {
      return '';
    }
  }

  private static async resolveStreamFromTranscodings(
    transcodings: any[],
    clientId: string,
    attempted = new Set<string>(),
    fullDuration = 0,
    preferAlternateFormat = false,
  ): Promise<string | null> {
    assertStreamResolveActive();
    if (!Array.isArray(transcodings) || transcodings.length === 0) return null;

    const validTranscodings = transcodings.filter((t) =>
      isFullSoundCloudTranscoding(t, fullDuration),
    );

    // Prevent the preview fallback from re-requesting a known encrypted/snipped rendition.
    for (const format of transcodings) {
      if (!validTranscodings.includes(format)) {
        const key = this.streamEndpointKey(format?.url || '');
        if (key) attempted.add(key);
      }
    }
    PlaybackLogger.debug(
      '[SoundCloud:Formats] described=' +
        transcodings.length +
        ' supported=' +
        validTranscodings.length +
        ' encrypted=' +
        transcodings.filter(
          (t) =>
            String(t?.format?.protocol || '').includes('encrypted') ||
            String(t?.url || '').includes('encrypted'),
        ).length,
    );
    // Prioritize progressive MP3 streams first, then unencrypted HLS streams
    const sorted = [...validTranscodings].sort((a, b) => {
      const aIsProg = a.format?.protocol === 'progressive' ? 1 : 0;
      const bIsProg = b.format?.protocol === 'progressive' ? 1 : 0;
      return bIsProg - aIsProg;
    });

    // Try a different rendition of this recording after its first CDN/decoder failed.
    if (preferAlternateFormat) sorted.reverse();
    let temporaryFailure: unknown;
    for (const tc of sorted) {
      try {
        const endpointKey = this.streamEndpointKey(tc.url);
        if (!endpointKey || attempted.has(endpointKey)) continue;
        attempted.add(endpointKey);
        const sep = tc.url.includes('?') ? '&' : '?';
        const streamEndpoint = `${tc.url}${sep}client_id=${clientId}`;
        const streamJson = await streamWait(this.fetchWithRelay(streamEndpoint, false, true));
        if (
          streamJson?.url &&
          typeof streamJson.url === 'string' &&
          streamJson.url.startsWith('http') &&
          !isSoundCloudPreviewUrl(streamJson.url)
        ) {
          PlaybackLogger.debug('[SoundCloud:Format] Selected recording rendition', {
            protocol: tc.format?.protocol,
            preset: tc.preset,
            alternate: preferAlternateFormat,
          });
          return streamJson.url;
        }
      } catch (e) {
        assertStreamResolveActive();
        if (getStreamResolveFailure(e) === 'rate-limit') throw e;
        if (getStreamResolveFailure(e)) temporaryFailure = e;
        // Continue to next transcoding
      }
    }

    if (temporaryFailure) throw temporaryFailure;
    return null;
  }

  /**
   * Scores and matches best track candidate against target track
   */
  public static findBestTrackMatch(
    targetTrack: { title?: string; artist?: any; duration?: number },
    collection: any[],
  ): any | null {
    if (!Array.isArray(collection) || collection.length === 0) return null;

    const targetTitle = (targetTrack.title || '').toLowerCase().trim();
    const targetArtist = (
      typeof targetTrack.artist === 'object' ? targetTrack.artist?.name : targetTrack.artist || ''
    )
      .toLowerCase()
      .trim();
    const targetDuration = Number(targetTrack.duration) > 0 ? Number(targetTrack.duration) : 180;

    let bestItem = null;
    let highestScore = -999;

    for (const item of collection) {
      if (!item || !item.id || !item.title) continue;

      // Skip tracks with blocked policy, Go+ subscription paywall, or explicitly empty transcodings
      if (isSoundCloudRestrictedTrack(item)) continue;
      if (
        item.media &&
        Array.isArray(item.media.transcodings) &&
        item.media.transcodings.length === 0
      )
        continue;

      const itemTitle = (item.title || '').toLowerCase();
      const itemArtist = (
        typeof item.artist === 'object'
          ? item.artist?.name
          : item.artist || item.user?.username || ''
      ).toLowerCase();

      const rawDur = Number(item.duration) || 0;
      const itemDuration = rawDur > 1000 ? Math.round(rawDur / 1000) : Math.round(rawDur);

      if (targetDuration > 60 && itemDuration <= 35) continue;

      let score = 100;

      // Duration penalty
      const durDiff = Math.abs(itemDuration - targetDuration);
      if (durDiff > 15) {
        score -= durDiff * 2;
      }

      // Title matching
      if (itemTitle.includes(targetTitle)) {
        score += 30;
      }

      // Artist matching
      if (targetArtist && (itemArtist.includes(targetArtist) || itemTitle.includes(targetArtist))) {
        score += 40;
      }

      // Transcodings availability bonus
      if (
        item.media &&
        Array.isArray(item.media.transcodings) &&
        item.media.transcodings.length > 0
      ) {
        score += 10;
      }

      // Reject unwanted covers / slowed / nightcore unless target asked for it
      const unwantedKeywords = [
        'slowed',
        'reverb',
        'nightcore',
        'cover',
        'instrumental',
        'karaoke',
      ];
      for (const kw of unwantedKeywords) {
        if (itemTitle.includes(kw) && !targetTitle.includes(kw)) {
          score -= 60;
        }
      }

      if (score > highestScore) {
        highestScore = score;
        bestItem = item;
      }
    }

    return bestItem;
  }

  private static streamCache = new Map<string, { url: string; expiresAt: number }>();
  private static STREAM_CACHE_TTL = 7 * 60 * 1000; // 7 minutes TTL for signed CDN URLs

  /**
   * Resolves direct high quality audio CDN stream URL from track
   */
  public static async getFullStreamUrl(
    track: Track,
    options: StreamResolveOptions = {},
  ): Promise<string> {
    assertStreamResolveActive();
    if (!track) return '';
    const id = String(track.id || track.preview || track.title);
    const fresh = !!options.forceRefresh || !!(track as any).forDownload;
    if (fresh) this.unavailableStreams.delete(id);
    else if ((this.unavailableStreams.get(id) || 0) > Date.now()) return '';
    const key = id + (fresh ? ':fresh' : ':normal');
    if (currentStreamResolveSignal()) return this.resolveFullStreamUrl(track, options);
    const pending = this.pendingStreams.get(key);
    if (pending) return pending;
    const request = this.resolveFullStreamUrl(track, options);
    this.pendingStreams.set(key, request);
    try {
      const url = await streamWait(request);
      if (url) this.unavailableStreams.delete(id);
      else if (
        !fresh &&
        !((this.streamCache.get(`stream:${track.id}`)?.expiresAt || 0) > Date.now())
      ) {
        if (this.unavailableStreams.size >= 300)
          this.unavailableStreams.delete(this.unavailableStreams.keys().next().value!);
        this.unavailableStreams.set(id, Date.now() + 5000);
      }
      return url;
    } finally {
      if (this.pendingStreams.get(key) === request) this.pendingStreams.delete(key);
    }
  }

  private static async resolveFullStreamUrl(
    track: Track,
    options: StreamResolveOptions,
    recoverMissing = true,
  ): Promise<string> {
    assertStreamResolveActive();
    if (!track) return '';

    const startMs = Date.now();
    const attempted = new Set<string>();

    // Downloads always resolve a fresh URL — signed CDN links cached for
    // playback may already be expired, which yields 403 XML instead of audio.
    const bypassCache = !!(track as any).forDownload || !!options.forceRefresh;

    // If stream URL is already resolved and fresh
    const now = Date.now();
    if (
      !bypassCache &&
      track.resolvedStreamUrl &&
      track.resolvedStreamUrl.startsWith('http') &&
      !track.resolvedStreamUrl.includes('api-v2.soundcloud.com') &&
      !isYouTubeAudioStreamUrl(track.resolvedStreamUrl) &&
      !isSoundCloudPreviewUrl(track.resolvedStreamUrl) &&
      typeof track.resolvedStreamTimestamp === 'number' &&
      now - track.resolvedStreamTimestamp < this.STREAM_CACHE_TTL
    ) {
      PlaybackLogger.debug(
        `[SoundCloud] Memory stream cache hit for "${track.title}" (id: ${track.id})`,
      );
      return track.resolvedStreamUrl;
    }

    const cacheKey = `stream:${track.id}`;
    if (!bypassCache && this.streamCache.has(cacheKey)) {
      const cached = this.streamCache.get(cacheKey);
      if (
        cached &&
        now < cached.expiresAt &&
        cached.url.startsWith('http') &&
        !cached.url.includes('api-v2.soundcloud.com') &&
        !isYouTubeAudioStreamUrl(cached.url) &&
        !isSoundCloudPreviewUrl(cached.url)
      ) {
        PlaybackLogger.debug(
          `[SoundCloud] Stream map cache hit for "${track.title}" (id: ${track.id})`,
        );
        return cached.url;
      }
    }

    PlaybackLogger.info(`[SoundCloud] Resolving stream for "${track.title}" (id: ${track.id})...`);

    try {
      const clientId = await streamShared(() => this.getSoundCloudKey());

      // Step 1: Fetch full track details to get progressive MP3 transcodings directly
      const rawId = String(track.id || '');
      let numericId = rawId.replace(/^sc_/, '');
      if (!/^\d+$/.test(numericId) && track.preview) {
        const match = track.preview.match(/tracks:(\d+)/) || track.preview.match(/tracks\/(\d+)/);
        if (match) numericId = match[1];
      }
      if (/^\d+$/.test(numericId)) {
        const trackEndpoint = `https://api-v2.soundcloud.com/tracks/${numericId}?client_id=${clientId}`;
        let metadataStatus = 0;
        const trackJson = await streamWait(
          this.fetchWithRelay(trackEndpoint, false, true, undefined, (status) => {
            metadataStatus = status;
          }),
        );
        if (metadataStatus === 404 || metadataStatus === 410) {
          if (
            recoverMissing &&
            !(track as any).forDownload &&
            Number.isFinite(track.duration) &&
            track.duration > 0
          ) {
            const artist = typeof track.artist === 'string' ? track.artist : track.artist?.name;
            if (artist && track.title) {
              const found = await streamWait(this.search(artist + ' ' + track.title, 8));
              const matches = found.data
                .filter(
                  (candidate) =>
                    String(candidate.id).replace(/^sc_/, '') !== numericId &&
                    candidate.source === 'soundcloud' &&
                    candidate.duration > 0 &&
                    matchesImportedRecording(track, candidate),
                )
                .slice(0, 2);
              for (const candidate of matches) {
                const replacement = await streamWait(
                  this.resolveFullStreamUrl(candidate, options, false),
                );
                if (!replacement) continue;
                if (this.streamCache.size >= this.MAX_CACHE_SIZE)
                  this.streamCache.delete(this.streamCache.keys().next().value!);
                this.streamCache.set(cacheKey, {
                  url: replacement,
                  expiresAt: Date.now() + this.STREAM_CACHE_TTL,
                });
                PlaybackLogger.info(
                  '[SoundCloud:Recovery] Removed recording ' +
                    numericId +
                    ' matched available recording ' +
                    candidate.id,
                );
                return replacement;
              }
            }
          }
          return '';
        }
        if (trackJson?.id !== undefined && String(trackJson.id) !== numericId) {
          PlaybackLogger.warn(
            '[SoundCloud:Identity] Metadata belongs to another recording; refusing playback',
          );
          return '';
        }
        if (isSoundCloudRestrictedTrack(trackJson)) return '';
        const fullDuration = Math.max(
          Number(trackJson?.full_duration) || 0,
          Number(trackJson?.duration) || 0,
        );
        const transcodings: any[] = trackJson?.media?.transcodings || [];

        const streamUrl = await streamWait(
          this.resolveStreamFromTranscodings(
            transcodings,
            clientId,
            attempted,
            fullDuration,
            !!options.preferAlternateFormat,
          ),
        );
        if (streamUrl) {
          if (this.streamCache.size >= this.MAX_CACHE_SIZE) {
            const oldest = this.streamCache.keys().next().value;
            if (oldest !== undefined) this.streamCache.delete(oldest);
          }
          this.streamCache.set(cacheKey, {
            url: streamUrl,
            expiresAt: Date.now() + this.STREAM_CACHE_TTL,
          });
          PlaybackLogger.info(
            `[SoundCloud] Stream resolved from transcodings in ${Date.now() - startMs}ms for "${track.title}" (numericId: ${numericId})`,
          );
          return streamUrl;
        }
      }

      // Step 2: Fallback to track.preview endpoint
      const previewKey = this.streamEndpointKey(track.preview || '');
      if (
        track.preview &&
        previewKey &&
        track.preview.includes('api-v2.soundcloud.com/media') &&
        !isSoundCloudPreviewUrl(track.preview) &&
        !attempted.has(previewKey)
      ) {
        const sep = track.preview.includes('?') ? '&' : '?';
        const streamEndpoint = `${track.preview}${sep}client_id=${clientId}`;
        const streamJson = await streamWait(this.fetchWithRelay(streamEndpoint, false, true));
        if (
          streamJson?.url &&
          typeof streamJson.url === 'string' &&
          streamJson.url.startsWith('http') &&
          !isSoundCloudPreviewUrl(streamJson.url)
        ) {
          if (this.streamCache.size >= this.MAX_CACHE_SIZE) {
            const oldest = this.streamCache.keys().next().value;
            if (oldest !== undefined) this.streamCache.delete(oldest);
          }
          this.streamCache.set(cacheKey, {
            url: streamJson.url,
            expiresAt: Date.now() + this.STREAM_CACHE_TTL,
          });
          PlaybackLogger.info(
            `[SoundCloud] Stream resolved from preview endpoint in ${Date.now() - startMs}ms for "${track.title}"`,
          );
          return streamJson.url;
        }
      }
    } catch (e) {
      assertStreamResolveActive();
      PlaybackLogger.warn(
        `[SoundCloud] Error resolving stream for "${track.title}" (id: ${track.id}) after ${Date.now() - startMs}ms:`,
        e,
      );
      console.error('[SoundCloudService] Stream resolve error:', e);
      if (getStreamResolveFailure(e)) throw e;
    }

    // Never return raw api-v2 endpoint as audio stream URL
    if (
      track.preview &&
      track.preview.startsWith('http') &&
      !track.preview.includes('api-v2.soundcloud.com') &&
      !isYouTubeAudioStreamUrl(track.preview) &&
      !isSoundCloudPreviewUrl(track.preview)
    ) {
      PlaybackLogger.info(
        `[SoundCloud] Using direct audio preview URL for "${track.title}" in ${Date.now() - startMs}ms`,
      );
      return track.preview;
    }

    PlaybackLogger.warn(
      `[SoundCloud] Failed to resolve stream for "${track.title}" (id: ${track.id}) after ${Date.now() - startMs}ms`,
    );
    return '';
  }

  /**
   * Get related tracks from SoundCloud's recommendation graph
   */
  public static async getRelatedTracks(
    trackId: string | number,
    limit: number = 20,
    signal?: AbortSignal,
  ): Promise<Track[]> {
    if (!trackId) return [];
    const rawId = String(trackId).replace(/^sc_/i, '').trim();
    if (!rawId || !/^\d+$/.test(rawId)) return [];

    signal?.throwIfAborted();
    try {
      const clientId = await this.getSoundCloudKey();
      const url = `https://api-v2.soundcloud.com/tracks/${rawId}/related?client_id=${clientId}&limit=${limit}`;
      const json = await this.fetchWithRelay(url, false, false, signal);
      const items: any[] = json?.collection || [];
      const tracks: Track[] = [];
      for (const item of items) {
        const transformed = this.transformSCTrack(item);
        if (transformed) tracks.push(transformed);
      }
      return tracks;
    } catch (e) {
      signal?.throwIfAborted();
      console.error('[SoundCloudService] getRelatedTracks error:', e);
      return [];
    }
  }

  /**
   * Search Artists / Users on SoundCloud
   */
  public static async searchArtists(query: string, limit: number = 6): Promise<Artist[]> {
    assertStreamResolveActive();
    if (!query || !query.trim()) return [];
    try {
      const clientId = await streamShared(() => this.getSoundCloudKey());
      const endpoint = `https://api-v2.soundcloud.com/search/users?q=${encodeURIComponent(query.trim())}&client_id=${clientId}&limit=${limit}`;
      const json = await streamWait(
        this.fetchWithRelay(endpoint, false, false, undefined, undefined, true),
      );
      if (!Array.isArray(json?.collection)) throw createStreamResolveError('provider');
      const items: any[] = json?.collection || [];
      return items.map((u: any) => {
        const rawAvatar = u.avatar_url || '';
        const hdAvatar = this.toSoundCloudHdCover(rawAvatar);
        return {
          id: `sc_art_${u.id}`,
          name: u.username,
          picture: hdAvatar || rawAvatar,
          picture_medium: hdAvatar || rawAvatar,
          picture_big: hdAvatar || rawAvatar,
          nb_album: u.track_count || 0,
          nb_fan: u.followers_count || 0,
          source: 'soundcloud' as const,
        };
      });
    } catch (e) {
      console.error('[SoundCloudService] searchArtists error:', e);
      assertStreamResolveActive();
      throw e;
    }
  }

  /**
   * Converts any SoundCloud artwork/avatar URL variant to high definition 500x500
   */
  public static toSoundCloudHdCover(url?: string | null): string {
    return toSoundCloudHdCover(url);
  }

  /**
   * Resolves HD artwork for a playlist/album by inspecting direct artwork,
   * tracks artwork, user avatar, and fallback avatar.
   */
  public static extractPlaylistCover(p: any, fallbackUserAvatar?: string): string {
    return extractPlaylistCover(p, fallbackUserAvatar);
  }

  public static resolveTrackAlbums(tracks: any[], playlists: any[]): any[] {
    if (!Array.isArray(tracks)) return [];
    const trackIdToAlbumMap = new Map<
      string | number,
      { id: number | string; title: string; cover: string }
    >();

    if (Array.isArray(playlists)) {
      for (const pl of playlists) {
        if (!pl || !pl.id) continue;
        const albumTitle = pl.title || '';
        const albumCover = SoundCloudService.extractPlaylistCover(pl, pl.user?.avatar_url);

        if (Array.isArray(pl.tracks)) {
          for (const t of pl.tracks) {
            if (!t || !t.id) continue;
            trackIdToAlbumMap.set(t.id, {
              id: pl.id,
              title: albumTitle,
              cover: albumCover,
            });
          }
        }
      }
    }

    return tracks.map((t) => {
      const match = trackIdToAlbumMap.get(t.id);
      if (match) {
        return {
          ...t,
          album: {
            id: match.id,
            title: match.title,
            cover: match.cover,
            cover_medium: match.cover,
          },
        };
      }
      return t;
    });
  }

  /**
   * Get SoundCloud Artist details, top tracks and playlists/albums
   */
  public static async getArtist(
    idOrName: string | number,
    expectedArtistName?: string,
  ): Promise<ArtistDetails | null> {
    if (!idOrName) return null;
    const query = String(idOrName).trim();
    const cleanUserQuery = query
      .replace(/^sc_art_/i, '')
      .replace(/^sc_/i, '')
      .trim();

    try {
      const clientId = await this.getSoundCloudKey();
      let userData: any = null;

      if (/^\d+$/.test(cleanUserQuery)) {
        userData = await this.fetchWithRelay(
          `https://api-v2.soundcloud.com/users/${cleanUserQuery}?client_id=${clientId}`,
        );
        // If numeric user ID belongs to a third-party uploader/reposter rather than the expected artist,
        // discard it and search for the real artist by name.
        if (userData && expectedArtistName) {
          const fetchedUsername = userData.username || '';
          const normFetched = normalizeText(fetchedUsername);
          const normExpected = normalizeText(expectedArtistName);
          if (
            normFetched !== normExpected &&
            !isArtistMatch(
              { user: { username: fetchedUsername }, artist: fetchedUsername },
              expectedArtistName,
            )
          ) {
            console.debug(
              `[SoundCloudService] Numeric user ${cleanUserQuery} ("${fetchedUsername}") does not match expected artist "${expectedArtistName}". Falling back to search.`,
            );
            userData = null;
          }
        }
      }

      if (!userData) {
        const searchQuery = (expectedArtistName || cleanUserQuery).trim();
        const searchJson = await this.fetchWithRelay(
          `https://api-v2.soundcloud.com/search/users?q=${encodeURIComponent(searchQuery)}&client_id=${clientId}&limit=10`,
        );
        const users: any[] = searchJson?.collection || [];
        if (users.length > 0) {
          const cleanLower = searchQuery.toLowerCase().trim();
          users.sort((a, b) => {
            const aExact = a.username?.toLowerCase().trim() === cleanLower ? 1 : 0;
            const bExact = b.username?.toLowerCase().trim() === cleanLower ? 1 : 0;
            if (aExact !== bExact) return bExact - aExact;
            const aScore =
              (a.followers_count || 0) + ((a.track_count || 0) + (a.playlist_count || 0)) * 50;
            const bScore =
              (b.followers_count || 0) + ((b.track_count || 0) + (b.playlist_count || 0)) * 50;
            return bScore - aScore;
          });
          userData = users[0];
        }
      }

      if (!userData || !userData.id) return null;

      const rawAvatar = userData.avatar_url || '';
      const hdAvatar = this.toSoundCloudHdCover(rawAvatar);

      const artist: Artist = {
        id: `sc_art_${userData.id}`,
        name: userData.username,
        picture: hdAvatar || rawAvatar,
        picture_medium: hdAvatar || rawAvatar,
        picture_big: hdAvatar || rawAvatar,
        picture_xl: hdAvatar || rawAvatar,
        nb_album: userData.playlist_count || 0,
        nb_fan: userData.followers_count || 0,
        source: 'soundcloud',
      };

      // Fetch tracks, toptracks, albums, playlists, and related artists (from GooseOb/music_plr)
      const [tracksRes, topTracksRes, albumsRes, playlistsRes, playlistsNoAlbumsRes, relatedRes] =
        await Promise.allSettled([
          this.fetchWithRelay(
            `https://api-v2.soundcloud.com/users/${userData.id}/tracks?client_id=${clientId}&limit=50`,
          ),
          this.fetchWithRelay(
            `https://api-v2.soundcloud.com/users/${userData.id}/toptracks?client_id=${clientId}&limit=50`,
          ),
          this.fetchWithRelay(
            `https://api-v2.soundcloud.com/users/${userData.id}/albums?client_id=${clientId}&limit=50`,
          ),
          this.fetchWithRelay(
            `https://api-v2.soundcloud.com/users/${userData.id}/playlists?client_id=${clientId}&limit=50`,
          ),
          this.fetchWithRelay(
            `https://api-v2.soundcloud.com/users/${userData.id}/playlists_without_albums?client_id=${clientId}&limit=50`,
          ),
          this.fetchWithRelay(
            `https://api-v2.soundcloud.com/users/${userData.id}/relatedartists?client_id=${clientId}&limit=10`,
          ),
        ]);

      const rawTopTracks =
        topTracksRes.status === 'fulfilled' ? topTracksRes.value?.collection || [] : [];
      const rawNormalTracks =
        tracksRes.status === 'fulfilled' ? tracksRes.value?.collection || [] : [];
      // Prioritize actual top tracks, falling back to chronological tracks
      const rawTracks = rawTopTracks.length > 0 ? rawTopTracks : rawNormalTracks;
      const rawAlbums = albumsRes.status === 'fulfilled' ? albumsRes.value?.collection || [] : [];
      const rawPlaylists =
        playlistsRes.status === 'fulfilled' ? playlistsRes.value?.collection || [] : [];
      const rawPlaylistsNoAlbums =
        playlistsNoAlbumsRes.status === 'fulfilled'
          ? playlistsNoAlbumsRes.value?.collection || []
          : [];

      const allRawCollections = [...rawAlbums, ...rawPlaylists, ...rawPlaylistsNoAlbums];
      const seenAlbumIds = new Set<string | number>();
      const albums: Album[] = [];
      const trackIdToAlbumMap = new Map<
        string | number,
        { id: number | string; title: string; cover: string }
      >();
      const trackTitleToAlbumMap = new Map<
        string,
        { id: number | string; title: string; cover: string }
      >();

      for (const p of allRawCollections) {
        if (!p || !p.id || seenAlbumIds.has(p.id)) continue;

        // Skip reposted playlists of other users
        const isOwner = !p.user_id || p.user_id === userData.id || p.user?.id === userData.id;
        if (!isOwner) continue;

        seenAlbumIds.add(p.id);

        const cover = this.extractPlaylistCover(p, hdAvatar || rawAvatar);
        const albumTitle = fixMojibake(p.title) || 'Album';

        const trkCount = p.track_count || (p.tracks ? p.tracks.length : 0);
        const rawSetType = (p.set_type || '').toLowerCase();
        let recordType: 'album' | 'ep' | 'single' | 'compilation' = 'album';
        if (rawSetType === 'ep' || (trkCount >= 2 && trkCount <= 5)) {
          recordType = 'ep';
        } else if (rawSetType === 'single' || trkCount === 1) {
          recordType = 'single';
        } else if (rawSetType === 'compilation') {
          recordType = 'compilation';
        } else if (rawSetType === 'album' || p.is_album) {
          recordType = 'album';
        }

        albums.push({
          id: p.id,
          title: albumTitle,
          cover: cover,
          cover_medium: cover,
          cover_big: cover,
          cover_xl: cover,
          release_date: p.release_date || p.created_at,
          record_type: recordType,
          track_count: trkCount,
          artist: {
            id: artist.id,
            name: artist.name,
          },
        });

        // Map tracks inside this album (both number and string keys)
        for (const trk of p.tracks || []) {
          if (trk?.id) {
            trackIdToAlbumMap.set(trk.id, { id: p.id, title: albumTitle, cover });
            trackIdToAlbumMap.set(String(trk.id), { id: p.id, title: albumTitle, cover });
          }
          if (trk?.title) {
            const norm = fixMojibake(trk.title)
              .toLowerCase()
              .replace(/[^a-z0-9а-яё]/g, '')
              .trim();
            if (norm) {
              trackTitleToAlbumMap.set(norm, { id: p.id, title: albumTitle, cover });
            }
          }
        }
      }

      // Sort albums newest first
      albums.sort((a, b) => {
        const dateA = a.release_date ? new Date(a.release_date).getTime() : 0;
        const dateB = b.release_date ? new Date(b.release_date).getTime() : 0;
        return dateB - dateA;
      });

      const topTracks: Track[] = [];
      for (const item of rawTracks) {
        const transformed = this.transformSCTrack(item);
        if (transformed) {
          // If track doesn't have an album or has default 'Single', resolve it from the artist's albums!
          if (!transformed.album?.title || transformed.album.title === 'Single') {
            const rawId = Number(String(transformed.id).replace(/^sc_/i, ''));
            const normTitle = transformed.title
              .toLowerCase()
              .replace(/[^a-z0-9а-яё]/g, '')
              .trim();
            const matchedAlb =
              trackIdToAlbumMap.get(transformed.id) ||
              trackIdToAlbumMap.get(rawId) ||
              trackTitleToAlbumMap.get(normTitle);

            if (matchedAlb) {
              transformed.album = {
                id: matchedAlb.id,
                title: matchedAlb.title,
                cover: matchedAlb.cover || transformed.album?.cover,
                cover_medium: matchedAlb.cover || transformed.album?.cover_medium,
                cover_big: matchedAlb.cover || transformed.album?.cover_big,
                cover_xl: matchedAlb.cover || transformed.album?.cover_xl,
              };
            }
          }
          topTracks.push(transformed);
        }
      }

      const similarArtists: {
        id: string | number;
        name: string;
        picture?: string;
        stat?: string;
      }[] = [];
      if (relatedRes.status === 'fulfilled' && Array.isArray(relatedRes.value?.collection)) {
        for (const rel of relatedRes.value.collection) {
          if (!rel || !rel.username) continue;
          similarArtists.push({
            id: `sc_art_${rel.id}`,
            name: rel.username,
            picture: toSoundCloudHdCover(rel.avatar_url),
            stat: rel.followers_count ? `${rel.followers_count} подписчиков` : undefined,
          });
        }
      }

      return {
        artist,
        topTracks,
        albums,
        similarArtists: similarArtists.slice(0, 10),
      };
    } catch (e) {
      console.error('[SoundCloudService] getArtist error:', e);
      return null;
    }
  }

  /**
   * Get all tracks for an artist on SoundCloud with album resolution
   */
  public static async getArtistAllTracks(
    artistId: string | number,
    artistName: string,
  ): Promise<Track[]> {
    const tracksMap = new Map<string, Track>();
    const cleanUserId = String(artistId)
      .replace(/^sc_art_/i, '')
      .replace(/^sc_/i, '')
      .trim();

    let numericUserId = /^\d+$/.test(cleanUserId) ? cleanUserId : null;
    if (!numericUserId) {
      try {
        const artistDetails = await this.getArtist(artistId, artistName);
        if (artistDetails?.artist?.id) {
          const resolvedId = String(artistDetails.artist.id)
            .replace(/^sc_art_/i, '')
            .replace(/^sc_/i, '')
            .trim();
          if (/^\d+$/.test(resolvedId)) {
            numericUserId = resolvedId;
          }
        }
      } catch (err) {
        console.debug('[SoundCloudService] getArtistAllTracks user resolution error:', err);
      }
    }

    try {
      const clientId = await this.getSoundCloudKey();
      const promises: Promise<any>[] = [];

      if (numericUserId) {
        promises.push(
          this.fetchCollectionPages(
            `https://api-v2.soundcloud.com/users/${numericUserId}/tracks?client_id=${clientId}&limit=100`,
          ),
        );
        promises.push(
          this.fetchCollectionPages(
            `https://api-v2.soundcloud.com/users/${numericUserId}/albums?client_id=${clientId}&limit=50`,
          ),
        );
        promises.push(
          this.fetchCollectionPages(
            `https://api-v2.soundcloud.com/users/${numericUserId}/playlists?client_id=${clientId}&limit=50`,
          ),
        );
      }
      if (artistName) {
        promises.push(
          this.fetchWithRelay(
            `https://api-v2.soundcloud.com/search/tracks?q=${encodeURIComponent(artistName)}&client_id=${clientId}&limit=50`,
          ),
        );
      }

      const results = await Promise.allSettled(promises);
      const trackIdToAlbumMap = new Map<
        string | number,
        { id: number | string; title: string; cover: string }
      >();
      const trackTitleToAlbumMap = new Map<
        string,
        { id: number | string; title: string; cover: string }
      >();

      // First extract album/playlist track associations
      for (const res of results) {
        if (res.status === 'fulfilled' && Array.isArray(res.value?.collection)) {
          for (const item of res.value.collection) {
            if (Array.isArray(item.tracks) && item.tracks.length > 0 && item.title) {
              const albumTitle = fixMojibake(item.title);
              const cover = this.extractPlaylistCover(item, item.user?.avatar_url);
              for (const trk of item.tracks) {
                if (trk?.id) {
                  trackIdToAlbumMap.set(trk.id, { id: item.id, title: albumTitle, cover });
                }
                if (trk?.title) {
                  const norm = fixMojibake(trk.title)
                    .toLowerCase()
                    .replace(/[^a-z0-9а-яё]/g, '')
                    .trim();
                  if (norm)
                    trackTitleToAlbumMap.set(norm, { id: item.id, title: albumTitle, cover });
                }
              }
            }
          }
        }
      }

      // Now process all tracks and assign real albums
      for (const res of results) {
        if (res.status === 'fulfilled' && Array.isArray(res.value?.collection)) {
          for (const item of res.value.collection) {
            if (item.kind === 'playlist') continue;
            const transformed = this.transformSCTrack(item);
            if (transformed && transformed.id && !tracksMap.has(String(transformed.id))) {
              if (!transformed.album?.title || transformed.album.title === 'Single') {
                const rawId = Number(String(transformed.id).replace(/^sc_/i, ''));
                const normTitle = transformed.title
                  .toLowerCase()
                  .replace(/[^a-z0-9а-яё]/g, '')
                  .trim();
                const matchedAlb =
                  trackIdToAlbumMap.get(transformed.id) ||
                  trackIdToAlbumMap.get(rawId) ||
                  trackTitleToAlbumMap.get(normTitle);

                if (matchedAlb) {
                  transformed.album = {
                    id: matchedAlb.id,
                    title: matchedAlb.title,
                    cover: matchedAlb.cover || transformed.album?.cover,
                    cover_medium: matchedAlb.cover || transformed.album?.cover_medium,
                    cover_big: matchedAlb.cover || transformed.album?.cover_big,
                    cover_xl: matchedAlb.cover || transformed.album?.cover_xl,
                  };
                }
              }
              tracksMap.set(String(transformed.id), transformed);
            }
          }
        }
      }
    } catch (e) {
      console.error('[SoundCloudService] getArtistAllTracks error:', e);
    }

    return Array.from(tracksMap.values());
  }

  /** Follow provider pagination without allowing repeated pages or arbitrary relay destinations. */
  private static async fetchCollectionPages(endpoint: string): Promise<{ collection: any[] }> {
    const initial = new URL(endpoint);
    const pages = new Set<string>();
    const collection: any[] = [];
    let next = endpoint;
    while (next && pages.size < 100) {
      assertStreamResolveActive();
      const url = new URL(next, initial);
      if (url.origin !== initial.origin || url.pathname !== initial.pathname || pages.has(url.href))
        break;
      pages.add(url.href);
      const response = await streamWait(this.fetchWithRelay(url.href));
      if (!Array.isArray(response?.collection)) break;
      collection.push(...response.collection);
      next = typeof response.next_href === 'string' ? response.next_href : '';
    }
    return { collection };
  }

  public static async getGenreList(): Promise<{ data: Genre[] }> {
    return await this.getGenres();
  }

  public static async getAlbum(id: string | number): Promise<Album | null> {
    const cleanId = String(id).replace(/^(sc_alb_|sc_)/, '');
    if (!/^\d+$/.test(cleanId)) return null;
    try {
      const clientId = await this.getSoundCloudKey();
      const p = await this.fetchWithRelay(
        `https://api-v2.soundcloud.com/playlists/${cleanId}?client_id=${clientId}`,
      );
      if (!p || !p.id) return null;
      const cover = this.extractPlaylistCover(p, p.user?.avatar_url);
      const trkCount = p.track_count || (p.tracks ? p.tracks.length : 0);
      const rawSetType = (p.set_type || '').toLowerCase();
      let recordType: 'album' | 'ep' | 'single' | 'compilation' = 'album';
      if (rawSetType === 'ep' || (trkCount >= 2 && trkCount <= 5)) {
        recordType = 'ep';
      } else if (rawSetType === 'single' || trkCount === 1) {
        recordType = 'single';
      } else if (rawSetType === 'compilation') {
        recordType = 'compilation';
      }

      return {
        id: p.id,
        title: fixMojibake(p.title),
        cover: cover,
        cover_medium: cover,
        cover_big: cover,
        cover_xl: cover,
        release_date: p.release_date || p.created_at,
        record_type: recordType,
        track_count: trkCount,
        artist: {
          id: `sc_art_${p.user?.id}`,
          name: fixMojibake(p.user?.username) || 'Unknown Artist',
        },
      };
    } catch (e) {
      return null;
    }
  }

  public static hydratePlaylistTracks(
    playlistTracks: any[],
    fullTracksMap: Map<number | string, any>,
    albumInfo?: { id: number | string; title: string; cover: string },
  ): Track[] {
    return hydrateSoundCloudPlaylistTracks(playlistTracks, fullTracksMap, albumInfo);
  }

  private static async fetchPlaylistTracksById(
    playlistId: string,
    albumTitle?: string,
    artistName?: string,
  ): Promise<Track[] | null> {
    const clientId = await this.getSoundCloudKey();
    const playlist = await this.fetchWithRelay(
      `https://api-v2.soundcloud.com/playlists/${playlistId}?client_id=${clientId}`,
    );
    if (!Array.isArray(playlist?.tracks)) return null;
    const normalized = (value: string) => normalizeText(fixMojibake(value).normalize('NFKC'));
    if (albumTitle && normalized(playlist.title || '') !== normalized(albumTitle)) return null;
    if (artistName && normalized(playlist.user?.username || '') !== normalized(artistName))
      return null;

    const fullTracksMap = await fetchSoundCloudPlaylistTrackDetails(playlist.tracks, (ids) =>
      this.fetchWithRelay(
        `https://api-v2.soundcloud.com/tracks?ids=${ids.join('%2C')}&client_id=${clientId}`,
      ),
    );

    return hydrateSoundCloudPlaylistTracks(playlist.tracks, fullTracksMap, {
      id: playlist.id ?? playlistId,
      title: fixMojibake(playlist.title) || albumTitle || 'Album',
      cover: extractPlaylistCover(playlist, playlist.user?.avatar_url),
    });
  }

  public static async getAlbumTracks(
    albumId?: string | number,
    albumTitle?: string,
    artistName?: string,
  ): Promise<Track[]> {
    const rawId = cleanSoundCloudPlaylistId(albumId);
    if (/^\d+$/.test(rawId)) {
      try {
        const tracks = await this.fetchPlaylistTracksById(rawId, albumTitle, artistName);
        if (tracks !== null) return tracks;
      } catch (e) {
        console.error('[SoundCloudService] getAlbumTracks error:', e);
      }
    }

    // Fallback: search specifically for playlists/albums on SoundCloud
    if (albumTitle && albumTitle !== 'Single' && albumTitle !== 'Unknown Album') {
      try {
        const q =
          artistName && artistName !== 'Unknown Artist'
            ? `${artistName} ${albumTitle}`
            : albumTitle;
        const playlists = await this.searchPlaylists(q, 8);
        if (playlists && playlists.length > 0) {
          const normTarget = albumTitle
            .normalize('NFKC')
            .toLowerCase()
            .replace(/[^\p{L}\p{N}]/gu, '')
            .trim();
          const normArtist = (artistName || '')
            .normalize('NFKC')
            .toLowerCase()
            .replace(/[^\p{L}\p{N}]/gu, '')
            .trim();

          // A playlist's album flag is not evidence that it belongs to the requested artist.
          const best = playlists.find((pl: any) => {
            const plTitle = fixMojibake(pl.title || '')
              .normalize('NFKC')
              .toLowerCase()
              .replace(/[^\p{L}\p{N}]/gu, '')
              .trim();
            const plAuthor = (pl.user?.username || '')
              .normalize('NFKC')
              .toLowerCase()
              .replace(/[^\p{L}\p{N}]/gu, '')
              .trim();
            const titleMatches = Boolean(normTarget && plTitle && plTitle === normTarget);
            const authorMatches = !normArtist || Boolean(plAuthor && plAuthor === normArtist);
            return titleMatches && authorMatches;
          });

          const bestId = cleanSoundCloudPlaylistId(best?.id);
          if (bestId && bestId !== rawId && /^\d+$/.test(bestId)) {
            const tracks = await this.fetchPlaylistTracksById(bestId, best.title, artistName);
            if (tracks !== null) return tracks;
          }
        }
      } catch (e) {
        console.warn('[SoundCloudService] getAlbumTracks playlist search fallback error:', e);
      }
    }

    return [];
  }

  /**
   * Search specifically for playlists and albums on SoundCloud
   */
  public static async searchPlaylists(query: string, limit = 10): Promise<any[]> {
    if (!query || !query.trim()) return [];
    try {
      const clientId = await this.getSoundCloudKey();
      const res = await this.fetchWithRelay(
        `https://api-v2.soundcloud.com/search/playlists?q=${encodeURIComponent(query.trim())}&client_id=${clientId}&limit=${limit}`,
      );
      return res?.collection || [];
    } catch (e) {
      console.warn('[SoundCloudService] searchPlaylists error:', e);
      return [];
    }
  }
}
