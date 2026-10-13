import type { IpcMain } from 'electron';
import type { DatabaseManager } from '../db/index.ts';
import type { WaveBatchContext, WaveMood } from '../../../shared/types/index.ts';
import { buildWaveTasteSeeds } from '../../../shared/utils/waveTaste.ts';
import { shuffled } from '../../../shared/utils/concurrentTasks.ts';
import { normalizeWaveBatchContext } from '../../../shared/utils/waveRecommendations.ts';
import { MusicAggregatorService } from '../services/musicAggregator.ts';
import { WaveBatchRequestRegistry } from '../services/waveBatchRequestRegistry.ts';

const HISTORY_SEED_LIMIT = 30;
const ARTIST_HISTORY_LIMIT = 15;

function tasteSeeds(db: DatabaseManager, provided: unknown[]) {
  const disliked = db.getDislikedTrackIds();
  const dislikedIds = new Set(disliked.map(String));
  const history = db
    .getWaveTasteTracks(HISTORY_SEED_LIMIT)
    .filter((track) => !dislikedIds.has(String(track.id)))
    .map((track) => ({
      id: track.id,
      title: track.title,
      artist: { name: track.artist },
      duration: track.duration,
    }));
  const likes = db
    .getLikedTracks()
    .filter((track) => !dislikedIds.has(String(track.deezer_id)))
    .map((track) => ({
      id: track.deezer_id,
      title: track.title,
      artist: { name: track.artist },
      duration: track.duration,
      cover_url: track.cover_url,
      preview: track.preview_url,
      source:
        track.source || (String(track.deezer_id).startsWith('yt_') ? 'youtube' : 'soundcloud'),
    }));
  return {
    disliked,
    // Sample the full library before the bounded taste profile is built.
    seeds: buildWaveTasteSeeds(
      shuffled(likes),
      provided,
      history,
      db.getPlaylistWaveTracks(),
      disliked,
    ),
  };
}

function familiarArtists(db: DatabaseManager): { id?: string | number; name: string }[] {
  const artists = new Map<string, { id?: string | number; name: string }>();
  for (const artist of db.getFollowedArtists()) {
    if (artist.name) artists.set(artist.name.toLowerCase(), artist);
  }
  for (const artist of db.getScrobbledTopArtists(ARTIST_HISTORY_LIMIT)) {
    if (artist.score > 0 && artist.name && !artists.has(artist.name.toLowerCase())) {
      artists.set(artist.name.toLowerCase(), { name: artist.name });
    }
  }
  return [...artists.values()];
}

export function registerWaveHandlers(ipc: IpcMain, db: DatabaseManager): void {
  const requests = new WaveBatchRequestRegistry();
  ipc.handle('music:cancelWaveBatch', (event, requestId: unknown) =>
    requests.cancel(event.sender, requestId),
  );
  ipc.handle(
    'music:getWaveBatch',
    async (
      event,
      mood?: WaveMood,
      provided?: unknown[],
      excluded?: (string | number)[],
      context?: WaveBatchContext,
      requestId?: string,
    ) => {
      const request = requests.begin(event.sender, requestId);
      try {
        const { seeds, disliked } = tasteSeeds(db, Array.isArray(provided) ? provided : []);
        return await MusicAggregatorService.getWaveBatch(
          mood,
          seeds,
          [...(Array.isArray(excluded) ? excluded : []), ...disliked],
          familiarArtists(db),
          db.getDislikedWaveTracks(),
          normalizeWaveBatchContext(context),
          request.signal,
        );
      } catch (error) {
        if (request.signal.aborted) return [];
        throw error;
      } finally {
        request.finish();
      }
    },
  );
}
