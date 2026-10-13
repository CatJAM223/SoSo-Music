import test from 'node:test';
import assert from 'node:assert/strict';
import { MusicAggregatorService } from '../src/desktop/main/services/musicAggregator.ts';

const { interleaveTracks, cleanArtistId, deduplicateAlbums, deduplicateArtists } =
  MusicAggregatorService;

test('MusicAggregator: Clean interleaving of SoundCloud and YouTube tracks', () => {
  const scList = [
    { id: 'sc_1', title: 'SC 1', source: 'soundcloud' },
    { id: 'sc_2', title: 'SC 2', source: 'soundcloud' },
  ];
  const ytList = [
    { id: 'yt_1', title: 'YT 1', source: 'youtube' },
    { id: 'yt_2', title: 'YT 2', source: 'youtube' },
    { id: 'yt_3', title: 'YT 3', source: 'youtube' },
  ];

  const interleaved = interleaveTracks(scList, ytList);
  assert.equal(interleaved.length, 5);
  assert.equal(interleaved[0].id, 'sc_1');
  assert.equal(interleaved[0].source, 'soundcloud');
  assert.equal(interleaved[1].id, 'yt_1');
  assert.equal(interleaved[1].source, 'youtube');
  assert.equal(interleaved[2].id, 'sc_2');
  assert.equal(interleaved[2].source, 'soundcloud');
  assert.equal(interleaved[3].id, 'yt_2');
  assert.equal(interleaved[3].source, 'youtube');
  assert.equal(interleaved[4].id, 'yt_3');
  assert.equal(interleaved[4].source, 'youtube');
});

test('MusicAggregatorService: cleanArtistId strips prefixes and normalizes ID format', () => {
  assert.equal(MusicAggregatorService.cleanArtistId('sc_art_12345'), '12345');
  assert.equal(MusicAggregatorService.cleanArtistId('yt_UC_abc123'), 'UC abc123');
  assert.equal(MusicAggregatorService.cleanArtistId('sc_555'), '555');
  assert.equal(MusicAggregatorService.cleanArtistId('The Weeknd'), 'The Weeknd');
});

test('Artist All Tracks Aggregation: Deduplication and Remix retention', () => {
  const scTracks = [
    { id: '100', title: 'Starboy', artist: { name: 'The Weeknd' }, source: 'soundcloud' },
    {
      id: '200',
      title: 'Blinding Lights (Remix)',
      artist: { name: 'The Weeknd' },
      source: 'soundcloud',
    },
    { id: '300', title: 'Unreleased Track', artist: { name: 'The Weeknd' }, source: 'soundcloud' },
  ];

  const ytTracks = [
    { id: 'yt_1', title: 'Starboy', artist: { name: 'The Weeknd' }, source: 'youtube' },
    { id: 'yt_2', title: 'Save Your Tears', artist: { name: 'The Weeknd' }, source: 'youtube' },
  ];

  const result = MusicAggregatorService.mergeArtistTracks(scTracks, ytTracks);
  assert.equal(result.length, 4);
  assert.ok(result.some((t) => t.title === 'Starboy' && t.source === 'soundcloud'));
  assert.ok(result.some((t) => t.title === 'Blinding Lights (Remix)' && t.source === 'soundcloud'));
  assert.ok(result.some((t) => t.title === 'Unreleased Track' && t.source === 'soundcloud'));
  assert.ok(result.some((t) => t.title === 'Save Your Tears' && t.source === 'youtube'));
});

test('MusicAggregator: Clean Artist ID parsing strips sc_, yt_, and legacy dz_ prefixes without wiping name', () => {
  assert.equal(cleanArtistId('sc_art_123456'), '123456');
  assert.equal(cleanArtistId('sc_art_alan_walker'), 'alan walker');
  assert.equal(cleanArtistId('sc_morgenshtern'), 'morgenshtern');
  assert.equal(cleanArtistId('yt_art_linkin_park'), 'linkin park');
  assert.equal(cleanArtistId('dz_art_daft_punk'), 'daft punk');
  assert.equal(cleanArtistId('The Weeknd'), 'The Weeknd');
});

test('SoundCloud: Search and Stream URL resolution model', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url) => {
    const u = String(url);
    if (u.includes('api-v2.soundcloud.com/tracks/12345678')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          media: {
            transcodings: [
              {
                format: { protocol: 'progressive', mime_type: 'audio/mpeg' },
                url: 'https://api-v2.soundcloud.com/media/test-transcoding',
              },
            ],
          },
        }),
      };
    }
    if (u.includes('/media/test-transcoding')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          url: 'https://cf-media.sndcdn.com/resolved-audio-stream.mp3',
        }),
      };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  });

  const directMediaTrack = {
    id: 12345678,
    title: 'Delicate',
    duration: 297,
    artist: { name: 'Headplate', source: 'soundcloud' },
    preview: 'https://cf-media.sndcdn.com/sample_media.mp3',
    source: 'soundcloud',
  };

  const streamUrl = await MusicAggregatorService.getFullStreamUrl(directMediaTrack);
  assert.equal(streamUrl, 'https://cf-media.sndcdn.com/resolved-audio-stream.mp3');
});

test('MusicAggregatorService: Multi-source discography, album deduplication and cover upgrade', () => {
  const scDetails = {
    artist: { id: 'sc_art_headplate', name: 'Headplate', source: 'soundcloud' },
    topTracks: [{ id: 'sc_1', title: 'Delicate', source: 'soundcloud' }],
    albums: [
      {
        id: 'sc_alb_1',
        title: 'Delicate',
        cover: 'https://images.unsplash.com/photo-stock?w=500',
        track_count: 13,
      },
      {
        id: 'sc_alb_2',
        title: 'Pieces',
        cover: 'https://i1.sndcdn.com/artworks-pieces-t500x500.jpg',
        track_count: 12,
      },
    ],
  };

  const ytDetails = {
    artist: { id: 'yt_art_headplate', name: 'Headplate', source: 'youtube' },
    topTracks: [{ id: 'yt_2', title: 'Bullsized', source: 'youtube' }],
    albums: [
      {
        id: 'yt_alb_1',
        title: 'delicate',
        cover: 'https://lh3.googleusercontent.com/delicate-real-cover=w544-h544',
        track_count: 13,
      },
      {
        id: 'yt_alb_3',
        title: '12-12-12',
        cover: 'https://lh3.googleusercontent.com/121212=w544-h544',
        track_count: 10,
      },
    ],
  };

  const allAlbums = [...scDetails.albums, ...ytDetails.albums];
  const uniqueAlbums = deduplicateAlbums(allAlbums);

  assert.equal(
    uniqueAlbums.length,
    3,
    '4 albums with 1 duplicate title should merge into 3 unique albums',
  );
  const delicate = uniqueAlbums.find((a) => a.title.toLowerCase() === 'delicate');
  assert.ok(delicate);
  assert.equal(
    delicate.cover,
    'https://lh3.googleusercontent.com/delicate-real-cover=w544-h544',
    'Should promote real cover over Unsplash placeholder',
  );
});

test('MusicAggregatorService: Search artists deduplicates artists across SoundCloud and YouTube', () => {
  const scArtists = [
    { id: 'sc_art_1', name: 'Linkin Park', source: 'soundcloud' },
    { id: 'sc_art_2', name: 'Bring Me The Horizon', source: 'soundcloud' },
  ];
  const ytArtists = [
    { id: 'yt_art_1', name: 'linkin park', source: 'youtube' },
    { id: 'yt_art_2', name: 'Architects', source: 'youtube' },
  ];

  const merged = deduplicateArtists([...scArtists, ...ytArtists]);
  assert.equal(merged.length, 3);
  assert.equal(merged[0].name, 'Linkin Park');
  assert.equal(merged[1].name, 'Bring Me The Horizon');
  assert.equal(merged[2].name, 'Architects');
});
