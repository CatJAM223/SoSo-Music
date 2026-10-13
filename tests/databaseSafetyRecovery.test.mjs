import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DatabaseManager } from '../src/desktop/main/db/index.ts';
const track = {
  id: 'yt_data_safe',
  title: 'Preserved song',
  artist: { name: 'Artist' },
  album: { title: '' },
  duration: 120,
  source: 'youtube',
  preview: '',
};
function directory(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'soso-data-safety-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  t.mock.method(console, 'error', () => {});
  return { root, file: path.join(root, 'library.sqlite') };
}
async function database(t, file = ':memory:') {
  const db = new DatabaseManager(file);
  db.save = () => {};
  t.after(() => {
    if (db.saveDebounceTimer) clearTimeout(db.saveDebounceTimer);
    db.db?.close();
    db.db = null;
  });
  await db.init();
  return db;
}
async function seeded(t, file) {
  const db = await database(t);
  const storedTrack = { ...track, deezer_id: track.id, artist: track.artist.name, album: '' };
  db.toggleLikeTrack(storedTrack);
  const playlist = db.createPlaylist('Library survives restart');
  db.addTrackToPlaylist(playlist.id, storedTrack);
  db.recordPlaybackSession({ sessionId: 'heard', track, playedSeconds: 31, completed: true });
  db.dbFilePath = file;
  db.saveSync();
  return db;
}
function assertLibrary(db) {
  assert.equal(db.getLikedTracks()[0].title, track.title);
  assert.equal(db.getPlaylists()[0].name, 'Library survives restart');
  assert.equal(db.getPlaylists()[0].track_count, 1);
  assert.equal(db.getStatsSummary().measuredSeconds, 31);
}

test('A valid saved database restarts with likes, playlists and measured listening unchanged', async (t) => {
  const { file } = directory(t);
  await seeded(t, file);
  const reopened = await database(t, file);
  assertLibrary(reopened);
  assert.equal(reopened.getPersistenceStatus().state, 'ready');
});

test('Corrupt primary recovers a validated backup and preserves the exact damaged original', async (t) => {
  const { root, file } = directory(t);
  await seeded(t, file);
  const damaged = Buffer.from('broken disk contents');
  fs.writeFileSync(file, damaged);
  const reopened = await database(t, file);
  assertLibrary(reopened);
  assert.equal(reopened.getPersistenceStatus().state, 'recovered');
  const saved = fs.readdirSync(root).filter((name) => name.includes('.corrupt.'));
  assert.equal(saved.length, 1);
  assert.deepEqual(fs.readFileSync(path.join(root, saved[0])), damaged);
  const secondRestart = await database(t, file);
  assertLibrary(secondRestart);
});

test('A missing primary recovers a valid existing backup rather than silently starting empty', async (t) => {
  const { file } = directory(t);
  await seeded(t, file);
  fs.unlinkSync(file);
  const reopened = await database(t, file);
  assertLibrary(reopened);
  assert.equal(fs.existsSync(file), true);
});

test('Corrupt database without a backup rejects initialization and never overwrites the original', async (t) => {
  const { root, file } = directory(t);
  const original = Buffer.from('do not erase');
  fs.writeFileSync(file, original);
  const db = new DatabaseManager(file);
  const reported = [];
  db.setPersistenceErrorHandler((error) => reported.push(error.message));
  await assert.rejects(db.init(), /Исходные файлы сохранены/);
  assert.equal(db.db, null);
  assert.equal(db.getPersistenceStatus().state, 'error');
  assert.equal(reported.length, 1);
  assert.deepEqual(fs.readFileSync(file), original);
  assert.deepEqual(fs.readdirSync(root), ['library.sqlite']);
});

test('Truncated and header-only database files are not mistaken for a new empty library', async (t) => {
  const { root, file } = directory(t);
  for (const original of [
    Buffer.alloc(0),
    Buffer.from('SQLite format 3\0'),
    Buffer.concat([Buffer.from('SQLite format 3\0'), Buffer.alloc(500)]),
  ]) {
    fs.writeFileSync(file, original);
    const db = new DatabaseManager(file);
    await assert.rejects(db.init());
    assert.equal(db.db, null);
    assert.deepEqual(fs.readFileSync(file), original);
    assert.deepEqual(fs.readdirSync(root), ['library.sqlite']);
  }
});

test('Two damaged snapshots fail safely without rewriting either primary or backup', async (t) => {
  const { file } = directory(t);
  const primary = Buffer.from('primary evidence'),
    backup = Buffer.from('bad backup');
  fs.writeFileSync(file, primary);
  fs.writeFileSync(file + '.bak', backup);
  await assert.rejects(new DatabaseManager(file).init());
  assert.deepEqual(fs.readFileSync(file), primary);
  assert.deepEqual(fs.readFileSync(file + '.bak'), backup);
});

test('Failure to preserve the damaged original prevents recovery from replacing it', async (t) => {
  const { file } = directory(t);
  await seeded(t, file);
  const damaged = Buffer.from('preserve');
  fs.writeFileSync(file, damaged);
  t.mock.method(fs, 'copyFileSync', () => {
    throw new Error('simulated full disk');
  });
  await assert.rejects(new DatabaseManager(file).init());
  assert.deepEqual(fs.readFileSync(file), damaged);
});

test('Schema migration failure leaves the existing compatible snapshot intact', async (t) => {
  const { file } = directory(t);
  await seeded(t, file);
  const original = fs.readFileSync(file);
  const db = new DatabaseManager(file);
  db.initSchema = () => {
    throw new Error('migration failed');
  };
  await assert.rejects(db.init());
  assert.equal(db.db, null);
  assert.deepEqual(fs.readFileSync(file), original);
});

test('Backup write failure cannot replace the prior primary snapshot or report a successful save', async (t) => {
  const { root, file } = directory(t);
  const db = await seeded(t, file);
  const original = fs.readFileSync(file),
    backup = fs.readFileSync(file + '.bak');
  db.recordPlaybackSession({ sessionId: 'heard', track, playedSeconds: 50 });
  db.lastBackupAt = 0;
  const write = fs.promises.writeFile;
  t.mock.method(fs.promises, 'writeFile', async (...args) => {
    if (String(args[0]).endsWith('.backup')) throw new Error('full disk');
    return write(...args);
  });
  const reported = [];
  db.setPersistenceErrorHandler((error) => reported.push(error.message));
  await assert.rejects(db.saveAsync(), /Не удалось сохранить/);
  assert.equal(reported.length, 1);
  assert.deepEqual(fs.readFileSync(file), original);
  assert.deepEqual(fs.readFileSync(file + '.bak'), backup);
  assert.deepEqual(fs.readdirSync(root).sort(), ['library.sqlite', 'library.sqlite.bak']);
});

test('File flush failure preserves both prior snapshots and allows a later successful retry', async (t) => {
  const { file } = directory(t);
  const db = await seeded(t, file);
  const original = fs.readFileSync(file);
  const open = fs.promises.open;
  let fail = true;
  const states = [];
  db.setPersistenceStatusHandler((status) => states.push(status));
  t.mock.method(fs.promises, 'open', async (...args) => {
    const handle = await open(...args);
    return {
      sync: async () => {
        if (fail) throw new Error('flush failed');
        await handle.sync();
      },
      close: () => handle.close(),
    };
  });
  db.recordPlaybackSession({ sessionId: 'heard', track, playedSeconds: 55 });
  await assert.rejects(db.saveAsync());
  assert.deepEqual(fs.readFileSync(file), original);
  fail = false;
  await db.saveAsync();
  assert.equal(db.getPersistenceStatus().state, 'ready');
  assert.deepEqual(
    states.map((status) => status.state),
    ['error', 'ready'],
  );
  await db.saveAsync();
  assert.equal(states.length, 2, 'Successful checkpoints must not spam status events');
  const reopened = await database(t, file);
  assert.equal(reopened.getStatsSummary().measuredSeconds, 55);
});

test('Synchronous save flushes bytes before atomic replacement and reports rename failures', async (t) => {
  const { file } = directory(t);
  const db = await seeded(t, file);
  const original = fs.readFileSync(file);
  let flushed = false;
  const sync = fs.fsyncSync,
    rename = fs.renameSync;
  t.mock.method(fs, 'fsyncSync', (...args) => {
    flushed = true;
    return sync(...args);
  });
  t.mock.method(fs, 'renameSync', (...args) => {
    assert.equal(flushed, true);
    throw new Error('sharing violation');
  });
  db.recordPlaybackSession({ sessionId: 'heard', track, playedSeconds: 61 });
  assert.throws(() => db.saveSync(), /перед выходом/);
  assert.deepEqual(fs.readFileSync(file), original);
  fs.renameSync = rename;
});

test('First database creation reports disk failure instead of continuing with an unsaved empty database', async (t) => {
  const { root, file } = directory(t);
  t.mock.method(fs.promises, 'writeFile', async () => {
    throw new Error('write denied');
  });
  const db = new DatabaseManager(file);
  await assert.rejects(db.init(), /Не удалось сохранить/);
  assert.equal(db.db, null);
  assert.deepEqual(fs.readdirSync(root), []);
});

test('A second initialization failure still reports a readable error rather than a stale failure state', async (t) => {
  const { file } = directory(t);
  fs.writeFileSync(file, Buffer.from('damaged'));
  const db = new DatabaseManager(file);
  const reports = [];
  db.setPersistenceErrorHandler((error) => reports.push(error));
  await assert.rejects(db.init(), /Исходные файлы сохранены/);
  await assert.rejects(db.init(), /Исходные файлы сохранены/);
  assert.equal(reports.length, 2);
  assert.equal(db.db, null);
  assert.equal(fs.readFileSync(file, 'utf8'), 'damaged');
});
