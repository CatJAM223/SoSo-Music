import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getWavePlaybackFeedback,
  decayWaveArtistFeedback,
  rememberPositiveWaveTrack,
} from '../src/shared/utils/waveFeedback.ts';

const song = (id, artist = `Artist ${id}`) => ({
  id,
  title: `Song ${id}`,
  artist: { name: artist },
  album: { title: 'Single' },
  duration: 180,
  preview: '',
});

test('wave feedback distinguishes a real quick skip from no-audio starts', () => {
  for (const played of [0, 0.5, 1.99, -1, NaN, Infinity])
    assert.equal(getWavePlaybackFeedback(played, 180), 0);
  assert.equal(getWavePlaybackFeedback(2, 180), -0.6);
  assert.equal(getWavePlaybackFeedback(24.99, 180), -0.35);
  assert.equal(getWavePlaybackFeedback(25, 180), 0);
});

test('short songs use their completion ratio instead of a fixed skip threshold', () => {
  assert.equal(getWavePlaybackFeedback(8, 10), 0.2);
  assert.equal(getWavePlaybackFeedback(2, 10), 0);
  assert.equal(getWavePlaybackFeedback(3, 20), 0);
  assert.equal(getWavePlaybackFeedback(2.99, 20), -0.35);
  assert.equal(getWavePlaybackFeedback(16, 20), 0.2);
});

test('only a large actual listening fraction supplies positive feedback', () => {
  assert.equal(getWavePlaybackFeedback(79, 100), 0);
  assert.equal(getWavePlaybackFeedback(80, 100), 0.2);
  assert.equal(getWavePlaybackFeedback(240, 600), 0);
  assert.equal(getWavePlaybackFeedback(480, 600), 0.2);
});

test('unknown or invalid durations allow cautious skips without invented completion', () => {
  for (const duration of [0, -100, NaN, Infinity]) {
    assert.equal(getWavePlaybackFeedback(2, duration), -0.6);
    assert.equal(getWavePlaybackFeedback(14.99, duration), -0.35);
    assert.equal(getWavePlaybackFeedback(15, duration), 0);
    assert.equal(getWavePlaybackFeedback(500, duration), 0);
  }
});

test('session feedback fades, clamps extreme values, and removes invalid or tiny entries', () => {
  const feedback = new Map([
    ['positive', 1],
    ['negative', -1],
    ['extreme', 100],
    ['low', -100],
    ['tiny', 0.05],
    ['nan', NaN],
    ['infinite', Infinity],
  ]);
  decayWaveArtistFeedback(feedback);
  assert.equal(feedback.get('positive'), 0.92);
  assert.equal(feedback.get('negative'), -0.92);
  assert.equal(feedback.get('extreme'), 1.84);
  assert.equal(feedback.get('low'), -1.84);
  for (const key of ['tiny', 'nan', 'infinite']) assert.equal(feedback.has(key), false);
  for (let count = 0; count < 100; count++) decayWaveArtistFeedback(feedback);
  assert.equal(feedback.size, 0);
});

test('positive seeds retain at most two songs by a normalized main artist', () => {
  const previous = [
    song(1, 'MADK1D feat. tewiq'),
    song(2, 'madk1d'),
    song(3, 'Madk1d'),
    song(4, 'tewiq'),
    song(5, 'kouru'),
  ];
  const current = song(6, 'ｍａｄｋ１ｄ');
  const retained = rememberPositiveWaveTrack(previous, current);
  assert.deepEqual(
    retained.map((track) => track.id),
    [6, 1, 4, 5],
  );
  assert.equal(previous.length, 5);
  assert.equal(retained[0], current);
});

test('a repeated seed updates to the latest metadata and preserves other artists', () => {
  const fresh = { ...song('1', 'Artist One'), title: 'New metadata' };
  const retained = rememberPositiveWaveTrack([song(1, 'Artist One'), song(2, 'Artist Two')], fresh);
  assert.deepEqual(
    retained.map((track) => track.id),
    ['1', 2],
  );
  assert.equal(retained[0].title, 'New metadata');
});

test('positive seed memory rotates twelve distinct artists as sessions change', () => {
  let remembered = [];
  for (let id = 1; id <= 20; id++) remembered = rememberPositiveWaveTrack(remembered, song(id));
  assert.deepEqual(
    remembered.map((track) => track.id),
    Array.from({ length: 12 }, (_, index) => 20 - index),
  );
  assert.equal(new Set(remembered.map((track) => track.artist.name)).size, 12);
});

test('missing artist metadata does not collapse independent positive seeds', () => {
  const retained = rememberPositiveWaveTrack(
    [song(1, ''), song(2, 'Unknown Artist'), song(3, '')],
    song(4, ''),
  );
  assert.deepEqual(
    retained.map((track) => track.id),
    [4, 1, 2, 3],
  );
  assert.deepEqual(rememberPositiveWaveTrack(retained, song(5), 0), []);
  assert.equal(rememberPositiveWaveTrack(retained, song(5), 2.9).length, 2);
});
