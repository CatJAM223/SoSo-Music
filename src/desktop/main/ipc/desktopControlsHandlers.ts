import type { IpcMain, BrowserWindow, IpcMainInvokeEvent } from 'electron';
import type { DesktopControls } from '../services/desktopControls.ts';
import { assertMainWindowSender } from './mainWindowHandlers.ts';
type Overlay = {
  owns: (event: IpcMainInvokeEvent) => boolean;
  toggle: () => boolean;
  setEnabled: (enabled: boolean) => void;
  edit: () => boolean;
  isEditing: () => boolean;
  getLanguage: () => 'ru' | 'en';
  finishEditing: () => boolean;
};
export function registerDesktopControlsHandlers(
  ipc: Pick<IpcMain, 'handle'>,
  main: () => BrowserWindow | null,
  controls: DesktopControls,
  overlay: Overlay,
  getState: () => unknown,
) {
  const assertOverlay = (event: IpcMainInvokeEvent) => {
    if (!overlay.owns(event)) throw Error('Overlay window required');
  };
  ipc.handle('desktopControls:get', (event) => {
    assertMainWindowSender(event, main());
    return controls.status();
  });
  ipc.handle('desktopControls:setShortcut', (event, action: unknown, key: unknown) => {
    assertMainWindowSender(event, main());
    return controls.update(action, key);
  });
  ipc.handle('desktopControls:capture', (event, enabled: unknown) => {
    assertMainWindowSender(event, main());
    if (typeof enabled !== 'boolean') throw Error('Invalid capture mode');
    return controls.capture(enabled);
  });
  ipc.handle('overlay:setEnabled', (event, value: unknown) => {
    assertMainWindowSender(event, main());
    const status = controls.setOverlayEnabled(value);
    overlay.setEnabled(status.overlayEnabled);
    return status;
  });
  ipc.handle('overlay:toggle', (event) => {
    if (!overlay.owns(event)) assertMainWindowSender(event, main());
    return overlay.toggle();
  });
  ipc.handle('overlay:edit', (event) => {
    assertMainWindowSender(event, main());
    return overlay.edit();
  });
  ipc.handle('overlay:isEditing', (event) => {
    assertOverlay(event);
    return overlay.isEditing();
  });
  ipc.handle('overlay:finishEditing', (event) => {
    assertOverlay(event);
    return overlay.finishEditing();
  });
  ipc.handle('overlay:getLayout', (event) => {
    assertOverlay(event);
    return controls.getLayout();
  });
  ipc.handle('overlay:getState', (event) => {
    assertOverlay(event);
    return getState();
  });
  ipc.handle('overlay:getLanguage', (event) => {
    assertOverlay(event);
    return overlay.getLanguage();
  });
  ipc.handle('overlay:saveLayout', (event, value: unknown) => {
    assertOverlay(event);
    if (!overlay.isEditing()) throw Error('Overlay editing required');
    return controls.saveLayout(value);
  });
}
