import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { EventEmitter } from 'node:events';
import {
  DEFAULT_OVERLAY_LAYOUT,
  overlayWindowBounds,
} from '../src/shared/utils/desktopControls.ts';
function fixture() {
  const windows = [];
  const screen = new EventEmitter();
  Object.assign(screen, {
    getCursorScreenPoint: () => ({ x: 100, y: 100 }),
    getDisplayNearestPoint: () => ({ bounds: { x: 0, y: 0, width: 1920, height: 1080 } }),
    getDisplayMatching: () => ({ bounds: { x: 0, y: 0, width: 1920, height: 1080 } }),
  });
  class Window extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.destroyed = false;
      this.shows = 0;
      this.focuses = 0;
      this.messages = [];
      this.visible = false;
      this.minimized = false;
      this.restores = 0;
      this.moves = 0;
      this.webContents = new EventEmitter();
      Object.assign(this.webContents, {
        isLoading: () => false,
        send: (...args) => this.messages.push(args),
        setWindowOpenHandler() {},
        mainFrame: {},
      });
      windows.push(this);
    }
    setAlwaysOnTop() {}
    setIgnoreMouseEvents(value) {
      this.ignoreMouse = value;
    }
    setFocusable(value) {
      this.focusable = value;
    }
    isVisible() {
      return this.visible;
    }
    isMinimized() {
      return this.minimized;
    }
    restore() {
      this.minimized = false;
      this.restores++;
    }
    moveTop() {
      this.moves++;
    }
    showInactive() {
      this.shows++;
      this.visible = true;
    }
    show() {
      this.shows++;
      this.visible = true;
    }
    focus() {
      this.focuses++;
    }
    hide() {
      this.hidden = true;
      this.visible = false;
      this.emit('hide');
    }
    minimize() {
      this.minimized = true;
      this.emit('minimize');
    }
    setBounds(value) {
      this.bounds = value;
    }
    getBounds() {
      return this.bounds || this.options;
    }
    isDestroyed() {
      return this.destroyed;
    }
    destroy() {
      this.destroyed = true;
      this.emit('closed');
    }
    loadFile() {
      return Promise.resolve();
    }
    loadURL() {
      return Promise.resolve();
    }
  }
  const raw = fs.readFileSync(
    new URL('../src/desktop/main/services/playerOverlayWindow.ts', import.meta.url),
    'utf8',
  );
  const source = stripTypeScriptTypes(raw, { mode: 'strip' })
    .replace(/^import[\s\S]*?;\s*/gm, '')
    .replace('export function', 'function');
  const create = vm.runInNewContext(source + '\ncreatePlayerOverlayWindow', {
    BrowserWindow: Window,
    screen,
    trackArtworkCandidates: () => [],
    DEFAULT_OVERLAY_LAYOUT,
    overlayWindowBounds,
    setTimeout,
    clearTimeout,
    PlaybackLogger: { debug() {}, warn() {} },
  });
  return { overlay: create('preload', 'renderer', undefined), windows, screen };
}
test('Enabled overlay opens once at startup without a hotkey, remains unfocused and click-through', () => {
  const f = fixture();
  f.overlay.setEnabled(true);
  assert.equal(f.windows.length, 0);
  f.overlay.start();
  assert.equal(f.windows.length, 1);
  const win = f.windows[0];
  assert.equal(win.options.hasShadow, false);
  assert.equal(win.options.webPreferences.partition, 'soso-player-overlay');
  win.emit('ready-to-show');
  assert.equal(win.shows, 1);
  assert.equal(win.focuses, 0);
  assert.equal(win.ignoreMouse, true);
  f.overlay.start();
  assert.equal(f.windows.length, 1);
  assert.equal(win.shows, 1);
  f.overlay.dispose();
  assert.equal(f.screen.listenerCount('display-removed'), 0);
});
test('Disabled preference prevents startup window creation; enabling shows it and disabling destroys it', () => {
  const f = fixture();
  f.overlay.setEnabled(false);
  f.overlay.start();
  assert.equal(f.windows.length, 0);
  assert.equal(f.overlay.toggle(), false);
  f.overlay.setEnabled(true);
  assert.equal(f.windows.length, 1);
  f.windows[0].emit('ready-to-show');
  assert.equal(f.windows[0].shows, 1);
  f.overlay.setEnabled(false);
  assert.equal(f.windows[0].isDestroyed(), true);
  f.overlay.setEnabled(true);
  assert.equal(f.windows.length, 2);
  f.overlay.dispose();
});
test('Hotkey visibility and position editor continue to work after automatic startup', () => {
  const f = fixture();
  f.overlay.start();
  f.windows[0].emit('ready-to-show');
  assert.equal(f.overlay.toggle(), false);
  assert.equal(f.windows[0].hidden, true);
  assert.equal(f.overlay.toggle(), true);
  assert.equal(f.windows[0].focuses, 0);
  f.overlay.edit();
  assert.equal(f.overlay.isEditing(), true);
  assert.equal(f.windows[0].ignoreMouse, false);
  f.overlay.finishEditing();
  assert.equal(f.windows[0].ignoreMouse, true);
  f.overlay.dispose();
  assert.equal(f.overlay.toggle(), false);
});

test('A native hide or minimization cannot leave the overlay stuck behind its logical flag', () => {
  for (const action of ['hide', 'minimize']) {
    const f = fixture();
    f.overlay.start();
    const win = f.windows[0];
    win.emit('ready-to-show');
    win[action]();
    assert.equal(f.overlay.toggle(), true);
    assert.equal(win.isVisible(), true);
    assert.equal(win.isMinimized(), false);
    assert.equal(win.focuses, 0);
    assert.ok(win.moves >= 2);
    f.overlay.dispose();
  }
});
test('Showing a minimized hidden overlay restores it and retains its display after the cursor moves', () => {
  const f = fixture();
  f.overlay.start();
  const win = f.windows[0];
  win.emit('ready-to-show');
  f.overlay.toggle();
  win.minimize();
  f.screen.getDisplayNearestPoint = () => ({
    bounds: { x: 1920, y: 0, width: 1920, height: 1080 },
  });
  assert.equal(f.overlay.toggle(), true);
  assert.equal(win.restores, 1);
  assert.ok(win.getBounds().x < 1920, 'Keep the original display rather than following the cursor');
  f.overlay.dispose();
});
test('A renderer failure releases the dead overlay so the next toggle recreates it', () => {
  const f = fixture();
  f.overlay.start();
  const win = f.windows[0];
  win.emit('ready-to-show');
  win.webContents.emit('render-process-gone', {}, { reason: 'crashed' });
  assert.equal(win.isDestroyed(), true);
  assert.equal(f.overlay.toggle(), true);
  assert.equal(f.windows.length, 2);
  f.windows[1].emit('ready-to-show');
  assert.equal(f.windows[1].isVisible(), true);
  f.overlay.dispose();
});
test('Hiding during first renderer load keeps it hidden when ready-to-show arrives', () => {
  const f = fixture();
  f.overlay.start();
  const win = f.windows[0];
  assert.equal(f.overlay.toggle(), false);
  win.emit('ready-to-show');
  assert.equal(win.shows, 0);
  assert.equal(f.overlay.toggle(), true);
  assert.equal(win.shows, 1);
  f.overlay.dispose();
});

test('Viewing allocates only the card surface, editing expands it, and finishing restores the saved position', () => {
  const f = fixture();
  f.overlay.start();
  const win = f.windows[0];
  win.emit('ready-to-show');
  assert.equal(win.getBounds().width, 340);
  assert.equal(win.getBounds().height, 80);
  const original = win.getBounds();
  f.overlay.edit();
  assert.equal(win.getBounds().width, 1920);
  assert.equal(win.getBounds().height, 1080);
  f.overlay.finishEditing();
  assert.deepEqual(win.getBounds(), original);
  f.overlay.dispose();
});

test('Overlay language is retained across window recreation without sharing playback storage', () => {
  const f = fixture();
  f.overlay.setLanguage('en');
  f.overlay.start();
  const first = f.windows[0];
  first.emit('ready-to-show');
  assert.equal(f.overlay.getLanguage(), 'en');
  f.overlay.setLanguage('ru');
  assert.ok(
    first.messages.some(
      ([channel, language]) => channel === 'overlay:languageChanged' && language === 'ru',
    ),
  );
  f.overlay.setEnabled(false);
  f.overlay.setLanguage('en');
  f.overlay.setEnabled(true);
  assert.equal(f.overlay.getLanguage(), 'en');
  assert.equal(f.windows[1].options.webPreferences.partition, 'soso-player-overlay');
  f.overlay.dispose();
});

test('A hidden overlay releases its renderer after the grace period and reopens with the retained track', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture();
  f.overlay.sendState({ track: { id: 1, title: 'Song' } });
  f.overlay.start();
  const win = f.windows[0];
  win.emit('ready-to-show');
  f.overlay.hide();
  t.mock.timers.tick(15000);
  assert.equal(win.isDestroyed(), true);
  assert.equal(f.overlay.toggle(), true);
  f.windows[1].emit('ready-to-show');
  assert.equal(
    f.windows[1].messages.find(([channel]) => channel === 'widget:stateUpdate')[1].track.title,
    'Song',
  );
  f.overlay.dispose();
});

test('Compact overlay placement supports displays left of the primary monitor', () => {
  const display = { x: -2560, y: -200, width: 2560, height: 1440 };
  const layout = { ...DEFAULT_OVERLAY_LAYOUT, track: { x: 1, y: 1 } };
  assert.deepEqual(overlayWindowBounds(display, layout, false), {
    x: -340,
    y: 1160,
    width: 340,
    height: 80,
  });
  assert.deepEqual(overlayWindowBounds(display, layout, true), display);
});
