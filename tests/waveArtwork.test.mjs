import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  trackArtworkCandidates,
  advanceTrackArtwork,
  waveSeedArtwork,
} from '../src/shared/utils/trackArtwork.ts';
import { resolveTrackCover } from '../src/shared/utils/formatters.ts';
import { DEFAULT_COVER_SVG_DATA_URI } from '../src/shared/utils/placeholder.ts';
import { buildWaveTasteSeeds } from '../src/shared/utils/waveTaste.ts';
import { WaveCandidatePool } from '../src/desktop/main/services/waveCandidatePool.ts';
import { registerWaveHandlers } from '../src/desktop/main/ipc/waveHandlers.ts';
import { MusicAggregatorService } from '../src/desktop/main/services/musicAggregator.ts';

const cover = 'https://i1.sndcdn.com/artworks-fixture-t500x500.jpg';
const liked = {
  deezer_id: 'sc_123',
  title: 'Signal',
  artist: 'Fixture',
  duration: 200,
  cover_url: cover,
};

test('wave taste retains bounded saved artwork without copying image bytes, signed audio or mutating library rows', () => {
  const seed = buildWaveTasteSeeds([liked], [], [], [], [])[0];
  assert.equal(resolveTrackCover(seed), cover);
  assert.equal(seed.waveSeedWeight, 2);
  assert.equal(liked.album, undefined);
  for (const cover_url of [
    'data:image/png;base64,huge',
    'file:///private',
    'https://test.invalid/' + 'x'.repeat(3000),
  ]) {
    const result = waveSeedArtwork({ ...liked, cover_url });
    assert.equal(result.cover, undefined);
  }
  assert.equal(seed.preview, '');
  assert.equal(seed.resolvedStreamUrl, undefined);
});

test('main wave IPC keeps a liked recording cover through taste selection and the candidate pool', async (t) => {
  const handlers = new Map();
  const db = Object.fromEntries(
    [
      'getDislikedTrackIds',
      'getWaveTasteTracks',
      'getPlaylistWaveTracks',
      'getFollowedArtists',
      'getScrobbledTopArtists',
      'getDislikedWaveTracks',
    ].map((key) => [key, () => []]),
  );
  db.getTastePolicy = () => ({ revision: 0, exclusions: [] });
  db.getTasteLikedTracks = () => [liked];
  t.mock.method(MusicAggregatorService, 'getWaveBatch', async (_mood, seeds) => {
    const pool = new WaveCandidatePool({
      mood: 'favorites',
      excluded: [],
      disliked: [],
      heard: [],
      familiarArtists: ['Fixture'],
    });
    seeds.forEach((seed) => pool.add(seed));
    return pool.values();
  });
  registerWaveHandlers({ handle: (name, callback) => handlers.set(name, callback) }, db);
  const result = await handlers.get('music:getWaveBatch')(
    { sender: new EventEmitter() },
    'favorites',
    [],
    [],
    {},
    'artwork',
  );
  assert.equal(result.length, 1);
  assert.equal(resolveTrackCover(result[0]), cover);
});

test('artwork skips invalid placeholders, derives YouTube covers and retains original SoundCloud size as fallback', () => {
  assert.equal(
    resolveTrackCover({
      album: { cover_medium: 'https://images.unsplash.com/placeholder' },
      cover_url: cover,
    }),
    cover,
  );
  assert.equal(
    resolveTrackCover({ album: { cover_medium: 'not a URL', cover_big: '  ' + cover } }),
    cover,
  );
  assert.equal(
    resolveTrackCover({ id: 'yt_abcdefghijk' }),
    'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg',
  );
  assert.deepEqual(
    trackArtworkCandidates({ album: { cover: 'https://i1.sndcdn.com/artworks-test-large.jpg' } }),
    [
      'https://i1.sndcdn.com/artworks-test-t500x500.jpg',
      'https://i1.sndcdn.com/artworks-test-large.jpg',
    ],
  );
  assert.equal(
    resolveTrackCover({ cover_url: '//i1.sndcdn.com/artworks-test.jpg' }),
    'https://i1.sndcdn.com/artworks-test.jpg',
  );
});

test('failed images advance through distinct recording alternatives once and stop at the offline placeholder', () => {
  const track = { id: 'yt_abcdefghijk', album: { cover_medium: cover, cover_big: cover } };
  const urls = trackArtworkCandidates(track),
    image = {
      src: urls[0],
      getAttribute() {
        return this.src;
      },
    };
  assert.equal(urls.filter((url) => url === cover).length, 1);
  for (const next of [...urls.slice(1), DEFAULT_COVER_SVG_DATA_URI]) {
    advanceTrackArtwork(image, track);
    assert.equal(image.src, next);
  }
  advanceTrackArtwork(image, track);
  assert.equal(image.src, DEFAULT_COVER_SVG_DATA_URI);
});
