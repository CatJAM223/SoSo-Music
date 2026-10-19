import { BrowserWindow, screen, type IpcMainInvokeEvent } from 'electron';
import { PlaybackLogger } from './playbackLogger';
import { trackArtworkCandidates } from '../../../shared/utils/trackArtwork.ts';
import type { WidgetState } from '../../../shared/types';
export function createPlayerOverlayWindow(
  preload: string,
  renderer: string,
  devUrl: string | undefined,
) {
  let window: BrowserWindow | null = null;
  let visible = false;
  let ready = false;
  let started = false;
  let editing = false;
  let enabled = true;
  let lastState: unknown = null;
  let lastTrackKey: string | null = null;
  function sendTrack(force = false) {
    if (
      lastState === null ||
      !visible ||
      !window ||
      window.isDestroyed() ||
      window.webContents.isLoading()
    )
      return;
    const track = (lastState as WidgetState | null)?.track;
    const key = JSON.stringify([
      track?.id,
      track?.title,
      track?.artist?.name,
      trackArtworkCandidates(track),
    ]);
    if (!force && key === lastTrackKey) return;
    lastTrackKey = key;
    window.webContents.send('widget:stateUpdate', lastState);
  }
  function applyMode() {
    if (!window || window.isDestroyed()) return;
    window.setFocusable(editing);
    // Normal viewing always passes every mouse event through, including the artwork.
    window.setIgnoreMouseEvents(!editing);
    window.webContents.send('overlay:editingChanged', editing);
  }
  function show() {
    if (!window || window.isDestroyed() || !ready) return;
    if (window.isMinimized()) window.restore();
    window.setAlwaysOnTop(true, 'screen-saver');
    visible = true;
    sendTrack(true);
    if (editing) {
      window.show();
      window.focus();
    } else window.showInactive();
    window.moveTop();
    PlaybackLogger.debug('[Overlay:Visibility] Shown', {
      editing,
      minimized: window.isMinimized(),
      visible: window.isVisible(),
    });
  }
  function toggle() {
    if (!enabled || !started) return false;
    const existing = window && !window.isDestroyed();
    const actualVisible = existing
      ? ready
        ? window!.isVisible() && !window!.isMinimized()
        : visible
      : false;
    visible = !actualVisible;
    editing = false;
    if (window && !window.isDestroyed()) {
      applyMode();
      if (!visible) {
        window.hide();
        PlaybackLogger.debug('[Overlay:Visibility] Hidden by toggle');
        return false;
      }
      window.setBounds(screen.getDisplayMatching(window.getBounds()).bounds);
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
    ready = false;
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setIgnoreMouseEvents(true);
    win.webContents.on('will-navigate', (event) => event.preventDefault());
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.once('ready-to-show', () => {
      if (window !== win || win.isDestroyed()) return;
      ready = true;
      if (visible) {
        applyMode();
        show();
      }
    });
    win.on('closed', () => {
      if (window === win) {
        window = null;
        visible = false;
        ready = false;
        editing = false;
        lastTrackKey = null;
      }
    });
    const nativeHidden = () => {
      if (window !== win || win.isDestroyed() || (win.isVisible() && !win.isMinimized())) return;
      visible = false;
      editing = false;
      applyMode();
    };
    win.on('hide', nativeHidden);
    win.on('minimize', nativeHidden);
    win.webContents.on('render-process-gone', (_event, details) => {
      PlaybackLogger.warn('[Overlay:Renderer] Renderer exited; next toggle recreates the window', {
        reason: details.reason,
      });
      if (!win.isDestroyed()) win.destroy();
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
    const loading = devUrl
      ? win.loadURL(devUrl + '#/overlay')
      : win.loadFile(renderer, { hash: '/overlay' });
    void loading.catch((error) => {
      PlaybackLogger.warn('[Overlay:Renderer] Window loading failed', error);
      if (!win.isDestroyed()) win.destroy();
    });
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
    start: () => {
      if (started) return;
      started = true;
      if (enabled && !visible) toggle();
    },
    toggle,
    owns,
    isEditing: () => editing,
    edit: () => {
      if (!enabled) throw Error('OVERLAY_DISABLED');
      if (!started) throw Error('OVERLAY_NOT_READY');
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
      lastState = state;
      sendTrack();
    },
    setEnabled: (value: boolean) => {
      enabled = value;
      if (!enabled) {
        window?.destroy();
        window = null;
        visible = false;
        editing = false;
        lastTrackKey = null;
        lastState = null;
      } else if (started && !visible) toggle();
    },
    dispose: () => {
      started = false;
      window?.destroy();
      window = null;
      visible = false;
      editing = false;
    },
  };
}
