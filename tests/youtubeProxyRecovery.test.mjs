import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { YouTubeMusicService } from '../src/desktop/main/services/youtubeMusic.ts';
import { YouTubeMusicTransport } from '../src/desktop/main/services/youtubeMusicTransport.ts';
import {
  setDesktopNetworkRecovery,
  recoverDesktopNetwork,
} from '../src/desktop/main/services/desktopFetch.ts';
import { describeYouTubeMediaRequest } from '../src/desktop/main/services/youtubeNetworkDiagnostics.ts';

test('YouTube playback recovery refreshes one rejected track while retaining healthy prefetches and visitor data', async (t) => {
  const events = [];
  const original = {
    streamCache: YouTubeMusicService.streamCache,
    videoStreamCache: YouTubeMusicService.videoStreamCache,
    cachedVisitorData: YouTubeMusicService.cachedVisitorData,
    audioStreamRequests: YouTubeMusicService.audioStreamRequests,
    audioAccessFailures: YouTubeMusicService.audioAccessFailures,
  };
  YouTubeMusicService.streamCache = new Map([
    [
      'proxytrack01',
      { url: 'https://old.googlevideo.com/videoplayback', expiresAt: Date.now() + 60000 },
    ],
    [
      'proxytrack02',
      { url: 'https://old.googlevideo.com/prefetched', expiresAt: Date.now() + 60000 },
    ],
  ]);
  YouTubeMusicService.videoStreamCache = new Map([
    ['proxytrack01', { url: 'old-video', expiresAt: Date.now() + 60000 }],
    ['proxytrack02', { url: 'healthy-video', expiresAt: Date.now() + 60000 }],
  ]);
  const visitor = { visitorData: 'healthy-visitor', expiresAt: Date.now() + 60000 };
  YouTubeMusicService.cachedVisitorData = visitor;
  YouTubeMusicService.audioStreamRequests = new Map();
  YouTubeMusicService.audioAccessFailures = new Map();
  setDesktopNetworkRecovery(async () => events.push('proxy-reloaded'));
  t.mock.method(YouTubeMusicTransport, 'fetch', async () =>
    assert.fail('Healthy visitor data must be reused'),
  );
  t.mock.method(YouTubeMusicTransport, 'postPlayer', async (payload, headers) => {
    events.push('player-resolved');
    assert.equal(payload.context.client.visitorData, 'healthy-visitor');
    assert.equal(headers['X-Goog-Visitor-Id'], 'healthy-visitor');
    assert.equal(
      YouTubeMusicService.streamCache.get('proxytrack02').url,
      'https://old.googlevideo.com/prefetched',
    );
    assert.equal(YouTubeMusicService.videoStreamCache.get('proxytrack02').url, 'healthy-video');
    assert.equal(YouTubeMusicService.videoStreamCache.has('proxytrack01'), false);
    return Response.json({
      playabilityStatus: { status: 'OK' },
      streamingData: {
        adaptiveFormats: [
          {
            itag: 140,
            mimeType: 'audio/mp4',
            bitrate: 128000,
            url: 'https://new.googlevideo.com/videoplayback?itag=140',
          },
        ],
      },
    });
  });
  try {
    assert.equal(
      await YouTubeMusicService.resolveDirectAudioStream('proxytrack01'),
      'https://old.googlevideo.com/videoplayback',
    );
    assert.deepEqual(events, []);
    const fresh = await YouTubeMusicService.resolveDirectAudioStream('proxytrack01', false, true);
    assert.equal(fresh, 'https://new.googlevideo.com/videoplayback?itag=140');
    assert.deepEqual(events, ['proxy-reloaded', 'player-resolved']);
    assert.equal(YouTubeMusicService.cachedVisitorData, visitor);
    assert.equal(
      await YouTubeMusicService.resolveDirectAudioStream('proxytrack02'),
      'https://old.googlevideo.com/prefetched',
    );
    assert.equal(await YouTubeMusicService.resolveDirectAudioStream('proxytrack01'), fresh);
    assert.equal(events.length, 2);
  } finally {
    Object.assign(YouTubeMusicService, original);
    setDesktopNetworkRecovery(null);
  }
});

test('Concurrent production proxy refreshes share one operation and never close active media connections', async () => {
  const source = fs.readFileSync(new URL('../src/desktop/main/index.ts', import.meta.url), 'utf8');
  const start = source.indexOf('  setDesktopNetworkRecovery(async () => {');
  const end = source.indexOf('\n  });', start) + '\n  });'.length;
  assert.ok(start >= 0 && end > start);
  let refreshes = 0,
    closes = 0,
    release;
  const pending = new Promise((resolve) => (release = resolve));
  vm.runInNewContext(source.slice(start, end), {
    setDesktopNetworkRecovery,
    session: {
      defaultSession: {
        forceReloadProxyConfig: async () => {
          refreshes++;
          await pending;
        },
        closeAllConnections: async () => {
          closes++;
        },
      },
    },
    PlaybackLogger: { debug() {} },
  });
  try {
    const first = recoverDesktopNetwork(),
      second = recoverDesktopNetwork();
    await Promise.resolve();
    assert.equal(first, second);
    assert.equal(refreshes, 1);
    assert.equal(closes, 0);
    release();
    await Promise.all([first, second]);
    await recoverDesktopNetwork();
    assert.equal(refreshes, 2);
    assert.equal(closes, 0);
  } finally {
    release();
    setDesktopNetworkRecovery(null);
  }
});

test('CDN diagnostics retain the server and format without signed parameters or credentials', () => {
  assert.equal(
    describeYouTubeMediaRequest(
      'https://user:password@rr3.googlevideo.com/private-path?itag=140&ip=203.0.113.1&sig=secret&visitor=private',
    ),
    'https://rr3.googlevideo.com/videoplayback (itag=140)',
  );
  assert.equal(
    describeYouTubeMediaRequest('https://rr3.googlevideo.com/videoplayback?itag=secret'),
    'https://rr3.googlevideo.com/videoplayback',
  );
  for (const url of [
    'broken',
    'https://googlevideo.com.attacker.test/x',
    'https://example.test/?host=googlevideo.com',
    'file:///googlevideo.com',
  ])
    assert.equal(describeYouTubeMediaRequest(url), null);
});
test('A second YouTube format recovery renews visitor data while leaving other tracks cached', async (t) => {
  const fields = [
    'streamCache',
    'videoStreamCache',
    'cachedVisitorData',
    'audioStreamRequests',
    'audioAccessFailures',
  ];
  const previous = Object.fromEntries(fields.map((key) => [key, YouTubeMusicService[key]]));
  const untouched = { url: 'https://rr1.googlevideo.com/healthy', expiresAt: Date.now() + 60000 };
  YouTubeMusicService.streamCache = new Map([['untouched', untouched]]);
  YouTubeMusicService.videoStreamCache = new Map();
  YouTubeMusicService.audioStreamRequests = new Map();
  YouTubeMusicService.audioAccessFailures = new Map();
  const forces = [];
  t.mock.method(YouTubeMusicService, 'getVisitorData', async (force) => {
    forces.push(force);
    return force ? 'renewed' : 'existing';
  });
  t.mock.method(YouTubeMusicTransport, 'postPlayer', async (payload) => {
    assert.equal(payload.context.client.visitorData, forces.at(-1) ? 'renewed' : 'existing');
    return Response.json({
      playabilityStatus: { status: 'OK' },
      streamingData: {
        adaptiveFormats: [
          {
            itag: 140,
            mimeType: 'audio/mp4',
            bitrate: 128000,
            url: 'https://rr1.googlevideo.com/videoplayback?itag=140',
          },
          {
            itag: 251,
            mimeType: 'audio/webm',
            bitrate: 160000,
            url: 'https://rr1.googlevideo.com/videoplayback?itag=251',
          },
        ],
      },
    });
  });
  try {
    await YouTubeMusicService.resolveDirectAudioStream('recovery001', false, true);
    const alternate = await YouTubeMusicService.resolveDirectAudioStream(
      'recovery001',
      false,
      true,
      { preferAlternateFormat: true, excludeItag: 140 },
    );
    assert.deepEqual(forces, [false, true]);
    assert.ok(alternate.includes('itag=251'));
    assert.equal(YouTubeMusicService.streamCache.get('untouched'), untouched);
  } finally {
    Object.assign(YouTubeMusicService, previous);
  }
});
