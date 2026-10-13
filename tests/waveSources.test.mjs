import test from 'node:test';
import assert from 'node:assert/strict';
import { WaveEngine } from '../src/desktop/main/services/waveEngine.ts';
import { SoundCloudService } from '../src/desktop/main/services/soundcloud.ts';
import { YouTubeMusicService } from '../src/desktop/main/services/youtubeMusic.ts';
import { LastFmService } from '../src/desktop/main/services/lastfm.ts';
import { normalizeWaveBatchContext } from '../src/shared/utils/waveRecommendations.ts';
import {
  normalizeWaveSource,
  matchesWaveSource,
  readWaveSource,
  saveWaveSource,
} from '../src/shared/services/waveSource.ts';

const createTrack = (id, artist, source) => ({
  id,
  title: 'Silver horizon',
  artist: { name: artist },
  album: { title: '' },
  source,
  duration: 200,
  preview: '',
});
for (const source of ['youtube', 'soundcloud']) {
  for (const mood of ['default', 'mix', 'favorites', 'energy', 'chill', 'discover']) {
    for (const hasTaste of [true, false]) {
      test(
        source + ' wave honors the source in ' + mood + ' with taste=' + hasTaste,
        async (context) => {
          const requestedSources = [];
          const search = (provider) => async (query) => {
            requestedSources.push(provider);
            return {
              data: [
                createTrack(provider + query, query, provider),
                createTrack(
                  'wrong-' + query,
                  query,
                  provider === 'youtube' ? 'soundcloud' : 'youtube',
                ),
              ],
            };
          };
          context.mock.method(SoundCloudService, 'search', search('soundcloud'));
          context.mock.method(YouTubeMusicService, 'search', search('youtube'));
          context.mock.method(LastFmService, 'getSimilarArtists', async () => [
            { name: 'Nearby Artist' },
          ]);
          context.mock.method(SoundCloudService, 'getRelatedTracks', async () => {
            requestedSources.push('soundcloud');
            return [];
          });
          context.mock.method(YouTubeMusicService, 'getRadioTracks', async () => {
            requestedSources.push('youtube');
            return [];
          });
          const seeds = hasTaste
            ? [
                { ...createTrack(10001, 'Known Artist', 'soundcloud'), waveSeedWeight: 2 },
                { ...createTrack('yt_abcdefghijk', 'Known Artist', 'youtube'), waveSeedWeight: 2 },
              ]
            : [];
          const batch = await WaveEngine.getWaveBatch(mood, seeds, [], [], [], { source }, false);
          assert.ok(requestedSources.length > 0);
          assert.ok(requestedSources.every((provider) => provider === source));
          assert.ok(batch.length > 0);
          assert.ok(batch.every((track) => track.source === source));
        },
      );
    }
  }
}
test('Wave validates the source at the IPC boundary and infers legacy provider IDs', () => {
  for (const source of ['all', 'soundcloud', 'youtube'])
    assert.equal(normalizeWaveBatchContext({ source }).source, source);
  for (const source of [null, {}, 'deezer', 'unknown'])
    assert.equal(normalizeWaveSource(source), 'all');
  assert.ok(matchesWaveSource(createTrack('yt_abcdefghijk', 'Artist', undefined), 'youtube'));
  assert.ok(matchesWaveSource(createTrack(12345, 'Artist', undefined), 'soundcloud'));
});
test('Wave source survives storage round trips and falls back safely when storage is unavailable', (context) => {
  const values = new Map();
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    writable: true,
    value: {},
  });
  context.after(() => {
    if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage);
    else delete globalThis.localStorage;
  });
  globalThis.localStorage = {
    getItem: (key) => values.get(key),
    setItem: (key, value) => values.set(key, value),
  };
  saveWaveSource('youtube');
  assert.equal(readWaveSource(), 'youtube');
  saveWaveSource('soundcloud');
  assert.equal(readWaveSource(), 'soundcloud');
  globalThis.localStorage = {
    getItem() {
      throw Error('Storage disabled');
    },
    setItem() {
      throw Error('Storage disabled');
    },
  };
  assert.equal(readWaveSource(), 'all');
  assert.doesNotThrow(() => saveWaveSource('youtube'));
});
