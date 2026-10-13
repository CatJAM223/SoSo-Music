import type { BrowserWindow, IpcMain } from 'electron';
import type { YouTubeAccountStatus } from '../../../shared/types/index.ts';
import { registerMainWindowHandlers } from './mainWindowHandlers.ts';

export interface YouTubeAccountController {
  status(): Promise<YouTubeAccountStatus>;
  connect(): Promise<YouTubeAccountStatus>;
  refresh(): Promise<YouTubeAccountStatus>;
  importSession(): Promise<YouTubeAccountStatus>;
  disconnect(): Promise<YouTubeAccountStatus>;
}

/** IPC contracts depend on the account interface, not its Chromium implementation. */
export function registerYouTubeAccountHandlers(
  ipc: Pick<IpcMain, 'handle' | 'removeHandler'>,
  getWindow: () => BrowserWindow | null,
  account: YouTubeAccountController,
): () => void {
  return registerMainWindowHandlers(ipc, getWindow, {
    'youtube:accountStatus': () => account.status(),
    'youtube:connectAccount': () => account.connect(),
    'youtube:refreshSession': () => account.refresh(),
    'youtube:importSession': () => account.importSession(),
    'youtube:disconnectAccount': () => account.disconnect(),
  });
}
