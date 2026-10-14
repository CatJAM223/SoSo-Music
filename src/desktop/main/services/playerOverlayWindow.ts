import { BrowserWindow, screen, type IpcMainInvokeEvent } from 'electron';
export function createPlayerOverlayWindow(
  preload: string,
  renderer: string,
  devUrl: string | undefined,
) {
  let window: BrowserWindow | null = null;
  let visible = false;
  function toggle() {
    visible = !visible;
    if (window && !window.isDestroyed()) {
      if (!visible) {
        window.hide();
        window.setIgnoreMouseEvents(true, { forward: true });
        return false;
      }
      window.setBounds(screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).bounds);
      window.setIgnoreMouseEvents(true, { forward: true });
      window.showInactive();
      return true;
    }
    const win = new BrowserWindow({
      ...screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).bounds,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      movable: false,
      hasShadow: false,
      skipTaskbar: true,
      focusable: false,
      alwaysOnTop: true,
      title: 'SoSo Music Overlay',
      webPreferences: {
        preload,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        backgroundThrottling: true,
      },
    });
    window = win;
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setIgnoreMouseEvents(true, { forward: true });
    win.webContents.on('will-navigate', (event) => event.preventDefault());
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.once('ready-to-show', () => {
      if (!win.isDestroyed() && visible) win.showInactive();
    });
    win.on('closed', () => {
      if (window === win) window = null;
    });
    const adjust = () => {
      if (!win.isDestroyed()) win.setBounds(screen.getDisplayMatching(win.getBounds()).bounds);
    };
    screen.on('display-metrics-changed', adjust);
    screen.on('display-removed', adjust);
    win.once('closed', () => {
      screen.removeListener('display-metrics-changed', adjust);
      screen.removeListener('display-removed', adjust);
    });
    if (devUrl) void win.loadURL(devUrl + '#/overlay');
    else void win.loadFile(renderer, { hash: '/overlay' });
    return true;
  }
  function owns(event: IpcMainInvokeEvent) {
    return (
      !!window &&
      !window.isDestroyed() &&
      event.sender === window.webContents &&
      event.senderFrame === window.webContents.mainFrame
    );
  }
  return {
    toggle,
    owns,
    hide: () => {
      visible = false;
      window?.hide();
      return false;
    },
    interactive: (enabled: boolean) => {
      window?.setIgnoreMouseEvents(!enabled, { forward: true });
    },
    sendState: (state: unknown) => {
      if (window && !window.isDestroyed()) window.webContents.send('widget:stateUpdate', state);
    },
    dispose: () => {
      window?.destroy();
      window = null;
    },
  };
}
