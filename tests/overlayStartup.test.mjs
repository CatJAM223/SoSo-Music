import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { EventEmitter } from 'node:events';
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
    showInactive() {
      this.shows++;
    }
    show() {
      this.shows++;
    }
    focus() {
      this.focuses++;
    }
    hide() {
      this.hidden = true;
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
