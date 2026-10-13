import {
  withStreamResolveDeadline,
  StreamResolveTimeoutError,
} from '../src/shared/utils/streamResolveDeadline.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { runProgressiveSearch, settleWithin } from '../src/shared/utils/progressiveSearch.ts';
import { SoundCloudService } from '../src/desktop/main/services/soundcloud.ts';
import { SoundCloudTransport } from '../src/desktop/main/services/soundcloudTransport.ts';
import { setDesktopNetworkRecovery } from '../src/desktop/main/services/desktopFetch.ts';
import { YouTubeMusicTransport } from '../src/desktop/main/services/youtubeMusicTransport.ts';
import { YouTubeMusicService } from '../src/desktop/main/services/youtubeMusic.ts';
import { MusicAggregatorService } from '../src/desktop/main/services/musicAggregator.ts';
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
const track = (id, source, title = 'Зоопарк') => ({
  id,
  source,
  title,
  artist: { name: 'Гражданская оборона' },
  album: { title: 'Single' },
  duration: 200,
});
const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};

test('Search displays the healthy provider immediately and merges late tracks/artists without duplicates', async () => {
  const slow = deferred(),
    updates = [];
  const api = {
    search: async (q, n, source) =>
      source === 'youtube' ? slow.promise : { data: [track('654184550', 'soundcloud')] },
    searchArtists: async (q, n, source) => ({
      data: [{ id: source, name: 'Гражданская Оборона', source }],
    }),
  };
  const finished = runProgressiveSearch('Зоопарк', 'all', api, (s) => updates.push(s));
  await flush();
  assert.ok(updates.some((s) => s.pending && s.tracks.some((t) => t.id === '654184550')));
  slow.resolve({ data: [track('yt_abcdefghijk', 'youtube')] });
  await finished;
  const last = updates.at(-1);
  assert.equal(last.pending, false);
  assert.equal(last.artists.length, 1);
  assert.equal(last.tracks.length, 1);
  assert.equal(last.tracks[0].source, 'youtube');
});

test('Hanging and failed sources finish without erasing healthy search results or publishing late data', async () => {
  const slow = deferred(),
    updates = [];
  await runProgressiveSearch(
    'Зоопарк',
    'all',
    {
      search: async (q, n, source) =>
        source === 'youtube' ? slow.promise : { data: [track('654184550', 'soundcloud')] },
      searchArtists: async () => {
        throw Error('offline');
      },
    },
    (s) => updates.push(s),
    20,
  );
  assert.equal(updates.at(-1).pending, false);
  assert.equal(updates.at(-1).tracks[0].id, '654184550');
  const count = updates.length;
  slow.resolve({ data: [track('yt_abcdefghijk', 'youtube')] });
  await flush();
  assert.equal(updates.length, count);
  assert.equal(await settleWithin(Promise.reject(Error('offline')), 20, 7), 7);
});

test('Explicit source search does not contact the other platform and artist API may be absent', async () => {
  const calls = [],
    updates = [];
  await runProgressiveSearch(
    'Зоопарк',
    'soundcloud',
    {
      search: async (q, n, source) => {
        calls.push(source);
        return { data: [track('654184550', 'soundcloud')] };
      },
    },
    (s) => updates.push(s),
  );
  assert.deepEqual(calls, ['soundcloud']);
  assert.equal(updates.at(-1).pending, false);
  assert.equal(updates.at(-1).tracks.length, 1);
});

test('Parallel SoundCloud key discovery/refresh makes one request and can retry a failed refresh', async (t) => {
  const previous = {
    id: SoundCloudService.scClientId,
    time: SoundCloudService.lastKeyFetch,
    pending: SoundCloudService.keyRequest,
  };
  SoundCloudService.scClientId = '';
  SoundCloudService.lastKeyFetch = 0;
  SoundCloudService.keyRequest = null;
  let calls = 0,
    mode = 'wait';
  const wait = deferred();
  t.mock.method(SoundCloudService, 'fetchSoundCloudKey', async () => {
    calls++;
    if (mode === 'error') throw Error('network');
    return mode === 'wait' ? wait.promise : 'replacement';
  });
  try {
    const jobs = Array.from({ length: 20 }, () => SoundCloudService.getSoundCloudKey());
    await flush();
    assert.equal(calls, 1);
    wait.resolve('test-key');
    assert.deepEqual(await Promise.all(jobs), Array(20).fill('test-key'));
    assert.equal(SoundCloudService.keyRequest, null);
    mode = 'error';
    await assert.rejects(SoundCloudService.getSoundCloudKey(true), /network/);
    assert.equal(SoundCloudService.keyRequest, null);
    mode = 'replacement';
    assert.equal(await SoundCloudService.getSoundCloudKey(true), 'replacement');
  } finally {
    SoundCloudService.scClientId = previous.id;
    SoundCloudService.lastKeyFetch = previous.time;
    SoundCloudService.keyRequest = previous.pending;
  }
});

test('Failed SoundCloud refresh preserves the previous key, and malformed JSON uses the existing relay fallback', async (t) => {
  const previous = { id: SoundCloudService.scClientId, time: SoundCloudService.lastKeyFetch };
  SoundCloudService.scClientId = 'previous-key';
  SoundCloudService.lastKeyFetch = Date.now();
  let relay = false,
    calls = 0;
  t.mock.method(SoundCloudTransport, 'fetch', async () => {
    if (!relay) throw Error('offline');
    return ++calls === 1 ? new Response('broken json') : Response.json({ ok: true });
  });
  t.mock.method(console, 'debug', () => {});
  try {
    assert.equal(await SoundCloudService.getSoundCloudKey(true), 'previous-key');
    assert.equal(SoundCloudService.scClientId, 'previous-key');
    relay = true;
    assert.deepEqual(
      await SoundCloudTransport.fetchJson(
        'https://api-v2.soundcloud.com/test',
        'https://relay.test?url=',
        async () => '',
      ),
      { ok: true },
    );
    assert.equal(calls, 2);
  } finally {
    SoundCloudService.scClientId = previous.id;
    SoundCloudService.lastKeyFetch = previous.time;
  }
});

test('Autocomplete coalesces equivalent queries, caches briefly, and keeps SoundCloud albums on SoundCloud', async (t) => {
  MusicAggregatorService.autocompleteCache.clear();
  MusicAggregatorService.autocompleteRequests.clear();
  let calls = 0;
  const gate = deferred();
  t.mock.method(SoundCloudService, 'getAutocomplete', async () => {
    calls++;
    await gate.promise;
    return [];
  });
  t.mock.method(YouTubeMusicService, 'searchArtists', async () => ({
    data: [{ id: 'yt_artist', name: 'Гражданская оборона' }],
  }));
  t.mock.method(SoundCloudService, 'searchArtists', async () => []);
  t.mock.method(YouTubeMusicService, 'searchAlbums', async () => []);
  t.mock.method(SoundCloudService, 'searchPlaylists', async () => [
    { id: 123, title: 'Зоопарк', is_album: true, user: { username: 'Гражданская оборона' } },
  ]);
  try {
    const a = MusicAggregatorService.getAutocomplete(' Зоопарк '),
      b = MusicAggregatorService.getAutocomplete('зоопарк');
    await flush();
    assert.equal(calls, 1);
    gate.resolve();
    const [one, two] = await Promise.all([a, b]);
    assert.deepEqual(one, two);
    assert.equal(one.find((s) => s.type === 'album').source, 'soundcloud');
    await MusicAggregatorService.getAutocomplete('ЗООПАРК');
    assert.equal(calls, 1);
    assert.equal(MusicAggregatorService.autocompleteRequests.size, 0);
  } finally {
    MusicAggregatorService.autocompleteCache.clear();
    MusicAggregatorService.autocompleteRequests.clear();
  }
});

test('Autocomplete returns healthy suggestions after the timeout even if one provider never settles', async (t) => {
  MusicAggregatorService.autocompleteCache.clear();
  t.mock.method(SoundCloudService, 'getAutocomplete', async () => new Promise(() => {}));
  t.mock.method(SoundCloudService, 'searchArtists', async () => []);
  t.mock.method(SoundCloudService, 'searchPlaylists', async () => []);
  t.mock.method(YouTubeMusicService, 'searchAlbums', async () => []);
  t.mock.method(YouTubeMusicService, 'searchArtists', async () => ({
    data: [{ id: 'yt_artist', name: 'Healthy artist' }],
  }));
  t.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const request = MusicAggregatorService.getAutocomplete('timed-query');
    await flush();
    t.mock.timers.tick(3001);
    await flush();
    const results = await request;
    assert.equal(results[0].title, 'Healthy artist');
    assert.equal(MusicAggregatorService.autocompleteRequests.size, 0);
  } finally {
    MusicAggregatorService.autocompleteCache.clear();
    t.mock.timers.reset();
  }
});

test('SoundCloud playback retries a dropped connection once while search and missing tracks do not retry', async (t) => {
  let calls = 0,
    recoveries = 0,
    mode = 'drop';
  t.mock.method(console, 'debug', () => {});
  t.mock.method(SoundCloudTransport, 'fetch', async () => {
    calls++;
    if (mode === 'drop' && calls === 1) throw Error('connection reset');
    if (mode === 'always-drop') throw Error('offline');
    return mode === 'missing'
      ? new Response('', { status: 404 })
      : Response.json({ url: 'https://cdn.example/audio.mp3' });
  });
  setDesktopNetworkRecovery(async () => {
    recoveries++;
  });
  try {
    assert.ok(
      (
        await SoundCloudTransport.fetchJson(
          'https://api-v2.soundcloud.com/test',
          '',
          async () => '',
          false,
          true,
        )
      ).url,
    );
    assert.equal(calls, 2);
    assert.equal(recoveries, 1);
    calls = 0;
    mode = 'always-drop';
    await assert.rejects(
      SoundCloudTransport.fetchJson(
        'https://api-v2.soundcloud.com/test',
        '',
        async () => '',
        false,
        true,
      ),
      /STREAM_NETWORK_UNAVAILABLE/,
    );
    assert.equal(calls, 2);
    calls = 0;
    assert.equal(
      await SoundCloudTransport.fetchJson('https://api-v2.soundcloud.com/test', '', async () => ''),
      null,
    );
    assert.equal(calls, 1);
    calls = 0;
    mode = 'missing';
    assert.equal(
      await SoundCloudTransport.fetchJson(
        'https://api-v2.soundcloud.com/test',
        '',
        async () => '',
        false,
        true,
      ),
      null,
    );
    assert.equal(calls, 1);
  } finally {
    setDesktopNetworkRecovery(null);
  }
});

test('SoundCloud accepts a valid fast asset without waiting for unrelated bundles and cancels them', async (t) => {
  const old = { id: SoundCloudService.scClientId, time: SoundCloudService.lastKeyFetch };
  SoundCloudService.scClientId = '';
  SoundCloudService.lastKeyFetch = 0;
  const slow = deferred();
  let signal;
  t.mock.method(SoundCloudTransport, 'fetch', async (url, init) => {
    if (url.includes('/discover'))
      return new Response(
        '<script src="https://a-v2.sndcdn.com/assets/fast.js"></script><script src="https://a-v2.sndcdn.com/assets/slow.js"></script>',
      );
    if (url.includes('fast.js')) return new Response('client_id:"' + 'a'.repeat(32) + '"');
    signal = init.signal;
    return slow.promise;
  });
  try {
    assert.equal(await SoundCloudService.getSoundCloudKey(true), 'a'.repeat(32));
    assert.equal(signal.aborted, true);
    slow.resolve(new Response('no key'));
    await flush();
  } finally {
    SoundCloudService.scClientId = old.id;
    SoundCloudService.lastKeyFetch = old.time;
  }
});

test('SoundCloud media requests use the updated key if track metadata triggered a refresh', async (t) => {
  const old = SoundCloudService.scClientId;
  SoundCloudService.scClientId = 'fresh-key';
  let requested;
  t.mock.method(SoundCloudTransport, 'fetchJson', async (url) => {
    requested = url;
    return { ok: true };
  });
  try {
    await SoundCloudService.fetchWithRelay(
      'https://api-v2.soundcloud.com/media/test?client_id=stale-key',
    );
    assert.equal(new URL(requested).searchParams.get('client_id'), 'fresh-key');
  } finally {
    SoundCloudService.scClientId = old;
  }
});

test('Whole stream lookup times out; a late provider response cannot restart the completed request', async () => {
  const slow = deferred();
  let loaded = 0;
  const request = withStreamResolveDeadline(slow.promise, 15).then(() => {
    loaded++;
  });
  await assert.rejects(request, StreamResolveTimeoutError);
  slow.resolve('https://cdn.example/late.mp3');
  await flush();
  assert.equal(loaded, 0);
  assert.equal(await withStreamResolveDeadline(Promise.resolve('ready'), 100), 'ready');
  const original = Error('LOGIN_REQUIRED');
  await assert.rejects(
    withStreamResolveDeadline(Promise.reject(original), 100),
    (e) => e === original,
  );
});

test('SoundCloud search does not cache a transport failure as an empty library for an hour', async (t) => {
  SoundCloudService.cache.clear();
  t.after(() => SoundCloudService.cache.clear());
  let available = false,
    calls = 0;
  t.mock.method(SoundCloudService, 'getSoundCloudKey', async () => 'synthetic-key');
  t.mock.method(SoundCloudTransport, 'fetchJson', async () => {
    calls++;
    return available
      ? {
          collection: [
            {
              id: 987654,
              title: 'Recovered song',
              duration: 180000,
              user: { id: 1, username: 'Artist' },
              media: {
                transcodings: [
                  {
                    url: 'https://api-v2.soundcloud.com/media/test',
                    format: { protocol: 'progressive' },
                  },
                ],
              },
            },
          ],
          total_results: 1,
        }
      : null;
  });
  assert.deepEqual(await SoundCloudService.search('temporary-drop', 5), { data: [], total: 0 });
  available = true;
  const recovered = await SoundCloudService.search('temporary-drop', 5);
  assert.equal(recovered.data.length, 1);
  assert.equal(calls, 2);
});

test('YouTube search retries after failed responses rather than reusing a permanent empty result', async (t) => {
  YouTubeMusicService.searchCache.clear();
  t.after(() => YouTubeMusicService.searchCache.clear());
  let available = false,
    calls = 0;
  t.mock.method(YouTubeMusicService, 'postInnertube', async () => {
    calls++;
    return available
      ? {
          contents: {
            tabbedSearchResultsRenderer: {
              tabs: [
                {
                  tabRenderer: {
                    content: {
                      sectionListRenderer: {
                        contents: [
                          {
                            musicShelfRenderer: {
                              contents: [
                                {
                                  musicResponsiveListItemRenderer: {
                                    playlistItemData: { videoId: 'W0LiTBNjJ_o' },
                                    flexColumns: [
                                      {
                                        musicResponsiveListItemFlexColumnRenderer: {
                                          text: { runs: [{ text: 'Recovered song' }] },
                                        },
                                      },
                                      {
                                        musicResponsiveListItemFlexColumnRenderer: {
                                          text: {
                                            runs: [
                                              { text: 'Artist' },
                                              { text: ' • ' },
                                              { text: '3:00' },
                                            ],
                                          },
                                        },
                                      },
                                    ],
                                  },
                                },
                              ],
                            },
                          },
                        ],
                      },
                    },
                  },
                },
              ],
            },
          },
        }
      : null;
  });
  assert.equal((await YouTubeMusicService.search('temporary-drop', 1)).data.length, 0);
  const initialCalls = calls;
  available = true;
  const recovered = await YouTubeMusicService.search('temporary-drop', 1);
  assert.equal(recovered.data.length, 1);
  assert.ok(calls > initialCalls);
});

test('Malformed YouTube JSON counts toward the circuit breaker instead of resetting it before parsing', async (t) => {
  const old = {
    failures: YouTubeMusicService.consecutiveFailures,
    time: YouTubeMusicService.lastFailureTime,
  };
  YouTubeMusicService.consecutiveFailures = 0;
  let calls = 0;
  t.after(() => {
    YouTubeMusicService.consecutiveFailures = old.failures;
    YouTubeMusicService.lastFailureTime = old.time;
  });
  t.mock.method(console, 'warn', () => {});
  t.mock.method(YouTubeMusicTransport, 'postMusic', async () => {
    calls++;
    return new Response('bad json', { status: 200 });
  });
  for (let i = 0; i < 5; i++)
    assert.equal(await YouTubeMusicService.postInnertube('/youtubei/v1/search', {}), null);
  assert.equal(calls, 4);
  assert.equal(YouTubeMusicService.consecutiveFailures, 4);
});

test('A real empty YouTube search remains cached; partially failed empty searches do not', async (t) => {
  YouTubeMusicService.searchCache.clear();
  t.after(() => YouTubeMusicService.searchCache.clear());
  let calls = 0,
    partial = true;
  t.mock.method(YouTubeMusicService, 'postInnertube', async () => {
    calls++;
    return partial && calls % 3 !== 0 ? null : { contents: {} };
  });
  await YouTubeMusicService.search('partial-empty', 5);
  await YouTubeMusicService.search('partial-empty', 5);
  assert.equal(calls, 6);
  partial = false;
  await YouTubeMusicService.search('valid-empty', 5);
  const cold = calls;
  await YouTubeMusicService.search('valid-empty', 5);
  assert.equal(calls, cold);
});

test('SoundCloud does not request a failed transcoding again through preview fallback with another key', async (t) => {
  SoundCloudService.streamCache.clear();
  SoundCloudService.unavailableStreams.clear();
  t.after(() => {
    SoundCloudService.streamCache.clear();
    SoundCloudService.unavailableStreams.clear();
  });
  let mediaCalls = 0;
  t.mock.method(SoundCloudService, 'getSoundCloudKey', async () => 'fresh');
  const endpoint = 'https://api-v2.soundcloud.com/media/test/progressive';
  t.mock.method(SoundCloudService, 'fetchWithRelay', async (url) => {
    if (url.includes('/tracks/'))
      return {
        media: {
          transcodings: [{ url: endpoint + '?client_id=old', format: { protocol: 'progressive' } }],
        },
      };
    mediaCalls++;
    return null;
  });
  assert.equal(
    await SoundCloudService.getFullStreamUrl({
      ...track('998811', 'soundcloud'),
      preview: endpoint + '?client_id=other',
    }),
    '',
  );
  assert.equal(mediaCalls, 1);
});

test('SoundCloud full playback cannot fall back to a known encrypted or thirty-second preview endpoint', async (t) => {
  SoundCloudService.streamCache.clear();
  SoundCloudService.unavailableStreams.clear();
  t.after(() => {
    SoundCloudService.streamCache.clear();
    SoundCloudService.unavailableStreams.clear();
  });
  let mediaCalls = 0;
  t.mock.method(SoundCloudService, 'getSoundCloudKey', async () => 'fresh');
  let rendition;
  t.mock.method(SoundCloudService, 'fetchWithRelay', async (url) => {
    if (url.includes('/tracks/')) return { media: { transcodings: [rendition] } };
    mediaCalls++;
    return { url: 'https://cdn.example/preview' };
  });
  const examples = [
    {
      url: 'https://api-v2.soundcloud.com/media/test/ctr-encrypted-hls',
      format: { protocol: 'ctr-encrypted-hls' },
    },
    {
      url: 'https://api-v2.soundcloud.com/media/test/progressive',
      snipped: true,
      format: { protocol: 'progressive' },
    },
  ];
  for (const [i, item] of examples.entries()) {
    rendition = item;
    assert.equal(
      await SoundCloudService.getFullStreamUrl({
        ...track('998812' + i, 'soundcloud'),
        preview: item.url,
      }),
      '',
    );
  }
  assert.equal(mediaCalls, 0);
});
