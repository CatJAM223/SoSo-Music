import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createStreamResolveError,
  getStreamResolveFailure,
  streamHttpFailure,
} from '../src/shared/utils/streamResolveError.ts';
import { SoundCloudTransport } from '../src/desktop/main/services/soundcloudTransport.ts';
import { SoundCloudService } from '../src/desktop/main/services/soundcloud.ts';
import { YouTubeMusicTransport } from '../src/desktop/main/services/youtubeMusicTransport.ts';
import { YouTubeMusicService } from '../src/desktop/main/services/youtubeMusic.ts';
import { MusicAggregatorService } from '../src/desktop/main/services/musicAggregator.ts';

const scTrack = (id) => ({
  id,
  title: 'Temporary failure fixture',
  artist: { name: 'Fixture' },
  duration: 200,
  source: 'soundcloud',
});
const ytTrack = (id) => ({ ...scTrack('yt_' + id), source: 'youtube' });
const failureIs = (kind) => (error) => getStreamResolveFailure(error) === kind;

test('Temporary stream failures retain classification through Electron-wrapped and plain serialized errors', () => {
  for (const kind of ['network', 'timeout', 'provider', 'rate-limit']) {
    const error = createStreamResolveError(kind);
    assert.equal(
      getStreamResolveFailure(
        new Error("Error invoking remote method 'music:getFullStreamUrl': Error: " + error.message),
      ),
      kind,
    );
    assert.equal(getStreamResolveFailure({ message: error.message }), kind);
  }
  assert.equal(getStreamResolveFailure(new Error('Video unavailable')), null);
  assert.equal(streamHttpFailure(404), null);
  assert.equal(streamHttpFailure(403), null);
});

for (const [scenario, kind, status] of [
  ['offline', 'network', 0],
  ['timeout', 'timeout', 0],
  ['busy', 'provider', 503],
  ['limited', 'rate-limit', 429],
]) {
  test(
    'SoundCloud playback propagates ' +
      scenario +
      ' after bounded attempts without refreshing the public key',
    async (t) => {
      let calls = 0,
        keys = 0;
      t.mock.method(SoundCloudTransport, 'fetch', async () => {
        calls++;
        if (scenario === 'offline') throw new TypeError('fetch failed');
        if (scenario === 'timeout') throw new DOMException('deadline', 'TimeoutError');
        return new Response('', { status });
      });
      await assert.rejects(
        SoundCloudTransport.fetchJson(
          'https://api-v2.soundcloud.com/tracks/900001',
          '',
          async () => {
            keys++;
            return 'key';
          },
          false,
          true,
        ),
        failureIs(kind),
      );
      assert.equal(calls, scenario === 'limited' ? 1 : 2);
      assert.equal(keys, 0);
    },
  );
}

test('SoundCloud catalog remains best effort, missing tracks remain unavailable, and a relay can recover playback', async (t) => {
  let relay = false;
  t.mock.method(SoundCloudTransport, 'fetch', async (url) =>
    relay && url.startsWith('https://relay.invalid/')
      ? Response.json({ ok: true })
      : new Response('', { status: 404 }),
  );
  assert.equal(
    await SoundCloudTransport.fetchJson(
      'https://api-v2.soundcloud.com/tracks/900002',
      '',
      async () => '',
      false,
      true,
    ),
    null,
  );
  t.mock.method(SoundCloudTransport, 'fetch', async (url) => {
    if (relay && url.startsWith('https://relay.invalid/')) return Response.json({ ok: true });
    throw new TypeError('fetch failed');
  });
  assert.equal(
    await SoundCloudTransport.fetchJson(
      'https://api-v2.soundcloud.com/search/tracks',
      '',
      async () => '',
    ),
    null,
  );
  relay = true;
  assert.equal(
    (
      await SoundCloudTransport.fetchJson(
        'https://api-v2.soundcloud.com/tracks/900003',
        'https://relay.invalid/',
        async () => '',
        false,
        true,
      )
    ).ok,
    true,
  );
});

test('SoundCloud outage reaches aggregator and does not cache an unavailable recording', async (t) => {
  let offline = true,
    calls = 0;
  t.mock.method(SoundCloudService, 'getSoundCloudKey', async () => 'public-key');
  t.mock.method(SoundCloudTransport, 'fetch', async (url) => {
    calls++;
    if (offline) throw new TypeError('fetch failed');
    return Response.json(
      url.includes('/tracks/')
        ? {
            id: 900004,
            media: {
              transcodings: [
                {
                  url: 'https://api-v2.soundcloud.com/media/900004',
                  format: { protocol: 'progressive' },
                },
              ],
            },
          }
        : { url: 'https://cf-media.sndcdn.com/healthy.mp3' },
    );
  });
  await assert.rejects(
    MusicAggregatorService.getFullStreamUrl(scTrack(900004)),
    failureIs('network'),
  );
  offline = false;
  assert.ok(
    (await MusicAggregatorService.getFullStreamUrl(scTrack(900004))).includes('healthy.mp3'),
  );
  assert.equal(calls, 4);
});

for (const mobile of [false])
  test(
    'Desktop' +
      ' YouTube distinguishes outages from unavailable videos and avoids rate-limit retry bursts',
    async (t) => {
      let mode = 'offline',
        calls = 0;
      const id = 'desktoptmp1';
      const respond = async () => {
        calls++;
        if (mode === 'offline') throw new TypeError('fetch failed');
        if (mode === 'limited') return new Response('', { status: 429 });
        return Response.json({
          playabilityStatus: { status: 'UNPLAYABLE', reason: 'Video unavailable' },
        });
      };
      {
        t.mock.method(YouTubeMusicService, 'getVisitorData', async () => '');
        t.mock.method(YouTubeMusicService, 'search', async () => ({ data: [] }));
        t.mock.method(YouTubeMusicService, 'postInnertube', async () => ({ contents: {} }));
        t.mock.method(YouTubeMusicTransport, 'postPlayer', respond);
      }
      const resolve = () => MusicAggregatorService.getFullStreamUrl(ytTrack(id));
      await assert.rejects(resolve(), failureIs('network'));
      assert.equal(calls, 2);
      mode = 'limited';
      calls = 0;
      await assert.rejects(resolve(), failureIs('rate-limit'));
      assert.equal(calls, 1);
      mode = 'unavailable';
      calls = 0;
      assert.equal(await resolve(), '');
      assert.ok(calls <= 2);
    },
  );

for (const mobile of [false])
  test(
    'Desktop' + ' SoundCloud rejects another recording returned for the selected ID',
    async (t) => {
      const id = 900007;
      let mediaCalls = 0;
      const response = (url) => {
        if (!url.includes('/tracks/')) mediaCalls++;
        return {
          id: 900099,
          media: {
            transcodings: [
              {
                url: 'https://api-v2.soundcloud.com/media/wrong',
                format: { protocol: 'progressive' },
              },
            ],
          },
        };
      };
      {
        t.mock.method(SoundCloudService, 'getSoundCloudKey', async () => 'public-key');
        t.mock.method(SoundCloudTransport, 'fetch', async (url) => Response.json(response(url)));
      }
      assert.equal(await SoundCloudService.getFullStreamUrl(scTrack(id)), '');
      assert.equal(mediaCalls, 0);
    },
  );

for (const mobile of [false])
  test(
    'Desktop' +
      ' imported playback selects the matching recording and preserves temporary failures',
    async (t) => {
      const service = MusicAggregatorService;
      const wanted = {
        id: 'dz_' + '900020',
        title: 'Selected song',
        artist: { name: 'Selected artist' },
        duration: 180,
        source: 'deezer',
      };
      const wrong = {
        ...scTrack(900022),
        title: 'Selected song (Live)',
        artist: { name: 'Selected artist' },
        duration: 181,
      };
      const correct = {
        ...scTrack(900023),
        title: 'Selected song',
        artist: { name: 'Selected artist' },
        duration: 181,
      };
      let selected = [],
        mode = 'healthy',
        ytCalls = 0;
      {
        t.mock.method(SoundCloudService, 'search', async () => ({ data: [wrong, correct] }));
        t.mock.method(YouTubeMusicService, 'search', async () => {
          ytCalls++;
          return { data: [] };
        });
        t.mock.method(SoundCloudService, 'getFullStreamUrl', async (track, options) => {
          selected.push(String(track.id));
          assert.equal(options.forceRefresh, true);
          if (mode !== 'healthy') throw createStreamResolveError(mode);
          return 'https://cf-media.sndcdn.com/selected.mp3';
        });
      }
      assert.ok(
        (await service.getFullStreamUrl(wanted, { forceRefresh: true })).includes('/selected.mp3'),
      );
      assert.deepEqual(selected, [String(correct.id)]);
      mode = 'network';
      await assert.rejects(
        service.getFullStreamUrl(wanted, { forceRefresh: true }),
        failureIs('network'),
      );
      assert.equal(ytCalls, 1);
      mode = 'rate-limit';
      ytCalls = 0;
      await assert.rejects(
        service.getFullStreamUrl(wanted, { forceRefresh: true }),
        failureIs('rate-limit'),
      );
      assert.equal(ytCalls, 0);
    },
  );

for (const mobile of [false])
  test(
    'Desktop' + ' SoundCloud rate limit stops alternate-format and preview bursts',
    async (t) => {
      const track = { ...scTrack(900030), preview: 'https://api-v2.soundcloud.com/media/preview' };
      let mediaCalls = 0;
      const request = async (url) => {
        if (url.includes('/tracks/'))
          return {
            id: track.id,
            media: {
              transcodings: ['one', 'two', 'three'].map((name) => ({
                url: 'https://api-v2.soundcloud.com/media/' + name,
                format: { protocol: 'progressive' },
              })),
            },
          };
        mediaCalls++;
        throw createStreamResolveError('rate-limit');
      };
      {
        t.mock.method(SoundCloudService, 'getSoundCloudKey', async () => 'public-key');
        t.mock.method(SoundCloudService, 'fetchWithRelay', request);
      }
      await assert.rejects(
        SoundCloudService.getFullStreamUrl(track, { forceRefresh: true }),
        failureIs('rate-limit'),
      );
      assert.equal(mediaCalls, 1);
    },
  );
