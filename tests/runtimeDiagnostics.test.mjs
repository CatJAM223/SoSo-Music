import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  recoverMainRenderer,
  startRuntimeDiagnostics,
} from '../src/desktop/main/services/runtimeDiagnostics.ts';
import { PlaybackLogger } from '../src/desktop/main/services/playbackLogger.ts';

function quiet(t) {
  const records = [];
  for (const level of ['info', 'warn', 'error'])
    t.mock.method(PlaybackLogger, level, (message, meta) => records.push({ level, message, meta }));
  t.mock.method(PlaybackLogger, 'flush', () => {});
  return records;
}
function windowFixture(t) {
  quiet(t);
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  const window = new EventEmitter();
  const contents = new EventEmitter();
  let destroyed = false;
  let quitting = false;
  let reloads = 0;
  window.webContents = contents;
  window.isDestroyed = contents.isDestroyed = () => destroyed;
  contents.reload = () => reloads++;
  recoverMainRenderer(window, () => quitting);
  return {
    window,
    crash: (reason = 'crashed') =>
      contents.emit('render-process-gone', {}, { reason, exitCode: 1 }),
    reloads: () => reloads,
    quit: () => {
      quitting = true;
    },
    close: () => {
      destroyed = true;
      window.emit('closed');
    },
  };
}

test('renderer recovery is delayed, deduplicated and limited to two attempts per five minutes', (t) => {
  const f = windowFixture(t);
  f.crash();
  f.crash();
  assert.equal(f.reloads(), 0);
  t.mock.timers.tick(500);
  assert.equal(f.reloads(), 1);
  f.crash('oom');
  t.mock.timers.tick(500);
  assert.equal(f.reloads(), 2);
  f.crash();
  t.mock.timers.tick(500);
  assert.equal(f.reloads(), 2, 'Do not loop indefinitely on a persistently crashing page');
  t.mock.timers.tick(5 * 60000);
  f.crash();
  t.mock.timers.tick(500);
  assert.equal(f.reloads(), 3, 'A later isolated failure may recover again');
});

test('memory samples identify window roles and private bytes without recording provider URLs', (t) => {
  const records = quiet(t);
  const directory = mkdtempSync(path.join(os.tmpdir(), 'soso-runtime-memory-'));
  const app = new EventEmitter();
  Object.assign(app, {
    getPath: () => directory,
    getVersion: () => 'test',
    isReady: () => false,
    getAppMetrics: () => [
      { pid: 101, type: 'Tab', memory: { workingSetSize: 123, privateBytes: 75 } },
      { pid: 102, type: 'Tab', memory: { workingSetSize: 234, privateBytes: 150 } },
    ],
  });
  const events = ['uncaughtException', 'unhandledRejection', 'exit'];
  const previous = new Map(events.map((event) => [event, new Set(process.listeners(event))]));
  t.after(() => {
    app.emit('will-quit');
    for (const event of events)
      for (const listener of process.listeners(event))
        if (!previous.get(event).has(listener)) process.removeListener(event, listener);
    rmSync(directory, { recursive: true, force: true });
  });
  const window = (pid, url) => ({
    isDestroyed: () => false,
    webContents: {
      isDestroyed: () => false,
      getOSProcessId: () => pid,
      getURL: () => url,
    },
  });
  startRuntimeDiagnostics(app, { start() {} }, () => [
    window(101, 'file:///player/index.html#/overlay'),
    window(102, 'https://accounts.google.com/private?token=secret'),
  ]);
  app.emit('ready');
  const sample = records.find((entry) => entry.message === '[Runtime] Process memory');
  assert.equal(sample.meta.processes[0].window, 'overlay');
  assert.equal(sample.meta.processes[0].privateBytesKB, 75);
  assert.equal(sample.meta.processes[1].window, 'auxiliary');
  assert.ok(!JSON.stringify(sample).includes('secret'));
  assert.ok(!JSON.stringify(sample).includes('accounts.google.com'));
});

test('normal renderer exits and intentional kills do not reload', (t) => {
  const f = windowFixture(t);
  for (const reason of ['clean-exit', 'killed', 'launch-failed', 'integrity-failure'])
    f.crash(reason);
  t.mock.timers.tick(1000);
  assert.equal(f.reloads(), 0);
});

for (const action of ['quit', 'close']) {
  test('pending renderer recovery is canceled on ' + action, (t) => {
    const f = windowFixture(t);
    f.crash();
    f[action]();
    t.mock.timers.tick(500);
    f.crash();
    t.mock.timers.tick(500);
    assert.equal(f.reloads(), 0);
  });
}

test('runtime records unclean previous sessions, local reports, process errors and completed quits', (t) => {
  const records = quiet(t);
  const directory = mkdtempSync(path.join(os.tmpdir(), 'soso-runtime-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const sessionFile = path.join(directory, 'logs/runtime-session.json');
  mkdirSync(path.dirname(sessionFile));
  writeFileSync(
    sessionFile,
    JSON.stringify({ cleanExit: false, version: 'old', startedAt: 'previous' }),
  );
  const app = new EventEmitter();
  app.getPath = () => directory;
  app.getVersion = () => 'test';
  app.isReady = () => false;
  const events = ['uncaughtException', 'unhandledRejection', 'exit'];
  const previous = Object.fromEntries(
    events.map((event) => [event, new Set(process.listeners(event))]),
  );
  t.after(() => {
    app.emit('will-quit');
    for (const event of events)
      for (const handler of process.listeners(event))
        if (!previous[event].has(handler)) process.removeListener(event, handler);
  });
  let options;
  startRuntimeDiagnostics(app, {
    start(value) {
      options = value;
    },
  });
  assert.equal(options.uploadToServer, false);
  assert.equal(JSON.parse(readFileSync(sessionFile)).cleanExit, false);
  assert.ok(
    records.some(
      (record) => record.message.includes('Previous session') && record.meta.version === 'old',
    ),
  );
  app.emit('before-quit', { preventDefault() {} });
  assert.equal(
    JSON.parse(readFileSync(sessionFile)).cleanExit,
    false,
    'A canceled quit is still an active session',
  );
  for (const event of ['uncaughtException', 'unhandledRejection']) {
    const handler = process.listeners(event).find((handler) => !previous[event].has(handler));
    const error = Error(event);
    handler(error);
    assert.ok(records.some((record) => record.level === 'error' && record.meta === error));
  }
  app.emit('child-process-gone', {}, { type: 'Utility', reason: 'crashed', exitCode: 7 });
  assert.ok(records.some((record) => record.level === 'error' && record.meta?.exitCode === 7));
  app.emit('will-quit');
  assert.equal(JSON.parse(readFileSync(sessionFile)).cleanExit, true);
});
