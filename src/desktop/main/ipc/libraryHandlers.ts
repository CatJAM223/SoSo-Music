import type { IpcMain } from 'electron';
import type { DatabaseManager } from '../db/index.ts';

export function registerLibraryHandlers(
  ipcMain: IpcMain,
  dbManager: DatabaseManager,
  onLibraryChanged?: () => void,
): void {
  // Database Local Scrobbling & Dislikes
  ipcMain.handle('db:recordScrobble', (_event: any, data: any) => {
    return dbManager.recordScrobble(data);
  });
  ipcMain.handle('db:recordPlaybackSession', (_event: any, data: any) => {
    return dbManager.recordPlaybackSession(data);
  });

  ipcMain.handle('db:dislikeTrack', (_event: any, track: any) => {
    const result = dbManager.dislikeTrack(track);
    onLibraryChanged?.();
    return result;
  });

  ipcMain.handle('db:undislikeTrack', (_event: any, trackId: string | number) => {
    const result = dbManager.undislikeTrack(trackId);
    onLibraryChanged?.();
    return result;
  });

  ipcMain.handle('db:getDislikedTrackIds', () => {
    return dbManager.getDislikedTrackIds();
  });

  ipcMain.handle('db:isTrackDisliked', (_event: any, trackId: string | number) => {
    return dbManager.isTrackDisliked(trackId);
  });

  // Database Liked Tracks handlers
  ipcMain.handle('db:getLikedTrackIds', () => dbManager.getLikedTrackIds());

  ipcMain.handle('db:getLikedTracks', () => {
    return dbManager.getLikedTracks();
  });

  ipcMain.handle('db:isTrackLiked', (_event: any, deezerId: string | number) => {
    return dbManager.isTrackLiked(deezerId);
  });

  ipcMain.handle('db:toggleLikeTrack', (_event: any, track: any) => {
    const result = dbManager.toggleLikeTrack(track);
    onLibraryChanged?.();
    return result;
  });

  // Database Saved Albums handlers
  ipcMain.handle('db:getSavedAlbums', () => {
    return dbManager.getSavedAlbums();
  });

  ipcMain.handle('db:isAlbumSaved', (_event: any, albumId: string | number) => {
    return dbManager.isAlbumSaved(albumId);
  });

  ipcMain.handle('db:toggleSaveAlbum', (_event: any, album: any) => {
    return dbManager.toggleSaveAlbum(album);
  });

  // Database Followed Artists handlers
  ipcMain.handle('db:getFollowedArtists', () => {
    return dbManager.getFollowedArtists();
  });

  ipcMain.handle('db:isArtistFollowed', (_event: any, artistId: string | number) => {
    return dbManager.isArtistFollowed(artistId);
  });

  ipcMain.handle('db:toggleFollowArtist', (_event: any, artist: any) => {
    return dbManager.toggleFollowArtist(artist);
  });
}
