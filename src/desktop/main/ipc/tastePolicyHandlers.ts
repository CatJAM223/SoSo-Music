import type { BrowserWindow, IpcMain } from 'electron';
import type { DatabaseManager } from '../db/index.ts';
import { assertMainWindowSender } from './mainWindowHandlers.ts';
export function registerTastePolicyHandlers(
  ipc: IpcMain,
  getWindow: () => BrowserWindow | null,
  db: DatabaseManager,
  changed: () => void,
): void {
  db.onTastePolicyChanged((policy) => {
    changed();
    const window = getWindow();
    if (window && !window.isDestroyed()) window.webContents.send('tastePolicy:changed', policy);
  });
  ipc.handle('tastePolicy:get', (event) => {
    assertMainWindowSender(event, getWindow());
    return db.getTastePolicy();
  });
  ipc.handle('tastePolicy:profile', (event) => {
    assertMainWindowSender(event, getWindow());
    return {
      revision: db.getTastePolicy().revision,
      likes: db.getTasteLikedTracks(),
      artists: [
        ...db.getFollowedArtists(),
        ...db.getScrobbledTopArtists(30).filter((artist) => artist.score > 0),
      ],
    };
  });
  ipc.handle('tastePolicy:setExcluded', (event, value: unknown) => {
    const window = getWindow();
    assertMainWindowSender(event, window);
    return db.setTasteExcluded(value);
  });
}
