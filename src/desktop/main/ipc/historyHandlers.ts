import type { IpcMain } from 'electron';
import type { DatabaseManager } from '../db/index.ts';

export function registerHistoryHandlers(ipcMain: IpcMain, dbManager: DatabaseManager): void {
  // Database Search History handlers
  ipcMain.handle('db:getSearchHistory', (_event: any, limit?: number) => {
    const validLimit = typeof limit === 'number' && limit > 0 ? limit : 10;
    return dbManager.getSearchHistory(validLimit);
  });

  ipcMain.handle('db:addSearchHistory', (_event: any, query: string) => {
    if (!query || typeof query !== 'string' || !query.trim()) return;
    dbManager.addSearchHistory(query.trim());
  });

  ipcMain.handle('db:deleteSearchHistoryItem', (_event: any, id: number) => {
    return dbManager.removeSearchHistoryItem(id);
  });
  ipcMain.handle('db:removeSearchHistoryItem', (_event: any, id: number) => {
    return dbManager.removeSearchHistoryItem(id);
  });

  ipcMain.handle('db:clearSearchHistory', () => {
    return dbManager.clearSearchHistory();
  });

  // Database Listening History handlers
  ipcMain.handle('db:addListeningHistory', (_event: any, track: any) => {
    return dbManager.addListeningHistory(track);
  });

  ipcMain.handle(
    'db:getListeningHistory',
    (_event: any, limit?: number, uniqueTracks?: boolean) => {
      return dbManager.getListeningHistory(limit, uniqueTracks);
    },
  );

  ipcMain.handle('db:clearListeningHistory', () => {
    return dbManager.clearListeningHistory();
  });
}
