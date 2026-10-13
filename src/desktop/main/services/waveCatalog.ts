import {
  waveRequestKey,
  type WaveRequestScheduler,
} from '../../../shared/services/waveRequestScheduler.ts';
import { matchesWaveSource, normalizeWaveSource } from '../../../shared/services/waveSource.ts';
import type { MusicSource, Track } from '../../../shared/types/index.ts';
import { SoundCloudService } from './soundcloud.ts';
import { YouTubeMusicService } from './youtubeMusic.ts';
import { LastFmService, type LastFmGenreTrack } from './lastfm.ts';

type BatchRequest = ReturnType<WaveRequestScheduler['createBatch']>;
type CatalogResult = { data: Track[] };
export interface WaveCatalog {
  soundcloud: (query: string, limit: number) => Promise<CatalogResult>;
  youtube: (query: string, limit: number) => Promise<CatalogResult>;
  fallback: (query: string, limit: number) => Promise<CatalogResult>;
  both: (query: string, limit: number) => Promise<CatalogResult>;
  similar: (artist: string, limit: number) => Promise<{ name: string }[]>;
  related: (seed: Track) => Promise<Track[]>;
  genreTracks: (genre: string) => Promise<LastFmGenreTrack[]>;
}

/** All modes share the same cancellable provider budget and request deduplication. */
export function createWaveCatalog(
  request: BatchRequest,
  selectedSource: MusicSource = 'all',
): WaveCatalog {
  const source = normalizeWaveSource(selectedSource);
  const soundcloud = (query: string, limit: number) =>
    source === 'youtube'
      ? Promise.resolve({ data: [] })
      : request(waveRequestKey('sc', query, limit), (signal) =>
          SoundCloudService.search(query, limit, signal),
        );
  const youtube = (query: string, limit: number) =>
    source === 'soundcloud'
      ? Promise.resolve({ data: [] })
      : request(waveRequestKey('yt', query, limit), (signal) =>
          YouTubeMusicService.search(query, limit, signal),
        );
  return {
    soundcloud,
    genreTracks: (genre) =>
      request(waveRequestKey('lastfm-genre', genre, 50), (signal) =>
        LastFmService.getGenreTracks(genre, AbortSignal.any([signal, AbortSignal.timeout(2500)])),
      ),
    youtube,
    fallback: source === 'youtube' ? youtube : soundcloud,
    both: async (query, limit) => {
      const replies = await Promise.allSettled([soundcloud(query, limit), youtube(query, limit)]);
      return {
        data: replies.flatMap((reply) =>
          reply.status === 'fulfilled' ? reply.value.data || [] : [],
        ),
      };
    },
    similar: (artist, limit) =>
      request(waveRequestKey('lastfm', artist, limit), (signal) =>
        LastFmService.getSimilarArtists(artist, limit, signal),
      ),
    related: (seed) =>
      !matchesWaveSource(seed, source)
        ? Promise.resolve([])
        : seed.source === 'youtube'
          ? request(waveRequestKey('yt-radio', String(seed.id), 20), (signal) =>
              YouTubeMusicService.getRadioTracks(String(seed.id), undefined, 20, signal),
            )
          : request(waveRequestKey('sc-radio', String(seed.id), 20), (signal) =>
              SoundCloudService.getRelatedTracks(seed.id, 20, signal),
            ),
  };
}
