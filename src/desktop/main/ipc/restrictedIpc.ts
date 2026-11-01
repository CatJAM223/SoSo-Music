import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron';
import { assertMainWindowSender } from './mainWindowHandlers.ts';

/** Every registered channel defaults to the main frame of the main window. */
export function restrictedIpc(
  ipc: IpcMain,
  main: () => BrowserWindow | null,
  secondary: (channel: string, event: IpcMainInvokeEvent) => boolean,
): IpcMain {
  return new Proxy(ipc, {
    get(target, property) {
      if (property === 'handle')
        return (channel: string, listener: (...args: any[]) => unknown) =>
          target.handle(channel, (event, ...args) => {
            if (!secondary(channel, event)) assertMainWindowSender(event, main());
            return listener(event, ...args);
          });
      if (property === 'on')
        return (channel: string, listener: (...args: any[]) => void) =>
          target.on(channel, (event, ...args) => {
            try {
              if (!secondary(channel, event)) assertMainWindowSender(event, main());
            } catch {
              return;
            }
            listener(event, ...args);
          });
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
