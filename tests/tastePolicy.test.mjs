import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSqliteRuntime } from '../src/desktop/main/db/sqliteRuntime.ts';
import { DatabaseManager } from '../src/desktop/main/db/index.ts';
import { initializeLibrarySchema } from '../src/desktop/main/db/schema.ts';
import { LibraryTasteStore } from '../src/desktop/main/services/libraryTasteStore.ts';
import { tasteHistoryScoreSql } from '../src/desktop/main/services/tastePolicyStore.ts';
import {
  isTasteEligible,
  tasteTrackId,
  withPlaybackOrigin,
  filterTasteContext,
} from '../src/shared/utils/tastePolicy.ts';
import { createWavePreferences } from '../src/shared/services/wavePreferences.ts';
import {
  createDailyRecommendationLoader,
  DAILY_RECOMMENDATIONS_KEY,
} from '../src/shared/utils/dailyRecommendations.ts';
import { selectPlayerQueue } from '../src/shared/utils/playerQueueSelection.ts';
import {
  readPlaybackSession,
  PLAYBACK_SESSION_KEY,
} from '../src/shared/services/playbackSession.ts';
import { normalizeWaveBatchContext } from '../src/shared/utils/waveRecommendations.ts';
const SQL = await loadSqliteRuntime(process.cwd());
const song = (id, artist = 'Artist ' + id) => ({
  id,
  title: 'Song ' + id,
  artist: { name: artist },
  album: { title: '' },
  duration: 180,
  preview: '',
  source: 'youtube',
});
const storage = () => {
  const map = new Map();
  return { getItem: (key) => map.get(key) || null, setItem: (key, value) => map.set(key, value) };
};
function fixture(t) {
  const manager = new DatabaseManager(':memory:');
  manager.db = new SQL.Database();
  initializeLibrarySchema(manager.db);
  t.after(() => manager.db.close());
  return manager;
}
function liked(db, id, title = 'Song ' + id, artist = 'Artist ' + id) {
  db.run('INSERT INTO liked_tracks(deezer_id,title,artist) VALUES(?,?,?)', [id, title, artist]);
}
function playlist(db, id) {
  db.run('INSERT INTO playlists(id,name) VALUES(?,?)', [id, 'Playlist ' + id]);
}
function member(db, pl, id, artist = 'Artist ' + id, position = 1) {
  db.run(
    'INSERT INTO playlist_tracks(playlist_id,track_deezer_id,title,artist,position) VALUES(?,?,?,?,?)',
    [pl, id, 'Song ' + id, artist, position],
  );
}
function change(manager, scope, id, excluded = true) {
  return manager.setTasteExcluded({ scope, id, excluded, label: id });
}
test('neutral rule is reversible, alias-aware, idempotent and independent of library/dislike rows', (t) => {
  const m = fixture(t);
  liked(m.db, '123');
  playlist(m.db, 'p');
  member(m.db, 'p', '123');
  m.db.run(
    "INSERT INTO disliked_tracks(track_id,title,artist) VALUES('yt_negative','Negative','Artist')",
  );
  const before = m.getTastePolicy().revision;
  assert.equal(change(m, 'track', 'dz_123').revision, before + 1);
  assert.equal(change(m, 'track', '123').revision, before + 1);
  assert.equal(m.getLikedTracks().length, 1);
  assert.equal(m.getPlaylistTracks('p').length, 1);
  assert.equal(m.getDislikedTrackIds().includes('yt_negative'), true);
  assert.equal(m.getTasteLikedTracks().length, 0);
  assert.equal(isTasteEligible(song('dz_123'), m.getTastePolicy()), false);
  assert.equal(isTasteEligible(song('yt_123'), m.getTastePolicy()), true);
  change(m, 'track', '123', false);
  assert.equal(m.getTasteLikedTracks().length, 1);
  assert.throws(() => m.setTasteExcluded({ scope: 'artist', id: 'x', excluded: true }), /Invalid/);
  assert.equal(tasteTrackId(Infinity), '');
});
test('playlist exclusion happens before metadata dedup and does not globally exclude shared/liked songs', (t) => {
  const m = fixture(t);
  playlist(m.db, 'ignored');
  playlist(m.db, 'allowed');
  member(m.db, 'ignored', '1', 'Artist');
  member(m.db, 'allowed', '1', 'Artist');
  liked(m.db, '2');
  member(m.db, 'ignored', '2');
  member(m.db, 'ignored', '3');
  change(m, 'playlist', 'ignored');
  const store = new LibraryTasteStore(
    () => m.db,
    () => {},
    () => m.getChangeRevision(),
  );
  assert.deepEqual(new Set(store.tracks().map((row) => row.id)), new Set(['1', '2']));
  assert.equal(isTasteEligible(song('1'), m.getTastePolicy()), true);
  assert.equal(
    isTasteEligible(
      withPlaybackOrigin(song('1'), { kind: 'playlist', id: 'ignored' }),
      m.getTastePolicy(),
    ),
    false,
  );
  change(m, 'playlist', 'ignored', false);
  assert.equal(store.tracks().length, 3);
});
test('ignored rows cannot consume per-artist ROW_NUMBER slots or global SQL limits', (t) => {
  const m = fixture(t);
  playlist(m.db, 'p');
  member(m.db, 'p', 'ignored', 'One Artist', 99);
  member(m.db, 'p', 'allowed', 'One Artist', 1);
  change(m, 'track', 'ignored');
  assert.deepEqual(
    m.getPlaylistWaveTracks().map((row) => row.track_deezer_id),
    ['allowed'],
  );
  m.db.run(
    "INSERT INTO track_scrobbles(track_id,title,artist,play_count) VALUES('ignored','Ignored','One Artist',100),('allowed','Allowed','Other Artist',5)",
  );
  assert.deepEqual(
    m.getWaveTasteTracks(1).map((row) => row.id),
    ['allowed'],
  );
  assert.deepEqual(
    m.getScrobbledTopArtists(1).map((row) => row.name),
    ['Other Artist'],
  );
});
test('context projection subtracts exact idempotent new sessions, preserves legacy and raw statistics', (t) => {
  const m = fixture(t);
  playlist(m.db, 'p');
  m.db.run(
    "INSERT INTO track_scrobbles(track_id,title,artist,play_count) VALUES('x','Song x','Artist x',10)",
  );
  const data = {
    sessionId: 'new-p',
    track: song('x'),
    playedSeconds: 15,
    origin: { kind: 'playlist', id: 'p' },
  };
  m.recordPlaybackSession(data);
  m.recordPlaybackSession(data);
  m.recordPlaybackSession({ ...data, playedSeconds: 180, completed: true, repeated: true });
  m.recordPlaybackSession({
    ...data,
    playedSeconds: 180,
    completed: true,
    repeated: true,
    origin: { kind: 'manual' },
  });
  const score = () =>
    Number(
      m.db.exec('SELECT ' + tasteHistoryScoreSql('s') + ' FROM track_scrobbles s')[0].values[0][0],
    );
  assert.equal(score(), 19);
  change(m, 'playlist', 'p');
  assert.equal(score(), 10);
  assert.equal(Number(m.db.exec('SELECT play_count FROM track_scrobbles')[0].values[0][0]), 11);
  assert.equal(
    Number(m.db.exec('SELECT SUM(played_seconds) FROM listening_daily_time')[0].values[0][0]),
    180,
  );
  m.recordPlaybackSession({
    sessionId: 'manual',
    track: song('x'),
    playedSeconds: 180,
    completed: true,
    origin: { kind: 'manual' },
  });
  assert.equal(score(), 14);
  m.recordPlaybackSession({
    sessionId: 'skip',
    track: song('x'),
    playedSeconds: 2,
    skipped: true,
    origin: { kind: 'playlist', id: 'p' },
  });
  assert.equal(score(), 14, 'ignored skip removes negative affinity too');
  change(m, 'playlist', 'p', false);
  assert.equal(score(), 22);
  m.db.run("DELETE FROM playback_sessions WHERE session_id='skip'");
  assert.equal(
    m.db.exec("SELECT COUNT(*) FROM taste_playback_origins WHERE session_id='skip'")[0]
      .values[0][0],
    0,
  );
});
test('learned evidence is filtered before artist/style corroboration; restore keeps saved evidence', () => {
  const saved = storage(),
    prefs = createWavePreferences(saved, () => 100000);
  prefs.record(song('a', 'Same Artist'), 0.5, true);
  prefs.record(song('b', 'Same Artist'), 0.5, true);
  const policy = { revision: 1, exclusions: [{ scope: 'track', id: 'b', label: 'B' }] };
  assert.equal(prefs.learnedTracks().length, 2);
  assert.equal(
    prefs.learnedTracks((track) => isTasteEligible(track, policy)).length,
    0,
    'ignored anchor cannot corroborate the other song',
  );
  assert.equal(createWavePreferences(saved, () => 100000).learnedTracks().length, 2);
});
test('same recording in multiple origins cannot corroborate itself; context restore is isolated', () => {
  const prefs = createWavePreferences(storage(), () => 100000);
  const a = withPlaybackOrigin(song('a', 'Same Artist'), { kind: 'playlist', id: 'p' });
  const b = withPlaybackOrigin(song('a', 'Same Artist'), { kind: 'manual' });
  prefs.record(a, 0.5, true);
  prefs.record(b, 0.5, true);
  assert.equal(prefs.learnedTracks().length, 0);
  prefs.record(a, 1, true, 'like');
  prefs.record(song('b', 'Other Artist'), 1, true, 'like');
  const policy = { revision: 1, exclusions: [{ scope: 'playlist', id: 'p', label: 'P' }] };
  assert.deepEqual(
    prefs.learnedTracks((track) => isTasteEligible(track, policy)).map((track) => track.id),
    ['b'],
  );
  assert.equal(
    prefs.learnedTracks().some((track) => track.id === 'a'),
    true,
  );
});
test('main context filtering precedes bounded normalization and invalidates aggregate feedback', () => {
  const ignored = Array.from({ length: 12 }, (_, i) => song('bad' + i));
  const policy = {
    revision: 2,
    exclusions: ignored.map((track) => ({ scope: 'track', id: track.id, label: track.title })),
  };
  const clean = normalizeWaveBatchContext(
    filterTasteContext(
      {
        tasteRevision: 1,
        positiveTracks: [...ignored, song('good')],
        artistFeedback: { artist: 2 },
        discoveryAdjustment: 0.2,
      },
      policy,
    ),
  );
  assert.deepEqual(
    clean.positiveTracks.map((track) => track.id),
    ['good'],
  );
  assert.deepEqual(clean.artistFeedback, {});
  assert.equal(clean.discoveryAdjustment, 0);
});
test('daily cache revision rejects stale in-flight overwrite without banning candidates', async () => {
  const saved = storage();
  let revision = 0,
    finishOld;
  const old = new Promise((resolve) => {
    finishOld = resolve;
  });
  let calls = 0;
  const load = createDailyRecommendationLoader(
    saved,
    () => (++calls === 1 ? old : Promise.resolve([song('fresh')])),
    () => new Date(2026, 9, 16),
    () => revision,
  );
  const first = load();
  await Promise.resolve();
  revision = 1;
  const fresh = await load();
  assert.equal(fresh.tracks[0].id, 'fresh');
  finishOld([song('stale')]);
  await first;
  assert.equal((await load()).tracks[0].id, 'fresh');
  assert.equal(JSON.parse(saved.getItem(DAILY_RECOMMENDATIONS_KEY)).tasteRevision, 1);
});
test('queue occurrences and persisted restoration preserve independent playback origins', () => {
  const queue = [
    withPlaybackOrigin(song('same'), { kind: 'playlist', id: 'p' }),
    withPlaybackOrigin(song('same'), { kind: 'manual' }),
  ];
  const selected = selectPlayerQueue([], 0, queue[0], queue);
  assert.notEqual(selected.queue[0].queueEntryId, selected.queue[1].queueEntryId);
  const second = selectPlayerQueue(selected.queue, 0, selected.queue[1]);
  assert.equal(second.index, 1);
  assert.equal(second.queue[1].queueOrigin.kind, 'manual');
  assert.equal(second.queue[0].queueOrigin.id, 'p');
  const saved = storage();
  saved.setItem(
    PLAYBACK_SESSION_KEY,
    JSON.stringify({
      version: 1,
      track: second.queue[1],
      queue: second.queue,
      queueIndex: 1,
      position: 42,
      repeatMode: 'all',
      isShuffle: true,
    }),
  );
  const restored = readPlaybackSession(saved);
  assert.equal(restored.queue[0].queueOrigin.id, 'p');
  assert.equal(restored.track.queueOrigin.kind, 'manual');
});
test('backup round-trip restores neutral policy without losing liked data', (t) => {
  const m = fixture(t);
  liked(m.db, 'a');
  change(m, 'track', 'a');
  playlist(m.db, 'p');
  change(m, 'playlist', 'p');
  const exported = m.exportData();
  assert.equal(exported.success, true);
  assert.equal(exported.payload.data.taste_exclusions.length, 2);
  change(m, 'track', 'a', false);
  change(m, 'playlist', 'p', false);
  assert.equal(m.importData(exported.payload).success, true);
  assert.equal(m.getTastePolicy().exclusions.length, 2);
  assert.equal(m.getLikedTracks().length, 1);
});

test('policy observers publish only committed changes across set and backup import, and unsubscribe', (t) => {
  const m = fixture(t);
  liked(m.db, 'a');
  const revisions = [],
    unsubscribe = m.onTastePolicyChanged((policy) => revisions.push(policy.revision));
  change(m, 'track', 'a');
  change(m, 'track', 'a');
  assert.deepEqual(revisions, [1]);
  const backup = m.exportData().payload;
  change(m, 'track', 'a', false);
  assert.deepEqual(revisions, [1, 2]);
  m.importData(backup);
  assert.deepEqual(revisions, [1, 2, 3]);
  t.mock.method(console, 'warn', () => {});
  m.onTastePolicyChanged(() => {
    throw Error('observer failure');
  });
  assert.doesNotThrow(() => change(m, 'playlist', 'p'));
  assert.equal(m.getTastePolicy().revision, 4);
  const before = revisions.length;
  t.mock.method(console, 'error', () => {});
  assert.equal(
    m.importData({
      data: {
        liked_tracks: [{ id: 'other', title: 'Other', artist: 'Artist' }],
        taste_exclusions: [{ scope: 'artist', id: 'bad' }],
      },
    }).success,
    false,
  );
  assert.equal(m.getTastePolicy().revision, 4);
  assert.equal(revisions.length, before);
  unsubscribe();
  change(m, 'playlist', 'p', false);
  assert.equal(revisions.length, before);
});
test('context history projection uses indexed session lookup, rather than a per-track full scan', (t) => {
  const m = fixture(t);
  // Simulate a pre-policy SQLite snapshot, then reopen and migrate it.
  liked(m.db, 'existing');
  m.db.run(
    "INSERT INTO playback_sessions(session_id,track_id,played_seconds) VALUES('legacy','existing',1)",
  );
  m.db.run(
    'DROP TABLE taste_playback_origins; DROP TABLE taste_exclusions; DROP TABLE taste_policy_revision; DROP INDEX idx_playback_sessions_track',
  );
  const bytes = m.db.export();
  m.db.close();
  m.db = new SQL.Database(bytes);
  initializeLibrarySchema(m.db);
  assert.equal(m.getLikedTracks().length, 1);
  assert.equal(m.db.exec('SELECT COUNT(*) FROM playback_sessions')[0].values[0][0], 1);
  assert.equal(m.getTastePolicy().revision, 0);
  initializeLibrarySchema(m.db); // Existing current-schema initialization is idempotent too.
  const plan = m.db.exec(
    'EXPLAIN QUERY PLAN SELECT ' + tasteHistoryScoreSql('s') + ' FROM track_scrobbles s',
  )[0].values;
  assert.ok(plan.some((row) => String(row.at(-1)).includes('idx_playback_sessions_track')));
});
