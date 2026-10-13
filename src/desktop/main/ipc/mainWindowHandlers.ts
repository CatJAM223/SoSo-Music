import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron';

export function assertMainWindowSender(
  event: IpcMainInvokeEvent,
  window: BrowserWindow | null,
): void {
  if (
    !window ||
    window.isDestroyed() ||
    event.sender !== window.webContents ||
    event.senderFrame !== window.webContents.mainFrame
  ) {
    throw new Error('This action is available only in the main application window');
  }
}

/** Register one feature's no-argument commands; untrusted renderer payloads are never forwarded. */
export function registerMainWindowHandlers(
  ipc: Pick<IpcMain, 'handle' | 'removeHandler'>,
  getWindow: () => BrowserWindow | null,
  commands: Record<string, () => unknown>,
): () => void {
  const registered: string[] = [];
  try {
    for (const [channel, command] of Object.entries(commands)) {
      ipc.handle(channel, (event) => {
        assertMainWindowSender(event, getWindow());
        return command();
      });
      registered.push(channel);
    }
  } catch (error) {
    for (const channel of registered) ipc.removeHandler(channel);
    throw error;
  }
  return () => {
    for (const channel of registered) ipc.removeHandler(channel);
  };
}
