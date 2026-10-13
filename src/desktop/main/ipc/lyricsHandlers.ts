import type { IpcMain } from 'electron';
import type { DatabaseManager } from '../db/index.ts';
import { LyricsService } from '../services/lyricsService.ts';
import { ChordsService } from '../services/chordsService.ts';
import { SongsterrService } from '../services/songsterrService.ts';
import { createLyricsCacheKey } from '../../../shared/utils/lyricsIdentity.ts';

export function registerLyricsHandlers(ipcMain: IpcMain, dbManager: DatabaseManager): void {
  // Lyrics API (with persistent SQLite cache — survives restarts)
  ipcMain.handle('music:getLyrics', async (_event: any, payload: any) => {
    if (!payload || typeof payload !== 'object') return null;
    const { title, artist, duration } = payload;
    if (!title || typeof title !== 'string') return null;
    if (!artist || typeof artist !== 'string') return null;
    const cacheKey = createLyricsCacheKey(title, artist, duration);
    try {
      const cached = dbManager.getCachedLyrics(cacheKey);
      if (cached) return cached.lines;
    } catch (e) {
      console.warn('[Main] getCachedLyrics error:', e);
    }

    const detailed = await LyricsService.getLyricsDetailed(title, artist, duration);
    if (detailed && detailed.lines.length > 0) {
      try {
        dbManager.saveLyricsCache(cacheKey, detailed.lines, detailed.synced);
      } catch (e) {
        console.warn('[Main] saveLyricsCache error:', e);
      }
      return detailed.lines;
    }
    return null;
  });

  // Guitar Chords API (Ultimate Guitar + AmDm)
  ipcMain.handle('music:getChords', async (_event: any, payload: any) => {
    if (!payload || typeof payload !== 'object') return null;
    const { title, artist } = payload;
    if (!title || typeof title !== 'string') return null;
    return await ChordsService.getChords(title, typeof artist === 'string' ? artist : '');
  });

  // Songsterr Guitar & Bass Tabs API
  ipcMain.handle('music:getSongsterrTab', async (_event: any, payload: any) => {
    if (!payload || typeof payload !== 'object') return null;
    const { title, artist } = payload;
    if (!title || typeof title !== 'string') return null;
    return await SongsterrService.getSongTab(title, typeof artist === 'string' ? artist : '');
  });
}
