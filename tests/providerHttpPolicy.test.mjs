import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRetryAfter, waitForRetry } from '../src/shared/utils/retryAfter.ts';
import { ProviderHttpPolicy } from '../src/desktop/main/services/providerHttpPolicy.ts';
const limited = (value = '2', status = 429) =>
  new Response('busy', { status, headers: { 'Retry-After': value } });

test('Retry-After parses seconds and HTTP dates without guessing malformed numeric dates', () => {
  const now = Date.UTC(2026, 9, 16, 0, 0, 0);
  assert.equal(parseRetryAfter('12', now), 12000);
  assert.equal(parseRetryAfter('Friday, 16-Oct-26 00:00:20 GMT', now), 20000);
  assert.equal(parseRetryAfter('Fri Oct 16 00:00:20 2026', now), 20000);
  assert.equal(parseRetryAfter('2026-10-16T00:00:20Z', now), null);
  assert.equal(parseRetryAfter('16 October 2026 00:00:20 GMT', now), null);
  assert.equal(parseRetryAfter('Fri, 16 Oct 2026 00:00:20 GMT', now), 20000);
  assert.equal(parseRetryAfter('Fri, 16 Oct 2026 00:00:00 GMT', now + 1000), 0);
  for (const value of [null, '', '-1', '1.5', '1e3', 'garbage', '9999999999999999999999'])
    assert.equal(parseRetryAfter(value, now), null);
});

test('Safe catalog requests honor the server delay and have a finite retry budget', async () => {
  let now = 0,
    calls = 0;
  const waits = [];
  const policy = new ProviderHttpPolicy(
    () => now,
    async (ms) => {
      waits.push(ms);
      now += ms;
    },
  );
  const response = await policy.fetch('https://api-v2.soundcloud.com/tracks/1', {}, async () =>
    ++calls < 3 ? limited('2') : new Response('ok'),
  );
  assert.equal(await response.text(), 'ok');
  assert.equal(calls, 3);
  assert.deepEqual(waits, [2000, 2000]);
  calls = 0;
  const failed = await policy.fetch('https://api-v2.soundcloud.com/tracks/2', {}, async () => {
    calls++;
    return limited('0');
  });
  assert.equal(failed.status, 429);
  assert.equal(calls, 3);
});

test('Mutating POST is never replayed, while the provider cooldown applies to its next request', async () => {
  let now = 0,
    calls = 0;
  const waits = [];
  const policy = new ProviderHttpPolicy(
    () => now,
    async (ms) => {
      waits.push(ms);
      now += ms;
    },
  );
  const fetcher = async () => (++calls === 1 ? limited('3') : new Response('ok'));
  assert.equal(
    (
      await policy.fetch(
        'https://www.youtube.com/subscription',
        { method: 'POST', body: '{}' },
        fetcher,
      )
    ).status,
    429,
  );
  assert.equal(calls, 1);
  await policy.fetch(
    'https://music.youtube.com/youtubei/v1/player',
    { method: 'POST', body: '{}' },
    fetcher,
  );
  assert.equal(calls, 2);
  assert.deepEqual(waits, [3000]);
});

test('Long Retry-After is retained without waiting forever or retrying earlier than requested', async () => {
  let calls = 0;
  const policy = new ProviderHttpPolicy(
    () => 0,
    async () => {
      throw Error('Unexpected sleep');
    },
  );
  const fetcher = async () => {
    calls++;
    return limited('86400');
  };
  assert.equal(
    (await policy.fetch('https://api-v2.soundcloud.com/track', {}, fetcher)).status,
    429,
  );
  await assert.rejects(
    policy.fetch('https://api.soundcloud.com/search', {}, fetcher),
    /SO.*RATE|STREAM_RATE_LIMITED/,
  );
  assert.equal(calls, 1);
});

test('Retry waiting aborts promptly and removes its listener without cancelling another request', async () => {
  const abort = new AbortController();
  const waiting = waitForRetry(10000, abort.signal);
  abort.abort(new DOMException('user cancelled', 'AbortError'));
  await assert.rejects(waiting, (error) => error.name === 'AbortError');
  let calls = 0;
  const policy = new ProviderHttpPolicy();
  await policy.fetch('https://www.youtube.com/mutate', { method: 'POST' }, async () => {
    calls++;
    return limited('2');
  });
  const cancelled = new AbortController();
  const request = policy.fetch('https://music.youtube.com/youtubei/v1/browse', {}, async () => {
    calls++;
    return new Response('ok');
  });
  const removed = policy.fetch(
    'https://music.youtube.com/youtubei/v1/player',
    { signal: cancelled.signal },
    async () => {
      calls++;
      return new Response('ok');
    },
  );
  cancelled.abort();
  await assert.rejects(removed, (error) => error.name === 'AbortError');
  await request;
  assert.equal(calls, 2);
});

test('Only one cooldown probe reaches a throttled provider before its response is known', async () => {
  let now = 0,
    finish,
    calls = 0;
  const policy = new ProviderHttpPolicy(
    () => now,
    async (ms) => {
      now += ms;
    },
  );
  await policy.fetch('https://www.youtube.com/mutate', { method: 'POST' }, async () =>
    limited('0'),
  );
  const fetcher = async () => {
    calls++;
    return new Promise((resolve) => {
      finish = resolve;
    });
  };
  const a = policy.fetch('https://music.youtube.com/one', {}, fetcher);
  const b = policy.fetch('https://www.youtube.com/two', {}, async () => {
    calls++;
    return new Response('ok');
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  finish(new Response('ok'));
  await Promise.all([a, b]);
  assert.equal(calls, 2);
});

test('503 retries require Retry-After and HTTP-date uses the same bounded gate', async () => {
  let now = Date.UTC(2026, 9, 16),
    calls = 0;
  const waits = [];
  const policy = new ProviderHttpPolicy(
    () => now,
    async (ms) => {
      waits.push(ms);
      now += ms;
    },
  );
  const response = await policy.fetch('https://api-v2.soundcloud.com/tracks', {}, async () => {
    calls++;
    return calls === 1 ? limited('Fri, 16 Oct 2026 00:00:04 GMT', 503) : new Response('ok');
  });
  assert.equal(response.status, 200);
  assert.deepEqual(waits, [4000]);
  calls = 0;
  assert.equal(
    (
      await policy.fetch('https://api-v2.soundcloud.com/tracks', {}, async () => {
        calls++;
        return new Response('unavailable', { status: 503 });
      })
    ).status,
    503,
  );
  assert.equal(calls, 1);
});

test('A successful probe cannot erase a newer cooldown from an older in-flight request', async () => {
  let now = 0,
    finishOld,
    finishProbe;
  const waits = [];
  const policy = new ProviderHttpPolicy(
    () => now,
    async (ms) => {
      waits.push(ms);
      now += ms;
    },
  );
  const old = policy.fetch(
    'https://www.youtube.com/mutate',
    { method: 'POST' },
    () =>
      new Promise((resolve) => {
        finishOld = resolve;
      }),
  );
  await policy.fetch('https://www.youtube.com/mutate', { method: 'POST' }, async () =>
    limited('0'),
  );
  const probe = policy.fetch(
    'https://music.youtube.com/one',
    {},
    () =>
      new Promise((resolve) => {
        finishProbe = resolve;
      }),
  );
  await new Promise((resolve) => setImmediate(resolve));
  finishOld(limited('5'));
  await old;
  finishProbe(new Response('ok'));
  await probe;
  await policy.fetch('https://www.youtube.com/two', {}, async () => new Response('ok'));
  assert.deepEqual(waits, [5000]);
});

test('Cancellation discards a late response before its metadata changes provider state', async () => {
  const controller = new AbortController();
  let discarded = false;
  const policy = new ProviderHttpPolicy();
  await assert.rejects(
    policy.fetch(
      'https://api-v2.soundcloud.com/tracks',
      { signal: controller.signal },
      async () => {
        controller.abort();
        return new Response(
          new ReadableStream({
            cancel() {
              discarded = true;
            },
          }),
          { status: 429, headers: { 'Retry-After': '86400' } },
        );
      },
    ),
    (error) => error.name === 'AbortError',
  );
  assert.equal(discarded, true);
  assert.equal(
    (await policy.fetch('https://api-v2.soundcloud.com/tracks', {}, async () => new Response('ok')))
      .status,
    200,
  );
});

test('SoundCloud rate limits neither reset connections nor fall through to a relay', async () => {
  const { SoundCloudTransport } =
    await import('../src/desktop/main/services/soundcloudTransport.ts');
  const { setDesktopFetch, setDesktopNetworkRecovery } =
    await import('../src/desktop/main/services/desktopFetch.ts');
  let calls = 0,
    recovery = 0,
    keyRefresh = 0;
  setDesktopFetch(async (url) => {
    calls++;
    assert.match(url, /^https:\/\/api-v2\.soundcloud\.com\//);
    return limited('0');
  });
  setDesktopNetworkRecovery(async () => {
    recovery++;
  });
  try {
    await assert.rejects(
      SoundCloudTransport.fetchJson(
        'https://api-v2.soundcloud.com/media/1',
        'https://relay.invalid/?url=',
        async () => {
          keyRefresh++;
          return 'key';
        },
        false,
        true,
        true,
      ),
      /STREAM_RATE_LIMITED/,
    );
    assert.equal(calls, 3);
    assert.equal(recovery, 0);
    assert.equal(keyRefresh, 0);
  } finally {
    setDesktopFetch(null);
    setDesktopNetworkRecovery(null);
  }
});
test('The current SoundCloud CDN shares the API cooldown rather than starting a new request', async () => {
  const policy = new ProviderHttpPolicy();
  await policy.fetch(
    'https://api-v2.soundcloud.com/search/tracks',
    {},
    async () => new Response('', { status: 429, headers: { 'retry-after': '60' } }),
  );
  let requests = 0;
  await assert.rejects(
    policy.fetch('https://playback.media-streaming.soundcloud.cloud/audio.m4s', {}, async () => {
      requests++;
      return new Response('ok');
    }),
    /STREAM_RATE_LIMITED/,
  );
  assert.equal(requests, 0);
});
