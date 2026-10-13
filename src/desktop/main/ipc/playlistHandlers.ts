import type { IpcMain } from 'electron';
import type { DatabaseManager } from '../db/index.ts';

export function registerPlaylistHandlers(
  ipcMain: IpcMain,
  dbManager: DatabaseManager,
  onLibraryChanged?: () => void,
): void {
  // Database Playlists handlers
  ipcMain.handle('db:getPlaylists', () => {
    return dbManager.getPlaylists();
  });
  ipcMain.handle('db:getTrackPlaylistIds', (_event, trackId: unknown) => {
    if (
      (typeof trackId !== 'string' && typeof trackId !== 'number') ||
      String(trackId).length > 200
    )
      return [];
    return dbManager.getTrackPlaylistIds(trackId);
  });

  ipcMain.handle('db:createPlaylist', (_event: any, name: string, description?: string) => {
    if (!name || typeof name !== 'string') return null;
    return dbManager.createPlaylist(
      name.trim(),
      typeof description === 'string' ? description : undefined,
    );
  });

  ipcMain.handle('db:setPlaylistCover', (_event: any, playlistId: string, coverUrl: string) => {
    if (
      typeof playlistId !== 'string' ||
      !playlistId ||
      typeof coverUrl !== 'string' ||
      (coverUrl &&
        (!/^data:image\/(?:jpeg|png|webp);base64,/.test(coverUrl) || coverUrl.length > 750000))
    )
      return false;
    return dbManager.setPlaylistCover(playlistId, coverUrl);
  });

  ipcMain.handle('db:deletePlaylist', (_event: any, playlistId: string) => {
    if (!playlistId || typeof playlistId !== 'string') return false;
    const result = dbManager.deletePlaylist(playlistId);
    onLibraryChanged?.();
    return result;
  });

  ipcMain.handle('db:getPlaylistTracks', (_event: any, playlistId: string) => {
    if (!playlistId || typeof playlistId !== 'string') return [];
    return dbManager.getPlaylistTracks(playlistId);
  });

  ipcMain.handle('db:addTrackToPlaylist', (_event: any, playlistId: string, track: any) => {
    if (!playlistId || typeof playlistId !== 'string' || !track || typeof track !== 'object')
      return false;
    const result = dbManager.addTrackToPlaylist(playlistId, track);
    onLibraryChanged?.();
    return result;
  });

  ipcMain.handle(
    'db:removeTrackFromPlaylist',
    (_event: any, playlistId: string, trackDeezerId: string | number) => {
      if (!playlistId || typeof playlistId !== 'string' || (!trackDeezerId && trackDeezerId !== 0))
        return false;
      const result = dbManager.removeTrackFromPlaylist(playlistId, trackDeezerId);
      onLibraryChanged?.();
      return result;
    },
  );
}
