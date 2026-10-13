import test from 'node:test';
import assert from 'node:assert/strict';
import { YouTubeMusicService } from '../src/desktop/main/services/youtubeMusic.ts';
import { isValidYouTubeVideoId } from '../src/shared/services/parsers/youtubeMusicParser.ts';
import { SNIPPET_DURATION } from '../src/shared/context/audioTypes.ts';
import { getSnippetProgressState } from '../src/shared/utils/snippetProgress.ts';

test('Karaoke & Clips: YouTube Data API v3 gracefully handles missing or empty keys', async () => {
  const res1 = await YouTubeMusicService.searchViaYouTubeDataApi(
    'The Weeknd',
    'Blinding Lights',
    '',
  );
  assert.equal(res1, null, 'Empty API key must return null');

  const res2 = await YouTubeMusicService.searchViaYouTubeDataApi('The Weeknd', '', 'AIzaSyFakeKey');
  assert.equal(res2, null, 'Empty title must return null');
});

test('YouTube parser: validates video IDs using the production guard', () => {
  const validIds = ['J7NFL-eOxiQ', 'LYd-8w-v2Aw', '4NRXx6U8ABQ', '4EfM6rPmxow', 'a1b2c3d4e5f'];
  const invalidIds = ['short', 'toolongvideoid12345', 'has spaces!', 'invalid@chars'];

  for (const id of validIds) {
    assert.equal(isValidYouTubeVideoId(id), true, `${id} should be accepted`);
  }

  for (const id of invalidIds) {
    assert.equal(isValidYouTubeVideoId(id), false, `${id} should be rejected`);
  }
  assert.equal(isValidYouTubeVideoId(null), false);
  assert.equal(isValidYouTubeVideoId(12345678901), false);
});

test('Snippet controller: progress helper handles seek delay, clamps progress, and reports completion', () => {
  const start = 60;
  const end = 70;

  assert.deepEqual(getSnippetProgressState(0, start, end), {
    isSeeking: true,
    isFinished: false,
    progress: 0,
  });
  assert.equal(getSnippetProgressState(start, start, end).progress, 0);
  assert.equal(getSnippetProgressState(start + SNIPPET_DURATION / 2, start, end).progress, 0.5);
  assert.deepEqual(getSnippetProgressState(end, start, end), {
    isSeeking: false,
    isFinished: true,
    progress: 1,
  });
  assert.equal(getSnippetProgressState(end + 4, start, end).progress, 1);
});
