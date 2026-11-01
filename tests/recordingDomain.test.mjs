import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseManager } from '../src/desktop/main/db/index.ts';
import {
  matchesImportedRecording,
  matchesCanonicalRecording,
} from '../src/shared/utils/recordingIdentity.ts';
import {
  recordingKey,
  providerTrackRef,
  queueEntryFromTrack,
} from '../src/shared/types/musicDomain.ts';
import { createQueueEntry } from '../src/shared/utils/queueEntry.ts';
import {
  PlaybackSessionWriter,
  readPlaybackSession,
} from '../src/shared/services/playbackSession.ts';
import { sequenceWaveIndices } from '../src/shared/compute/waveSequence.ts';

const song = (id, source = 'youtube', title = 'Silver River', duration = 180) => ({
  id,
  source,
  title,
  artist: { name: 'Fixture Band' },
  album: { title: '' },
  duration,
  preview: '',
});
async function database(t) {
  const db = new DatabaseManager(':memory:');
  await db.init();
  t.after(() => {
    db.db?.close();
    db.db = null;
  });
  return db;
}
test('Provider upload, recording, temporary source and queue occurrence have separate identities', () => {
  const track = song('yt_one'),
    first = createQueueEntry(track),
    second = createQueueEntry(track);
  assert.deepEqual(providerTrackRef(track), { provider: 'youtube', providerId: 'one' });
  assert.notEqual(first.queueEntryId, second.queueEntryId);
  assert.equal(queueEntryFromTrack(first).recording.id, queueEntryFromTrack(second).recording.id);
  assert.notEqual(recordingKey(track), recordingKey(song('sc_one', 'soundcloud')));
  assert.equal(
    recordingKey({ ...track, resolvedStreamUrl: 'https://cdn.test/a?secret=expired' }),
    recordingKey(track),
  );
});
test('Rust replacement matching preserves the broader import contract but canonical links require known exact version/credits/duration', () => {
  const original = song('yt_original');
  assert.equal(
    matchesImportedRecording(
      original,
      song('yt_new', 'youtube', 'Silver River (Official Audio)', 190),
    ),
    true,
  );
  assert.equal(
    matchesCanonicalRecording(
      original,
      song('yt_new', 'youtube', 'Silver River (Official Audio)', 190),
    ),
    false,
  );
  assert.equal(
    matchesCanonicalRecording(
      original,
      song('sc_new', 'soundcloud', 'Silver River (Official Audio)', 181),
    ),
    true,
  );
  for (const title of [
    'Silver River (Live)',
    'Silver River Remix',
    'Silver River Remaster',
    'Silver River Acoustic',
  ]) {
    assert.equal(
      matchesCanonicalRecording(original, song('yt_version', 'youtube', title)),
      false,
      title,
    );
  }
  assert.equal(
    matchesCanonicalRecording(original, { ...song('yt_bad'), artist: { name: 'Another Band' } }),
    false,
  );
  assert.equal(
    matchesCanonicalRecording(original, song('yt_unknown', 'youtube', original.title, 0)),
    false,
  );
});
test('Verified replacement keeps canonical ID, aliases, likes and removal through SQLite reopen and JSON backup', async (t) => {
  const db = await database(t),
    original = song('yt_original'),
    replacement = song('sc_reupload', 'soundcloud');
  db.toggleLikeTrack({
    deezer_id: original.id,
    title: original.title,
    artist: original.artist.name,
    duration: original.duration,
  });
  assert.equal(db.recordings.link(original, replacement), true);
  assert.equal(db.recordings.id(original), db.recordings.id(replacement));
  assert.ok(db.getLikedTrackIds().includes(replacement.id));
  const snapshot = db.db.export();
  const SQL = (await import('sql.js')).default;
  const runtime = await SQL();
  const reopened = new runtime.Database(snapshot);
  const { RecordingCatalog } = await import('../src/desktop/main/db/recordingCatalog.ts');
  const catalog = new RecordingCatalog(
    () => reopened,
    () => {},
  );
  assert.equal(catalog.id(replacement), db.recordings.id(original));
  reopened.close();
  const backup = db.exportData();
  assert.equal(backup.success, true);
  const imported = await database(t);
  assert.equal(imported.importData(backup.payload).success, true);
  assert.equal(imported.recordings.id(replacement), db.recordings.id(original));
  assert.ok(imported.getLikedTrackIds().includes(replacement.id));
  assert.equal(
    db.toggleLikeTrack({
      deezer_id: replacement.id,
      title: replacement.title,
      artist: replacement.artist.name,
      duration: replacement.duration,
    }).liked,
    false,
  );
  assert.equal(db.getLikedTracks().length, 0);
});
test('Legacy library and distinct versions survive identity schema initialization and rejected aliases', async (t) => {
  const db = await database(t);
  db.db.run(
    "INSERT INTO liked_tracks (deezer_id,title,artist,duration) VALUES ('sc_legacy','Silver River','Fixture Band',180)",
  );
  assert.equal(
    db.recordings.link(
      song('sc_legacy', 'soundcloud'),
      song('yt_live', 'youtube', 'Silver River Live'),
    ),
    false,
  );
  assert.equal(db.getLikedTracks()[0].deezer_id, 'sc_legacy');
  assert.notEqual(
    db.recordings.id(song('sc_legacy', 'soundcloud')),
    db.recordings.id(song('yt_live')),
  );
});
test('Recording identity survives session restore while expired stream data is dropped', () => {
  const values = new Map(),
    storage = { getItem: (k) => values.get(k) || null, setItem: (k, v) => values.set(k, v) };
  const track = {
    ...song('sc_alias', 'soundcloud'),
    recordingId: 'rec:youtube:original',
    resolvedStreamUrl: 'https://cdn.test/expired?token=secret',
  };
  new PlaybackSessionWriter(storage).save({
    track,
    queue: [track],
    position: 4,
    queueIndex: 0,
    repeatMode: 'off',
    isShuffle: false,
  });
  const restored = readPlaybackSession(storage);
  assert.equal(restored.track.recordingId, track.recordingId);
  assert.equal(restored.track.resolvedStreamUrl, undefined);
});
test('The same Rust ranker suppresses an alias with different metadata by canonical identity', () => {
  const heard = { ...song('yt_heard'), recordingId: 'rec:youtube:heard' };
  const alias = {
    ...song('sc_alias', 'soundcloud', 'Catalog renamed this recording'),
    artist: { name: 'New catalog credit' },
    recordingId: heard.recordingId,
  };
  const fresh = {
    ...song('yt_fresh', 'youtube', 'Another Different Tune'),
    artist: { name: 'Other Artist' },
  };
  const before = sequenceWaveIndices(
    [{ ...alias, recordingId: undefined }, fresh],
    'default',
    [],
    2,
    { recentTracks: [{ ...heard, recordingId: undefined }] },
  );
  const after = sequenceWaveIndices([alias, fresh], 'default', [], 2, { recentTracks: [heard] });
  assert.ok(before.includes(0), 'control fixture must actually expose the cross-provider repeat');
  assert.ok(!after.includes(0), 'canonical alias must be recognized as already heard');
  assert.ok(after.includes(1), 'a fresh artist must remain eligible');
});

test('Identity migration preserves a version-2 library and never lowers a newer schema version', async (t) => {
  const db = await database(t);
  db.db.run('DROP TABLE provider_tracks');
  db.db.run('DROP TABLE recordings');
  db.db.run(
    "PRAGMA user_version=2; INSERT INTO liked_tracks(deezer_id,title,artist,duration) VALUES ('yt_old','Silver River','Fixture Band',180)",
  );
  const { initializeLibrarySchema } = await import('../src/desktop/main/db/schema.ts');
  initializeLibrarySchema(db.db);
  assert.equal(db.getLikedTracks()[0].deezer_id, 'yt_old');
  assert.equal(db.db.exec('PRAGMA user_version')[0].values[0][0], 3);
  db.db.run('PRAGMA user_version=7');
  initializeLibrarySchema(db.db);
  assert.equal(db.db.exec('PRAGMA user_version')[0].values[0][0], 7);
});
