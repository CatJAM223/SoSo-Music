import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WaveRequestScheduler,
  waveRequestKey,
} from '../src/shared/services/waveRequestScheduler.ts';
import { WaveEngine } from '../src/desktop/main/services/waveEngine.ts';
import { SoundCloudService } from '../src/desktop/main/services/soundcloud.ts';
import { YouTubeMusicService } from '../src/desktop/main/services/youtubeMusic.ts';
import { LastFmService } from '../src/desktop/main/services/lastfm.ts';

const delay = () => new Promise((resolve) => setTimeout(resolve, 1));

test('Wave request gate combines independent producers and overlapping batches into one provider limit', async () => {
  const scheduler = new WaveRequestScheduler(3);
  const batches = [scheduler.createBatch(), scheduler.createBatch()];
  let active = 0,
    peak = 0;
  const task = async () => {
    peak = Math.max(peak, ++active);
    await delay();
    active--;
    return 42;
  };
  const replies = await Promise.all(
    Array.from({ length: 24 }, (_, i) => batches[i % 2](String(i), task)),
  );
  assert.equal(peak, 3);
  assert.equal(active, 0);
  assert.equal(replies.length, 24);
});

test('One wave and overlapping waves reuse the same request, but later waves retry failed or empty results', async () => {
  const scheduler = new WaveRequestScheduler(1);
  const batch = scheduler.createBatch();
  const other = scheduler.createBatch();
  let calls = 0;
  const key = waveRequestKey('youtube', '  THE   Artist ', 8);
  assert.equal(key, waveRequestKey('youtube', 'the artist', 8));
  assert.notEqual(key, waveRequestKey('soundcloud', 'the artist', 8));
  assert.notEqual(key, waveRequestKey('youtube', 'the artist', 10));
  const task = async () => {
    calls++;
    await delay();
    throw new Error('offline');
  };
  const replies = await Promise.allSettled([batch(key, task), other(key, task), batch(key, task)]);
  assert.equal(calls, 1);
  assert.ok(replies.every((reply) => reply.status === 'rejected'));
  assert.deepEqual(
    await scheduler.createBatch()(key, async () => {
      calls++;
      return [];
    }),
    [],
  );
  assert.equal(calls, 2);
  assert.deepEqual(
    await scheduler.createBatch()(key, async () => {
      calls++;
      return ['fresh'];
    }),
    ['fresh'],
  );
  assert.equal(calls, 3);
});

test('Queue overload rejects promptly and a failed provider releases its slot for queued work', async () => {
  const scheduler = new WaveRequestScheduler(1, 1);
  const batch = scheduler.createBatch();
  let release;
  const first = batch(
    'first',
    () =>
      new Promise((resolve, reject) => {
        release = () => reject(new Error('failed'));
      }),
  );
  const next = batch('next', async () => 'ok');
  const excess = batch('excess', async () => 'should not run');
  await assert.rejects(excess, /queue is full/);
  const failed = assert.rejects(first, /failed/);
  release();
  await failed;
  assert.equal(await next, 'ok');
});

for (const mobile of [false])
  test(
    'Desktop' + ' wave bounds real search fanout to four provider tasks in every mood',
    async (t) => {
      let active = 0,
        peak = 0,
        calls = 0;
      const search = async (query, limit, source = 'soundcloud') => {
        peak = Math.max(peak, ++active);
        calls++;
        await delay();
        active--;
        return {
          data: Array.from({ length: 4 }, (_, i) => ({
            id: source + '_' + query + '_' + i,
            title: 'Melody ' + query + ' Number ' + i,
            artist: { name: query },
            source,
            duration: 180,
          })),
        };
      };
      const seeds = Array.from({ length: 9 }, (_, i) => ({
        id: 'seed' + i,
        title: 'Seed',
        artist: { name: 'Artist' + i },
        duration: 180,
        source: 'soundcloud',
      }));
      t.mock.method(LastFmService, 'getSimilarArtists', async (artist) =>
        Array.from({ length: 4 }, (_, i) => ({
          name: 'Neighbor ' + artist.slice(-1) + ' branch ' + i,
        })),
      );
      {
        t.mock.method(SoundCloudService, 'search', (q, l) => search(q, l, 'soundcloud'));
        t.mock.method(YouTubeMusicService, 'search', (q, l) => search(q, l, 'youtube'));
      }
      for (const mood of ['default', 'energy', 'chill', 'discover', 'mix', 'favorites']) {
        peak = 0;
        calls = 0;
        const tracks = await WaveEngine.getWaveBatch(mood, seeds);
        assert.ok(calls >= 8, mood + ' exercised a meaningful burst');
        assert.ok(peak <= 4, mood + ' peak was ' + peak);
        assert.equal(active, 0);
        assert.ok(tracks.length >= 10, mood + ' retains a useful candidate pool');
      }
    },
  );

for (const mobile of [false])
  test(
    'Desktop' + ' discovery does not mislabel familiar artist collaborations as new musicians',
    async (t) => {
      const seeds = [
        {
          id: 'seed',
          title: 'Old favorite',
          artist: { name: 'Known Artist' },
          duration: 180,
          source: 'soundcloud',
        },
      ];
      const collab = {
        id: 'collab',
        title: 'Fresh collaboration',
        artist: { name: 'Known Artist & Guest' },
        duration: 180,
        source: 'soundcloud',
      };
      const fresh = {
        id: 'fresh',
        title: 'Entirely unfamiliar music',
        artist: { name: 'New Musician' },
        duration: 180,
        source: 'soundcloud',
      };
      const search = async (query) => ({ data: query.endsWith(' similar') ? [collab, fresh] : [] });
      t.mock.method(LastFmService, 'getSimilarArtists', async () => []);
      {
        t.mock.method(SoundCloudService, 'search', search);
        t.mock.method(YouTubeMusicService, 'search', async () => ({ data: [] }));
      }
      const tracks = await WaveEngine.getWaveBatch('discover', seeds);
      assert.ok(tracks.some((track) => track.id === 'fresh'));
      assert.ok(tracks.every((track) => track.id !== 'collab'));
    },
  );
