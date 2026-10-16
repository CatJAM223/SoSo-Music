import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSqliteRuntime } from '../src/desktop/main/db/sqliteRuntime.ts';
import { initializeLibrarySchema } from '../src/desktop/main/db/schema.ts';
import { DatabaseManager } from '../src/desktop/main/db/index.ts';
import { LibraryTasteService } from '../src/desktop/main/services/libraryTaste.ts';
import { LibraryTasteStore } from '../src/desktop/main/services/libraryTasteStore.ts';
import { libraryTasteKey } from '../src/shared/utils/libraryTaste.ts';

const SQL = await loadSqliteRuntime(process.cwd());
const song = (id) => ({ deezer_id: id, title: 'Song ' + id, artist: 'Artist ' + id });
const turn = () => new Promise((resolve) => setTimeout(resolve, 1));
async function settled(service) {
  for (let i = 0; i < 1000 && service.report().running; i++) await turn();
  assert.equal(service.report().running, false);
  return service.report();
}
function fixture(t, tags = async () => ['rock']) {
  const manager = new DatabaseManager(':memory:');
  manager.db = new SQL.Database();
  initializeLibrarySchema(manager.db);
  const service = new LibraryTasteService(
    () => manager.getDb(),
    () => manager.save(),
    tags,
    0,
    () => true,
    () => manager.getChangeRevision(),
  );
  const store = new LibraryTasteStore(
    () => manager.getDb(),
    () => manager.save(),
    () => manager.getChangeRevision(),
  );
  t.after(() => {
    service.dispose();
    manager.db?.close();
  });
  return {
    manager,
    service,
    store,
    put: (track, genres) => store.put(libraryTasteKey(track), genres),
  };
}
function countReads(db) {
  const queries = [];
  const prepare = db.prepare.bind(db),
    exec = db.exec.bind(db);
  db.prepare = (...args) => {
    queries.push(args[0]);
    return prepare(...args);
  };
  db.exec = (...args) => {
    queries.push(args[0]);
    return exec(...args);
  };
  return queries;
}

test('Unchanged 2,000-track taste reports, Wave enrichment and automatic checks reuse one snapshot', (t) => {
  let providers = 0;
  const f = fixture(t, async () => {
    providers++;
    return ['rock'];
  });
  f.manager.db.run('BEGIN');
  for (let i = 0; i < 2000; i++) {
    const track = song(String(i));
    f.manager.db.run('INSERT INTO liked_tracks(deezer_id,title,artist) VALUES(?,?,?)', [
      track.deezer_id,
      track.title,
      track.artist,
    ]);
    f.manager.db.run('INSERT INTO library_genre_tags(cache_key,genres,updated_at) VALUES(?,?,?)', [
      libraryTasteKey(track),
      '["rock"]',
      Date.now(),
    ]);
  }
  f.manager.db.run('COMMIT');
  f.manager.save();
  f.store.setAutoAnalyze(true);
  assert.equal(f.service.report().matchedTracks, 2000);
  f.service.libraryChanged();
  const queries = countReads(f.manager.db),
    started = performance.now();
  for (let i = 0; i < 100; i++) {
    assert.equal(f.service.report().matchedTracks, 2000);
    f.service.libraryChanged();
    assert.deepEqual(
      f.service.enrichCached([
        { id: 'candidate', title: 'Song 0', artist: { name: 'Artist 0' } },
      ])[0].tags,
      ['rock'],
    );
  }
  assert.equal(queries.length, 0, 'warm reads must not repeat any SQLite query');
  assert.equal(providers, 0);
  t.diagnostic(
    JSON.stringify({
      tracks: 2000,
      repeatedChecks: 100,
      sqlQueries: queries.length,
      elapsedMs: Number((performance.now() - started).toFixed(2)),
      providerCalls: providers,
    }),
  );
  const report = f.service.report();
  report.genres[0].share = 0;
  report.genres.length = 0;
  assert.equal(
    f.service.report().genres[0].share,
    1,
    'callers cannot mutate cached genre summaries',
  );
});

test('Real likes, playlist membership, dislikes and removals invalidate taste immediately', (t) => {
  const f = fixture(t),
    track = song('a');
  assert.equal(f.service.report().totalTracks, 0);
  f.manager.toggleLikeTrack(track);
  assert.equal(f.service.report().totalTracks, 1);
  f.put(track, ['rock']);
  assert.equal(f.service.report().genres[0].name, 'rock');
  f.manager.toggleLikeTrack(track);
  assert.equal(f.service.report().totalTracks, 0);
  const playlist = f.manager.createPlaylist('Fixture');
  f.manager.addTrackToPlaylist(playlist.id, track);
  assert.equal(f.service.report().totalTracks, 1);
  f.manager.dislikeTrack({ id: track.deezer_id, title: track.title, artist: track.artist });
  assert.equal(f.service.report().totalTracks, 0);
  f.manager.undislikeTrack(track.deezer_id);
  assert.equal(f.service.report().totalTracks, 1);
  f.put(track, ['jazz']);
  assert.deepEqual(
    f.service.enrichCached([{ id: 'x', title: track.title, artist: { name: track.artist } }])[0]
      .tags,
    ['jazz'],
  );
  f.manager.removeTrackFromPlaylist(playlist.id, track.deezer_id);
  assert.equal(f.service.report().totalTracks, 0);
});

test('Import, direct saved edits and SQLite exports never leave an old cached taste', async (t) => {
  const f = fixture(t);
  f.service.report();
  const imported = f.manager.importData({ version: 1, data: { liked_tracks: [song('imported')] } });
  assert.equal(imported.success, true);
  assert.equal(f.service.report().totalTracks, 1);
  f.put(song('imported'), ['rock']);
  assert.equal(f.service.report().matchedTracks, 1);
  f.manager.db.export();
  assert.equal(f.service.report().matchedTracks, 1);
  f.manager.db.run('DELETE FROM liked_tracks');
  f.manager.saveSync();
  assert.equal(f.service.report().totalTracks, 0);
  f.manager.db.run('INSERT INTO liked_tracks(deezer_id,title,artist) VALUES(?,?,?)', [
    'direct',
    'Direct',
    'Direct artist',
  ]);
  await f.manager.saveAsync();
  assert.equal(f.service.report().totalTracks, 1);
});

test('Replacing or disconnecting the database invalidates snapshots even at the same revision', (t) => {
  const f = fixture(t);
  f.manager.toggleLikeTrack(song('a'));
  assert.equal(f.service.report().totalTracks, 1);
  const old = f.manager.db,
    revision = f.manager.getChangeRevision();
  const replacement = new SQL.Database(old.export());
  replacement.run('DELETE FROM liked_tracks');
  f.manager.db = replacement;
  assert.equal(f.manager.getChangeRevision(), revision);
  assert.equal(f.service.report().totalTracks, 0);
  f.manager.db = null;
  assert.equal(f.service.report().totalTracks, 0);
  f.manager.db = old;
  assert.equal(f.service.report().totalTracks, 1);
  replacement.close();
});

test('Cached summaries still report live progress, failed lookups, cancellation and successful retries', async (t) => {
  let fail = true;
  const f = fixture(t, async () => {
    if (fail) throw Error('Fixture offline');
    return ['jazz'];
  });
  f.manager.toggleLikeTrack(song('a'));
  f.service.report();
  f.service.analyze();
  assert.equal(f.service.report().running, true);
  let report = await settled(f.service);
  assert.equal(report.failedTracks, 1);
  assert.ok(report.error);
  assert.equal(report.matchedTracks, 0);
  fail = false;
  f.service.analyze();
  assert.equal(f.service.report().failedTracks, 0);
  report = await settled(f.service);
  assert.equal(report.matchedTracks, 1);
  assert.equal(report.error, undefined);
  let release;
  const cancelled = fixture(
    t,
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  cancelled.manager.toggleLikeTrack(song('cancel'));
  cancelled.service.analyze();
  cancelled.service.cancel();
  release(['metal']);
  await turn();
  assert.equal(cancelled.service.report().running, false);
  assert.equal(cancelled.service.report().matchedTracks, 0);
});

test('Automatic checks reuse known data but manual analysis still refreshes expired genre tags', async (t) => {
  let now = Date.now(),
    genre = 'rock',
    calls = 0;
  t.mock.method(Date, 'now', () => now);
  const f = fixture(t, async () => {
    calls++;
    return [genre];
  });
  f.manager.toggleLikeTrack(song('a'));
  f.store.setAutoAnalyze(true);
  f.service.analyze();
  await settled(f.service);
  f.service.libraryChanged();
  now += 31 * 24 * 60 * 60 * 1000;
  genre = 'jazz';
  f.service.libraryChanged();
  assert.equal(calls, 1);
  f.service.analyze();
  const report = await settled(f.service);
  assert.equal(calls, 2);
  assert.equal(report.genres[0].name, 'jazz');
});

test('Cancelled automatic work stays paused, while newly added tracks invalidate the checked snapshot', async (t) => {
  let release;
  const calls = [];
  const f = fixture(t, async (_artist, title) => {
    calls.push(title);
    return title === 'Song a'
      ? new Promise((resolve) => {
          release = resolve;
        })
      : ['jazz'];
  });
  f.manager.toggleLikeTrack(song('a'));
  f.service.setAutoAnalyze(true);
  f.service.cancel();
  release(['rock']);
  await turn();
  f.service.libraryChanged();
  f.service.libraryChanged();
  assert.deepEqual(calls, ['Song a']);
  f.manager.toggleLikeTrack(song('b'));
  f.service.libraryChanged();
  const report = await settled(f.service);
  assert.deepEqual(calls, ['Song a', 'Song b']);
  assert.equal(report.matchedTracks, 1);
});

test('A failing save still invalidates tag snapshots; callers without revision tracking keep live reads', (t) => {
  const f = fixture(t);
  f.manager.toggleLikeTrack(song('a'));
  const store = new LibraryTasteStore(
    () => f.manager.db,
    () => {
      throw Error('Fixture disk full');
    },
    () => 0,
  );
  assert.equal(store.snapshot().entries.size, 0);
  assert.throws(() => store.put(libraryTasteKey(song('a')), ['rock']), /disk full/);
  assert.equal(store.snapshot().entries.size, 1);
  const live = new LibraryTasteService(
    () => f.manager.db,
    () => {},
  );
  assert.equal(live.report().totalTracks, 1);
  f.manager.db.run('DELETE FROM liked_tracks');
  assert.equal(live.report().totalTracks, 0);
  live.dispose();
});

test('An opted-out automatic analysis checks only its preference and never scans the full library', (t) => {
  const f = fixture(t),
    queries = countReads(f.manager.db);
  for (let i = 0; i < 3; i++) f.service.libraryChanged();
  assert.ok(queries.length > 0);
  assert.ok(queries.every((sql) => sql.includes('library_taste_preferences')));
});
