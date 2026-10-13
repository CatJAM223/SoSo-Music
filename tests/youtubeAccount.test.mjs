import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseYouTubeCookieFile,
  buildYouTubeCookieHeader,
  isYouTubeCookieDomain,
} from '../src/desktop/main/services/youtubeAccountCookies.ts';
import {
  extractYouTubeAccountStream,
  selectYouTubeHlsAudio,
  isYouTubeStreamUrl,
} from '../src/desktop/main/services/youtubeAccountStream.ts';
import { YouTubeMusicService as yt } from '../src/desktop/main/services/youtubeMusic.ts';
import { YouTubeMusicTransport as transport } from '../src/desktop/main/services/youtubeMusicTransport.ts';
import { setYouTubeSessionReset } from '../src/desktop/main/services/desktopFetch.ts';
import {
  YOUTUBE_AUDIO_BOT_CHECK,
  YOUTUBE_AUDIO_AGE_RESTRICTED,
} from '../src/shared/utils/youtubeAudioAccessError.ts';

const cookie = (name, value = 'test-value', extra = {}) => ({
  name,
  value,
  domain: '.youtube.com',
  path: '/',
  secure: true,
  ...extra,
});
test('YouTube account import: scopes a multi-site export to YouTube and supports secure authentication cookies', () => {
  const text = JSON.stringify([
    cookie('__Secure-3PAPISID'),
    cookie('__Secure-3PSID'),
    cookie('evil-secret', 'x', { domain: '.google.com' }),
    cookie('lookalike', 'x', { domain: 'youtube.com.evil.test' }),
  ]);
  const result = parseYouTubeCookieFile(text);
  assert.equal(result.length, 2);
  const header = buildYouTubeCookieHeader(result);
  assert.ok(header.includes('SAPISID=test-value'));
  assert.ok(!header.includes('evil-secret'));
  assert.equal(isYouTubeCookieDomain('.music.youtube.com'), true);
  assert.equal(isYouTubeCookieDomain('evilyoutube.com'), false);
});

test('YouTube account import: Netscape HttpOnly and session expiry survive parsing', () => {
  const text =
    '# Netscape HTTP Cookie File\n#HttpOnly_.youtube.com\tTRUE\t/\tTRUE\t0\tSAPISID\tsecret-a\n.youtube.com\tTRUE\t/\tTRUE\t2000\tSID\tsecret-b\n';
  const result = parseYouTubeCookieFile(
    text.replaceAll('\\\n', '\n').replaceAll('\\\t', '\t'),
    1000,
  );
  assert.equal(result.length, 2);
  assert.equal(result[0].httpOnly, true);
  assert.equal(result[1].expirationDate, 2000);
  assert.equal(result[0].expirationDate, undefined);
});

test('YouTube account import: malformed, expired, anonymous and oversized exports are rejected before replacing a session', () => {
  assert.throws(() =>
    parseYouTubeCookieFile(
      JSON.stringify([cookie('SAPISID'), cookie('SID', 'x', { expirationDate: 500 })]),
      1000,
    ),
  );
  assert.throws(() => parseYouTubeCookieFile(JSON.stringify([cookie('VISITOR_INFO1_LIVE')])));
  assert.throws(() =>
    parseYouTubeCookieFile(JSON.stringify([cookie('SAPISID', 'x; injected=yes'), cookie('SID')])),
  );
  assert.throws(() =>
    parseYouTubeCookieFile(
      JSON.stringify([cookie('SAPISID', 'x', { expirationDate: 'tomorrow' }), cookie('SID')]),
    ),
  );
  assert.throws(() => parseYouTubeCookieFile('x'.repeat(256 * 1024 + 1)));
  assert.equal(
    buildYouTubeCookieHeader([cookie('SAPISID', 'a', { expirationDate: 5 }), cookie('SID')], 10),
    '',
  );
});

const master =
  'https://manifest.googlevideo.com/api/manifest/hls_playlist/id/demo/playlist/index.m3u8';
test('Authenticated HLS chooses audio-only 128k and rejects video variants or unrelated hosts', () => {
  const manifest = [
    '#EXTM3U',
    '#EXT-X-STREAM-INF:BANDWIDTH=64000,CODECS="mp4a.40.2"',
    'https://manifest.googlevideo.com/api/manifest/hls_playlist/itag/233/playlist/index.m3u8',
    '#EXT-X-STREAM-INF:BANDWIDTH=220000,CODECS="avc1.4d401e,mp4a.40.2",RESOLUTION=640x360',
    'https://manifest.googlevideo.com/video/index.m3u8',
    '#EXT-X-STREAM-INF:BANDWIDTH=128000,CODECS="mp4a.40.2"',
    'https://manifest.googlevideo.com/api/manifest/hls_playlist/itag/234/playlist/index.m3u8',
  ]
    .join('\n')
    .replaceAll('\\\n', '\n');
  assert.ok(selectYouTubeHlsAudio(manifest, master).includes('/itag/234/'));
  assert.equal(
    selectYouTubeHlsAudio(
      '#EXT-X-MEDIA:TYPE=AUDIO,DEFAULT=YES,URI="https://evil.test/file.m3u8"',
      master,
    ),
    '',
  );
  assert.equal(isYouTubeStreamUrl('https://googlevideo.com.evil.test/audio'), false);
  assert.equal(isYouTubeStreamUrl('http://rr1.googlevideo.com/audio'), false);
  assert.equal(isYouTubeStreamUrl('https://user:secret@rr1.googlevideo.com/audio'), false);
});

test('Authenticated HLS preserves the default original rendition over a secondary audio track', () => {
  const manifest =
    '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,DEFAULT=NO,URI="https://manifest.googlevideo.com/dub/itag/234/index.m3u8"\n#EXT-X-MEDIA:TYPE=AUDIO,DEFAULT=YES,URI="https://manifest.googlevideo.com/original/itag/233/index.m3u8"'.replaceAll(
      '\\\n',
      '\n',
    );
  assert.ok(selectYouTubeHlsAudio(manifest, master).includes('/original/'));
});
const basic = {
  basic_info: { id: 'W0LiTBNjJ_o', duration: 106 },
  playability_status: { status: 'OK' },
  player_config: { audio_config: { loudness_db: 5.5 } },
};
test('Authenticated playback deciphers HLS, returns only audio and retains duration and loudness', async () => {
  let deciphered = 0,
    downloads = 0;
  const result = await extractYouTubeAccountStream(
    'W0LiTBNjJ_o',
    {
      ...basic,
      streaming_data: {
        hls_manifest_url: master,
        adaptive_formats: [
          {
            url: 'https://rr1.googlevideo.com/videoplayback',
            itag: 140,
            bitrate: 128000,
            mime_type: 'audio/mp4',
            has_audio: true,
            has_video: false,
            decipher: async () => assert.fail('Safari HLS should precede web GVS formats'),
          },
        ],
      },
    },
    {
      decipher: async (url) => {
        deciphered++;
        return url + '?decoded=yes';
      },
    },
    async (url) => {
      downloads++;
      assert.ok(url.includes('decoded=yes'));
      return '#EXT-X-MEDIA:TYPE=AUDIO,DEFAULT=YES,URI="https://manifest.googlevideo.com/audio/playlist/index.m3u8"';
    },
  );
  assert.equal(result.url, 'https://manifest.googlevideo.com/audio/playlist/index.m3u8');
  assert.equal(result.duration, 106);
  assert.equal(result.gainDb, -5.5);
  assert.equal(deciphered, 1);
  assert.equal(downloads, 1);
});

test('Authenticated playback never replaces the requested recording and preserves access errors', async () => {
  await assert.rejects(
    extractYouTubeAccountStream('other-id', basic, undefined, async () => ''),
    /another recording/,
  );
  await assert.rejects(
    extractYouTubeAccountStream(
      'W0LiTBNjJ_o',
      {
        ...basic,
        playability_status: {
          status: 'LOGIN_REQUIRED',
          reason: 'Sign in to confirm you’re not a bot',
        },
      },
      undefined,
      async () => '',
    ),
    { message: YOUTUBE_AUDIO_BOT_CHECK },
  );
  await assert.rejects(
    extractYouTubeAccountStream(
      'W0LiTBNjJ_o',
      { ...basic, streaming_data: { hls_manifest_url: master } },
      undefined,
      async () =>
        '#EXTM3U\n#EXT-X-STREAM-INF:RESOLUTION=1280x720,CODECS="avc1"\nhttps://manifest.googlevideo.com/video.m3u8',
    ),
    /аудиопоток/,
  );
});

function isolate(t) {
  const fields = [
    'streamCache',
    'videoStreamCache',
    'videoDurationCache',
    'searchCache',
    'audioStreamRequests',
    'playerStreamRequests',
    'playerStreamOptions',
    'audioAccessFailures',
    'cachedVisitorData',
    'visitorDataRequest',
    'sessionEpoch',
    'sessionRecoveryRequest',
    'lastSessionRecoveryAt',
    'accountResolver',
    'recordingGain',
  ];
  const previous = Object.fromEntries(fields.map((field) => [field, yt[field]]));
  for (const field of fields) if (previous[field] instanceof Map) yt[field] = new Map();
  Object.assign(yt, {
    accountResolver: null,
    cachedVisitorData: null,
    visitorDataRequest: null,
    sessionEpoch: 0,
    sessionRecoveryRequest: null,
    lastSessionRecoveryAt: -Infinity,
  });
  t.after(() => {
    Object.assign(yt, previous);
    setYouTubeSessionReset(null);
  });
}
test('Connecting YouTube removes a cached anonymous denial; playback and prefetch share account resolution', async (t) => {
  isolate(t);
  yt.audioAccessFailures.set('W0LiTBNjJ_o', {
    code: YOUTUBE_AUDIO_BOT_CHECK,
    expiresAt: Date.now() + 30000,
  });
  let requests = 0;
  yt.setAccountResolver(async (id) => {
    requests++;
    assert.equal(id, 'W0LiTBNjJ_o');
    await new Promise((resolve) => setTimeout(resolve, 5));
    return { url: 'https://rr1.googlevideo.com/videoplayback?itag=140', duration: 106, gainDb: -3 };
  });
  t.mock.method(transport, 'postPlayer', async () =>
    assert.fail('Connected accounts must use the authenticated resolver'),
  );
  const urls = await Promise.all([
    yt.resolveDirectAudioStream('yt_W0LiTBNjJ_o'),
    yt.resolveDirectAudioStream('W0LiTBNjJ_o', false, false, { allowSessionRecovery: true }),
  ]);
  assert.equal(requests, 1);
  assert.equal(urls[0], urls[1]);
  assert.equal(yt.getVideoDuration('W0LiTBNjJ_o'), 106);
  assert.equal(yt.getRecordingGain('W0LiTBNjJ_o'), -3);
  assert.deepEqual(yt.getStreamRoute('yt_W0LiTBNjJ_o'), { via: 'account', client: 'WEB' });
  assert.equal(await yt.resolveDirectAudioStream('W0LiTBNjJ_o'), urls[0]);
  assert.equal(requests, 1);
});

test('Anonymous YouTube continues using VisionOS when there is no connected account', async (t) => {
  isolate(t);
  yt.setAccountResolver(async () => null);
  t.mock.method(yt, 'getVisitorData', async () => '');
  let posts = 0;
  t.mock.method(transport, 'postPlayer', async (payload) => {
    posts++;
    assert.equal(payload.context.client.clientName, 'VISIONOS');
    return Response.json({
      playabilityStatus: { status: 'OK' },
      streamingData: {
        adaptiveFormats: [
          {
            itag: 140,
            mimeType: 'audio/mp4',
            url: 'https://rr1.googlevideo.com/videoplayback?itag=140',
          },
        ],
      },
    });
  });
  assert.ok((await yt.resolveDirectAudioStream('W0LiTBNjJ_o')).includes('googlevideo.com'));
  assert.equal(posts, 1);
});

test('Account and anonymous bot denials get only one reset and retry, then a cached error', async (t) => {
  isolate(t);
  let attempts = 0,
    resets = 0;
  yt.setAccountResolver(async () => {
    attempts++;
    throw new Error(YOUTUBE_AUDIO_BOT_CHECK);
  });
  setYouTubeSessionReset(async () => resets++);
  t.mock.method(yt, 'getVisitorData', async () => '');
  t.mock.method(transport, 'postPlayer', async () =>
    Response.json({
      playabilityStatus: {
        status: 'LOGIN_REQUIRED',
        reason: 'Sign in to confirm you are not a bot',
      },
    }),
  );
  await assert.rejects(
    yt.resolveDirectAudioStream('W0LiTBNjJ_o', false, false, { allowSessionRecovery: true }),
    { message: YOUTUBE_AUDIO_BOT_CHECK },
  );
  assert.equal(attempts, 2);
  assert.equal(resets, 1);
  await assert.rejects(yt.resolveDirectAudioStream('W0LiTBNjJ_o'), {
    message: YOUTUBE_AUDIO_BOT_CHECK,
  });
  assert.equal(attempts, 2);
});

test('Disconnecting YouTube invalidates a pending authenticated URL', async (t) => {
  isolate(t);
  let finish;
  yt.setAccountResolver(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = yt.resolveDirectAudioStream('W0LiTBNjJ_o');
  await new Promise((resolve) => setImmediate(resolve));
  yt.setAccountResolver(async () => null);
  finish({ url: 'https://rr1.googlevideo.com/videoplayback?old=1' });
  await assert.rejects(pending, /YOUTUBE_AUDIO_LOGIN_REQUIRED/);
  assert.equal(yt.streamCache.size, 0);
});

test('An unfinished account does not block an available anonymous stream of the same recording', async (t) => {
  isolate(t);
  let accountCalls = 0,
    posts = 0;
  yt.setAccountResolver(async () => {
    accountCalls++;
    throw new Error('Incomplete session');
  });
  t.mock.method(yt, 'getVisitorData', async () => '');
  t.mock.method(transport, 'postPlayer', async (payload) => {
    posts++;
    assert.equal(payload.videoId, 'W0LiTBNjJ_o');
    return Response.json({
      playabilityStatus: { status: 'OK' },
      videoDetails: { lengthSeconds: '106' },
      streamingData: {
        adaptiveFormats: [
          {
            itag: 140,
            mimeType: 'audio/mp4',
            url: 'https://rr1.googlevideo.com/videoplayback?itag=140',
          },
        ],
      },
    });
  });
  const stream = await yt.resolveDirectAudioStream('W0LiTBNjJ_o', false, false, {
    allowSessionRecovery: true,
  });
  assert.ok(stream.includes('itag=140'));
  assert.equal(accountCalls, 1);
  assert.equal(posts, 1);
  assert.equal(yt.getVideoDuration('W0LiTBNjJ_o'), 106);
  assert.equal(yt.audioAccessFailures.size, 0);
  assert.deepEqual(yt.getStreamRoute('W0LiTBNjJ_o'), { via: 'anonymous', client: 'VISIONOS' });
  assert.equal(await yt.resolveDirectAudioStream('W0LiTBNjJ_o'), stream);
  assert.equal(accountCalls, 1);
});

test('Account bot denial does not poison an available anonymous stream', async (t) => {
  isolate(t);
  let resets = 0;
  yt.setAccountResolver(async () => {
    throw new Error(YOUTUBE_AUDIO_BOT_CHECK);
  });
  setYouTubeSessionReset(async () => resets++);
  t.mock.method(yt, 'getVisitorData', async () => '');
  t.mock.method(transport, 'postPlayer', async () =>
    Response.json({
      playabilityStatus: { status: 'OK' },
      streamingData: {
        adaptiveFormats: [
          {
            itag: 140,
            mimeType: 'audio/mp4',
            url: 'https://rr1.googlevideo.com/videoplayback?itag=140',
          },
        ],
      },
    }),
  );
  assert.ok(
    (
      await yt.resolveDirectAudioStream('W0LiTBNjJ_o', false, false, { allowSessionRecovery: true })
    ).includes('itag=140'),
  );
  assert.equal(resets, 0);
  assert.equal(yt.audioAccessFailures.size, 0);
});

test('An account age restriction remains an explicit error without anonymous fallback', async (t) => {
  isolate(t);
  yt.setAccountResolver(async () => {
    throw new Error(YOUTUBE_AUDIO_AGE_RESTRICTED);
  });
  t.mock.method(transport, 'postPlayer', async () =>
    assert.fail('An age restriction must not attempt anonymous fallback'),
  );
  await assert.rejects(yt.resolveDirectAudioStream('W0LiTBNjJ_o'), {
    message: YOUTUBE_AUDIO_AGE_RESTRICTED,
  });
});

test('A rejected account request after a session change cannot start anonymous playback', async (t) => {
  isolate(t);
  let reject;
  yt.setAccountResolver(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  t.mock.method(transport, 'postPlayer', async () => assert.fail('A stale request must stop'));
  const pending = yt.resolveDirectAudioStream('W0LiTBNjJ_o');
  await new Promise((resolve) => setImmediate(resolve));
  yt.setAccountResolver(async () => null);
  reject(new Error('Old session failed'));
  await assert.rejects(pending, /YOUTUBE_AUDIO_LOGIN_REQUIRED/);
  assert.equal(yt.streamCache.size, 0);
});

test('Route diagnostics preserve the resolver through URL cache hits and never contain cookies or signed URLs', async (t) => {
  isolate(t);
  const logs = [];
  const { PlaybackLogger } = await import('../src/desktop/main/services/playbackLogger.ts');
  t.mock.method(PlaybackLogger, 'info', (message) => logs.push(message));
  yt.setAccountResolver(async () => ({
    url: 'https://rr1.googlevideo.com/videoplayback?token=secret',
    duration: 106,
  }));
  await yt.resolveDirectAudioStream('W0LiTBNjJ_o');
  await yt.resolveDirectAudioStream('W0LiTBNjJ_o');
  const routes = logs.filter((x) => x.startsWith('[YouTubeMusic:Route]'));
  assert.equal(routes.length, 2);
  assert.match(routes[0], /via=account client=WEB urlCache=miss/);
  assert.match(routes[1], /via=account client=WEB urlCache=hit/);
  assert.ok(!routes.join(' ').includes('secret'));
  assert.ok(!routes.join(' ').includes('https:'));
  yt.invalidateSessionCaches();
  assert.equal(yt.getStreamRoute('W0LiTBNjJ_o'), undefined);
});

test('Real YouTube.js Format retains its prototype and private signature cache when selected', async () => {
  const { default: Format } =
    await import('../node_modules/youtubei.js/dist/src/parser/classes/misc/Format.js');
  const cache = new Map([['n-input', 'n-decoded']]);
  const format = new Format(
    {
      itag: 140,
      mimeType: 'audio/mp4; codecs="mp4a.40.2"',
      bitrate: 128000,
      audioQuality: 'AUDIO_QUALITY_MEDIUM',
      url: 'https://rr1.googlevideo.com/videoplayback?itag=140&n=n-input',
    },
    cache,
  );
  assert.equal(Object.hasOwn(format, 'decipher'), false);
  let called = 0;
  const player = {
    decipher: async (url, _signature, _cipher, responseCache) => {
      called++;
      assert.equal(responseCache, cache);
      return url.replace('n-input', responseCache.get('n-input'));
    },
  };
  const stream = await extractYouTubeAccountStream(
    'W0LiTBNjJ_o',
    { ...basic, streaming_data: { adaptive_formats: [format] } },
    player,
    async () => assert.fail(),
  );
  assert.match(stream.url, /n=n-decoded/);
  assert.equal(stream.duration, 106);
  assert.equal(called, 1);
});

test('Authenticated clips select video HLS and preserve real video Format methods and access restrictions', async () => {
  const { extractYouTubeAccountVideo, selectYouTubeHlsVideo } =
    await import('../src/desktop/main/services/youtubeAccountStream.ts');
  const { default: Format } =
    await import('../node_modules/youtubei.js/dist/src/parser/classes/misc/Format.js');
  const base = 'https://rr1.googlevideo.com/manifest/hls_playlist/master.m3u8';
  const manifest =
    '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=40000,CODECS="mp4a.40.2"\naudio.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=500000,RESOLUTION=640x360\n360.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=1200000,RESOLUTION=1280x720\n720.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=2400000,RESOLUTION=1920x1080\n1080.m3u8';
  assert.equal(
    selectYouTubeHlsVideo(manifest, base),
    'https://rr1.googlevideo.com/manifest/hls_playlist/720.m3u8',
  );
  const hls = await extractYouTubeAccountVideo(
    'W0LiTBNjJ_o',
    { ...basic, streaming_data: { hls_manifest_url: base } },
    undefined,
    async () => manifest,
  );
  assert.match(hls.url, /720.m3u8$/);
  const format = new Format(
    {
      itag: 136,
      mimeType: 'video/mp4',
      qualityLabel: '720p',
      height: 720,
      bitrate: 1000000,
      url: 'https://rr1.googlevideo.com/videoplayback?itag=136',
    },
    new Map(),
  );
  const direct = await extractYouTubeAccountVideo(
    'W0LiTBNjJ_o',
    { ...basic, streaming_data: { adaptive_formats: [format] } },
    undefined,
    async () => assert.fail(),
  );
  assert.match(direct.url, /itag=136/);
  await assert.rejects(
    extractYouTubeAccountVideo(
      'W0LiTBNjJ_o',
      {
        ...basic,
        playability_status: { status: 'LOGIN_REQUIRED', reason: 'Sign in to confirm your age' },
      },
      undefined,
      async () => assert.fail(),
    ),
    /YOUTUBE_AUDIO_AGE_RESTRICTED/,
  );
});

test('SABR format descriptions without an address never enter the decipherer', async () => {
  const { default: Format } =
    await import('../node_modules/youtubei.js/dist/src/parser/classes/misc/Format.js');
  const format = new Format({
    itag: 140,
    mimeType: 'audio/mp4',
    audioQuality: 'AUDIO_QUALITY_MEDIUM',
    bitrate: 128000,
  });
  await assert.rejects(
    extractYouTubeAccountStream(
      'W0LiTBNjJ_o',
      { ...basic, streaming_data: { adaptive_formats: [format] } },
      { decipher: async () => assert.fail('There is no URL to decipher') },
      async () => assert.fail(),
    ),
    /поддерживаемый аудиопоток/,
  );
});

test('Signed HLS with only combined audio+video selects the smallest rendition, rejecting video-only and foreign hosts', async () => {
  const manifest = [
    '#EXTM3U',
    '#EXT-X-STREAM-INF:BANDWIDTH=900000,RESOLUTION=1280x720,CODECS="avc1.4d401f,mp4a.40.2"',
    '720.m3u8',
    '#EXT-X-STREAM-INF:BANDWIDTH=160000,RESOLUTION=256x144,CODECS="avc1.4d401e,mp4a.40.2"',
    '144.m3u8',
    '#EXT-X-STREAM-INF:BANDWIDTH=10000,RESOLUTION=128x72,CODECS="avc1.4d401e"',
    'video-only.m3u8',
    '#EXT-X-STREAM-INF:BANDWIDTH=10000,RESOLUTION=128x72,CODECS="avc1.4d401e,mp4a.40.2"',
    'https://evil.test/audio.m3u8',
  ].join('\n');
  const stream = await extractYouTubeAccountStream(
    'W0LiTBNjJ_o',
    { ...basic, streaming_data: { hls_manifest_url: master } },
    undefined,
    async () => manifest,
  );
  assert.ok(stream.url.endsWith('/144.m3u8'));
  assert.equal(stream.audioIncludesVideo, true);
  assert.equal(stream.gainDb, -5.5);
  // A direct audio rendition remains preferable to downloading combined video.
  const format = {
    url: 'https://rr1.googlevideo.com/audio',
    itag: 140,
    bitrate: 128000,
    mime_type: 'audio/mp4',
    has_audio: true,
    has_video: false,
    decipher: async () => 'https://rr1.googlevideo.com/audio',
  };
  const direct = await extractYouTubeAccountStream(
    'W0LiTBNjJ_o',
    { ...basic, streaming_data: { hls_manifest_url: master, adaptive_formats: [format] } },
    undefined,
    async () => manifest,
  );
  assert.equal(direct.url, format.url);
  assert.equal(direct.audioIncludesVideo, undefined);
});

test('Real account Format with missing audioQuality retains playable audio MIME data', async () => {
  const { default: Format } =
    await import('../node_modules/youtubei.js/dist/src/parser/classes/misc/Format.js');
  const format = new Format(
    {
      itag: 140,
      mimeType: 'audio/mp4',
      bitrate: 128000,
      url: 'https://rr1.googlevideo.com/videoplayback?itag=140',
    },
    new Map(),
  );
  assert.equal(format.has_audio, false);
  const result = await extractYouTubeAccountStream(
    'W0LiTBNjJ_o',
    { ...basic, streaming_data: { adaptive_formats: [format] } },
    undefined,
    async () => assert.fail(),
  );
  assert.ok(result.url.includes('itag=140'));
});

test('SABR audio descriptions plus a real progressive MP4 resolve sound through the account', async () => {
  const { default: Format } =
    await import('../node_modules/youtubei.js/dist/src/parser/classes/misc/Format.js');
  const cache = new Map();
  const audio = new Format(
    { itag: 140, mimeType: 'audio/mp4', audioQuality: 'AUDIO_QUALITY_MEDIUM', bitrate: 128000 },
    cache,
  );
  const combined = new Format(
    {
      itag: 18,
      mimeType: 'video/mp4; codecs="avc1.42001E, mp4a.40.2"',
      qualityLabel: '360p',
      height: 360,
      bitrate: 400000,
      url: 'https://rr1.googlevideo.com/videoplayback?itag=18',
    },
    cache,
  );
  // Missing audioQuality is common on progressive formats: use the AAC codec as evidence.
  assert.equal(combined.has_audio, false);
  const info = { ...basic, streaming_data: { adaptive_formats: [audio], formats: [combined] } };
  const stream = await extractYouTubeAccountStream('W0LiTBNjJ_o', info, undefined, async () =>
    assert.fail(),
  );
  assert.equal(stream.url, combined.url);
  assert.equal(stream.audioIncludesVideo, true);
  assert.equal(stream.audioItag, 18);
  assert.equal(stream.audioContainer, 'progressive');
  assert.equal(stream.duration, 106);
  assert.equal(stream.gainDb, -5.5);
  await assert.rejects(
    extractYouTubeAccountStream('W0LiTBNjJ_o', info, undefined, async () => assert.fail(), {
      preferAlternateFormat: true,
      excludeItag: 18,
    }),
    /поддерживаемый аудиопоток/,
  );
  await assert.rejects(
    extractYouTubeAccountStream('W0LiTBNjJ_o', info, undefined, async () => assert.fail(), {
      preferAlternateFormat: true,
    }),
    /поддерживаемый аудиопоток/,
  );
});

test('Progressive fallback rejects silent video, DRM, translated audio and unrelated stream URLs', async () => {
  const { default: Format } =
    await import('../node_modules/youtubei.js/dist/src/parser/classes/misc/Format.js');
  const base = {
    itag: 18,
    mimeType: 'video/mp4; codecs="avc1.42001E, mp4a.40.2"',
    qualityLabel: '360p',
    height: 360,
    bitrate: 400000,
    url: 'https://rr1.googlevideo.com/videoplayback?itag=18',
  };
  for (const change of [
    { mimeType: 'video/mp4; codecs="avc1.42001E"' },
    { drmFamilies: ['WIDEVINE'] },
    { url: 'https://evil.test/audio' },
    { audioTrack: { audioIsDefault: false } },
  ]) {
    const format = new Format({ ...base, ...change }, new Map());
    await assert.rejects(
      extractYouTubeAccountStream(
        'W0LiTBNjJ_o',
        { ...basic, streaming_data: { formats: [format] } },
        undefined,
        async () => assert.fail(),
      ),
      /поддерживаемый аудиопоток/,
    );
  }
});

test('Audio-only formats keep priority; progressive fallback chooses the smallest usable video rendition', async () => {
  const format = (itag, height, mime) => ({
    itag,
    height,
    mime_type: mime,
    bitrate: height * 1000,
    has_audio: true,
    has_video: height > 0,
    url: 'https://rr1.googlevideo.com/videoplayback?itag=' + itag,
    decipher: async () => 'https://rr1.googlevideo.com/videoplayback?itag=' + itag,
  });
  const small = format(18, 360, 'video/mp4'),
    large = format(22, 720, 'video/mp4'),
    audio = format(140, 0, 'audio/mp4');
  let info = { ...basic, streaming_data: { formats: [large, small], adaptive_formats: [audio] } };
  assert.equal(
    (await extractYouTubeAccountStream('W0LiTBNjJ_o', info, undefined, async () => assert.fail()))
      .audioItag,
    140,
  );
  info.streaming_data.adaptive_formats = [];
  assert.equal(
    (await extractYouTubeAccountStream('W0LiTBNjJ_o', info, undefined, async () => assert.fail()))
      .audioItag,
    18,
  );
});

test('A usable combined account stream is CDN-checked once and retains its account route in cache', async (t) => {
  isolate(t);
  let requests = 0,
    checks = 0,
    cancelled = 0;
  yt.setAccountResolver(async () => {
    requests++;
    return {
      url: 'https://rr1.googlevideo.com/videoplayback?itag=18',
      duration: 106,
      audioIncludesVideo: true,
      audioContainer: 'progressive',
    };
  });
  t.mock.method(transport, 'postPlayer', async () =>
    assert.fail('Usable account streams must precede anonymous playback'),
  );
  t.mock.method(transport, 'fetch', async (_url, init) => {
    checks++;
    assert.equal(init.headers.Range, 'bytes=0-1023');
    assert.equal(init.credentials, 'omit');
    return new Response(
      new ReadableStream({
        start(c) {
          c.enqueue(new Uint8Array([1, 2, 3]));
        },
        cancel() {
          cancelled++;
        },
      }),
      { status: 206, headers: { 'content-type': 'video/mp4' } },
    );
  });
  const url = await yt.resolveDirectAudioStream('W0LiTBNjJ_o');
  assert.ok(url.includes('itag=18'));
  assert.equal(checks, 1);
  assert.equal(cancelled, 1);
  assert.deepEqual(yt.getStreamRoute('W0LiTBNjJ_o'), { via: 'account', client: 'WEB' });
  assert.equal(await yt.resolveDirectAudioStream('W0LiTBNjJ_o'), url);
  assert.equal(requests, 1);
  assert.equal(checks, 1);
});

test('Rejected account CDN falls back to a playable anonymous stream rather than caching a dead address', async (t) => {
  isolate(t);
  yt.setAccountResolver(async () => ({
    url: 'https://rr1.googlevideo.com/videoplayback?itag=18',
    audioIncludesVideo: true,
    audioContainer: 'progressive',
  }));
  t.mock.method(
    transport,
    'fetch',
    async () => new Response('denied', { status: 403, headers: { 'content-type': 'text/plain' } }),
  );
  t.mock.method(yt, 'getVisitorData', async () => '');
  t.mock.method(transport, 'postPlayer', async () =>
    Response.json({
      playabilityStatus: { status: 'OK' },
      streamingData: {
        adaptiveFormats: [
          {
            itag: 140,
            mimeType: 'audio/mp4',
            url: 'https://rr1.googlevideo.com/videoplayback?itag=140',
          },
        ],
      },
    }),
  );
  assert.ok((await yt.resolveDirectAudioStream('W0LiTBNjJ_o')).includes('itag=140'));
  assert.deepEqual(yt.getStreamRoute('W0LiTBNjJ_o'), { via: 'anonymous', client: 'VISIONOS' });
});

test('Changing the account during CDN validation discards the old stream without an anonymous request', async (t) => {
  isolate(t);
  let finish;
  yt.setAccountResolver(async () => ({
    url: 'https://rr1.googlevideo.com/videoplayback?itag=18',
    audioIncludesVideo: true,
    audioContainer: 'progressive',
  }));
  t.mock.method(
    transport,
    'fetch',
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  t.mock.method(transport, 'postPlayer', async () =>
    assert.fail('An abandoned session must not start another route'),
  );
  const pending = yt.resolveDirectAudioStream('W0LiTBNjJ_o');
  await new Promise((resolve) => setImmediate(resolve));
  yt.setAccountResolver(async () => null);
  finish(new Response('data', { status: 206, headers: { 'content-type': 'video/mp4' } }));
  await assert.rejects(pending, /YOUTUBE_AUDIO_LOGIN_REQUIRED/);
  assert.equal(yt.streamCache.size, 0);
});

test('Anonymous bot rejection after a connected account CDN failure does not request another login', async (t) => {
  isolate(t);
  t.mock.method(yt, 'getVisitorData', async () => '');
  const { YouTubeMusicService: service } =
    await import('../src/desktop/main/services/youtubeMusic.ts');
  const { YouTubeMusicTransport: transport } =
    await import('../src/desktop/main/services/youtubeMusicTransport.ts');
  service.setAccountResolver(async () => {
    throw Object.assign(new Error('Account delivery failed'), { cause: new Error('cdn-http-403') });
  });
  t.after(() => service.setAccountResolver(null));
  t.mock.method(transport, 'postPlayer', async () =>
    Response.json({
      playabilityStatus: {
        status: 'LOGIN_REQUIRED',
        reason: 'Sign in to confirm you are not a bot',
      },
    }),
  );
  await assert.rejects(
    service.resolveDirectAudioStream('W0LiTBNjJ_o', false, false, { allowSessionRecovery: true }),
    /STREAM_PROVIDER_UNAVAILABLE/,
  );
  assert.equal(service.audioAccessFailures.has('W0LiTBNjJ_o'), false);
  await assert.rejects(
    service.resolveDirectAudioStream('W0LiTBNjJ_o', false, false, { allowSessionRecovery: true }),
    /STREAM_PROVIDER_UNAVAILABLE/,
  );
});

test('Playback joining account prefetch promotes recovery on the existing request without duplicate resolution', async (t) => {
  isolate(t);
  let release,
    entered,
    requests = 0;
  const waiting = new Promise((resolve) => {
    entered = resolve;
  });
  const latch = new Promise((resolve) => {
    release = resolve;
  });
  const originalOptions = {};
  yt.setAccountResolver(async (id, options) => {
    requests++;
    entered();
    await latch;
    assert.equal(options.allowSessionRecovery, true);
    return {
      url: 'https://rr1.googlevideo.com/videoplayback?itag=140&c=WEB',
      deliveryVerified: true,
    };
  });
  t.mock.method(transport, 'postPlayer', async () =>
    assert.fail('Active account recovery must not fall into anonymous playback'),
  );
  const prefetch = yt.resolveDirectAudioStream('W0LiTBNjJ_o', false, false, originalOptions);
  await waiting;
  const playback = yt.resolveDirectAudioStream('W0LiTBNjJ_o', false, false, {
    allowSessionRecovery: true,
  });
  release();
  const urls = await Promise.all([prefetch, playback]);
  assert.equal(urls[0], urls[1]);
  assert.equal(requests, 1);
  assert.deepEqual(originalOptions, {});
  assert.equal(yt.playerStreamRequests.size, 0);
  assert.equal(yt.playerStreamOptions.size, 0);
});
