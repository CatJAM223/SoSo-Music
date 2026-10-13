import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { LanImportApproval } from '../src/desktop/main/services/lanImportApproval.ts';

const summary = { address: '192.168.1.4', tracks: 29, playlists: 2, albums: 1, artists: 2 };
function fixture() {
  const handlers = new Map(),
    events = [];
  const win = new EventEmitter();
  win.webContents = new EventEmitter();
  win.webContents.mainFrame = {};
  win.webContents.send = (channel, payload) => events.push({ channel, payload });
  win.isDestroyed = () => false;
  win.isMinimized = () => false;
  win.show = () => {};
  win.focus = () => {};
  const broker = new LanImportApproval(() => win);
  broker.register({ handle: (name, fn) => handlers.set(name, fn) });
  const invoke = (name, ...args) =>
    handlers.get(name)(
      { sender: win.webContents, senderFrame: win.webContents.mainFrame },
      ...args,
    );
  return { win, broker, events, invoke, handlers };
}

test('LAN consent accepts only the current request and a strict boolean from the main frame', async () => {
  const f = fixture(),
    controller = new AbortController();
  let settled = false;
  const pending = f.broker.request(summary, controller.signal).then((value) => {
    settled = true;
    return value;
  });
  const request = f.invoke('sync:pendingImport');
  assert.deepEqual({ ...request, id: undefined }, { ...summary, id: undefined });
  await Promise.resolve();
  assert.equal(settled, false);
  assert.equal(f.invoke('sync:respondImport', 'old-id', true), false);
  assert.equal(f.invoke('sync:respondImport', request.id, 'true'), false);
  for (const event of [
    { sender: {}, senderFrame: f.win.webContents.mainFrame },
    { sender: f.win.webContents, senderFrame: {} },
  ])
    assert.throws(
      () => f.handlers.get('sync:respondImport')(event, request.id, true),
      /main application window/,
    );
  assert.equal(f.invoke('sync:respondImport', request.id, true), true);
  assert.equal(await pending, true);
  assert.equal(f.invoke('sync:respondImport', request.id, true), false);
  assert.equal(f.invoke('sync:pendingImport'), null);
  assert.equal(f.win.webContents.listenerCount('render-process-gone'), 0);
});

test('Cancel, timeout, window close, renderer crash and reload discard consent and its late reply', async () => {
  for (const reason of ['cancel', 'abort', 'closed', 'render-process-gone', 'did-start-loading']) {
    const f = fixture(),
      controller = new AbortController();
    const pending = f.broker.request(summary, controller.signal);
    const id = f.invoke('sync:pendingImport').id;
    if (reason === 'cancel') f.invoke('sync:respondImport', id, false);
    else if (reason === 'abort') controller.abort();
    else if (reason === 'closed') f.win.emit(reason);
    else f.win.webContents.emit(reason);
    assert.equal(await pending, false, reason);
    assert.equal(f.invoke('sync:pendingImport'), null);
    assert.equal(f.invoke('sync:respondImport', id, true), false);
    assert.equal(f.win.listenerCount('closed'), 0);
    assert.equal(f.win.webContents.listenerCount('did-start-loading'), 0);
  }
});

test('A simultaneous import cannot replace consent; a later request gets a different ID', async () => {
  const f = fixture(),
    controller = new AbortController();
  const first = f.broker.request(summary, controller.signal);
  const id = f.invoke('sync:pendingImport').id;
  assert.equal(
    await f.broker.request({ ...summary, tracks: 500 }, new AbortController().signal),
    false,
  );
  assert.equal(f.invoke('sync:pendingImport').tracks, 29);
  f.invoke('sync:respondImport', id, false);
  assert.equal(await first, false);
  const next = f.broker.request(summary, new AbortController().signal);
  const nextId = f.invoke('sync:pendingImport').id;
  assert.notEqual(id, nextId);
  assert.equal(f.invoke('sync:respondImport', id, true), false);
  f.invoke('sync:respondImport', nextId, true);
  assert.equal(await next, true);
});
