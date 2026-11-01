import { validateWaveContext, validateWaveSeeds } from './waveInput.ts';
import { waveTasteSnapshot } from '../services/waveTasteSnapshot.ts';
import { identifyCatalogTracks } from '../services/recordingCatalog.ts';
import { filterTasteContext, isTasteEligible } from '../../../shared/utils/tastePolicy.ts';
import type { IpcMain } from 'electron';
import type { DatabaseManager } from '../db/index.ts';
import type { WaveBatchContext, WaveMood } from '../../../shared/types/index.ts';
import {
  normalizeWaveBatchContext,
  normalizeWaveSeed,
} from '../../../shared/utils/waveRecommendations.ts';
import { MusicAggregatorService } from '../services/musicAggregator.ts';
import { WaveBatchRequestRegistry } from '../services/waveBatchRequestRegistry.ts';

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
      if (
        mood !== undefined &&
        !['default', 'energy', 'chill', 'mix', 'favorites', 'discover'].includes(mood)
      )
        throw new TypeError('Invalid wave mood');
      if (provided !== undefined && (!Array.isArray(provided) || provided.length > 64))
        throw new TypeError('Invalid wave seeds');
      if (
        excluded !== undefined &&
        (!Array.isArray(excluded) ||
          excluded.length > 4096 ||
          excluded.some(
            (id) =>
              !['string', 'number'].includes(typeof id) ||
              (typeof id === 'number' && !Number.isFinite(id)) ||
              String(id).length > 128,
          ))
      )
        throw new TypeError('Invalid wave exclusions');
      if (provided) validateWaveSeeds(provided);
      validateWaveContext(context);
      context = normalizeWaveBatchContext(context);
      const request = requests.begin(event.sender, requestId);
      try {
        const snapshot = waveTasteSnapshot(db);
        const policy = db.getTastePolicy();
        const { disliked } = snapshot;
        const seeds = [
          ...snapshot.waveSeeds,
          ...(Array.isArray(provided) ? provided.slice(0, 8) : [])
            .map(normalizeWaveSeed)
            .filter((track) => track !== null && isTasteEligible(track, policy)),
        ].filter((track): track is NonNullable<typeof track> => track !== null);
        return identifyCatalogTracks(
          await MusicAggregatorService.getWaveBatch(
            mood,
            seeds,
            [...(Array.isArray(excluded) ? excluded : []), ...disliked],
            [
              ...snapshot.artists,
              ...snapshot.likes.map((track) => ({ name: track.artist })),
              ...(context?.learnedTracks || [])
                .filter((track) => isTasteEligible(track, policy))
                .map((track) => ({ name: track.artist?.name || '' })),
            ],
            db.getDislikedWaveTracks(),
            normalizeWaveBatchContext({
              ...filterTasteContext(context || {}, policy),
              tasteTracks:
                context?.tasteRevision === snapshot.revision && Array.isArray(context.tasteTracks)
                  ? context.tasteTracks.filter((track) => isTasteEligible(track, policy))
                  : snapshot.waveSeeds,
            }),
            request.signal,
          ),
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
