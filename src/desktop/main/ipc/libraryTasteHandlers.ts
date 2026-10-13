import type { BrowserWindow, IpcMain } from 'electron';
import { assertMainWindowSender } from './mainWindowHandlers.ts';
import type { LibraryTasteService } from '../services/libraryTaste.ts';

export function registerLibraryTasteHandlers(
  ipc: IpcMain,
  getWindow: () => BrowserWindow | null,
  service: LibraryTasteService,
  credentials?: {
    status: () => { configured: boolean };
    save: (value: unknown) => { configured: boolean };
  },
): void {
  if (credentials) {
    ipc.handle('lastfm:keyStatus', (event) => {
      assertMainWindowSender(event, getWindow());
      return credentials.status();
    });
    ipc.handle('lastfm:saveKey', (event, value: unknown) => {
      assertMainWindowSender(event, getWindow());
      return credentials.save(value);
    });
  }
  ipc.handle('libraryTaste:status', (event) => {
    assertMainWindowSender(event, getWindow());
    return {
      ...service.report(),
      ...(credentials ? { apiKeyConfigured: credentials.status().configured } : {}),
    };
  });
  ipc.handle('libraryTaste:analyze', (event) => {
    assertMainWindowSender(event, getWindow());
    return service.analyze();
  });
  ipc.handle('libraryTaste:cancel', (event) => {
    assertMainWindowSender(event, getWindow());
    return service.cancel();
  });
  ipc.handle('libraryTaste:setAutoAnalyze', (event, enabled: unknown) => {
    assertMainWindowSender(event, getWindow());
    if (typeof enabled !== 'boolean') throw new Error('Invalid automatic analysis setting');
    return service.setAutoAnalyze(enabled);
  });
}
