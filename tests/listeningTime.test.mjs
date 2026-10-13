import test from 'node:test';
import assert from 'node:assert/strict';
import { playedMediaDelta } from '../src/shared/utils/listeningTime.ts';
import { DatabaseManager } from '../src/desktop/main/db/index.ts';

test('Listening time counts audio progress, but excludes pauses and seeks', () => {
  assert.ok(Math.abs(playedMediaDelta(10, 11.1, 1.1, 1, true, false) - 1.1) < 1e-9);
  assert.equal(playedMediaDelta(11, 20, 0.2, 1, true, false), 0);
  assert.equal(playedMediaDelta(20, 21, 1, 1, false, false), 0);
  assert.equal(playedMediaDelta(20, 21, 1, 1, true, true), 0);
  assert.equal(playedMediaDelta(20, 5, 1, 1, true, false), 0);
});

test('Desktop playback sessions keep actual seconds and count completion and skip once', async (t) => {
  const db = new DatabaseManager(':memory:');
  t.after(() => db.db?.close());
  await db.init();
  const track = {
    id: 'actual-time-test',
    title: 'A track',
    artist: { name: 'An artist' },
    album: { title: '' },
    duration: 100,
    preview: '',
  };
  db.recordPlaybackSession({ sessionId: 'one', track, playedSeconds: 7 });
  db.recordPlaybackSession({ sessionId: 'one', track, playedSeconds: 82, completed: true });
  db.recordPlaybackSession({ sessionId: 'one', track, playedSeconds: 82, completed: true });
  db.recordPlaybackSession({ sessionId: 'two', track, playedSeconds: 3, skipped: true });
  db.addListeningHistory({ track_id: track.id, title: track.title, artist: track.artist.name });
  db.addListeningHistory({ track_id: track.id, title: track.title, artist: track.artist.name });
  const stats = db.getStatsSummary();
  assert.equal(stats.measuredSeconds, 85);
  assert.equal(stats.todaySeconds, 85);
  assert.equal(stats.weekly?.measuredSeconds, 85);
  assert.equal(stats.weekly?.plays, 2);
  assert.equal(stats.weekly?.topTracks[0].play_count, 2);
  assert.equal(stats.totalPlays, 2);
  assert.equal(stats.totalCompletions, 1);
  assert.equal(stats.completionRate, 50);
  assert.equal(stats.topTracks[0].play_count, 2);
  const row = db.db.exec(
    "SELECT skip_count FROM track_scrobbles WHERE track_id = 'actual-time-test'",
  )[0].values[0];
  assert.equal(row[0], 1);
});

test('Weekly statistics exclude old history and keep today separate', async (t) => {
  const db = new DatabaseManager(':memory:');
  t.after(() => db.db?.close());
  await db.init();
  const track = {
    id: 'weekly-track',
    title: 'This week',
    artist: { name: 'Artist' },
    album: { title: '' },
    duration: 180,
    preview: '',
  };
  db.recordPlaybackSession({ sessionId: 'week', track, playedSeconds: 94 });
  db.addListeningHistory({
    track_id: track.id,
    title: track.title,
    artist: track.artist.name,
    cover_url: 'https://example.com/cover.jpg',
  });
  db.addListeningHistory({ track_id: 'old-track', title: 'Old', artist: 'Other' });
  db.toggleFollowArtist({
    id: 'artist-profile',
    name: 'Artist',
    picture_url: 'https://example.com/artist.jpg',
  });
  db.db.run(
    "UPDATE listening_history SET played_at = datetime('now', '-8 days') WHERE track_id = 'old-track'",
  );
  const stats = db.getStatsSummary();
  assert.equal(stats.todaySeconds, 94);
  assert.equal(stats.weekly?.measuredSeconds, 94);
  assert.equal(stats.weekly?.plays, 1);
  assert.equal(stats.weekly?.uniqueTracks, 1);
  assert.equal(stats.weekly?.topTracks[0].cover_url, 'https://example.com/cover.jpg');
  assert.equal(stats.weekly?.topArtists[0].picture_url, 'https://example.com/artist.jpg');
  assert.deepEqual(
    stats.weekly?.topArtists.map((artist) => artist.artist),
    ['Artist'],
  );
});
