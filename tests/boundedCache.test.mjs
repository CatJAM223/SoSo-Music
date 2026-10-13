import test from 'node:test';
import assert from 'node:assert/strict';
import { BoundedMap, BoundedSet } from '../src/shared/utils/boundedCache.ts';
import { YouTubeMusicService } from '../src/desktop/main/services/youtubeMusic.ts';

test('Transient cache stays bounded after 20,000 tracks and keeps frequently read entries', () => {
  const cache = new BoundedMap(128),
    rejected = new BoundedSet(128);
  cache.set('playing', 1);
  for (let i = 0; i < 20000; i++) {
    assert.equal(cache.get('playing'), 1);
    cache.set('track-' + i, i);
    rejected.add('track-' + i);
  }
  assert.equal(cache.size, 128);
  assert.equal(rejected.size, 128);
  assert.equal(cache.get('track-0'), undefined);
  assert.equal(cache.get('track-19999'), 19999);
  assert.equal(rejected.has('track-0'), false);
  assert.equal(rejected.has('track-19999'), true);
});
test('Expired stream links are removed on access and before capacity eviction', () => {
  let now = 0;
  const cache = new BoundedMap(
    3,
    (item) => item.expiresAt,
    () => now,
  );
  cache.set('stale', { expiresAt: 10 });
  cache.set('fresh', { expiresAt: 100 });
  now = 11;
  assert.equal(cache.get('stale'), undefined);
  cache.set('new', { expiresAt: 100 });
  assert.equal(cache.size, 2);
  assert.ok(cache.get('fresh'));
  now = 100;
  cache.set('last', { expiresAt: 200 });
  assert.deepEqual([...cache.keys()], ['last']);
});
test('YouTube production metadata caches do not retain a whole long-session catalogue', () => {
  YouTubeMusicService.invalidateSessionCaches();
  for (let i = 0; i < 5000; i++) {
    YouTubeMusicService.streamCache.set(String(i), {
      url: 'https://fixture.invalid/' + i,
      expiresAt: Date.now() + 60000,
      via: 'account',
    });
    YouTubeMusicService.videoStreamCache.set(String(i), {
      url: 'https://fixture.invalid/' + i,
      expiresAt: Date.now() + 60000,
    });
    YouTubeMusicService.videoDurationCache.set(String(i), 180);
  }
  assert.equal(YouTubeMusicService.streamCache.size, 128);
  assert.equal(YouTubeMusicService.videoStreamCache.size, 128);
  assert.equal(YouTubeMusicService.videoDurationCache.size, 1000);
  assert.deepEqual(YouTubeMusicService.getStreamRoute('4999'), { via: 'account', client: 'WEB' });
  assert.equal(YouTubeMusicService.getVideoDuration('4999'), 180);
  YouTubeMusicService.invalidateSessionCaches();
});
