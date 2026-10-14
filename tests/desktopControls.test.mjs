import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DesktopControls } from '../src/desktop/main/services/desktopControls.ts';
import {
  DEFAULT_SHORTCUTS,
  normalizeShortcut,
  shortcutFromKey,
} from '../src/shared/utils/desktopControls.ts';
import { registerDesktopControlsHandlers } from '../src/desktop/main/ipc/desktopControlsHandlers.ts';
function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soso-hotkeys-'));
  const keys = new Map(),
    blocked = new Set(),
    actions = [];
  const registry = {
    register: (key, fn) => {
      if (blocked.has(key) || keys.has(key)) return false;
      keys.set(key, fn);
      return true;
    },
    unregister: (key) => keys.delete(key),
  };
  const controls = new DesktopControls(dir, registry, (action) => actions.push(action));
  controls.start();
  t.after(() => {
    controls.dispose();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { dir, keys, blocked, actions, controls, registry };
}
test('Default global hotkeys dispatch the expected commands and release only their registrations', (t) => {
  const f = setup(t);
  f.keys.get(DEFAULT_SHORTCUTS.next)();
  f.keys.get(DEFAULT_SHORTCUTS.overlay)();
  assert.deepEqual(f.actions, ['next', 'overlay']);
  f.keys.set('Foreign', () => {});
  f.controls.dispose();
  assert.deepEqual([...f.keys.keys()], ['Foreign']);
});
test('Changes, disabled shortcuts and normalized overlay positions survive a restart', (t) => {
  const f = setup(t);
  f.controls.update('next', 'Alt+Control+N');
  f.controls.update('prev', '');
  f.controls.saveLayout({ track: { x: 0.8, y: 0.2 }, controls: { x: -1, y: 9 } });
  f.controls.dispose();
  const restored = new DesktopControls(f.dir, f.registry, () => {});
  assert.equal(restored.status().shortcuts.next, 'Control+Alt+N');
  assert.equal(restored.status().shortcuts.prev, '');
  assert.deepEqual(restored.getLayout(), { track: { x: 0.8, y: 0.2 }, controls: { x: 0, y: 1 } });
  restored.dispose();
});
test('Conflicts and duplicate assignments preserve the previous working registration and preferences', (t) => {
  const f = setup(t);
  f.blocked.add('Control+Alt+N');
  assert.throws(() => f.controls.update('next', 'Control+Alt+N'), /SHORTCUT_IN_USE/);
  assert.equal(f.controls.status().shortcuts.next, DEFAULT_SHORTCUTS.next);
  assert.ok(f.keys.has(DEFAULT_SHORTCUTS.next));
  assert.throws(() => f.controls.update('next', DEFAULT_SHORTCUTS.prev), /DUPLICATE/);
  assert.ok(f.keys.has(DEFAULT_SHORTCUTS.next));
});
test('A disk write failure rolls global shortcuts back and does not leak temporary files', (t) => {
  const f = setup(t);
  fs.mkdirSync(path.join(f.dir, 'desktop-controls.json'));
  assert.throws(() => f.controls.update('next', 'Control+Alt+N'));
  assert.ok(f.keys.has(DEFAULT_SHORTCUTS.next));
  assert.ok(!f.keys.has('Control+Alt+N'));
  assert.deepEqual(fs.readdirSync(f.dir), ['desktop-controls.json']);
});
test('Recording suspends shortcuts and resuming reports unavailable external bindings', (t) => {
  const f = setup(t);
  f.controls.capture(true);
  assert.equal(f.keys.size, 0);
  f.blocked.add(DEFAULT_SHORTCUTS.overlay);
  const status = f.controls.capture(false);
  assert.deepEqual(status.unavailable, ['overlay']);
  assert.equal(f.keys.size, 3);
});
test('Malformed input cannot install unmodified typing keys or non-finite panel coordinates', (t) => {
  const f = setup(t);
  for (const key of ['A', 'Shift+A', 'Control+Control+A', 'Control+Escape', null])
    assert.throws(() => normalizeShortcut(key));
  assert.equal(
    shortcutFromKey({ code: 'KeyO', ctrlKey: true, shiftKey: true, altKey: false, metaKey: false }),
    'Control+Shift+O',
  );
  assert.throws(() => f.controls.saveLayout({ track: { x: NaN, y: 0 }, controls: { x: 0, y: 0 } }));
  assert.throws(() => f.controls.update('__proto__', 'Control+O'));
});
test('IPC enforces separate permissions for player settings and overlay interaction', () => {
  const handlers = new Map(),
    contents = { mainFrame: {} },
    overlayContents = { mainFrame: {} };
  let calls = 0;
  const main = { isDestroyed: () => false, webContents: contents },
    event = { sender: contents, senderFrame: contents.mainFrame },
    overlayEvent = { sender: overlayContents, senderFrame: overlayContents.mainFrame };
  registerDesktopControlsHandlers(
    { handle: (name, fn) => handlers.set(name, fn) },
    () => main,
    {
      status: () => {
        calls++;
        return {};
      },
      update: () => {
        calls++;
      },
      capture: () => {},
      getLayout: () => ({}),
      saveLayout: () => {
        calls++;
      },
    },
    {
      owns: (e) => e.sender === overlayContents && e.senderFrame === overlayContents.mainFrame,
      toggle: () => true,
      interactive: () => {},
    },
    () => null,
  );
  assert.throws(() => handlers.get('desktopControls:get')(overlayEvent));
  assert.equal(calls, 0);
  assert.throws(() => handlers.get('overlay:saveLayout')(event, {}));
  assert.equal(calls, 0);
  assert.throws(() => handlers.get('overlay:interactive')(overlayEvent, 'yes'));
  assert.throws(() => handlers.get('desktopControls:capture')(event, {}));
  assert.equal(handlers.get('overlay:toggle')(overlayEvent), true);
  handlers.get('desktopControls:get')(event);
  assert.equal(calls, 1);
});
