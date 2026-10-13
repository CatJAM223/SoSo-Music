import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DatabaseManager } from '../src/desktop/main/db/index.ts';

const track = {
  id: 'yt_checkpoint',
  title: 'Checkpoint',
  artist: { name: 'Artist' },
  album: { title: '' },
  duration: 120,
  source: 'youtube',
  preview: '',
};

test('Duplicate and older desktop checkpoints perform no SQLite writes or full database exports', async (t) => {
  const db = new DatabaseManager(':memory:');
  await db.init();
  t.after(() => db.db?.close());
  const checkpoint = { sessionId: 'one', track, playedSeconds: 10, completed: true };
  db.recordPlaybackSession(checkpoint);
  const changes = () => Number(db.db.exec('SELECT total_changes()')[0].values[0][0]);
  const before = changes();
  let exports = 0;
  db.save = () => {
    exports++;
  };
  for (let i = 0; i < 100; i++)
    db.recordPlaybackSession(
      i % 2 ? checkpoint : { ...checkpoint, playedSeconds: 5, completed: false },
    );
  assert.equal(changes(), before);
  assert.equal(exports, 0);
  db.recordPlaybackSession({ ...checkpoint, playedSeconds: 15, skipped: true });
  assert.equal(exports, 1);
  const stats = db.getStatsSummary();
  assert.equal(stats.measuredSeconds, 15);
  assert.equal(stats.totalPlays, 1);
  assert.equal(stats.totalCompletions, 1);
  assert.equal(db.db.exec('SELECT skip_count FROM track_scrobbles')[0].values[0][0], 1);
});

test('A delayed old async snapshot cannot overwrite the latest synchronous quit checkpoint', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soso-db-generation-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const db = new DatabaseManager(':memory:');
  await db.init();
  t.after(() => db.db?.close());
  db.recordPlaybackSession({ sessionId: 'one', track, playedSeconds: 5 });
  db.dbFilePath = path.join(dir, 'state.sqlite');
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  const write = fs.promises.writeFile;
  t.mock.method(fs.promises, 'writeFile', async (...args) => {
    await write(...args);
    await held;
  });
  const saving = db.saveAsync();
  db.recordPlaybackSession({ sessionId: 'one', track, playedSeconds: 25, completed: true });
  db.saveSync();
  const latest = fs.readFileSync(db.dbFilePath);
  release();
  await saving;
  assert.deepEqual(fs.readFileSync(db.dbFilePath), latest);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['state.sqlite', 'state.sqlite.bak']);
});

test('Failed async snapshots remove their temporary file and leave the prior database intact', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soso-db-save-failure-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const db = new DatabaseManager(':memory:');
  await db.init();
  t.after(() => db.db?.close());
  db.recordPlaybackSession({ sessionId: 'one', track, playedSeconds: 5 });
  db.dbFilePath = path.join(dir, 'state.sqlite');
  db.saveSync();
  const previous = fs.readFileSync(db.dbFilePath),
    write = fs.promises.writeFile;
  t.mock.method(console, 'error', () => {});
  t.mock.method(fs.promises, 'writeFile', async (...args) => {
    await write(...args);
    throw new Error('simulated disk failure');
  });
  await assert.rejects(db.saveAsync(), /Не удалось сохранить/);
  assert.equal(db.getPersistenceStatus().state, 'error');
  assert.deepEqual(fs.readFileSync(db.dbFilePath), previous);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['state.sqlite', 'state.sqlite.bak']);
});
