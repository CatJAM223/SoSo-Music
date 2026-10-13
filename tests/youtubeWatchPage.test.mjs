import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseYouTubeWatchPage,
  readYouTubeWatchPage,
  youtubeAccountMediaUserAgent,
} from '../src/desktop/main/services/youtubeWatchPage.ts';

test('Watch page parser reads nested JSON and escaped braces without executing scripts', () => {
  const response = {
    videoDetails: { videoId: 'sameVideo', title: 'escaped " } \\ text' },
    playabilityStatus: { status: 'OK' },
  };
  const html =
    '<script src="/s/player/abcd1234/player_ias.vflset/en_US/base.js"></script><script>var ytInitialPlayerResponse = ' +
    JSON.stringify(response) +
    '; throw new Error("must not run");</script>';
  assert.deepEqual(parseYouTubeWatchPage(html, 'sameVideo'), { response, playerId: 'abcd1234' });
  assert.deepEqual(
    parseYouTubeWatchPage(
      'window["ytInitialPlayerResponse"] = ' + JSON.stringify(response),
      'sameVideo',
    ).response,
    response,
  );
  assert.throws(() => parseYouTubeWatchPage(html, 'anotherVideo'), /another recording/);
  assert.throws(
    () => parseYouTubeWatchPage('<html>Sign in</html>', 'sameVideo'),
    /no player response/,
  );
});

test('Watch recovery reads bounded HTML and refuses JSON, redirects and oversized responses', async () => {
  assert.equal(
    await readYouTubeWatchPage(
      new Response('<html/>', { headers: { 'content-type': 'text/html; charset=utf-8' } }),
    ),
    '<html/>',
  );
  for (const response of [
    Response.json({}),
    new Response('', { status: 302 }),
    new Response('', {
      headers: { 'content-type': 'text/html', 'content-length': String(9 * 1024 * 1024) },
    }),
  ])
    await assert.rejects(readYouTubeWatchPage(response));
  await assert.rejects(
    readYouTubeWatchPage(
      new Response('x'.repeat(8 * 1024 * 1024 + 1), { headers: { 'content-type': 'text/html' } }),
    ),
    /too large/,
  );
});

test('Only Google video web streams share the account browser identity, including HLS paths', () => {
  for (const url of [
    'https://rr1.googlevideo.com/videoplayback?c=WEB',
    'https://rr1.googlevideo.com/manifest/hls_variant/c/WEB/itag/234',
  ])
    assert.match(youtubeAccountMediaUserAgent(url), /Safari/);
  for (const url of [
    'https://rr1.googlevideo.com/videoplayback?c=VISIONOS',
    'https://googlevideo.com.evil.test/?c=WEB',
    'https://example.com/c/WEB/',
    'http://rr1.googlevideo.com/?c=WEB',
  ])
    assert.equal(youtubeAccountMediaUserAgent(url), undefined);
});
