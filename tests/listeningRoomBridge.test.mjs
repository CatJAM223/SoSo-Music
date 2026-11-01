import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import ts from 'typescript';

function fixture() {
  const children = [],
    timers = new Map(),
    handlers = new Map(),
    messages = [];
  let serial = 0;
  const module = { exports: {} };
  const source = ts.transpileModule(
    readFileSync(
      new URL('../src/desktop/main/services/listeningRooms.ts', import.meta.url),
      'utf8',
    ),
    {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    },
  ).outputText;
  const window = {
    isDestroyed: () => false,
    webContents: { send: (_channel, value) => messages.push(value) },
  };
  vm.runInNewContext(source, {
    module,
    exports: module.exports,
    process: { platform: 'win32' },
    setTimeout: (callback) => {
      const id = ++serial;
      timers.set(id, () => {
        timers.delete(id);
        callback();
      });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
    require(name) {
      if (name === 'electron') return { app: { isPackaged: false, getAppPath: () => '/fixture' } };
      if (name === 'node:path') return path;
      if (name === './playbackLogger') return { PlaybackLogger: { warn() {} } };
      if (name.includes('mainWindowHandlers')) return { assertMainWindowSender: () => {} };
      if (name === 'node:readline') return { createInterface: ({ input }) => input };
      if (name === 'node:child_process')
        return {
          spawn: () => {
            const child = new EventEmitter();
            child.stdout = new EventEmitter();
            child.stdout.close = () => {};
            child.stderr = { resume() {} };
            child.requests = [];
            child.stdin = new EventEmitter();
            child.stdin.write = (text) => child.requests.push(JSON.parse(text));
            child.kill = () => {
              child.killed = true;
            };
            children.push(child);
            return child;
          },
        };
      throw Error('Unexpected import: ' + name);
    },
  });
  const bridge = new module.exports.ListeningRooms();
  bridge.register({ handle: (name, handler) => handlers.set(name, handler) }, () => window);
  return {
    children,
    timers,
    messages,
    bridge,
    request: (request) => handlers.get('rooms:request')({}, request),
  };
}

test('cancelling a blocked native connection releases the UI and a late exit cannot kill its replacement', async () => {
  const f = fixture();
  const joining = f.request({
    op: 'join',
    payload: { invitation: 'fixture', displayName: 'Guest' },
  });
  const rejection = assert.rejects(joining, /connection_lost/);
  assert.equal((await f.request({ op: 'leave' })).status, 'idle');
  await rejection;
  assert.equal(f.children[0].killed, true);
  assert.equal(f.timers.size, 0);
  const replacement = f.request({
    op: 'create',
    payload: { mode: 'internet', name: 'Room', displayName: 'Host' },
  });
  f.children[0].emit('exit', 1);
  const fresh = f.children[1],
    id = fresh.requests[0].id;
  fresh.stdout.emit('line', JSON.stringify({ id, result: { status: 'connected' } }));
  assert.equal((await replacement).status, 'connected');
  assert.equal(fresh.killed, undefined);
  f.bridge.dispose();
});

test('native timeout rejects every queued request and permits an immediate clean retry', async () => {
  const f = fixture();
  const joining = f.request({
    op: 'join',
    payload: { invitation: 'fixture', displayName: 'Guest' },
  });
  const status = f.request({ op: 'status' });
  const joinedRejection = assert.rejects(joining, /native_rooms_timeout/);
  const statusRejection = assert.rejects(status, /native_rooms_timeout/);
  f.timers.values().next().value();
  await Promise.all([joinedRejection, statusRejection]);
  assert.equal(f.timers.size, 0);
  assert.equal(f.messages.at(-1).status, 'idle');
  const retry = f.request({ op: 'status' });
  assert.equal((await retry).status, 'idle');
  f.bridge.dispose();
});
