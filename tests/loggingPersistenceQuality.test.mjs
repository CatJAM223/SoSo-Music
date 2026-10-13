import { stripModuleImports } from './helpers/sourceInspection.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import {
  preparePlaybackLog,
  sanitizePlaybackText,
} from '../src/shared/utils/playbackLogSanitizer.ts';
import { PlaybackLogger as MainLogger } from '../src/desktop/main/services/playbackLogger.ts';
import { PlaybackLogger as RendererLogger } from '../src/shared/services/playbackLogger.ts';

function quiet(t) {
  for (const method of ['log', 'warn', 'error']) t.mock.method(console, method, () => {});
}
function mainFixture(t) {
  quiet(t);
  MainLogger.flush();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soso-log-audit-'));
  const previous = {
    logFilePath: MainLogger.logFilePath,
    workspaceLogPath: MainLogger.workspaceLogPath,
  };
  MainLogger.logFilePath = path.join(dir, 'playback.log');
  MainLogger.workspaceLogPath = null;
  t.after(() => {
    MainLogger.flush();
    Object.assign(MainLogger, previous);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return MainLogger.logFilePath;
}

test('Playback logs redact credentials in messages, nested metadata and signed URLs before IPC', (t) => {
  quiet(t);
  const previous = globalThis.window;
  const forwarded = [];
  globalThis.window = { electronAPI: { logPlaybackEvent: (...args) => forwarded.push(args) } };
  t.after(() => {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  });
  RendererLogger.warn(
    'failure https://user:pass@rr1.googlevideo.com/videoplayback?token=url-secret&itag=140',
    {
      cookie: 'SID=cookie-secret',
      nested: { access_token: 'access-secret', Authorization: 'Bearer auth-secret' },
      error: new Error('HTTP403 https://cdn.test/audio?sig=error-secret'),
      code: 403,
      trackId: 'yt_recording',
    },
  );
  const emitted = JSON.stringify(forwarded),
    recent = RendererLogger.getRecentLogs().at(-1);
  for (const secret of [
    'url-secret',
    'cookie-secret',
    'access-secret',
    'auth-secret',
    'error-secret',
    'user:pass',
  ]) {
    assert.ok(!emitted.includes(secret), secret);
    assert.ok(!recent.includes(secret), secret);
  }
  assert.match(emitted, /itag=140/);
  assert.match(recent, /HTTP403/);
  assert.match(recent, /yt_recording/);
});

test('Playback metadata is bounded, handles circular errors and cannot forge extra log lines', () => {
  const cycle = { code: 403, message: 'Denied' };
  cycle.self = cycle;
  const safe = preparePlaybackLog('warn', 'first\n[ERROR] forged', cycle);
  assert.equal(safe.level, 'WARN');
  assert.ok(!safe.message.includes('\n'));
  assert.match(safe.suffix, /circular/);
  const huge = preparePlaybackLog('invalid', 'x'.repeat(9000), Array(1000).fill('x'.repeat(9000)));
  assert.equal(huge.level, 'INFO');
  assert.ok(huge.message.length <= 2000);
  assert.ok(huge.suffix.length <= 6003);
  assert.equal(sanitizePlaybackText('Authorization: Bearer secret'), '[redacted-credentials]');
  assert.ok(!sanitizePlaybackText('{"access_token":"raw-secret"}').includes('raw-secret'));
  assert.ok(!sanitizePlaybackText('{"cookie":"raw-cookie"}').includes('raw-cookie'));
});

test('Main logging batches 100 provider events into one append and flushes errors immediately', (t) => {
  const logPath = mainFixture(t);
  let writes = 0;
  const append = fs.appendFileSync;
  t.mock.method(fs, 'appendFileSync', (...args) => {
    writes++;
    return append(...args);
  });
  for (let i = 0; i < 100; i++) MainLogger.info('[Wave:Candidate] candidate=' + i);
  assert.equal(writes, 0);
  MainLogger.flush();
  assert.equal(writes, 1);
  assert.equal(fs.readFileSync(logPath, 'utf8').trim().split('\n').length, 100);
  MainLogger.error('[Wave:Failure] failed');
  assert.equal(writes, 2);
  assert.match(fs.readFileSync(logPath, 'utf8'), /Wave:Failure/);
});

test('Main log batches have a byte cap and retain the newest bounded recent history', (t) => {
  const logPath = mainFixture(t);
  for (let i = 0; i < 500; i++) MainLogger.debug('[Wave:Candidate] ' + i + ' ' + 'x'.repeat(1990));
  assert.ok(MainLogger.pendingBytes < 64 * 1024);
  assert.equal(MainLogger.getRecentLogs(500).length, 150);
  assert.deepEqual(MainLogger.getRecentLogs(0), []);
  assert.deepEqual(MainLogger.getRecentLogs(-1), []);
  assert.equal(MainLogger.getRecentLogs(NaN).length, 50);
  MainLogger.flush();
  assert.ok(fs.statSync(logPath).size < 1100000);
});

test('Main logger sanitizes direct provider logs as well as renderer logs', (t) => {
  const logPath = mainFixture(t);
  MainLogger.warn('network https://cdn.test/stream?signature=hidden-secret', {
    refresh_token: 'hidden-token',
    code: 403,
  });
  const opened = MainLogger.getLogFilePath();
  assert.equal(opened, logPath);
  const log = fs.readFileSync(logPath, 'utf8');
  assert.ok(!log.includes('hidden-secret'));
  assert.ok(!log.includes('hidden-token'));
  assert.match(log, /403/);
});

test('Packaged logger writes only to user data and flushes remaining events on will-quit', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soso-logger-packaged-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const userData = path.join(dir, 'user-data');
  let onQuit;
  const app = {
    isPackaged: true,
    getPath: () => userData,
    once: (name, callback) => {
      assert.equal(name, 'will-quit');
      onQuit = callback;
    },
  };
  let source = fs.readFileSync(
    new URL('../src/desktop/main/services/playbackLogger.ts', import.meta.url),
    'utf8',
  );
  source = stripTypeScriptTypes(
    stripModuleImports(source).replace('export class PlaybackLogger', 'class PlaybackLogger'),
  );
  const context = {
    fs,
    path,
    preparePlaybackLog,
    getElectronApp: () => app,
    require: () => ({ app }),
    process: { versions: { electron: '33' }, cwd: () => dir },
    console: { log() {}, warn() {}, error() {} },
    Buffer,
    setTimeout,
    clearTimeout,
  };
  const logger = vm.runInNewContext(source + '\nPlaybackLogger;', context);
  logger.info('[Wave:Start] packaged');
  assert.equal(fs.existsSync(path.join(dir, 'logs')), false);
  onQuit();
  assert.match(fs.readFileSync(path.join(userData, 'logs', 'playback.log'), 'utf8'), /packaged/);
});
