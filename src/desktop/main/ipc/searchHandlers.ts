import { identifyCatalogTracks } from '../services/recordingCatalog.ts';
import type { IpcMain } from 'electron';
import type { MusicAggregatorService } from '../services/musicAggregator.ts';
import { StreamRequestRegistry } from '../services/streamRequestRegistry.ts';
import { runStreamResolve, streamWait } from '../services/streamResolveContext.ts';

export function registerSearchHandlers(
  ipc: Pick<IpcMain, 'handle'>,
  service: Pick<
    typeof MusicAggregatorService,
    'search' | 'searchArtists' | 'getSearchArtistTracks'
  >,
): void {
  const requests = new StreamRequestRegistry();
  for (const channel of ['music:search', 'music:searchArtists'] as const) {
    ipc.handle(
      channel,
      async (event, query: unknown, limit: unknown, source: unknown, requestId?: string) => {
        const artists = channel === 'music:searchArtists';
        if (typeof query !== 'string' || !query.trim() || query.length > 500)
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
          const result = await runStreamResolve(request.signal, () =>
            artists
              ? streamWait(service.searchArtists(query.trim(), safeLimit, safeSource))
              : streamWait(service.search(query.trim(), safeLimit, safeSource)),
          );
          return artists
            ? result
            : {
                ...result,
                data: identifyCatalogTracks(
                  result.data as import('../../../shared/types/index.ts').Track[],
                ),
              };
        } finally {
          request.finish();
        }
      },
    );
  }
  ipc.handle(
    'music:searchArtistTracks',
    async (event, artist: unknown, source: unknown, requestId?: string) => {
      if (
        (source !== 'youtube' && source !== 'soundcloud') ||
        !artist ||
        typeof artist !== 'object' ||
        !('id' in artist) ||
        (typeof artist.id !== 'string' && typeof artist.id !== 'number') ||
        !('name' in artist) ||
        typeof artist.name !== 'string' ||
        !artist.name.trim() ||
        artist.name.length > 500 ||
        String(artist.id).length > 200
      )
        return [];
      const { id, name } = artist;
      const request = requests.begin(event.sender, requestId);
      try {
        const tracks = await runStreamResolve(request.signal, () =>
          streamWait(service.getSearchArtistTracks(id, name, source)),
        );
        return identifyCatalogTracks(tracks);
      } finally {
        request.finish();
      }
    },
  );
  ipc.handle('music:cancelSearch', (event, requestId: unknown) =>
    requests.cancel(event.sender, requestId),
  );
}
