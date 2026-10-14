import test from 'node:test';
import assert from 'node:assert/strict';
import { sequenceWaveTracks, resequenceWaveQueue } from '../src/shared/utils/waveQueue.ts';
const song = (id, artist = 'Artist ' + id) => ({
  id,
  title: 'Song ' + id,
  artist: { name: artist },
  album: { title: 'Single' },
  duration: 200,
  source: 'soundcloud',
  genre: 'Jazz',
});
const likes = Array.from({ length: 4 }, (_, i) => ({ ...song('liked-' + i), waveSeedWeight: 2 }));
const fresh = Array.from({ length: 12 }, (_, i) => song('fresh-' + i));
const familiar = likes.map((t) => t.artist.name);
const options = { tasteTracks: likes };
for (const mood of ['default', 'mix'])
  test(
    mood + ' spaces actual saved songs even when different artists rank ahead of discoveries',
    () => {
      const queue = sequenceWaveTracks([...likes, ...fresh], mood, familiar, 12, options);
      const ids = new Set(likes.map((t) => t.id));
      assert.ok(queue.slice(0, 3).some((t) => !ids.has(t.id)));
      for (let i = 1; i < queue.length; i++)
        assert.ok(!(ids.has(queue[i - 1].id) && ids.has(queue[i].id)));
      assert.ok(
        queue.some((t) => ids.has(t.id)),
        'Likes remain available',
      );
    },
  );
test('A saved alternate upload at the end of a batch is followed by a new song', () => {
  const copy = { ...likes[0], id: 'yt_otherupload', source: 'youtube' };
  const queue = sequenceWaveTracks([...likes.slice(1), ...fresh], 'default', familiar, 3, {
    ...options,
    recentTracks: [copy],
  });
  assert.ok(queue[0].id.startsWith('fresh-'));
});
test('Refill preserves current and announced next while spacing saved songs in the remaining tail', () => {
  const current = likes[0],
    announced = likes[1];
  const queue = resequenceWaveQueue(
    [current, announced, ...likes.slice(2), ...fresh],
    1,
    'default',
    familiar,
    new Map(),
    [],
    [],
    options,
  );
  assert.deepEqual(queue.slice(0, 2), [current, announced]);
  assert.ok(queue[2].id.startsWith('fresh-'));
});
test('A tiny catalog remains playable and the favorites station keeps its intent', () => {
  assert.equal(sequenceWaveTracks(likes, 'default', familiar, 4, options).length, 4);
  const queue = sequenceWaveTracks([...likes, ...fresh], 'favorites', familiar, 3, options);
  assert.ok(queue.every((t) => t.id.startsWith('liked-')));
});
test('A new recording by a liked artist is eligible between two saved songs', () => {
  const newSong = song('different-recording', likes[2].artist.name);
  const queue = sequenceWaveTracks([...likes, newSong], 'default', familiar, 2, {
    ...options,
    recentTracks: [likes[0]],
  });
  assert.equal(queue[0].id, newSong.id);
});

test('Liked markers returned by the main process survive a differently sampled renderer profile', () => {
  const queue = sequenceWaveTracks([...likes, ...fresh], 'default', familiar, 3, {
    tasteTracks: [],
  });
  assert.ok(queue.slice(0, 3).some((track) => track.id.startsWith('fresh-')));
});
