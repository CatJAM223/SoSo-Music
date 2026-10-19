import test from 'node:test';
import assert from 'node:assert/strict';
import { watchAudioStartup } from '../src/shared/utils/audioStartup.ts';
import { isSoundCloudUrl } from '../src/shared/utils/soundcloudUrl.ts';
function fixture(t) {
  const audio = new EventTarget(),
    controller = new AbortController();
  let current = true,
    failures = 0;
  const stop = watchAudioStartup(
    audio,
    () => current,
    () => failures++,
    controller.signal,
  );
  return {
    audio,
    controller,
    stop,
    stale: () => {
      current = false;
    },
    failures: () => failures,
  };
}
test('Startup times out before HLS calls play, without requiring playing/waiting events', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = fixture(t);
  t.mock.timers.tick(7999);
  assert.equal(h.failures(), 0);
  t.mock.timers.tick(1);
  assert.equal(h.failures(), 1);
  t.mock.timers.tick(60000);
  assert.equal(h.failures(), 1);
});
test('Playing, teardown and cancellation release a pending startup timeout', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const event of ['playing', 'stop', 'abort', 'pause']) {
    const h = fixture(t);
    if (event === 'playing') h.audio.dispatchEvent(new Event('playing'));
    if (event === 'stop') h.stop();
    if (event === 'abort') h.controller.abort();
    if (event === 'pause') {
      h.stale();
      h.audio.dispatchEvent(new Event('pause'));
    }
    t.mock.timers.tick(8000);
    assert.equal(h.failures(), 0, event);
    h.stop();
  }
});
test('An initial pause event cannot cancel HLS startup, while a replaced source cannot recover', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = fixture(t);
  h.audio.dispatchEvent(new Event('pause'));
  t.mock.timers.tick(8000);
  assert.equal(h.failures(), 1);
  const next = fixture(t);
  next.stale();
  t.mock.timers.tick(8000);
  assert.equal(next.failures(), 0);
});
test('SoundCloud delivery headers cover the new CDN without matching lookalike domains', () => {
  for (const host of [
    'api-v2.soundcloud.com',
    'cf-media.sndcdn.com',
    'playback.media-streaming.soundcloud.cloud',
    'soundcloud.com',
  ])
    assert.equal(isSoundCloudUrl('https://' + host + '/audio'), true);
  for (const value of [
    'https://soundcloud.cloud.evil.test/audio',
    'https://evil.test/?url=soundcloud.com',
    'https://fakesoundcloud.com/audio',
    'file:///soundcloud.com',
    'http://soundcloud.cloud/audio',
    'invalid',
  ])
    assert.equal(isSoundCloudUrl(value), false);
});
