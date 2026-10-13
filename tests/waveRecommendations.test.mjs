import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeWaveBatchContext,
  normalizeWaveSeed,
  selectWaveRelatedSeeds,
  waveQueueContext,
  waveFamiliarArtists,
} from '../src/shared/utils/waveRecommendations.ts';
import { parseYouTubeRadioResponse } from '../src/shared/services/parsers/youtubeMusicParser.ts';
import { WaveEngine } from '../src/desktop/main/services/waveEngine.ts';
import { SoundCloudService } from '../src/desktop/main/services/soundcloud.ts';
import { YouTubeMusicService } from '../src/desktop/main/services/youtubeMusic.ts';
import { LastFmService } from '../src/desktop/main/services/lastfm.ts';

import { sequenceWaveTracks } from '../src/shared/utils/waveQueue.ts';

const track = (id, artist, title = `Melody ${id}`) => ({
  id,
  title,
  artist: { name: artist },
  album: { title: 'Single' },
  duration: 200,
  preview: '',
  source: String(id).startsWith('yt_') ? 'youtube' : 'soundcloud',
});
const radioResponse = (contents) => ({
  contents: {
    singleColumnMusicWatchNextResultsRenderer: {
      tabbedRenderer: {
        watchNextTabbedResultsRenderer: {
          tabs: [
            {
              tabRenderer: {
                content: {
                  musicQueueRenderer: { content: { playlistPanelRenderer: { contents } } },
                },
              },
            },
          ],
        },
      },
    },
  },
});
const panel = (videoId, artist = 'Radio Singer') => ({
  playlistPanelVideoRenderer: {
    videoId,
    title: { runs: [{ text: 'A new melody' }] },
    longBylineText: {
      runs: [{ text: artist, navigationEndpoint: { browseEndpoint: { browseId: 'UC_artist' } } }],
    },
    lengthText: { simpleText: '3:20' },
  },
});

test('Session IPC context bounds history and feedback and drops runtime URLs and unrelated metadata', () => {
  const context = normalizeWaveBatchContext({
    recentTracks: Array.from({ length: 370 }, (_, i) => ({
      ...track(String(i), 'Singer'),
      resolvedStreamUrl: 'https://signed.invalid/audio',
      cover_url: 'data:image/png;base64,abc',
    })),
    artistFeedback: { SINGER: 100, bad: NaN },
    extra: 'not shared',
  });
  assert.equal(context.recentTracks.length, 300);
  assert.equal(context.recentTracks[0].id, '70');
  assert.equal(context.artistFeedback.singer, 2);
  assert.equal(context.artistFeedback.bad, undefined);
  assert.equal(context.recentTracks[0].resolvedStreamUrl, undefined);
  assert.equal(context.recentTracks[0].cover_url, undefined);
  assert.deepEqual(normalizeWaveBatchContext('wrong'), {});
});

test('Related retrieval normalizes desktop likes, mobile likes and playlist database identities', () => {
  const seed = normalizeWaveSeed({
    id: 99,
    deezer_id: 'yt_abcdefghijk',
    artist: 'Singer',
    preview_url: 'https://www.youtube.com/watch?v=abcdefghijk',
    album: 'Release',
  });
  assert.equal(seed.id, 'yt_abcdefghijk');
  assert.equal(seed.source, 'youtube');
  assert.equal(seed.artist.name, 'Singer');
  assert.equal(seed.album.title, 'Release');
  assert.equal(
    selectWaveRelatedSeeds([{ deezer_id: 'yt_abcdefghijk', artist: 'Singer' }])[0].id,
    seed.id,
  );
  assert.equal(normalizeWaveSeed({ id: 'undefined' }), null);
});

test('Radio anchors cover different artists and both sources, without duplicate provider identities', () => {
  const seeds = [
    track('yt_abcdefghijk', 'A'),
    track('yt_bcdefghijkl', 'A'),
    track('yt_cdefghijklm', 'B'),
    track('sc_12345', 'C'),
  ];
  const result = selectWaveRelatedSeeds([...seeds, seeds[0]], {}, 3, () => 0);
  assert.equal(result.length, 3);
  assert.equal(new Set(result.map((t) => t.artist.name)).size, 3);
  assert.deepEqual(new Set(result.map((t) => t.source)), new Set(['youtube', 'soundcloud']));
  assert.equal(selectWaveRelatedSeeds(seeds, {}, 0).length, 0);
});

test('Recently repeated and temporarily skipped anchors lose priority, while small taste still works', () => {
  const seeds = [
    track('yt_abcdefghijk', 'A'),
    track('yt_bcdefghijkl', 'B'),
    track('yt_cdefghijklm', 'C'),
  ];
  const context = {
    recentTracks: Array.from({ length: 12 }, (_, i) => track(`past${i}`, 'A')),
    artistFeedback: { b: -2 },
  };
  assert.equal(selectWaveRelatedSeeds(seeds, context, 1, () => 0)[0].artist.name, 'C');
  assert.equal(selectWaveRelatedSeeds([seeds[0]], context, 3, () => 0).length, 1);
});

test('Shared radio parser drops unplayable entries, unknown renderers, invalid IDs and duplicate songs', () => {
  const blocked = panel('cdefghijklm');
  blocked.playlistPanelVideoRenderer.isPlayable = false;
  const response = radioResponse([
    panel('abcdefghijk'),
    panel('abcdefghijk'),
    panel('short'),
    blocked,
    { continuationItemRenderer: {} },
    panel('bcdefghijkl', 'Another'),
  ]);
  const result = parseYouTubeRadioResponse(response, 20);
  assert.deepEqual(
    result.map((t) => t.id),
    ['yt_abcdefghijk', 'yt_bcdefghijkl'],
  );
  assert.equal(result[0].duration, 200);
  assert.equal(result[0].source, 'youtube');
  assert.equal(parseYouTubeRadioResponse(response, 0).length, 0);
  assert.equal(parseYouTubeRadioResponse({}).length, 0);
});

for (const mobile of [false])
  test(`${'Desktop'} YT-heavy wave discovers relevant new artists even when Last.fm is empty`, async (t) => {
    const label = 'desktop';
    const engine = WaveEngine;
    const seeds = [
      track('yt_abcdefghijk', `${label} familiar A`),
      track('yt_bcdefghijkl', `${label} familiar B`),
    ];
    const calls = [];
    const radio = async (id) => {
      calls.push(id);
      return Array.from({ length: 12 }, (_, i) =>
        track(
          `yt_${label}_new_${id}_${i}`,
          `${label} radio ${id} ${i}`,
          `${label} Branch ${id} Tune${i}`,
        ),
      );
    };
    const search = async (artist) => ({
      data: seeds
        .filter((s) => s.artist.name === artist)
        .flatMap((seed) =>
          Array.from({ length: 5 }, (_, i) =>
            track(`${label}_known_${seed.id}_${i}`, artist, `${label} Familiar${i}`),
          ),
        ),
    });
    {
      t.mock.method(LastFmService, 'getSimilarArtists', async () => []);
      t.mock.method(YouTubeMusicService, 'getRadioTracks', radio);
      t.mock.method(SoundCloudService, 'search', search);
      t.mock.method(YouTubeMusicService, 'search', async () => ({ data: [] }));
    }
    const result = await engine.getWaveBatch('default', seeds);
    assert.equal(new Set(calls).size, 2);
    assert.ok(new Set(result.map((t) => t.artist.name)).size >= 8);
    assert.ok(result.some((t) => t.artist.name === seeds[0].artist.name));
    assert.ok(result.filter((t) => t.artist.name.includes('radio')).length <= 18);
  });

test('Durable familiar taste survives recent positive seeds and session context changes every mood ordering', () => {
  assert.deepEqual(
    waveFamiliarArtists(
      [{ deezer_id: 'sc_1', artist: 'Longtime favorite' }],
      [{ name: 'Followed musician' }],
      [track('sc_2', 'New discovery')],
    ),
    ['Longtime favorite', 'Followed musician', 'New discovery'],
  );
  const frequent = Array.from({ length: 32 }, (_, i) => track(`played${i}`, 'Frequent'));
  const pool = [track('freshA', 'Frequent'), track('freshB', 'Fresh favorite')];
  for (const mood of ['default', 'energy', 'chill', 'discover', 'mix', 'favorites']) {
    const result = sequenceWaveTracks(
      pool,
      mood,
      ['Frequent', 'Fresh favorite'],
      25,
      waveQueueContext({ recentTracks: frequent, artistFeedback: { frequent: 2 } }),
    );
    assert.equal(result[0].artist.name, 'Fresh favorite');
    assert.equal(result.length, 2);
  }
});

test('Related discovery detours strongly skipped artists when another musical anchor is available', () => {
  const disliked = track('yt_abcdefghijk', 'Skipped musician');
  const first = track('yt_bcdefghijkl', 'Fresh musician');
  const second = track('301', 'Another musician');
  second.source = 'soundcloud';
  const context = { artistFeedback: { 'skipped musician': -1.2 } };
  const anchors = selectWaveRelatedSeeds([disliked, first, second], context, 3, () => 0);
  assert.deepEqual(
    new Set(anchors.map((t) => t.artist.name)),
    new Set(['Fresh musician', 'Another musician']),
  );
  assert.equal(
    selectWaveRelatedSeeds([disliked], context, 3, () => 0)[0].id,
    disliked.id,
    'Small profiles retain a fallback instead of starving',
  );
});
