import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseManager } from '../src/desktop/main/db/index.ts';
import { LanSyncServer } from '../src/desktop/main/services/lanSyncServer.ts';

test('Playlist cover survives SQLite export and import', async () => {
  const source = new DatabaseManager(':memory:');
  await source.init();
  const playlist = source.createPlaylist('Road Trip');
  const cover = 'data:image/jpeg;base64,ZmFrZQ==';
  assert.equal(source.setPlaylistCover(playlist.id, cover), true);
  const backup = source.exportData();
  assert.equal(backup.payload.data.playlists[0].cover_url, cover);
  const target = new DatabaseManager(':memory:');
  await target.init();
  assert.equal(target.importData(backup.payload).success, true);
  assert.equal(target.getPlaylists()[0].cover_url, cover);
});

test('LAN sync requires code and transfers a library in both directions', async (t) => {
  const db = new DatabaseManager(':memory:');
  await db.init();
  db.createPlaylist('Desktop');
  let imports = 0;
  const server = new LanSyncServer(
    db,
    () => {
      imports++;
    },
    async () => true,
  );
  t.after(() => server.stop());
  const session = await server.start();
  const url = `http://127.0.0.1:${session.port}/library`;
  assert.equal((await fetch(url)).status, 401);
  const headers = { Authorization: `Bearer ${session.code}` };
  const backup = await (await fetch(url, { headers })).json();
  assert.equal(backup.data.playlists[0].name, 'Desktop');
  backup.data.playlists.push({ id: 'mobile-test', name: 'Mobile' });
  const response = await fetch(url, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(backup),
  });
  assert.equal(response.status, 200);
  assert.equal(imports, 1);
  assert.deepEqual(
    db
      .getPlaylists()
      .map((item) => item.name)
      .sort(),
    ['Desktop', 'Mobile'],
  );
  assert.equal(server.stop().active, false);
});

test('LAN push cannot write before approval and a second push cannot bypass the prompt', async (t) => {
  const db = new DatabaseManager(':memory:');
  await db.init();
  let approve;
  let announce;
  const prompted = new Promise((resolve) => {
    announce = resolve;
  });
  const server = new LanSyncServer(db, undefined, (summary) => {
    announce(summary);
    return new Promise((resolve) => {
      approve = resolve;
    });
  });
  t.after(() => server.stop());
  const session = await server.start();
  const url = `http://127.0.0.1:${session.port}/library`;
  const options = {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.code}` },
    body: JSON.stringify({
      app: 'SoSo Music',
      data: { playlists: [{ id: 'phone', name: 'Phone' }] },
    }),
  };
  const pending = fetch(url, options);
  assert.equal((await prompted).playlists, 1);
  assert.deepEqual(db.getPlaylists(), []);
  assert.equal((await fetch(url, options)).status, 409);
  approve(true);
  assert.equal((await pending).status, 200);
  assert.equal(db.getPlaylists()[0].name, 'Phone');
});

test('LAN rejection and missing consent callback leave the database unchanged', async (t) => {
  for (const consent of [undefined, async () => false]) {
    const db = new DatabaseManager(':memory:');
    await db.init();
    const server = new LanSyncServer(db, undefined, consent);
    t.after(() => server.stop());
    const session = await server.start();
    const response = await fetch(`http://127.0.0.1:${session.port}/library`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.code}` },
      body: JSON.stringify({
        app: 'SoSo Music',
        data: { playlists: [{ id: 'phone', name: 'Phone' }] },
      }),
    });
    assert.equal(response.status, 403);
    assert.deepEqual(db.getPlaylists(), []);
    server.stop();
  }
});

test('Closing LAN session cancels pending approval, including a late acceptance', async (t) => {
  const db = new DatabaseManager(':memory:');
  await db.init();
  let approve;
  let announce;
  let signal;
  const prompted = new Promise((resolve) => {
    announce = resolve;
  });
  const server = new LanSyncServer(db, undefined, (_summary, abortSignal) => {
    signal = abortSignal;
    announce();
    return new Promise((resolve) => {
      approve = resolve;
    });
  });
  t.after(() => server.stop());
  const session = await server.start();
  const pending = fetch(`http://127.0.0.1:${session.port}/library`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.code}` },
    body: JSON.stringify({
      app: 'SoSo Music',
      data: { playlists: [{ id: 'phone', name: 'Phone' }] },
    }),
  });
  await prompted;
  server.stop();
  assert.equal(signal.aborted, true);
  approve(true);
  assert.equal((await pending).status, 403);
  assert.deepEqual(db.getPlaylists(), []);
});
