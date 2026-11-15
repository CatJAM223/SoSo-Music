import { BrowserWindow, screen, type IpcMainInvokeEvent } from 'electron';
import { PlaybackLogger } from './playbackLogger';
import { trackArtworkCandidates } from '../../../shared/utils/trackArtwork.ts';
import type { WidgetState } from '../../../shared/types';
import {
  DEFAULT_OVERLAY_LAYOUT,
  overlayWindowBounds,
  type OverlayLayout,
} from '../../../shared/utils/desktopControls';
export function createPlayerOverlayWindow(
  preload: string,
  renderer: string,
  devUrl: string | undefined,
  readLayout: () => OverlayLayout = () => DEFAULT_OVERLAY_LAYOUT,
) {
  let window: BrowserWindow | null = null;
  let requested = false;
  let playerFocused = false;
  let ready = false;
  let started = false;
  let editing = false;
  let enabled = true;
  let language: 'ru' | 'en' = 'ru';
  let lastState: unknown = null;
  let lastTrackKey: string | null = null;
  let releaseTimer: ReturnType<typeof setTimeout> | undefined;
  let previousBounds: ReturnType<typeof overlayWindowBounds> | undefined;
  const cancelRelease = () => {
    clearTimeout(releaseTimer);
    releaseTimer = undefined;
  };
  const shouldShow = () => started && enabled && requested && (editing || !playerFocused);
  function forgetWindow() {
    cancelRelease();
    window = null;
    ready = false;
    lastTrackKey = null;
  }
  function releaseWhenHidden(win: BrowserWindow) {
    if (releaseTimer !== undefined) return;
    releaseTimer = setTimeout(() => {
      releaseTimer = undefined;
      if (window !== win || shouldShow() || win.isDestroyed()) return;
      forgetWindow();
      win.destroy();
    }, 15000);
    releaseTimer.unref?.();
  }
  function fitWindow() {
    if (!window || window.isDestroyed()) return;
    const display = screen.getDisplayMatching(window.getBounds());
    previousBounds = overlayWindowBounds(display.workArea ?? display.bounds, readLayout(), editing);
    window.setBounds(previousBounds);
  }
  function sendTrack(force = false) {
    if (
      lastState === null ||
      !shouldShow() ||
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
    if (!window || window.isDestroyed() || !ready || !shouldShow()) return;
    cancelRelease();
    if (window.isMinimized()) window.restore();
    fitWindow();
    window.setAlwaysOnTop(true, 'screen-saver');
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
  function createWindow() {
    const display = previousBounds
      ? screen.getDisplayMatching(previousBounds)
      : screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const win = new BrowserWindow({
      ...overlayWindowBounds(display.workArea ?? display.bounds, readLayout(), editing),
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
        // Playback checkpoints are large localStorage writes. Sharing their session
        // sends old/new queue strings to this otherwise idle renderer every 10s.
        partition: 'soso-player-overlay',
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
      if (shouldShow()) {
        applyMode();
        show();
      }
    });
    win.on('closed', () => {
      if (window !== win) return;
      forgetWindow();
      requested = false;
      editing = false;
    });
    const nativeHidden = () => {
      if (window !== win || win.isDestroyed() || (win.isVisible() && !win.isMinimized())) return;
      if (shouldShow()) {
        requested = false;
        editing = false;
        applyMode();
        fitWindow();
      }
      releaseWhenHidden(win);
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
      if (!win.isDestroyed()) fitWindow();
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
  }
  function syncVisibility() {
    const win = window && !window.isDestroyed() ? window : null;
    if (shouldShow()) {
      cancelRelease();
      if (!win) createWindow();
      else if (!win.isVisible() || win.isMinimized()) show();
    } else if (win) {
      if (win.isVisible()) win.hide();
      releaseWhenHidden(win);
    }
  }
  function toggle() {
    if (!enabled || !started) return false;
    requested = !requested;
    editing = false;
    applyMode();
    fitWindow();
    syncVisibility();
    return requested;
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
      requested = enabled;
      syncVisibility();
    },
    toggle,
    setPlayerFocused: (focused: boolean) => {
      if (playerFocused === focused) return;
      playerFocused = focused;
      if (focused && editing) {
        editing = false;
        applyMode();
        fitWindow();
      }
      syncVisibility();
    },
    owns,
    getLanguage: () => language,
    setLanguage: (value: 'ru' | 'en') => {
      language = value;
      if (window && !window.isDestroyed())
        window.webContents.send('overlay:languageChanged', language);
    },
    isEditing: () => editing,
    edit: () => {
      if (!enabled) throw Error('OVERLAY_DISABLED');
      if (!started) throw Error('OVERLAY_NOT_READY');
      requested = true;
      editing = true;
      if (!window || window.isDestroyed()) createWindow();
      applyMode();
      show();
      return true;
    },
    finishEditing: () => {
      editing = false;
      fitWindow();
      applyMode();
      syncVisibility();
      return false;
    },
    hide: () => {
      requested = false;
      editing = false;
      applyMode();
      fitWindow();
      syncVisibility();
      return false;
    },
    sendState: (state: unknown) => {
      lastState = state;
      sendTrack();
    },
    setEnabled: (value: boolean) => {
      enabled = value;
      if (!enabled) {
        const previous = window;
        forgetWindow();
        previous?.destroy();
        requested = false;
        editing = false;
        lastState = null;
      } else if (started) {
        requested = true;
        syncVisibility();
      }
    },
    dispose: () => {
      started = false;
      const previous = window;
      forgetWindow();
      previous?.destroy();
      requested = false;
      editing = false;
    },
  };
}
