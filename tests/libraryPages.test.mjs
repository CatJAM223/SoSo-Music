import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  readLibraryPage,
  readLibraryStats,
  readLibraryPlaybackTracks,
  readSavedAlbumIds,
  readArtistMembership,
  validateLibraryRequest,
} from '../src/desktop/main/db/libraryPages.ts';
const repo = process.env.SOSO_TEST_REPO || fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(path.join(repo, 'package.json'));
const init = require('sql.js');
const SQL = await init({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') });
const { initializeLibrarySchema } = await import(
  pathToFileURL(path.join(repo, 'src/desktop/main/db/schema.ts'))
);
const { fixMojibake, decodeHtmlEntities } = await import(
  pathToFileURL(path.join(repo, 'src/shared/utils/formatters.ts'))
);
const canonical = (value) => fixMojibake(decodeHtmlEntities(value));
function fixture() {
  const db = new SQL.Database();
  initializeLibrarySchema(db);
  return db;
}
function track(db, id, title = 'ТЕСТ', artist = 'Артист', album = 'Альбом') {
  db.run(
    'INSERT INTO liked_tracks(deezer_id,title,artist,album,duration,liked_at) VALUES(?,?,?,?,?,?)',
    [id, title, artist, album, 60, '2026-01-01'],
  );
}
test('SQL paging: Cyrillic case-fold, literal wildcards, separate search fields', () => {
  const db = fixture();
  try {
    track(db, 'a', 'ПРИВЕТ 100%_');
    track(db, 'b', 'Other', 'СЛОВО');
    track(db, 'c', 'Other', 'Other', 'АЛЬБОМ');
    track(db, 'd', 'Boundary', 'abc', 'def');
    for (const [query, ids] of [
      ['привет', ['a']],
      ['100%_', ['a']],
      ['слово', ['b']],
      ['альбом', ['a', 'b', 'c']],
      ['%', ['a']],
      ['_', ['a']],
      ["' OR 1=1 --", []],
      ['cde', []],
    ])
      assert.deepEqual(
        readLibraryPage(db, { kind: 'tracks', query }, canonical).items.map((x) => x.deezer_id),
        ids,
      );
  } finally {
    db.close();
  }
});
test('SQL paging: deterministic tied dates and offset continuity, all sorts', () => {
  const db = fixture();
  try {
    for (const [id, title] of [
      ['c', 'Бета'],
      ['a', 'Яблоко'],
      ['b', 'Альфа'],
    ])
      track(db, id, title);
    for (const sort of ['recent', 'oldest', 'title']) {
      const ids = [];
      let offset = 0;
      do {
        const page = readLibraryPage(db, { kind: 'tracks', sort, offset, limit: 1 }, canonical);
        assert.equal(page.total, 3);
        ids.push(...page.items.map((x) => x.deezer_id));
        offset = page.nextOffset;
      } while (offset !== null);
      assert.deepEqual(ids, sort === 'title' ? ['b', 'c', 'a'] : ['a', 'b', 'c']);
      assert.equal(new Set(ids).size, 3);
    }
    assert.deepEqual(readLibraryPage(db, { kind: 'tracks', offset: 999 }, canonical).items, []);
  } finally {
    db.close();
  }
});
test('SQL paging: playlist canonical text, count is per page item, synthetic card excluded', () => {
  const db = fixture();
  try {
    db.run('INSERT INTO playlists(id,name,description) VALUES(?,?,?)', [
      'p1',
      'Rock &amp; Roll',
      'ТЕСТ',
    ]);
    db.run('INSERT INTO playlists(id,name,description) VALUES(?,?,?)', ['p2', 'Other', '']);
    db.run(
      'INSERT INTO playlist_tracks(playlist_id,track_deezer_id,title,artist,position) VALUES(?,?,?,?,?)',
      ['p1', 't', 'T', 'A', 0],
    );
    const page = readLibraryPage(db, { kind: 'playlists', query: '& roll', limit: 1 }, canonical);
    assert.equal(page.total, 1);
    assert.equal(page.items[0].name, 'Rock & Roll');
    assert.equal(page.items[0].track_count, 1);
    assert.equal(readLibraryPage(db, { kind: 'playlists', query: 'тест' }, canonical).total, 1);
    assert.equal(readLibraryStats(db).playlists, 2);
  } finally {
    db.close();
  }
});
test('SQL paging: compact membership preserves artist aliases; hero stats ignore query', () => {
  const db = fixture();
  try {
    track(db, 'a');
    db.run('INSERT INTO saved_albums(album_id,title,artist_name) VALUES(?,?,?)', [
      'sc_album',
      'Album',
      'Artist',
    ]);
    db.run('INSERT INTO followed_artists(id,name) VALUES(?,?)', ['sc_artist', 'ИМЯ']);
    assert.deepEqual(readSavedAlbumIds(db), ['sc_album']);
    assert.deepEqual(readArtistMembership(db), [{ id: 'sc_artist', name: 'ИМЯ' }]);
    const stats = readLibraryStats(db);
    assert.deepEqual(stats, {
      tracks: 1,
      playlists: 0,
      albums: 1,
      artists: 1,
      durationSeconds: 60,
    });
    assert.equal(readLibraryPage(db, { kind: 'tracks', query: 'missing' }, canonical).total, 0);
    assert.equal(readLibraryStats(db).tracks, 1);
  } finally {
    db.close();
  }
});
test('SQL paging: explicit playback reads complete matching order beyond page 0', () => {
  const db = fixture();
  try {
    for (let i = 0; i < 205; i++) track(db, String(i).padStart(3, '0'), i % 2 ? 'Skip' : 'MATCH');
    assert.equal(
      readLibraryPage(db, { kind: 'tracks', query: 'match', limit: 20 }, canonical).items.length,
      20,
    );
    const all = readLibraryPlaybackTracks(db, { query: 'match', sort: 'oldest' }, canonical);
    assert.equal(all.length, 103);
    assert.equal(all.at(-1).deezer_id, '204');
  } finally {
    db.close();
  }
});
test('SQL paging: new database handles receive Unicode functions; malformed IPC rejected', () => {
  for (let n = 0; n < 2; n++) {
    const db = fixture();
    try {
      track(db, 't');
      assert.equal(readLibraryPage(db, { kind: 'tracks', query: 'тест' }, canonical).total, 1);
    } finally {
      db.close();
    }
  }
  for (const request of [
    null,
    [],
    { kind: '__proto__' },
    { kind: 'tracks', sort: 'DROP TABLE liked_tracks' },
    { kind: 'tracks', query: 42 },
    { kind: 'tracks', query: 'x'.repeat(513) },
    { kind: 'tracks', limit: 0 },
    { kind: 'tracks', limit: 201 },
    { kind: 'tracks', offset: -1 },
    { kind: 'tracks', offset: Infinity },
  ])
    assert.throws(() => validateLibraryRequest(request));
  assert.throws(() => readLibraryStats(null), /not initialized/);
});
