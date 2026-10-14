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
test('Malformed input cannot install invalid shortcuts or non-finite panel coordinates', (t) => {
  const f = setup(t);
  for (const key of ['Control', 'Shift', 'A+B', 'Control+Control+A', 'Control+Escape', null])
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
  let editing = false;
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
      setOverlayEnabled: (value) => {
        if (typeof value !== 'boolean') throw Error('INVALID_OVERLAY_ENABLED');
        return { overlayEnabled: value };
      },
      getLayout: () => ({}),
      saveLayout: () => {
        calls++;
      },
    },
    {
      owns: (e) => e.sender === overlayContents && e.senderFrame === overlayContents.mainFrame,
      toggle: () => true,
      setEnabled: () => {},
      edit: () => (editing = true),
      isEditing: () => editing,
      finishEditing: () => (editing = false),
    },
    () => null,
  );
  assert.throws(() => handlers.get('overlay:setEnabled')(overlayEvent, false));
  assert.throws(() => handlers.get('overlay:setEnabled')(event, 'false'));
  assert.equal(handlers.get('overlay:setEnabled')(event, false).overlayEnabled, false);
  assert.throws(() => handlers.get('desktopControls:get')(overlayEvent));
  assert.equal(calls, 0);
  assert.throws(() => handlers.get('overlay:saveLayout')(event, {}));
  assert.equal(calls, 0);
  assert.throws(() => handlers.get('overlay:edit')(overlayEvent));
  assert.throws(() => handlers.get('overlay:isEditing')(event));
  assert.throws(() => handlers.get('overlay:finishEditing')(event));
  assert.throws(() => handlers.get('overlay:edit')({ ...event, senderFrame: {} }));
  assert.equal(handlers.get('overlay:isEditing')(overlayEvent), false);
  assert.throws(() => handlers.get('overlay:saveLayout')(overlayEvent, {}), /editing required/);
  assert.equal(handlers.get('overlay:edit')(event), true);
  assert.equal(handlers.get('overlay:isEditing')(overlayEvent), true);
  handlers.get('overlay:saveLayout')(overlayEvent, {});
  assert.equal(calls, 1);
  assert.equal(handlers.get('overlay:finishEditing')(overlayEvent), false);
  assert.throws(() => handlers.get('overlay:saveLayout')(overlayEvent, {}), /editing required/);
  assert.equal(handlers.has('overlay:interactive'), false);
  assert.throws(() => handlers.get('desktopControls:capture')(event, {}));
  assert.equal(handlers.get('overlay:toggle')(overlayEvent), true);
  handlers.get('desktopControls:get')(event);
  assert.equal(calls, 2);
});

test('Single keys, modifier/key pairs and numpad keys can be recorded and survive restart', (t) => {
  const f = setup(t);
  for (const key of [
    'F8',
    'A',
    'Space',
    'Shift+F8',
    'Control+Space',
    'Alt+Left',
    'Enter',
    'num5',
    'numadd',
    '-',
    '=',
  ])
    assert.equal(normalizeShortcut(key), key);
  const event = { code: 'F8', ctrlKey: false, shiftKey: false, altKey: false, metaKey: false };
  assert.equal(shortcutFromKey(event), 'F8');
  assert.equal(shortcutFromKey({ ...event, shiftKey: true }), 'Shift+F8');
  assert.equal(shortcutFromKey({ ...event, code: 'Numpad5' }), 'num5');
  assert.equal(shortcutFromKey({ ...event, code: 'ControlLeft', ctrlKey: true }), null);
  f.controls.update('next', 'F8');
  f.controls.update('prev', 'Shift+F8');
  assert.ok(f.keys.has('F8'));
  assert.ok(f.keys.has('Shift+F8'));
  f.controls.dispose();
  const restored = new DesktopControls(f.dir, f.registry, () => {});
  assert.equal(restored.status().shortcuts.next, 'F8');
  assert.equal(restored.status().shortcuts.prev, 'Shift+F8');
  restored.dispose();
});

test('Disabling overlay releases only its binding, survives layout writes/restart and preserves assigned shortcuts', (t) => {
  const f = setup(t),
    original = f.controls.status().shortcuts;
  assert.equal(f.controls.setOverlayEnabled(false).overlayEnabled, false);
  assert.ok(!f.keys.has(DEFAULT_SHORTCUTS.overlay));
  for (const action of ['next', 'prev', 'togglePlay'])
    assert.ok(f.keys.has(DEFAULT_SHORTCUTS[action]));
  f.controls.update('next', 'F8');
  f.keys.get('F8')();
  assert.deepEqual(f.actions, ['next']);
  f.controls.saveLayout(f.controls.getLayout());
  f.controls.dispose();
  const restored = new DesktopControls(f.dir, f.registry, () => {});
  restored.start();
  assert.equal(restored.status().overlayEnabled, false);
  assert.ok(!f.keys.has(DEFAULT_SHORTCUTS.overlay));
  restored.setOverlayEnabled(true);
  assert.ok(f.keys.has(DEFAULT_SHORTCUTS.overlay));
  assert.equal(restored.status().shortcuts.overlay, original.overlay);
  restored.dispose();
});

test('Failure to persist disabled overlay leaves it enabled and its shortcut registered', (t) => {
  const f = setup(t);
  fs.mkdirSync(path.join(f.dir, 'desktop-controls.json'));
  assert.throws(() => f.controls.setOverlayEnabled(false));
  assert.equal(f.controls.status().overlayEnabled, true);
  assert.ok(f.keys.has(DEFAULT_SHORTCUTS.overlay));
  assert.throws(() => f.controls.setOverlayEnabled('false'), /INVALID_OVERLAY_ENABLED/);
});
