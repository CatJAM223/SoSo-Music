import test from 'node:test';
import assert from 'node:assert/strict';
import { fixMojibake } from '../src/shared/utils/formatters.ts';
import { SoundCloudService } from '../src/desktop/main/services/soundcloud.ts';
import { YouTubeMusicService } from '../src/desktop/main/services/youtubeMusic.ts';
import { MusicAggregatorService } from '../src/desktop/main/services/musicAggregator.ts';

const toSoundCloudHdCover = SoundCloudService.toSoundCloudHdCover;
const extractPlaylistCover = SoundCloudService.extractPlaylistCover;
const hydratePlaylistTracks = SoundCloudService.hydratePlaylistTracks;
const deduplicateAlbums = MusicAggregatorService.deduplicateAlbums;
const mergeArtistTracks = MusicAggregatorService.mergeArtistTracks;

// ---------------------------------------------------------
// TESTS
// ---------------------------------------------------------

test('Artist Discography: extractPlaylistCover prioritizes direct artwork_url', () => {
  const playlist = {
    id: 101,
    title: 'Greatest Hits',
    artwork_url: 'https://i1.sndcdn.com/artworks-direct-large.jpg',
    tracks: [{ id: 1, artwork_url: 'https://i1.sndcdn.com/artworks-track1-large.jpg' }],
    user: { avatar_url: 'https://i1.sndcdn.com/avatars-user-large.jpg' },
  };

  const cover = extractPlaylistCover(playlist);
  assert.equal(cover, 'https://i1.sndcdn.com/artworks-direct-t500x500.jpg');
});

test('Artist Discography: extractPlaylistCover extracts from first track with artwork when playlist artwork_url is null', () => {
  const playlist = {
    id: 202,
    title: 'Некрофилия (1987)',
    artwork_url: null,
    tracks: [
      { id: 1, title: 'Track 1 (no art)', artwork_url: null },
      { id: 2, title: 'Track 2 (empty art)', artwork_url: '' },
      {
        id: 3,
        title: 'Волна патриотизма',
        artwork_url: 'https://i1.sndcdn.com/artworks-000441101730-wdcvfu-large.jpg',
      },
      { id: 4, title: 'Track 4', artwork_url: 'https://i1.sndcdn.com/artworks-other-large.jpg' },
    ],
    user: { avatar_url: 'https://i1.sndcdn.com/avatars-000536762667-c3fpks-large.jpg' },
  };

  const cover = extractPlaylistCover(playlist);
  assert.equal(cover, 'https://i1.sndcdn.com/artworks-000441101730-wdcvfu-t500x500.jpg');
});

test('Artist Discography: extractPlaylistCover falls back to user avatar when playlist and tracks lack artwork', () => {
  const playlist = {
    id: 303,
    title: 'Acoustic Bootlegs',
    artwork_url: null,
    tracks: [
      { id: 1, artwork_url: null },
      { id: 2, artwork_url: '' },
    ],
    user: { avatar_url: 'https://i1.sndcdn.com/avatars-user123-large.jpg' },
  };

  const cover = extractPlaylistCover(playlist);
  assert.equal(cover, 'https://i1.sndcdn.com/avatars-user123-t500x500.jpg');
});

test('Artist Discography: extractPlaylistCover rejects default generic stock avatars', () => {
  const playlistWithStockAvatar = {
    id: 404,
    title: 'Rarities',
    artwork_url: null,
    tracks: [{ id: 1, artwork_url: null }],
    user: { avatar_url: 'https://a1.sndcdn.com/images/default_avatar_large.png' },
  };

  // When playlist user has default_avatar, fall back to artist avatar if available
  const artistAvatar = 'https://i1.sndcdn.com/avatars-real-artist-large.jpg';
  const cover = extractPlaylistCover(playlistWithStockAvatar, artistAvatar);
  assert.equal(cover, 'https://i1.sndcdn.com/avatars-real-artist-t500x500.jpg');

  // If fallback avatar is also default_avatar, return empty string (avoiding stock avatar)
  const coverNoFallback = extractPlaylistCover(
    playlistWithStockAvatar,
    'https://a1.sndcdn.com/images/default_avatar_large.png',
  );
  assert.equal(coverNoFallback, '');
});

test('Artist Discography: toSoundCloudHdCover upgrades diverse thumbnail formats to t500x500', () => {
  assert.equal(
    toSoundCloudHdCover('https://i1.sndcdn.com/artworks-xyz-large.jpg'),
    'https://i1.sndcdn.com/artworks-xyz-t500x500.jpg',
  );
  assert.equal(
    toSoundCloudHdCover('https://i1.sndcdn.com/artworks-xyz-t300x300.jpg'),
    'https://i1.sndcdn.com/artworks-xyz-t500x500.jpg',
  );
  assert.equal(
    toSoundCloudHdCover('https://i1.sndcdn.com/avatars-xyz-crop.jpg'),
    'https://i1.sndcdn.com/avatars-xyz-t500x500.jpg',
  );
  assert.equal(
    toSoundCloudHdCover('https://i1.sndcdn.com/artworks-xyz-small.png'),
    'https://i1.sndcdn.com/artworks-xyz-t500x500.png',
  );
  assert.equal(
    toSoundCloudHdCover('https://i1.sndcdn.com/artworks-xyz-badge.jpg'),
    'https://i1.sndcdn.com/artworks-xyz-t500x500.jpg',
  );
  assert.equal(toSoundCloudHdCover(null), '');
  assert.equal(toSoundCloudHdCover(''), '');
});

test('Artist Discography: SoundCloudService.getAlbumTracks batch hydration for playlist stub tracks', async (t) => {
  const fetchedBatches = [];
  t.mock.method(SoundCloudService, 'getSoundCloudKey', async () => 'test-client-id');

  const playlist = {
    id: 5001,
    title: 'Complete Collection',
    tracks: [
      { id: 101, title: 'Track 1', duration: 180000, user: { id: 1, username: 'Artist' } },
      { id: 102, title: 'Track 2', duration: 210000, user: { id: 1, username: 'Artist' } },
      { id: 103 }, // stub
      { id: 104 }, // stub
      { id: 105 }, // stub
      { id: 106 }, // stub
      { id: 107 }, // stub
    ],
    user: { avatar_url: 'https://avatar.jpg' },
  };

  t.mock.method(SoundCloudService, 'fetchWithRelay', async (endpoint) => {
    const ep = String(endpoint);
    if (ep.includes('/playlists/5001')) {
      return playlist;
    }
    if (ep.includes('/tracks?ids=')) {
      const idsMatch = ep.match(/ids=([^&]+)/);
      const idsStr = idsMatch ? decodeURIComponent(idsMatch[1]) : '';
      const ids = idsStr.split(',').map((x) => parseInt(x, 10));
      fetchedBatches.push(ids);
      return ids.map((id) => ({
        id,
        title: `Ãðàæäàíñêàÿ Îáîðîíà - Track ${id}`, // corrupted mojibake title
        duration: 195000,
        user: { id: 1, username: 'Ãðàæäàíñêàÿ Îáîðîíà' },
      }));
    }
    return null;
  });

  const tracks = await SoundCloudService.getAlbumTracks(5001, 'Complete Collection');

  assert.equal(tracks.length, 7);
  assert.equal(fetchedBatches.length, 1);
  assert.deepEqual(fetchedBatches[0], [103, 104, 105, 106, 107]);

  // Check that stub track was hydrated AND mojibake was repaired!
  assert.equal(tracks[0].title, 'Track 1');
  assert.equal(tracks[2].id, 103);
  assert.equal(tracks[2].title, 'Track 103');
  assert.equal(tracks[2].artist.name, 'Гражданская Оборона');
  assert.equal(tracks[2].duration, 195);
});

test('Artist Discography: SoundCloudService.getAlbumTracks chunks stub tracks exceeding 50 IDs into multiple batches', async (t) => {
  const fetchedBatches = [];
  t.mock.method(SoundCloudService, 'getSoundCloudKey', async () => 'test-client-id');

  const stubTracks = [];
  for (let i = 1; i <= 110; i++) {
    stubTracks.push({ id: 1000 + i });
  }

  const playlist = {
    id: 9999,
    title: 'Massive Box Set',
    tracks: stubTracks,
    user: { avatar_url: 'https://avatar.jpg' },
  };

  t.mock.method(SoundCloudService, 'fetchWithRelay', async (endpoint) => {
    const ep = String(endpoint);
    if (ep.includes('/playlists/9999')) {
      return playlist;
    }
    if (ep.includes('/tracks?ids=')) {
      const idsMatch = ep.match(/ids=([^&]+)/);
      const idsStr = idsMatch ? decodeURIComponent(idsMatch[1]) : '';
      const ids = idsStr.split(',').map((x) => parseInt(x, 10));
      fetchedBatches.push(ids);
      return ids.map((id) => ({
        id,
        title: `Song ${id}`,
        duration: 180000,
        user: { id: 1, username: 'Band' },
      }));
    }
    return null;
  });

  const tracks = await SoundCloudService.getAlbumTracks(9999, 'Massive Box Set');

  assert.equal(tracks.length, 110);
  assert.equal(
    fetchedBatches.length,
    3,
    '110 tracks chunked by 50 should produce 3 batches (50 + 50 + 10)',
  );
  assert.equal(fetchedBatches[0].length, 50);
  assert.equal(fetchedBatches[1].length, 50);
  assert.equal(fetchedBatches[2].length, 10);
});

test('Artist Discography: MusicAggregator deduplicates albums and promotes HD cover over stock photo', () => {
  const soundCloudAlbums = [
    {
      id: 'sc_alb_1',
      title: 'After Hours',
      cover: 'https://images.unsplash.com/photo-stock?w=500', // Unsplash fallback
      track_count: 14,
      release_date: '2020-03-20',
      source: 'soundcloud',
    },
    {
      id: 'sc_alb_2',
      title: 'Dawn FM',
      cover: 'https://i1.sndcdn.com/artworks-dawnfm-t500x500.jpg',
      track_count: 16,
      release_date: '2022-01-07',
      source: 'soundcloud',
    },
  ];

  const youtubeAlbums = [
    {
      id: 'yt_alb_1',
      title: 'after hours', // Duplicate title with lower case
      cover: 'https://lh3.googleusercontent.com/real-hd-cover=w544-h544', // Real HD artwork!
      track_count: 14,
      release_date: '2020-03-20',
      source: 'youtube',
    },
    {
      id: 'yt_alb_3',
      title: 'Starboy',
      cover: 'https://lh3.googleusercontent.com/starboy=w544-h544',
      track_count: 18,
      release_date: '2016-11-25',
      source: 'youtube',
    },
  ];

  const merged = deduplicateAlbums([...soundCloudAlbums, ...youtubeAlbums]);

  assert.equal(merged.length, 3, 'Should merge "After Hours" duplicate');
  const afterHours = merged.find((a) => a.title.toLowerCase() === 'after hours');
  assert.ok(afterHours);
  // Real HD cover from YouTube must replace the Unsplash fallback
  assert.equal(afterHours.cover, 'https://lh3.googleusercontent.com/real-hd-cover=w544-h544');

  const dawnFm = merged.find((a) => a.title === 'Dawn FM');
  assert.equal(dawnFm.cover, 'https://i1.sndcdn.com/artworks-dawnfm-t500x500.jpg');
});

test('Artist Discography: Preserves Remixes and Edits while deduplicating exact matches', () => {
  const scTracks = [
    { id: 'sc_1', title: 'Blinding Lights', duration: 200, source: 'soundcloud' },
    {
      id: 'sc_2',
      title: 'Blinding Lights (Chromatics Remix)',
      duration: 245,
      source: 'soundcloud',
    },
    { id: 'sc_3', title: 'Save Your Tears (Acoustic)', duration: 190, source: 'soundcloud' },
  ];

  const ytTracks = [
    { id: 'yt_1', title: 'Blinding Lights', duration: 200, source: 'youtube' }, // Duplicate of sc_1
    { id: 'yt_2', title: 'In Your Eyes', duration: 237, source: 'youtube' },
  ];

  const result = mergeArtistTracks(scTracks, ytTracks);
  assert.equal(result.length, 4);
  assert.ok(result.some((t) => t.id === 'sc_1'));
  assert.ok(result.some((t) => t.title.includes('Remix')));
  assert.ok(result.some((t) => t.title.includes('Acoustic')));
  assert.ok(result.some((t) => t.id === 'yt_2'));
  // Duplicate YouTube Blinding Lights was cleanly omitted in favor of primary SoundCloud
  assert.ok(!result.some((t) => t.id === 'yt_1'));
});

test('Artist Discography: Maps tracks with Single to real albums from artist collections', () => {
  const playlists = [
    {
      id: 1853426289,
      title: 'Реанимация',
      artwork_url: 'https://i1.sndcdn.com/artworks-reanim-large.jpg',
      tracks: [
        { id: 1877877489, title: 'Собаки' },
        { id: 1877877490, title: 'Родина' },
        { id: 1877877491, title: 'Хороший Автобус' },
      ],
    },
    {
      id: 1853433372,
      title: 'Долгая Счастливая Жизнь',
      artwork_url: 'https://i1.sndcdn.com/artworks-dszh-large.jpg',
      tracks: [
        { id: 1877892006, title: 'Без Меня' },
        { id: 1877891943, title: 'Белые Солдаты' },
      ],
    },
  ];

  const rawTopTracks = [
    { id: 1877877489, title: 'Собаки', album: { id: 1877877489, title: 'Single' } },
    { id: 1877877490, title: 'Родина', album: { id: 1877877490, title: 'Single' } },
    { id: 1877892006, title: 'Без Меня', album: { id: 1877892006, title: 'Single' } },
    { id: 9999999999, title: 'Новый Сингл', album: { id: 9999999999, title: 'Single' } },
  ];

  const resolved = SoundCloudService.resolveTrackAlbums(rawTopTracks, playlists);

  assert.equal(resolved[0].album.title, 'Реанимация');
  assert.equal(resolved[0].album.id, 1853426289);
  assert.equal(resolved[0].album.cover, 'https://i1.sndcdn.com/artworks-reanim-t500x500.jpg');

  assert.equal(resolved[1].album.title, 'Реанимация');
  assert.equal(resolved[2].album.title, 'Долгая Счастливая Жизнь');
  assert.equal(resolved[2].album.id, 1853433372);

  // Unlinked single stays Single
  assert.equal(resolved[3].album.title, 'Single');
});

test('Artist Discography: YouTube Music flexColumns extracts real album and browseId', () => {
  const flexColumns = [
    {
      musicResponsiveListItemFlexColumnRenderer: {
        text: { runs: [{ text: 'Про дурачка' }] },
      },
    },
    {
      musicResponsiveListItemFlexColumnRenderer: {
        text: {
          runs: [
            {
              text: 'Гражданская оборона',
              navigationEndpoint: { browseEndpoint: { browseId: 'UCeMsJJOE6avjyvbqP4Kf24g' } },
            },
          ],
        },
      },
    },
    {
      musicResponsiveListItemFlexColumnRenderer: {
        text: { runs: [{ text: '5,1 млн прослушиваний' }] },
      },
    },
    {
      musicResponsiveListItemFlexColumnRenderer: {
        text: {
          runs: [
            {
              text: 'Лунный переворот',
              navigationEndpoint: { browseEndpoint: { browseId: 'MPREb_7wrYD8LxZ09' } },
            },
          ],
        },
      },
    },
  ];

  const { albumTitle, albumBrowseId } =
    YouTubeMusicService.extractAlbumFromFlexColumns(flexColumns);

  assert.equal(albumTitle, 'Лунный переворот');
  assert.equal(albumBrowseId, 'MPREb_7wrYD8LxZ09');
});

test('Artist Discography: SoundCloudService.getArtistAllTracks resolves non-numeric slug into numeric ID to fetch official tracks and albums', async (t) => {
  let getArtistCalled = false;
  const requestedUrls = [];

  t.mock.method(SoundCloudService, 'getSoundCloudKey', async () => 'mock_client_id');

  t.mock.method(SoundCloudService, 'getArtist', async (idOrName, artistName) => {
    getArtistCalled = true;
    return {
      artist: {
        id: 'sc_art_987654321',
        name: 'The Weeknd',
        picture: '',
        picture_medium: '',
        picture_big: '',
        picture_xl: '',
        nb_album: 5,
        nb_fan: 1000000,
        source: 'soundcloud',
      },
      topTracks: [],
      albums: [],
    };
  });

  t.mock.method(SoundCloudService, 'fetchWithRelay', async (url) => {
    requestedUrls.push(url);
    if (url.includes('/users/987654321/tracks')) {
      return {
        collection: [
          {
            id: 1001,
            title: 'Blinding Lights',
            duration: 200000,
            user: { id: 987654321, username: 'The Weeknd' },
            media: {
              transcodings: [
                {
                  format: { protocol: 'progressive', mime_type: 'audio/mpeg' },
                  url: 'https://stream',
                },
              ],
            },
          },
        ],
      };
    }
    if (url.includes('/users/987654321/albums')) {
      return {
        collection: [
          {
            id: 5001,
            title: 'After Hours',
            tracks: [{ id: 1001 }],
          },
        ],
      };
    }
    return { collection: [] };
  });

  // Call with string slug instead of numeric ID
  const tracks = await SoundCloudService.getArtistAllTracks('the_weeknd', 'The Weeknd');

  assert.ok(getArtistCalled, 'getArtist should be called to resolve string slug to numeric ID');
  assert.ok(
    requestedUrls.some((u) => u.includes('/users/987654321/tracks')),
    'Should fetch tracks using resolved numeric user ID',
  );
  assert.ok(
    requestedUrls.some((u) => u.includes('/users/987654321/albums')),
    'Should fetch albums using resolved numeric user ID',
  );
  assert.ok(tracks.length > 0, 'Should return aggregated tracks');
  assert.equal(tracks[0].title, 'Blinding Lights');
  assert.equal(tracks[0].album?.title, 'After Hours', 'Album association should be resolved');
});

test('Artist Discography: YouTubeMusicService.getArtistAllTracks includes every release with bounded concurrency', async (t) => {
  const requestedAlbums = [];
  let active = 0,
    maxActive = 0;

  // Mock artist with 14 albums
  t.mock.method(YouTubeMusicService, 'getArtist', async () => {
    const albums = [];
    for (let i = 1; i <= 14; i++) {
      albums.push({
        id: `yt_alb_album_${i}`,
        title: `Album ${i}`,
        cover_medium: '',
        source: 'youtube',
      });
    }
    return {
      artist: {
        id: 'yt_art_test_artist',
        name: 'Prolific Artist',
        picture: '',
        picture_medium: '',
        picture_big: '',
        picture_xl: '',
        nb_album: 14,
        nb_fan: 50000,
        source: 'youtube',
      },
      topTracks: [
        {
          id: 'yt_top_1',
          title: 'Top Hit 1',
          duration: 180,
          source: 'youtube',
          artist: { id: 'yt_art_test_artist', name: 'Prolific Artist' },
        },
      ],
      albums,
    };
  });

  t.mock.method(YouTubeMusicService, 'getAlbumTracks', async (albumId, albumTitle, artistName) => {
    active++;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setImmediate(resolve));
    requestedAlbums.push(albumId);
    active--;
    return [
      {
        id: `yt_trk_from_${albumId}`,
        title: `Track from ${albumTitle}`,
        duration: 210,
        source: 'youtube',
        artist: { id: 'yt_art_test_artist', name: artistName },
      },
    ];
  });

  const tracks = await YouTubeMusicService.getArtistAllTracks(
    'yt_art_test_artist',
    'Prolific Artist',
  );

  assert.equal(requestedAlbums.length, 14, 'Every discovered release must be included');
  assert.ok(maxActive <= 3, 'Provider requests remain bounded');
  assert.equal(tracks.length, 15);
  assert.equal(tracks[0].id, 'yt_top_1');
});
