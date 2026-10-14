import { BrowserWindow, screen, type IpcMainInvokeEvent } from 'electron';
export function createPlayerOverlayWindow(
  preload: string,
  renderer: string,
  devUrl: string | undefined,
) {
  let window: BrowserWindow | null = null;
  let visible = false;
  let editing = false;
  function applyMode() {
    if (!window || window.isDestroyed()) return;
    window.setFocusable(editing);
    // Normal viewing always passes every mouse event through, including the artwork.
    window.setIgnoreMouseEvents(!editing);
    window.webContents.send('overlay:editingChanged', editing);
  }
  function show() {
    if (!window || window.isDestroyed()) return;
    if (editing) {
      window.show();
      window.focus();
    } else window.showInactive();
  }
  function toggle() {
    visible = !visible;
    editing = false;
    if (window && !window.isDestroyed()) {
      applyMode();
      if (!visible) {
        window.hide();
        return false;
      }
      window.setBounds(screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).bounds);
      show();
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
    win.setIgnoreMouseEvents(true);
    win.webContents.on('will-navigate', (event) => event.preventDefault());
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.once('ready-to-show', () => {
      if (!win.isDestroyed() && visible) {
        applyMode();
        show();
      }
    });
    win.on('closed', () => {
      if (window === win) {
        window = null;
        visible = false;
        editing = false;
      }
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
    isEditing: () => editing,
    edit: () => {
      if (!visible || !window || window.isDestroyed()) toggle();
      editing = true;
      applyMode();
      if (!window?.webContents.isLoading()) show();
      return true;
    },
    finishEditing: () => {
      editing = false;
      applyMode();
      return false;
    },
    hide: () => {
      visible = false;
      editing = false;
      applyMode();
      window?.hide();
      return false;
    },
    sendState: (state: unknown) => {
      if (window && !window.isDestroyed()) window.webContents.send('widget:stateUpdate', state);
    },
    dispose: () => {
      window?.destroy();
      window = null;
      visible = false;
      editing = false;
    },
  };
}
