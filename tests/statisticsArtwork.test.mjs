import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseManager } from '../src/desktop/main/db/index.ts';

async function database(t) {
  const manager = new DatabaseManager(':memory:');
  await manager.init();
  t.after(() => manager.db?.close());
  return manager;
}

function seedPlays(db, id, count) {
  db.db.run(
    'INSERT INTO track_scrobbles (track_id, title, artist, play_count, repeat_count) VALUES (?, ?, ?, ?, ?)',
    [id, 'ГРИБЫ – КОПЫ (БИСТМАСТЕР REMIX)', 'papasha', count, 1],
  );
}

test('Statistics use saved SoundCloud artwork instead of alphabetically highest history URL', async (t) => {
  const db = await database(t),
    id = '2372343320';
  const artwork = 'https://i1.sndcdn.com/artworks-K1JgctMZ4rgJpv0z-j2gujA-t500x500.jpg';
  const placeholder = 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=500&q=80';
  db.toggleLikeTrack({ deezer_id: id, title: 'КОПЫ', artist: 'papasha', cover_url: artwork });
  db.addListeningHistory({ track_id: id, title: 'КОПЫ', artist: 'papasha', cover_url: artwork });
  db.addListeningHistory({
    track_id: id,
    title: 'КОПЫ',
    artist: 'papasha',
    cover_url: placeholder,
  });
  seedPlays(db, id, 2);
  const stats = db.getStatsSummary();
  assert.equal(stats.weekly.topTracks[0].cover_url, artwork);
  assert.equal(stats.topTracks[0].cover_url, artwork);
  assert.equal(stats.mostReplayedTrack.cover_url, artwork);
  assert.equal(stats.weekly.topTracks[0].play_count, 2);
  assert.equal(stats.totalPlays, 2);
  assert.equal(
    db.db.exec('SELECT cover_url FROM listening_history ORDER BY id DESC LIMIT 1')[0].values[0][0],
    placeholder,
  );
});

test('Statistics fall back to latest usable artwork for the same track ID without changing counts', async (t) => {
  const db = await database(t),
    id = 'sc_original';
  const latest = 'https://i1.sndcdn.com/aa-new-t500x500.jpg';
  for (const cover_url of [
    'https://i1.sndcdn.com/zz-old-t500x500.jpg',
    latest,
    '',
    'https://images.unsplash.com/placeholder.jpg',
    'blob:expired',
    'data:image/png;base64,bad',
  ]) {
    db.addListeningHistory({ track_id: id, title: 'КОПЫ', artist: 'papasha', cover_url });
  }
  db.addListeningHistory({
    track_id: 'yt_different-recording',
    title: 'КОПЫ',
    artist: 'papasha',
    cover_url: 'https://i.ytimg.com/vi/other/hqdefault.jpg',
  });
  seedPlays(db, id, 6);
  const stats = db.getStatsSummary();
  assert.equal(stats.weekly.topTracks.find((track) => track.id === id).cover_url, latest);
  assert.equal(stats.topTracks[0].cover_url, latest);
  assert.equal(stats.mostReplayedTrack.cover_url, latest);
  assert.equal(stats.weekly.topTracks.find((track) => track.id === id).play_count, 6);
  assert.equal(stats.weekly.plays, 7);
});
