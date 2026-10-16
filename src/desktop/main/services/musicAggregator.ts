import { assertStreamResolveActive, streamWait } from './streamResolveContext.ts';
import { getStreamResolveFailure } from '../../../shared/utils/streamResolveError.ts';
import { matchesImportedRecording } from '../../../shared/utils/recordingIdentity.ts';
import { SoundCloudService } from './soundcloud.ts';
import { YouTubeMusicService } from './youtubeMusic.ts';
import { LastFmService } from './lastfm.ts';
import { PlaybackLogger } from './playbackLogger.ts';
import { WaveEngine } from './waveEngine.ts';
import { settleWithin } from '../../../shared/utils/progressiveSearch.ts';
import type { WaveBatchContext } from '../../../shared/types/index.ts';

import type {
  Album,
  Artist,
  ArtistDetails,
  AutocompleteSuggestion,
  ChartData,
  Genre,
  MusicSource,
  StreamResolveOptions,
  Track,
} from '../../../shared/types/index.ts';
import {
  cleanTitleForMatching,
  isArtistMatch,
  isTitleMatch,
} from '../../../shared/utils/artistParser.ts';
import { isYouTubeAudioStreamUrl } from '../../../shared/utils/audioUrlValidator.ts';
import { rankSearchTracks } from '../../../shared/utils/searchRanking.ts';
import { loadGenreCatalog } from '../../../shared/services/genreCatalog.ts';

export { cleanTitleForMatching, isArtistMatch, isTitleMatch };

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallbackValue: T): Promise<T> {
  let timer: any = null;
  const timeoutPromise = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallbackValue), timeoutMs);
  });
  return Promise.race([
    promise.then((res) => {
      if (timer) clearTimeout(timer);
      return res;
    }),
    timeoutPromise,
  ]).catch(() => {
    if (timer) clearTimeout(timer);
    return fallbackValue;
  });
}

export class MusicAggregatorService {
  /**
   * Multi-Source Search (SoundCloud + YouTube Music) with relevance ranking
   */
  public static async search(
    query: string,
    limit: number = 30,
    source: MusicSource = 'all',
  ): Promise<{ data: Track[]; total: number }> {
    if (!query || !query.trim()) return { data: [], total: 0 };
    const cleanQ = query.trim();

    if (source === 'soundcloud') {
      const scRes = await SoundCloudService.search(cleanQ, limit * 2);
      const pureScTracks = (scRes.data || []).filter(
        (t: Track) => t.source === 'soundcloud' || String(t.id).startsWith('sc_'),
      );
      const ranked = this.rankSearchTracks(pureScTracks, cleanQ);
      return { data: ranked.slice(0, limit), total: ranked.length };
    }

    if (source === 'youtube') {
      const ytRes = await YouTubeMusicService.search(cleanQ, limit * 2);
      const ranked = this.rankSearchTracks(ytRes.data, cleanQ);
      return { data: ranked.slice(0, limit), total: ranked.length };
    }

    // Default 'all': query YouTube Music and SoundCloud in parallel
    const [ytResult, scResult] = await Promise.allSettled([
      YouTubeMusicService.search(cleanQ, limit * 2),
      SoundCloudService.search(cleanQ, limit * 2),
    ]);

    const ytTracks = ytResult.status === 'fulfilled' ? ytResult.value.data : [];
    const scTracks = scResult.status === 'fulfilled' ? scResult.value.data : [];

    // Interleave with official YouTube tracks first before ranking so tie-breaks favor YouTube
    const allTracks = this.interleaveTracks(ytTracks, scTracks);
    const ranked = this.rankSearchTracks(allTracks, cleanQ);

    return {
      data: ranked.slice(0, limit),
      total: ranked.length,
    };
  }

  public static interleaveTracks(primaryTracks: Track[], secondaryTracks: Track[]): Track[] {
    const combined: Track[] = [];
    const maxLen = Math.max(primaryTracks.length, secondaryTracks.length);
    for (let i = 0; i < maxLen; i++) {
      if (i < primaryTracks.length) combined.push(primaryTracks[i]);
      if (i < secondaryTracks.length) combined.push(secondaryTracks[i]);
    }
    return combined;
  }

  public static cleanArtistId(idOrName: string | number): string {
    const idStr = String(idOrName);
    return (
      idStr
        .replace(/^yt_art_/i, '')
        .replace(/^yt_/i, '')
        .replace(/^sc_art_/i, '')
        .replace(/^sc_/i, '')
        .replace(/^dz_art_/i, '')
        .replace(/^dz_/i, '')
        .replace(/_/g, ' ')
        .trim() || idStr
    );
  }

  public static deduplicateAlbums(albums: Album[]): Album[] {
    const uniqueAlbums: Album[] = [];
    const seenAlbumMap = new Map<string, Album>();
    for (const alb of albums) {
      const normTitle = (alb.title || '').toLowerCase().trim();
      if (!normTitle) continue;
      const existing = seenAlbumMap.get(normTitle);
      if (!existing) {
        const copy = { ...alb };
        seenAlbumMap.set(normTitle, copy);
        uniqueAlbums.push(copy);
      } else {
        const existingHasCover = Boolean(
          existing.cover && !existing.cover.includes('unsplash.com'),
        );
        const newHasCover = Boolean(alb.cover && !alb.cover.includes('unsplash.com'));
        if (!existingHasCover && newHasCover) {
          existing.cover = alb.cover;
          existing.cover_medium = alb.cover_medium || alb.cover;
          existing.cover_big = alb.cover_big || alb.cover;
          existing.cover_xl = alb.cover_xl || alb.cover;
        }
        if (!existing.track_count && alb.track_count) {
          existing.track_count = alb.track_count;
        }
      }
    }
    return uniqueAlbums;
  }

  public static deduplicateArtists(artists: Artist[]): Artist[] {
    const artistMap = new Map<string, Artist>();
    for (const a of artists) {
      const norm = (a.name || '').toLowerCase().replace(/[^a-z0-9а-яё]/g, '');
      if (norm && !artistMap.has(norm)) {
        artistMap.set(norm, a);
      }
    }
    return Array.from(artistMap.values());
  }

  public static mergeArtistTracks(scTracks: Track[], ytTracks: Track[]): Track[] {
    const tracksMap = new Map<string, Track>();
    const seenTitles = new Set<string>();

    for (const t of scTracks) {
      const norm = (t.title || '').toLowerCase().replace(/[^a-z0-9а-яё]/gi, '');
      seenTitles.add(norm);
      tracksMap.set(`sc_${t.id}`, t);
    }

    for (const t of ytTracks) {
      const norm = (t.title || '').toLowerCase().replace(/[^a-z0-9а-яё]/gi, '');
      if (!seenTitles.has(norm)) {
        seenTitles.add(norm);
        tracksMap.set(`yt_${t.id}`, t);
      }
    }

    return Array.from(tracksMap.values());
  }

  /**
   * Rank search tracks by relevance to user query and filter low-quality noise
   */
  public static rankSearchTracks(tracks: Track[], query: string): Track[] {
    return rankSearchTracks(tracks, query);
  }

  /**
   * Search Artists across SoundCloud and YouTube Music with deduplication
   */
  public static async searchArtists(
    query: string,
    limit: number = 6,
    source: MusicSource = 'all',
  ): Promise<{ data: Artist[] }> {
    if (!query || !query.trim()) return { data: [] };
    const cleanQ = query.trim();

    if (source === 'soundcloud') {
      const data = await SoundCloudService.searchArtists(cleanQ, limit);
      const pureScArtists = (data || []).filter(
        (a: Artist) => a.source === 'soundcloud' || String(a.id).startsWith('sc_'),
      );
      return { data: pureScArtists };
    }
    if (source === 'youtube') {
      const ytRes = await YouTubeMusicService.searchArtists(cleanQ, limit);
      return { data: ytRes.data };
    }

    const ytPromise = Promise.race([
      YouTubeMusicService.searchArtists(cleanQ, limit),
      new Promise<{ data: Artist[] }>((resolve) => setTimeout(() => resolve({ data: [] }), 2500)),
    ]).catch(() => ({ data: [] }));

    const [ytRes, scRes] = await Promise.allSettled([
      ytPromise,
      SoundCloudService.searchArtists(cleanQ, limit),
    ]);

    const ytArtists = ytRes.status === 'fulfilled' ? ytRes.value?.data || [] : [];
    const scArtists = scRes.status === 'fulfilled' ? scRes.value : [];

    const uniqueArtists = this.deduplicateArtists([...ytArtists, ...scArtists]);
    return { data: uniqueArtists.slice(0, limit) };
  }

  /**
   * Get Charts (Official Global Billboard Top 50 / Filtered SoundCloud Trends)
   */
  public static async getCharts(source: MusicSource = 'all'): Promise<ChartData> {
    if (source === 'soundcloud') {
      return await SoundCloudService.getCharts(50);
    }
    if (source === 'youtube') {
      const ytCharts = await YouTubeMusicService.getCharts(50);
      return { tracks: { data: ytCharts.data } };
    }

    // Default 'all': Query official YouTube Music top charts and SoundCloud top charts in parallel
    try {
      const [ytChart, scChart] = await Promise.allSettled([
        YouTubeMusicService.getCharts(40),
        SoundCloudService.getCharts(30),
      ]);

      const ytTracks = ytChart.status === 'fulfilled' ? ytChart.value?.data || [] : [];
      const scTracks = scChart.status === 'fulfilled' ? scChart.value?.tracks?.data || [] : [];

      if (ytTracks.length > 0 && scTracks.length > 0) {
        // Prioritize official YouTube Music chart hits first, then blend in clean SoundCloud tracks
        const topYt = ytTracks.slice(0, 30);
        const remainingYt = ytTracks.slice(30);
        const combined = [...topYt, ...this.interleaveTracks(remainingYt, scTracks)];
        return { tracks: { data: combined.slice(0, 50) } };
      }
      if (ytTracks.length > 0) {
        return { tracks: { data: ytTracks.slice(0, 50) } };
      }
      if (scTracks.length > 0) {
        return { tracks: { data: scTracks.slice(0, 50) } };
      }
    } catch (e) {
      console.debug('[MusicAggregatorService] Chart aggregation notice:', e);
    }

    // Fallback: YouTube Music charts then SoundCloud Top 50
    try {
      const ytFallback = await YouTubeMusicService.getCharts(50);
      if (ytFallback.data.length > 0) {
        return { tracks: { data: ytFallback.data } };
      }
    } catch {}

    return await SoundCloudService.getCharts(50);
  }

  /**
   * Get Genres
   */
  public static async getGenres(): Promise<{ data: Genre[] }> {
    return await SoundCloudService.getGenres();
  }

  /**
   * Get Genre Tracks with duration and mix filtering
   */
  public static async getGenreTracks(
    genreId: number | string,
    source: MusicSource = 'all',
  ): Promise<{ data: Track[] }> {
    return loadGenreCatalog(genreId, source, {
      soundcloud: (id) => SoundCloudService.getGenreTracks(id, 30),
      youtube: (query) => YouTubeMusicService.search(query, 12),
    });
  }

  /**
   * Autocomplete search suggestions with enriched artist avatars from YouTube Music & SoundCloud
   */
  private static autocompleteRequests = new Map<string, Promise<AutocompleteSuggestion[]>>();
  private static autocompleteCache = new Map<
    string,
    { items: AutocompleteSuggestion[]; expires: number }
  >();
  public static async getAutocomplete(query: string): Promise<AutocompleteSuggestion[]> {
    const key = (query || '').trim().toLocaleLowerCase();
    if (!key) return [];
    const cached = this.autocompleteCache.get(key);
    if (cached && cached.expires > Date.now()) return cached.items;
    const pending = this.autocompleteRequests.get(key);
    if (pending) return pending;
    const request = this.resolveAutocomplete(query).then((items) => {
      if (this.autocompleteCache.size >= 40)
        this.autocompleteCache.delete(this.autocompleteCache.keys().next().value!);
      this.autocompleteCache.set(key, {
        items,
        expires: Date.now() + (items.length ? 30000 : 1000),
      });
      return items;
    });
    this.autocompleteRequests.set(key, request);
    try {
      return await request;
    } finally {
      if (this.autocompleteRequests.get(key) === request) this.autocompleteRequests.delete(key);
    }
  }

  private static async resolveAutocomplete(query: string): Promise<AutocompleteSuggestion[]> {
    const cleanQ = (query || '').trim();
    if (!cleanQ) return [];

    try {
      const [scSettled, ytSettled, scArtistsSettled, ytAlbumsSettled, scAlbumsSettled] =
        await Promise.allSettled([
          settleWithin(SoundCloudService.getAutocomplete(cleanQ), 3000, []),
          settleWithin(YouTubeMusicService.searchArtists(cleanQ, 3), 3000, { data: [] }),
          settleWithin(SoundCloudService.searchArtists(cleanQ, 3), 3000, []),
          settleWithin(YouTubeMusicService.searchAlbums(cleanQ, 3), 3000, []),
          settleWithin(SoundCloudService.searchPlaylists(cleanQ, 5), 3000, []),
        ]);

      const scList = scSettled.status === 'fulfilled' ? scSettled.value : [];
      const ytArtists = ytSettled.status === 'fulfilled' ? ytSettled.value?.data || [] : [];
      const scArtists = scArtistsSettled.status === 'fulfilled' ? scArtistsSettled.value || [] : [];
      const ytAlbums = ytAlbumsSettled.status === 'fulfilled' ? ytAlbumsSettled.value || [] : [];
      const scAlbums =
        scAlbumsSettled.status === 'fulfilled'
          ? scAlbumsSettled.value
              .filter(
                (item: any) =>
                  item?.is_album ||
                  ['album', 'ep', 'single'].includes(String(item?.set_type || '').toLowerCase()),
              )
              .map((item: any) => {
                const cover = String(item.artwork_url || '').replace('-large.', '-t500x500.');
                const artistName = item.user?.username || '';
                return {
                  id: `sc_alb_${item.id}`,
                  title: item.title || '',
                  cover,
                  cover_medium: cover,
                  artist_name: artistName,
                  artist: { name: artistName },
                  source: 'soundcloud' as const,
                };
              })
          : [];

      const result: AutocompleteSuggestion[] = [];
      const seenArtistKeys = new Set<string>();

      // 1. Add YouTube Music official artists
      for (const ytArt of ytArtists) {
        if (!ytArt || !ytArt.name) continue;
        const key = `yt_${ytArt.name.toLowerCase().trim()}`;
        if (!seenArtistKeys.has(key)) {
          seenArtistKeys.add(key);
          result.push({
            id: ytArt.id,
            title: ytArt.name,
            artist: 'Исполнитель',
            type: 'artist',
            source: 'youtube',
            picture: ytArt.picture || undefined,
          });
        }
      }

      // 2. Add SoundCloud artists
      for (const scArt of scArtists) {
        if (!scArt || !scArt.name) continue;
        const key = `sc_${scArt.name.toLowerCase().trim()}`;
        if (!seenArtistKeys.has(key)) {
          seenArtistKeys.add(key);
          result.push({
            id: scArt.id,
            title: scArt.name,
            artist: 'Исполнитель',
            type: 'artist',
            source: 'soundcloud',
            picture: scArt.picture || undefined,
          });
        }
      }

      // 3. Add official albums directly from the album search filter.
      const seenAlbumKeys = new Set<string>();
      for (const album of [...ytAlbums, ...scAlbums]) {
        if (!album?.title) continue;
        const key = `${album.artist_name || album.artist?.name || ''}:${album.title}`
          .toLocaleLowerCase()
          .trim();
        if (seenAlbumKeys.has(key)) continue;
        seenAlbumKeys.add(key);
        result.push({
          id: album.id,
          title: album.title,
          artist: album.artist_name || album.artist?.name || '',
          type: 'album',
          source: album.source || 'youtube',
          picture: album.cover_medium || album.cover || undefined,
        });
      }

      // 4. Add SoundCloud suggestions (tracks and query completions)
      for (const item of scList) {
        if (item.type === 'artist') {
          const key = `sc_${item.title.toLowerCase().trim()}`;
          if (!seenArtistKeys.has(key)) {
            seenArtistKeys.add(key);
            result.push({
              ...item,
              source: 'soundcloud',
            });
          }
        } else {
          result.push(item);
        }
      }

      return [
        ...result.filter((item) => item.type === 'artist').slice(0, 4),
        ...result.filter((item) => item.type === 'album').slice(0, 4),
        ...result.filter((item) => item.type === 'track').slice(0, 4),
      ];
    } catch (e) {
      console.warn('[MusicAggregatorService] getAutocomplete error:', e);
      return await settleWithin(SoundCloudService.getAutocomplete(cleanQ), 3000, []);
    }
  }

  /**
   * Direct Clean Audio Stream Resolver
   */
  public static async getFullStreamUrl(
    track: any,
    options: StreamResolveOptions = {},
  ): Promise<string> {
    assertStreamResolveActive();
    if (!track) return '';

    const startTime = Date.now();
    let temporaryFailure: unknown;
    const artistName = (typeof track.artist === 'object' ? track.artist?.name : track.artist) || '';
    const trackIdStr = String(track.id || '');
    PlaybackLogger.info(
      `[Aggregator] Resolving stream for "${track.title}" by "${artistName}" (source: ${track.source || 'auto'}, id: ${trackIdStr})`,
    );

    const isYouTube =
      track.source === 'youtube' ||
      trackIdStr.startsWith('yt_') ||
      Boolean(
        track.preview &&
        (track.preview.includes('youtube.com/watch') || track.preview.includes('youtu.be/')),
      );
    const isDeezer = track.source === 'deezer' || trackIdStr.startsWith('dz_');

    // 1. Direct SoundCloud track
    const isSoundCloud =
      !isYouTube &&
      !isDeezer &&
      (track.source === 'soundcloud' ||
        trackIdStr.startsWith('sc_') ||
        (track.preview &&
          (track.preview.includes('soundcloud.com') ||
            track.preview.includes('sndcdn.com') ||
            track.preview.includes('api-v2.soundcloud.com'))) ||
        typeof track.id === 'number');

    if (isSoundCloud) {
      const scStream = await streamWait(SoundCloudService.getFullStreamUrl(track, options));
      if (scStream && scStream.startsWith('http') && !scStream.includes('api-v2.soundcloud.com')) {
        PlaybackLogger.info(
          `[Aggregator] SoundCloud primary stream resolved for "${track.title}" in ${Date.now() - startTime}ms`,
        );
        return scStream;
      }
      PlaybackLogger.warn(`[Aggregator] SoundCloud stream unavailable for "${track.title}"`);
    }

    // 2. Direct YouTube Music track
    if (isYouTube) {
      const ytStream = await streamWait(YouTubeMusicService.getFullStreamUrl(track, options));
      if (ytStream && ytStream.startsWith('http')) {
        PlaybackLogger.info(
          `[Aggregator] YouTube Music stream resolved for "${track.title}" in ${Date.now() - startTime}ms`,
        );
        return ytStream;
      }
      PlaybackLogger.warn(
        `[Aggregator] YouTube Music stream unavailable for "${track.title}" (id: ${trackIdStr})`,
      );
      return '';
    }

    // 3. Legacy Deezer track fallback (resolve via SoundCloud or YouTube)
    if (isDeezer) {
      const query = `${artistName} ${track.title}`.trim();
      if (query) {
        try {
          const scSearch = await streamWait(SoundCloudService.search(query, 5));
          const candidate = scSearch.data.find((item) => matchesImportedRecording(track, item));
          if (candidate) {
            const stream = await streamWait(SoundCloudService.getFullStreamUrl(candidate, options));
            if (stream) {
              PlaybackLogger.info(
                `[Aggregator] Deezer track resolved via SoundCloud for "${track.title}" in ${Date.now() - startTime}ms`,
              );
              return stream;
            }
          }
        } catch (error) {
          assertStreamResolveActive();
          if (getStreamResolveFailure(error) === 'rate-limit') throw error;
          if (getStreamResolveFailure(error)) temporaryFailure = error;
        }
        try {
          const ytSearch = await streamWait(YouTubeMusicService.search(query, 3));
          const candidate = ytSearch.data.find((item) => matchesImportedRecording(track, item));
          if (candidate) {
            const stream = await streamWait(
              YouTubeMusicService.getFullStreamUrl(candidate, options),
            );
            if (stream) {
              PlaybackLogger.info(
                `[Aggregator] Deezer track resolved via YouTube Music for "${track.title}" in ${Date.now() - startTime}ms`,
              );
              return stream;
            }
          }
        } catch (error) {
          assertStreamResolveActive();
          if (getStreamResolveFailure(error) === 'rate-limit') throw error;
          if (getStreamResolveFailure(error)) temporaryFailure = error;
        }
      }
    }

    // 4. Return direct media preview URL if available and valid
    const previewUrl: string = track.preview || '';
    const isMediaUrl =
      previewUrl.startsWith('http') &&
      !previewUrl.includes('api-v2.soundcloud.com') &&
      !previewUrl.includes('youtube.com/watch') &&
      !previewUrl.includes('youtu.be/') &&
      (!isSoundCloud || !isYouTubeAudioStreamUrl(previewUrl));
    if (isMediaUrl) {
      PlaybackLogger.info(
        `[Aggregator] Serving direct media preview URL for "${track.title}" in ${Date.now() - startTime}ms`,
      );
      return previewUrl;
    }

    if (temporaryFailure) throw temporaryFailure;
    PlaybackLogger.warn(
      `[Aggregator] No direct stream available for track "${track.title}" by "${artistName}" (source: ${track.source || 'unknown'}).`,
    );
    return '';
  }

  /**
   * Get Artist details, top tracks, and full album discography from SoundCloud & YouTube Music
   */
  public static async getArtist(
    idOrName: string | number,
    artistName?: string,
    artistSource?: string,
  ): Promise<ArtistDetails | null> {
    const rawId = String(idOrName || '').trim();
    const cleanName = (artistName || this.cleanArtistId(idOrName)).trim();

    // 1. Explicit YouTube Artist ID or source
    if (
      artistSource === 'youtube' ||
      rawId.startsWith('yt_art_') ||
      rawId.startsWith('yt_') ||
      (rawId.startsWith('UC') && rawId.length >= 20)
    ) {
      const ytDetails = await YouTubeMusicService.getArtist(rawId, cleanName);
      if (ytDetails) {
        const lastFmInfo = await withTimeout(
          LastFmService.getArtistInfo(ytDetails.artist.name || cleanName),
          1500,
          null,
        );
        if (lastFmInfo) {
          if (lastFmInfo.bio) ytDetails.bio = lastFmInfo.bio;
          if (
            lastFmInfo.similarArtists &&
            (!ytDetails.similarArtists || ytDetails.similarArtists.length === 0)
          ) {
            ytDetails.similarArtists = lastFmInfo.similarArtists;
          }
          ytDetails.stats = {
            listeners: lastFmInfo.listeners,
            playcount: lastFmInfo.playcount,
          };
        }
        return ytDetails;
      }
    }

    // 2. Explicit SoundCloud Artist ID or source - resolve immediately without stalling on secondary sources
    if (
      artistSource === 'soundcloud' ||
      rawId.startsWith('sc_art_') ||
      rawId.startsWith('sc_') ||
      /^\d+$/.test(rawId)
    ) {
      const scDetails = await SoundCloudService.getArtist(rawId, cleanName);
      if (scDetails) {
        const lastFmInfo = await withTimeout(
          LastFmService.getArtistInfo(scDetails.artist.name || cleanName),
          1500,
          null,
        );
        if (lastFmInfo) {
          if (lastFmInfo.bio) scDetails.bio = lastFmInfo.bio;
          if (
            (!scDetails.similarArtists || scDetails.similarArtists.length === 0) &&
            lastFmInfo.similarArtists
          ) {
            scDetails.similarArtists = lastFmInfo.similarArtists;
          }
          scDetails.stats = {
            listeners: lastFmInfo.listeners || scDetails.artist.nb_fan,
            playcount: lastFmInfo.playcount,
          };
        }
        return scDetails;
      }
      const scByName = await SoundCloudService.getArtist(cleanName, cleanName);
      if (scByName) return scByName;
      return null;
    }

    // 3. Generic Artist query: run SoundCloud and YouTube in parallel,
    // capping YouTube wait time to 4s max so UI never freezes, clearing timer on finish
    const ytPromise = withTimeout(YouTubeMusicService.getArtist(cleanName), 4000, null);
    const lastFmPromise = withTimeout(LastFmService.getArtistInfo(cleanName), 2000, null);

    const [scRes, ytRes, lastFmRes] = await Promise.allSettled([
      SoundCloudService.getArtist(cleanName, cleanName),
      ytPromise,
      lastFmPromise,
    ]);

    const scDetails = scRes.status === 'fulfilled' ? scRes.value : null;
    const ytDetails = ytRes.status === 'fulfilled' ? ytRes.value : null;
    const lastFmInfo = lastFmRes.status === 'fulfilled' ? lastFmRes.value : null;

    const base = scDetails || ytDetails;
    if (!base) {
      return null;
    }

    // 1. Merge all albums across SoundCloud and YouTube Music
    const allAlbums = [...(scDetails?.albums || []), ...(ytDetails?.albums || [])];
    const uniqueAlbums = this.deduplicateAlbums(allAlbums);

    // 2. Merge top tracks across sources
    const allTopTracks = [...(scDetails?.topTracks || []), ...(ytDetails?.topTracks || [])];
    const seenTrackTitles = new Set<string>();
    const uniqueTopTracks = allTopTracks.filter((trk) => {
      const norm = (trk.title || '')
        .toLowerCase()
        .replace(/[\(\[\{].*?[\)\]\}]/g, '')
        .trim();
      if (!norm || seenTrackTitles.has(norm)) return false;
      seenTrackTitles.add(norm);
      return true;
    });

    // 3. Enrich top tracks with missing cover art from albums if available
    for (const trk of uniqueTopTracks) {
      if (!trk.album?.cover_medium && !trk.album?.cover_big && trk.album?.title) {
        const normTrkAlb = trk.album.title.toLowerCase().trim();
        for (const alb of uniqueAlbums) {
          if (alb.title?.toLowerCase().trim() === normTrkAlb) {
            trk.album = {
              ...trk.album,
              cover: alb.cover || trk.album?.cover,
              cover_medium: alb.cover_medium || trk.album?.cover_medium,
              cover_big: alb.cover_big || trk.album?.cover_big,
              cover_xl: alb.cover_xl || trk.album?.cover_xl,
            };
            break;
          }
        }
      }
    }

    const bestArtistName = scDetails?.artist?.name || ytDetails?.artist?.name || cleanName;
    const bestPicture =
      scDetails?.artist?.picture_big ||
      scDetails?.artist?.picture_medium ||
      ytDetails?.artist?.picture_big ||
      lastFmInfo?.image ||
      base.artist?.picture;

    const similarArtists =
      scDetails?.similarArtists && scDetails.similarArtists.length > 0
        ? scDetails.similarArtists
        : lastFmInfo?.similarArtists || [];

    const stats = lastFmInfo
      ? { listeners: lastFmInfo.listeners || base.artist?.nb_fan, playcount: lastFmInfo.playcount }
      : base.artist?.nb_fan
        ? { listeners: base.artist.nb_fan }
        : undefined;

    return {
      artist: {
        id: base.artist?.id || `sc_art_${cleanName.toLowerCase().replace(/\s+/g, '_')}`,
        name: bestArtistName,
        picture: bestPicture,
        picture_medium: bestPicture,
        picture_big: bestPicture,
        picture_xl: bestPicture,
        nb_album: uniqueAlbums.length,
        nb_fan: scDetails?.artist?.nb_fan || base.artist?.nb_fan || 0,
        source: base.artist?.source || 'soundcloud',
      },
      topTracks: uniqueTopTracks.slice(0, 30),
      albums: uniqueAlbums,
      bio: lastFmInfo?.bio || '',
      similarArtists: similarArtists.slice(0, 10),
      stats,
    };
  }

  /**
   * Get all available tracks for an artist across SoundCloud and YouTube Music
   */
  public static async getArtistAllTracks(
    idOrName: string | number,
    artistName?: string,
    artistSource?: string,
  ): Promise<Track[]> {
    const idStr = String(idOrName);
    const cleanName = (artistName || idStr)
      .replace(/^yt_art_/i, '')
      .replace(/^yt_/i, '')
      .replace(/^sc_art_/i, '')
      .replace(/^sc_/i, '')
      .replace(/^dz_art_/i, '')
      .replace(/^dz_/i, '')
      .replace(/_/g, ' ')
      .trim();

    // 1. If explicit YouTube artist ID or source, strictly return YouTube tracks only:
    if (artistSource === 'youtube' || idStr.startsWith('yt_')) {
      return await YouTubeMusicService.getArtistAllTracks(idStr, cleanName);
    }

    // 2. If explicit SoundCloud artist ID or source, strictly return SoundCloud tracks only:
    if (artistSource === 'soundcloud' || idStr.startsWith('sc_') || /^\d+$/.test(idStr)) {
      return await SoundCloudService.getArtistAllTracks(idStr, cleanName);
    }

    const [scRes, ytRes] = await Promise.allSettled([
      SoundCloudService.getArtistAllTracks(idOrName, cleanName),
      YouTubeMusicService.getArtistAllTracks(idOrName, cleanName),
    ]);

    const scTracks = scRes.status === 'fulfilled' ? scRes.value : [];
    const ytTracks = ytRes.status === 'fulfilled' ? ytRes.value : [];

    const tracksMap = new Map<string, Track>();
    const seenTitles = new Set<string>();

    // 1. Add SoundCloud tracks (SoundCloud primary)
    for (const t of scTracks) {
      if (!t || !t.title) continue;
      const normalizedTitle = t.title.toLowerCase().replace(/[^a-z0-9а-яё]/gi, '');
      if (
        !seenTitles.has(normalizedTitle) ||
        t.title.toLowerCase().includes('remix') ||
        t.title.toLowerCase().includes('edit')
      ) {
        seenTitles.add(normalizedTitle);
        tracksMap.set(`sc_${t.id}`, t);
      }
    }

    // 2. Add YouTube fallback tracks
    for (const t of ytTracks) {
      if (!t || !t.title) continue;
      const normalizedTitle = t.title.toLowerCase().replace(/[^a-z0-9а-яё]/gi, '');
      if (!seenTitles.has(normalizedTitle)) {
        seenTitles.add(normalizedTitle);
        tracksMap.set(`yt_${t.id}`, t);
      }
    }

    return Array.from(tracksMap.values());
  }

  /**
   * Get tracks for a specific album across SoundCloud or YouTube Music
   */
  public static async getAlbumTracks(
    albumId?: string | number,
    albumTitle?: string,
    artistName?: string,
  ): Promise<Track[]> {
    const idStr = String(albumId || '').trim();

    // 1. Explicit SoundCloud Album / Playlist (handles sc_alb_*, sc_*, or purely numeric IDs)
    if (
      idStr.startsWith('sc_alb_') ||
      (idStr.startsWith('sc_') && !idStr.startsWith('sc_art_')) ||
      /^\d+$/.test(idStr)
    ) {
      const scTracks = await SoundCloudService.getAlbumTracks(albumId, albumTitle, artistName);
      if (scTracks && scTracks.length > 0) return scTracks;
    }

    // 2. Explicit YouTube Music Album (handles yt_alb_*, MPREb_*, OLAK5uy_*)
    if (idStr.startsWith('yt_alb_') || idStr.startsWith('MPREb_') || idStr.startsWith('OLAK5uy_')) {
      const ytTracks = await YouTubeMusicService.getAlbumTracks(albumId, albumTitle, artistName);
      if (ytTracks && ytTracks.length > 0) return ytTracks;
    }

    // 3. Fallback: If ID was missing, artificial (e.g. alb_*), or direct fetch returned empty,
    // resolve via the Artist's discography across SoundCloud and YouTube
    if (albumTitle && albumTitle !== 'Single' && albumTitle !== 'Unknown Album') {
      const cleanArtist = (artistName || '').trim();
      if (
        cleanArtist &&
        cleanArtist !== 'Unknown Artist' &&
        cleanArtist !== 'Неизвестный исполнитель'
      ) {
        try {
          const artistDetails = await this.getArtist(cleanArtist);
          if (artistDetails?.albums && artistDetails.albums.length > 0) {
            const normTarget = albumTitle
              .toLowerCase()
              .replace(/[^a-z0-9а-яё]/g, '')
              .trim();
            const matched = artistDetails.albums.find((a: any) => {
              const normA = (a.title || '')
                .toLowerCase()
                .replace(/[^a-z0-9а-яё]/g, '')
                .trim();
              return (
                normA &&
                normTarget &&
                (normA === normTarget || normA.includes(normTarget) || normTarget.includes(normA))
              );
            });

            if (matched && matched.id && String(matched.id) !== idStr) {
              const matchedId = String(matched.id);
              const tracks =
                matchedId.startsWith('yt_alb_') ||
                matchedId.startsWith('MPREb_') ||
                matchedId.startsWith('OLAK5uy_')
                  ? await YouTubeMusicService.getAlbumTracks(matched.id, matched.title, cleanArtist)
                  : await SoundCloudService.getAlbumTracks(matched.id, matched.title, cleanArtist);
              if (tracks && tracks.length > 0) return tracks;
            }
          }
        } catch (e) {
          console.warn(
            '[MusicAggregatorService] getAlbumTracks artist discography fallback error:',
            e,
          );
        }
      }

      // 4. Try searching specifically for SoundCloud playlists/albums
      try {
        const scFallbackTracks = await SoundCloudService.getAlbumTracks(
          undefined,
          albumTitle,
          artistName,
        );
        if (scFallbackTracks && scFallbackTracks.length > 0) return scFallbackTracks;
      } catch (e) {
        console.warn('[MusicAggregatorService] getAlbumTracks playlist search fallback error:', e);
      }
    }

    return [];
  }

  /**
   * Get dynamic personalized tracks for "My Wave"
   */
  public static async getWaveBatch(
    mood: any = 'default',
    seedTracks: Track[] = [],
    excludeIds: (string | number)[] = [],
    followedArtists: { id?: string | number; name: string }[] = [],
    dislikedTracks: { id: string | number; title: string; artist: string }[] = [],
    context: WaveBatchContext = {},
    signal?: AbortSignal,
  ): Promise<Track[]> {
    return await WaveEngine.getWaveBatch(
      mood,
      seedTracks,
      excludeIds,
      followedArtists,
      dislikedTracks,
      context,
      true,
      signal,
    );
  }

  /**
   * Set custom proxy
   */
  public static setCustomProxy(url: string) {
    SoundCloudService.setCustomProxy(url);
  }

  /**
   * Search for an authentic official video clip via YouTube Music
   */
  public static async getOfficialVideoClip(
    artist: string,
    title: string,
    apiKey?: string,
  ): Promise<string | null> {
    return await YouTubeMusicService.searchOfficialMusicVideo(artist, title, apiKey);
  }
}
