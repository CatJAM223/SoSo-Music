import { randomUUID } from 'node:crypto';
import type { BrowserWindow, IpcMain } from 'electron';
import type { LanImportRequest } from '../../../shared/types/index.ts';
import { assertMainWindowSender } from '../ipc/mainWindowHandlers.ts';

/** Consent remains in main; the renderer sees only counts and a one-use request ID. */
export class LanImportApproval {
  private pending: LanImportRequest | null = null;
  private finish: ((accepted: boolean) => void) | null = null;
  private getWindow: () => BrowserWindow | null;
  constructor(getWindow: () => BrowserWindow | null) {
    this.getWindow = getWindow;
  }

  request(summary: Omit<LanImportRequest, 'id'>, signal: AbortSignal): Promise<boolean> {
    const win = this.getWindow();
    if (!win || win.isDestroyed() || signal.aborted || this.pending) return Promise.resolve(false);
    const request = { ...summary, id: randomUUID() };
    return new Promise((resolve) => {
      const cancel = () => finish(false);
      const finish = (accepted: boolean) => {
        if (this.pending?.id !== request.id) return;
        this.pending = null;
        this.finish = null;
        signal.removeEventListener('abort', cancel);
        win.off('closed', cancel);
        win.webContents.off('render-process-gone', cancel);
        win.webContents.off('did-start-loading', cancel);
        resolve(accepted && !signal.aborted);
        if (!win.isDestroyed()) {
          try {
            win.webContents.send('sync:importRequest', null);
          } catch {}
        }
      };
      this.pending = request;
      this.finish = finish;
      signal.addEventListener('abort', cancel, { once: true });
      win.once('closed', cancel);
      win.webContents.once('render-process-gone', cancel);
      win.webContents.once('did-start-loading', cancel);
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      try {
        win.webContents.send('sync:importRequest', request);
      } catch {
        finish(false);
      }
    });
  }

  register(ipc: Pick<IpcMain, 'handle'>): void {
    ipc.handle('sync:pendingImport', (event) => {
      assertMainWindowSender(event, this.getWindow());
      return this.pending;
    });
    ipc.handle('sync:respondImport', (event, id: unknown, accepted: unknown) => {
      assertMainWindowSender(event, this.getWindow());
      if (typeof id !== 'string' || typeof accepted !== 'boolean' || this.pending?.id !== id)
        return false;
      this.finish?.(accepted);
      return true;
    });
  }
}
