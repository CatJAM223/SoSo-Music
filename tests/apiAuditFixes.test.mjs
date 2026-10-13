import test from 'node:test';
import assert from 'node:assert/strict';
import { getGenreSearchConfig, trackHasGenreTag } from '../src/shared/utils/genreSearch.ts';
import { AudioCacheService } from '../src/shared/services/audioCacheService.ts';

import { ChordsService } from '../src/shared/services/chordsService.ts';

test('API Audit: genre results use SoundCloud genre tags instead of title keywords', () => {
  assert.equal(getGenreSearchConfig(2).soundCloudSlug, 'hiphoprap');
  assert.equal(getGenreSearchConfig(14).soundCloudSlug, undefined);
  assert.ok(getGenreSearchConfig(14).tags.includes('synthwave'));
  assert.equal(getGenreSearchConfig(999), undefined);

  assert.equal(trackHasGenreTag({ title: 'Phonk hit', genre: 'Phonk', tags: [] }, 1), true);
  assert.equal(trackHasGenreTag({ title: 'Phonk hit', genre: '', tags: ['drift phonk'] }, 1), true);
  assert.equal(trackHasGenreTag({ title: 'Phonk hit', genre: 'Hip-Hop', tags: [] }, 1), false);
});

test('API Audit: AudioCacheService.isHlsUrl rejects progressive MP3 with hls query params and accepts true HLS', () => {
  // True HLS streams
  assert.equal(AudioCacheService.isHlsUrl('https://cf-hls-media.sndcdn.com/playlist.m3u8'), true);
  assert.equal(
    AudioCacheService.isHlsUrl('https://api-v2.soundcloud.com/media/tracks:123/stream/hls'),
    true,
  );
  assert.equal(AudioCacheService.isHlsUrl('https://example.com/live/hls/master.m3u8'), true);
  assert.equal(
    AudioCacheService.isHlsUrl('https://example.com/audio/stream?format=audio/mpegurl'),
    true,
  );

  // Progressive MP3 streams that contain "hls" in auth tokens or query parameters
  assert.equal(
    AudioCacheService.isHlsUrl(
      'https://playback.media-streaming.soundcloud.cloud/aac_160k/audio.mp3?token=hls_12345',
    ),
    false,
  );
  assert.equal(
    AudioCacheService.isHlsUrl('https://cdn.example.com/audio.mp3?channel=hls_preview'),
    false,
  );
  assert.equal(AudioCacheService.isHlsUrl('https://cdn.example.com/track.mp3'), false);
  assert.equal(AudioCacheService.isHlsUrl(''), false);
});

test('API Audit: ChordsService normalize and cleanQuery handles dirty inputs safely', () => {
  const cleanQ = ChordsService['cleanQuery'](
    'Miyagi & Эндшпиль (Official Video) [Remaster 2024] - Single',
  );
  assert.ok(!cleanQ.includes('Official Video'));
  assert.ok(!cleanQ.includes('Remaster'));
  assert.ok(!cleanQ.includes('Single'));
  assert.ok(cleanQ.includes('Miyagi'));

  const isMatch = ChordsService['isStrictMatch'](
    'Группа крови',
    'Кино',
    'Группа крови (Remastered)',
    'Кино',
  );
  assert.equal(isMatch, true);
});

test('API Audit: SoundCloudService.findBestTrackMatch filters out BLOCK and SUB_HIGH_TIER tracks', async () => {
  const { SoundCloudService } = await import('../src/desktop/main/services/soundcloud.ts');

  const target = {
    title: 'Boulevard of Broken Dreams',
    artist: 'Green Day',
    duration: 262,
  };

  const candidates = [
    {
      id: 101,
      title: 'Green Day - Boulevard of Broken Dreams',
      duration: 262000,
      policy: 'BLOCK', // Blocked track
      artist: { name: 'Green Day' },
      media: { transcodings: [{ format: { protocol: 'progressive' }, url: 'https://api-v2/1' }] },
    },
    {
      id: 102,
      title: 'Green Day - Boulevard of Broken Dreams',
      duration: 262000,
      monetization_model: 'SUB_HIGH_TIER', // Go+ paywalled
      artist: { name: 'Green Day' },
      media: { transcodings: [{ format: { protocol: 'progressive' }, url: 'https://api-v2/2' }] },
    },
    {
      id: 103,
      title: 'Green Day - Boulevard of Broken Dreams',
      duration: 262000,
      policy: 'MONETIZE',
      monetization_model: 'AD_SUPPORTED',
      artist: { name: 'Green Day' },
      media: { transcodings: [{ format: { protocol: 'progressive' }, url: 'https://api-v2/3' }] },
    },
  ];

  const best = SoundCloudService.findBestTrackMatch(target, candidates);
  assert.ok(best);
  assert.equal(best.id, 103);
});

test('API Audit: YouTubeMusicService extractAlbumFromFlexColumns resolves both MPREb and runs-based albums', async () => {
  const { YouTubeMusicService } = await import('../src/desktop/main/services/youtubeMusic.ts');

  // Case 1: Explicit MPREb browse ID
  const flexExplicit = [
    {},
    {
      musicResponsiveListItemFlexColumnRenderer: {
        text: {
          runs: [
            { text: 'Linkin Park', navigationEndpoint: { browseEndpoint: { browseId: 'UC123' } } },
            { text: ' • ' },
            {
              text: 'Meteora',
              navigationEndpoint: { browseEndpoint: { browseId: 'MPREb_meteora' } },
            },
          ],
        },
      },
    },
  ];
  const resExplicit = YouTubeMusicService.extractAlbumFromFlexColumns(flexExplicit);
  assert.equal(resExplicit.albumTitle, 'Meteora');
  assert.equal(resExplicit.albumBrowseId, 'MPREb_meteora');

  // Case 2: Run-based album without MPREb browse ID
  const flexRuns = [
    {},
    {
      musicResponsiveListItemFlexColumnRenderer: {
        text: {
          runs: [
            { text: 'Deftones', navigationEndpoint: { browseEndpoint: { browseId: 'UC456' } } },
            { text: ' • ' },
            { text: 'White Pony' },
            { text: ' • ' },
            { text: '3:45' },
          ],
        },
      },
    },
  ];
  const resRuns = YouTubeMusicService.extractAlbumFromFlexColumns(flexRuns);
  assert.equal(resRuns.albumTitle, 'White Pony');
});
