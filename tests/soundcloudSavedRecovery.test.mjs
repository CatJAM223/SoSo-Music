import test from 'node:test';
import assert from 'node:assert/strict';
import { SoundCloudService as sc } from '../src/desktop/main/services/soundcloud.ts';
import { createStreamResolveError } from '../src/shared/utils/streamResolveError.ts';
import { runStreamResolve } from '../src/desktop/main/services/streamResolveContext.ts';
const original = {
  id: '900100',
  title: 'First constellation',
  artist: { name: 'Singer' },
  album: {},
  duration: 98,
  source: 'soundcloud',
  preview: 'https://api-v2.soundcloud.com/media/tracks:900100/stream/hls',
};
const replacement = { ...original, id: 900101, preview: '' };
function setup(t, candidates = [replacement]) {
  sc.streamCache.clear();
  sc.unavailableStreams.clear();
  sc.pendingStreams.clear();
  t.after(() => {
    sc.streamCache.clear();
    sc.unavailableStreams.clear();
    sc.pendingStreams.clear();
  });
  let searches = 0;
  const requests = [];
  t.mock.method(sc, 'getSoundCloudKey', async () => 'public-key');
  t.mock.method(sc, 'search', async () => {
    searches++;
    return { data: candidates, total: candidates.length };
  });
  t.mock.method(sc, 'fetchWithRelay', async (url, _retry, _transient, _signal, onStatus) => {
    requests.push(url);
    if (url.includes('/tracks/900100?')) {
      onStatus?.(404);
      return null;
    }
    if (url.includes('/tracks/900101?')) {
      onStatus?.(200);
      return {
        id: 900101,
        duration: 98000,
        media: {
          transcodings: [
            {
              url: 'https://api-v2.soundcloud.com/media/tracks:900101/stream/progressive',
              format: { protocol: 'progressive' },
            },
          ],
        },
      };
    }
    return { url: 'https://cdn.sndcdn.com/recovered.mp3' };
  });
  return {
    requests,
    get searches() {
      return searches;
    },
  };
}
test('SoundCloud restores a removed saved ID only through a matching public recording on SoundCloud', async (t) => {
  const f = setup(t),
    before = structuredClone(original);
  assert.equal(await sc.getFullStreamUrl(original), 'https://cdn.sndcdn.com/recovered.mp3');
  assert.deepEqual(original, before, 'Keep library identity and metadata intact');
  assert.equal(f.searches, 1);
  assert.equal(await sc.getFullStreamUrl(original), 'https://cdn.sndcdn.com/recovered.mp3');
  assert.equal(f.searches, 1, 'Reuse recovered URL during its normal lifetime');
});
test('SoundCloud recovery rejects a different artist, remix, duration, provider, or the same dead ID', async (t) => {
  const candidates = [
    { ...replacement, artist: { name: 'Other' } },
    { ...replacement, title: 'First constellation (remix)' },
    { ...replacement, duration: 160 },
    { ...replacement, source: 'youtube' },
    { ...original },
  ];
  const f = setup(t, candidates);
  assert.equal(await sc.getFullStreamUrl(original), '');
  assert.equal(f.requests.length, 1);
  assert.equal(f.searches, 1);
});
test('SoundCloud does not search around subscription restrictions, temporary failures or downloads', async (t) => {
  const f = setup(t);
  t.mock.method(sc, 'fetchWithRelay', async () => ({ id: 900100, policy: 'BLOCK' }));
  assert.equal(await sc.getFullStreamUrl({ ...original, id: '900100-block' }), '');
  assert.equal(f.searches, 0);
  t.mock.method(sc, 'fetchWithRelay', async () => {
    throw createStreamResolveError('network');
  });
  await assert.rejects(
    sc.getFullStreamUrl({ ...original, id: '900100-network' }),
    /STREAM_NETWORK_UNAVAILABLE/,
  );
  assert.equal(f.searches, 0);
  t.mock.method(sc, 'fetchWithRelay', async (_url, _retry, _transient, _signal, onStatus) => {
    onStatus?.(404);
    return null;
  });
  assert.equal(await sc.getFullStreamUrl({ ...original, forDownload: true }), '');
  assert.equal(f.searches, 0);
});
test('SoundCloud missing-ID recovery is bounded and cancelled responses cannot populate URL caches', async (t) => {
  const f = setup(t),
    controller = new AbortController();
  t.mock.method(sc, 'fetchWithRelay', async (_url, _retry, _transient, _signal, onStatus) => {
    onStatus?.(404);
    return null;
  });
  assert.equal(await sc.getFullStreamUrl(original), '');
  assert.equal(f.searches, 1, 'No recursive catalog recovery for replacement IDs');
  sc.unavailableStreams.clear();
  let finish;
  t.mock.method(
    sc,
    'search',
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = runStreamResolve(controller.signal, () => sc.getFullStreamUrl(original));
  await new Promise((r) => setImmediate(r));
  controller.abort(new DOMException('Cancelled', 'AbortError'));
  finish({ data: [replacement] });
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(sc.streamCache.has('stream:' + original.id), false);
});

test('SoundCloud recovery changes rendition of the same recording and still excludes previews', async (t) => {
  const normal = 'https://api-v2.soundcloud.com/media/tracks:900101/aac_160k';
  const alternate = 'https://api-v2.soundcloud.com/media/tracks:900101/abr_sq';
  sc.streamCache.clear();
  t.after(() => sc.streamCache.clear());
  t.mock.method(sc, 'getSoundCloudKey', async () => 'fixture-key');
  const calls = [];
  t.mock.method(sc, 'fetchWithRelay', async (url) => {
    calls.push(url);
    if (url.includes('/tracks/900101?'))
      return {
        id: 900101,
        duration: 98000,
        media: {
          transcodings: [
            { url: normal, format: { protocol: 'hls' } },
            { url: alternate, format: { protocol: 'hls' } },
            { url: alternate + '/snipped', snipped: true, format: { protocol: 'hls' } },
          ],
        },
      };
    return {
      url: url.startsWith(normal)
        ? 'https://cdn.sndcdn.com/normal.m3u8'
        : 'https://cdn.sndcdn.com/alternate.m3u8',
    };
  });
  const track = { ...replacement, id: '900101' };
  assert.equal(await sc.getFullStreamUrl(track), 'https://cdn.sndcdn.com/normal.m3u8');
  calls.length = 0;
  assert.equal(
    await sc.getFullStreamUrl(track, { forceRefresh: true, preferAlternateFormat: true }),
    'https://cdn.sndcdn.com/alternate.m3u8',
  );
  assert.ok(calls.some((url) => url.startsWith(alternate)));
  assert.ok(calls.every((url) => !url.includes('snipped') && !url.startsWith(normal)));
});
