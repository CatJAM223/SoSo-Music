import type { IpcMain } from 'electron';
import type { MusicAggregatorService } from '../services/musicAggregator.ts';
import { StreamRequestRegistry } from '../services/streamRequestRegistry.ts';
import { runStreamResolve, streamWait } from '../services/streamResolveContext.ts';

export function registerSearchHandlers(
  ipc: Pick<IpcMain, 'handle'>,
  service: Pick<typeof MusicAggregatorService, 'search' | 'searchArtists'>,
): void {
  const requests = new StreamRequestRegistry();
  for (const channel of ['music:search', 'music:searchArtists'] as const) {
    ipc.handle(
      channel,
      async (event, query: unknown, limit: unknown, source: unknown, requestId?: string) => {
        const artists = channel === 'music:searchArtists';
        if (typeof query !== 'string' || !query.trim())
          return artists ? { data: [] } : { data: [], total: 0 };
        const maximum = artists ? 50 : 100;
        const safeLimit =
          typeof limit === 'number' && Number.isInteger(limit) && limit > 0 && limit <= maximum
            ? limit
            : artists
              ? 10
              : 20;
        const safeSource = source === 'youtube' || source === 'soundcloud' ? source : 'all';
        const request = requests.begin(event.sender, requestId);
        try {
          return await runStreamResolve(request.signal, () =>
            artists
              ? streamWait(service.searchArtists(query.trim(), safeLimit, safeSource))
              : streamWait(service.search(query.trim(), safeLimit, safeSource)),
          );
        } finally {
          request.finish();
        }
      },
    );
  }
  ipc.handle('music:cancelSearch', (event, requestId: unknown) =>
    requests.cancel(event.sender, requestId),
  );
}
