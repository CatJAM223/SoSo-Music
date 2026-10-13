import test from 'node:test';
import assert from 'node:assert/strict';
import {
  recoverDesktopNetwork,
  setDesktopFetch,
  setDesktopNetworkRecovery,
} from '../src/desktop/main/services/desktopFetch.ts';
import { SoundCloudTransport } from '../src/desktop/main/services/soundcloudTransport.ts';
import { YouTubeMusicTransport } from '../src/desktop/main/services/youtubeMusicTransport.ts';

test('Desktop catalog providers use the same configured network transport', async () => {
  const calls = [];
  setDesktopFetch(async (url, init) => {
    calls.push({ url, init });
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  });

  try {
    await SoundCloudTransport.fetch('https://api-v2.soundcloud.com/search', {
      signal: AbortSignal.timeout(1000),
    });
    await YouTubeMusicTransport.postPlayer(
      { videoId: 'test' },
      { 'Content-Type': 'application/json' },
    );
  } finally {
    setDesktopFetch(null);
  }

  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, 'https://api-v2.soundcloud.com/search');
  assert.ok(calls[0].init.signal);
  assert.match(calls[1].url, /youtube\.com\/youtubei\/v1\/player/);
  assert.equal(calls[1].init.method, 'POST');
  assert.equal(
    calls[1].init.cache,
    'no-store',
    'Signed stream resolution must not reuse an HTTP cached response',
  );
  assert.match(calls[1].init.body, /"videoId":"test"/);
});

test('Concurrent playback retries share one network recovery and can retry a failed recovery', async () => {
  let finish;
  let count = 0;
  setDesktopNetworkRecovery(() => {
    count++;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  try {
    const first = recoverDesktopNetwork();
    const second = recoverDesktopNetwork();
    await Promise.resolve();
    assert.equal(count, 1);
    finish();
    await Promise.all([first, second]);

    setDesktopNetworkRecovery(async () => {
      throw new Error('proxy unavailable');
    });
    await assert.rejects(recoverDesktopNetwork(), /proxy unavailable/);
    setDesktopNetworkRecovery(async () => {
      count++;
    });
    await recoverDesktopNetwork();
    assert.equal(count, 2);
  } finally {
    setDesktopNetworkRecovery(null);
  }
});
