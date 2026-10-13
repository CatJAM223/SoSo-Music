import test from 'node:test';
import assert from 'node:assert/strict';
import {
  YouTubeMusicService,
  cleanYTTitle,
  parseDuration,
} from '../src/desktop/main/services/youtubeMusic.ts';
import {
  extractArtistsFromRuns,
  parsePlaylistPanelItem,
} from '../src/shared/services/parsers/youtubeMusicParser.ts';
import { resolveTrackCover } from '../src/shared/utils/formatters.ts';
import { extractAllArtists } from '../src/shared/utils/artistParser.ts';

test('YouTube Music: Clean title extraction from raw video titles', () => {
  const t1 = cleanYTTitle('Nirvana - Smells Like Teen Spirit (Official Music Video)');
  assert.equal(t1.artist, 'Nirvana');
  assert.equal(t1.title, 'Smells Like Teen Spirit');

  const t2 = cleanYTTitle('Король и Шут - Кукла колдуна [Official Audio]');
  assert.equal(t2.artist, 'Король и Шут');
  assert.equal(t2.title, 'Кукла колдуна');

  const t3 = cleanYTTitle('The Weeknd - Blinding Lights (Lyric Video)');
  assert.equal(t3.artist, 'The Weeknd');
  assert.equal(t3.title, 'Blinding Lights');
});

test('YouTube Music: Duration string parsing into seconds', () => {
  assert.equal(parseDuration('4:39'), 279);
  assert.equal(parseDuration('3:05'), 185);
  assert.equal(parseDuration('1:02:15'), 3735);
  assert.equal(parseDuration(''), 180);
  assert.equal(parseDuration(' 3:33 '), 213);
  assert.equal(parseDuration('236'), 236);
});

test('YouTube Music: ytmusicapi WEB_REMIX responsive shelf parser', () => {
  const mockShelf = {
    contents: [
      {
        musicResponsiveListItemRenderer: {
          playlistItemData: { videoId: '5hCE51oBszQ' },
          flexColumns: [
            {
              musicResponsiveListItemFlexColumnRenderer: {
                text: { runs: [{ text: 'Denial' }] },
              },
            },
            {
              musicResponsiveListItemFlexColumnRenderer: {
                text: {
                  runs: [
                    {
                      text: 'Sevendust',
                      navigationEndpoint: {
                        browseEndpoint: { browseId: 'UCQ9OsAvXM3OoI4bNmbVEq1Q' },
                      },
                    },
                    { text: ' • ' },
                    { text: 'Home' },
                    { text: ' • ' },
                    { text: '4:18' },
                  ],
                },
              },
            },
          ],
          thumbnail: {
            musicThumbnailRenderer: {
              thumbnail: {
                thumbnails: [{ url: 'https://lh3.googleusercontent.com/abc=w120-h120' }],
              },
            },
          },
        },
      },
    ],
  };

  const track = YouTubeMusicService.parseShelfItem(
    mockShelf.contents[0].musicResponsiveListItemRenderer,
  );
  assert.ok(track !== null);
  assert.equal(track.title, 'Denial');
  assert.equal(track.artist.name, 'Sevendust');
  assert.equal(track.album.title, 'Home');
  assert.ok(track.album.cover_big.includes('=w544-h544-l90-rj'));
  assert.ok(track.album.cover_medium.includes('=w226-h226-l90-rj'));
});

test('YouTube Music Search: Earshot - Wait verification (WEB_REMIX parsing)', () => {
  const earshotItem = {
    musicResponsiveListItemRenderer: {
      playlistItemData: { videoId: '54n7Xp2U1ab' },
      flexColumns: [
        { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'Wait' }] } } },
        {
          musicResponsiveListItemFlexColumnRenderer: {
            text: {
              runs: [
                { text: 'Earshot', navigationEndpoint: { browseEndpoint: { browseId: 'UC123' } } },
                { text: ' • ' },
                { text: 'Letting Go' },
                { text: ' • ' },
                { text: '3:33' },
              ],
            },
          },
        },
      ],
    },
  };

  const parsed = YouTubeMusicService.parseShelfItem(earshotItem.musicResponsiveListItemRenderer);
  assert.ok(parsed !== null);
  assert.equal(parsed.title, 'Wait');
  assert.equal(parsed.artist.name, 'Earshot');
  assert.equal(parsed.album.title, 'Letting Go');
  assert.equal(parsed.duration, 213);
});

test('YouTube Music Search: Headplate and Sevendust official tracks parsing', () => {
  const headplateItem = {
    musicResponsiveListItemRenderer: {
      playlistItemData: { videoId: 'hp_retina_1' },
      flexColumns: [
        { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'Retina' }] } } },
        {
          musicResponsiveListItemFlexColumnRenderer: {
            text: {
              runs: [
                {
                  text: 'Headplate',
                  navigationEndpoint: { browseEndpoint: { browseId: 'UC_headplate' } },
                },
                { text: ' • ' },
                { text: 'Delicate' },
                { text: ' • ' },
                { text: '3:15' },
              ],
            },
          },
        },
      ],
    },
  };

  const sevendustItem = {
    musicResponsiveListItemRenderer: {
      playlistItemData: { videoId: 'sd_waffle_1' },
      flexColumns: [
        { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'Waffle' }] } } },
        {
          musicResponsiveListItemFlexColumnRenderer: {
            text: {
              runs: [
                {
                  text: 'Sevendust',
                  navigationEndpoint: { browseEndpoint: { browseId: 'UC_sevendust' } },
                },
                { text: ' • ' },
                { text: 'Home' },
                { text: ' • ' },
                { text: '3:30' },
              ],
            },
          },
        },
      ],
    },
  };

  const hp = YouTubeMusicService.parseShelfItem(headplateItem.musicResponsiveListItemRenderer);
  assert.ok(hp !== null);
  assert.equal(hp.title, 'Retina');
  assert.equal(hp.artist.name, 'Headplate');
  assert.equal(hp.album.title, 'Delicate');
  assert.equal(hp.duration, 195);

  const sd = YouTubeMusicService.parseShelfItem(sevendustItem.musicResponsiveListItemRenderer);
  assert.ok(sd !== null);
  assert.equal(sd.title, 'Waffle');
  assert.equal(sd.artist.name, 'Sevendust');
  assert.equal(sd.album.title, 'Home');
  assert.equal(sd.duration, 210);
});

test('YouTube Music & Aggregator: getFullStreamUrl duration tolerance rejects SeregaMP (185s) for Earshot - Wait (213s)', () => {
  const targetDuration = 213; // 3:33 (Earshot - Wait)
  const candidates = [
    { id: 1, title: 'Earshot - Wait (cut by SeregaMP)', artist: 'Earshot', duration: 185 }, // 3:05 (diff: 28s -> reject)
    { id: 2, title: 'Earshot - Wait (Radio Edit)', artist: 'Earshot', duration: 195 }, // 3:15 (diff: 18s -> reject)
    { id: 3, title: 'Earshot - Wait', artist: 'Earshot', duration: 213 }, // 3:33 (diff: 0s -> MATCH)
  ];

  const valid = candidates.filter((c) =>
    YouTubeMusicService.isDurationAcceptable(targetDuration, c.duration),
  );
  assert.equal(valid.length, 1);
  assert.equal(valid[0].id, 3);
  assert.equal(valid[0].duration, 213);
  assert.equal(valid[0].title, 'Earshot - Wait');
});

test('YouTube Music Parser: Extracts duration from fixedColumns (runs and simpleText)', () => {
  const itemWithRuns = {
    playlistItemData: { videoId: 'abc123vid01' },
    flexColumns: [
      { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'Test Song' }] } } },
      { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'Test Artist' }] } } },
    ],
    fixedColumns: [
      {
        musicResponsiveListItemFixedColumnRenderer: {
          text: { runs: [{ text: '3:45' }] },
        },
      },
    ],
  };

  const itemWithSimpleText = {
    playlistItemData: { videoId: 'def456vid01' },
    flexColumns: [
      { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'Another Song' }] } } },
      {
        musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'Another Artist' }] } },
      },
    ],
    fixedColumns: [
      {
        musicResponsiveListItemFixedColumnRenderer: {
          text: { simpleText: '4:12' },
        },
      },
    ],
  };

  const parsed1 = YouTubeMusicService.parseShelfItem(itemWithRuns);
  assert.ok(parsed1 !== null);
  assert.equal(parsed1.duration, 225); // 3:45 = 225s

  const parsed2 = YouTubeMusicService.parseShelfItem(itemWithSimpleText);
  assert.ok(parsed2 !== null);
  assert.equal(parsed2.duration, 252); // 4:12 = 252s
});

test('YouTube Music: Multiple collaborating artists (feats) extraction from flexColumns', () => {
  const multiArtistShelfItem = {
    playlistItemData: { videoId: 'yt_feat_01x' },
    flexColumns: [
      {
        musicResponsiveListItemFlexColumnRenderer: {
          text: { runs: [{ text: 'грустная история' }] },
        },
      },
      {
        musicResponsiveListItemFlexColumnRenderer: {
          text: {
            runs: [
              { text: 'madk1d', navigationEndpoint: { browseEndpoint: { browseId: 'UC_madk1d' } } },
              { text: ', ' },
              {
                text: 'VILLIAN',
                navigationEndpoint: { browseEndpoint: { browseId: 'UC_villian' } },
              },
              { text: ' • ' },
              { text: 'Single' },
              { text: ' • ' },
              { text: '2:15' },
            ],
          },
        },
      },
    ],
  };

  const parsed = YouTubeMusicService.parseShelfItem(multiArtistShelfItem);
  assert.ok(parsed !== null);
  assert.equal(parsed.title, 'грустная история');
  assert.equal(parsed.artist.name, 'madk1d, VILLIAN');
  assert.equal(parsed.artist.id, 'yt_art_UC_madk1d');

  // Verify extractAllArtists correctly extracts both collaborating artists
  const allArtists = extractAllArtists(parsed.artist, parsed.title);
  assert.deepEqual(allArtists, ['madk1d', 'VILLIAN']);
});

test('YouTube Music: Multiple collaborating artists with & separator and Radio panel', () => {
  const runsWithAmpersand = [
    { text: 'Drake', navigationEndpoint: { browseEndpoint: { browseId: 'UC_drake' } } },
    { text: ' & ' },
    { text: '21 Savage', navigationEndpoint: { browseEndpoint: { browseId: 'UC_21' } } },
    { text: ' • ' },
    { text: 'Her Loss' },
    { text: ' • ' },
    { text: '3:20' },
  ];

  const extracted = extractArtistsFromRuns(runsWithAmpersand);
  assert.equal(extracted.artistName, 'Drake & 21 Savage');
  assert.equal(extracted.artistBrowseId, 'UC_drake');

  const radioPanelItem = {
    videoId: 'radioFeat01',
    title: { runs: [{ text: 'Rich Flex' }] },
    longBylineText: {
      runs: [
        { text: 'Drake', navigationEndpoint: { browseEndpoint: { browseId: 'UC_drake' } } },
        { text: ' & ' },
        { text: '21 Savage', navigationEndpoint: { browseEndpoint: { browseId: 'UC_21' } } },
      ],
    },
    lengthText: { simpleText: '3:59' },
  };

  const radioTrack = parsePlaylistPanelItem(radioPanelItem);
  assert.ok(radioTrack !== null);
  assert.equal(radioTrack.artist.name, 'Drake & 21 Savage');
  const artists = extractAllArtists(radioTrack.artist, radioTrack.title);
  assert.deepEqual(artists, ['Drake', '21 Savage']);
});

test('Queue Cover: resolveTrackCover robustly extracts covers from all track formats', () => {
  // 1. YouTube track with cover_medium
  const ytTrack = {
    id: 'yt_123',
    title: 'Song',
    album: { cover_medium: 'https://i.ytimg.com/vi/123/hqdefault.jpg' },
  };
  assert.equal(resolveTrackCover(ytTrack), 'https://i.ytimg.com/vi/123/hqdefault.jpg');

  // 2. SoundCloud track with -large. converts to -t500x500.
  const scTrack = {
    id: 'sc_456',
    title: 'SC Track',
    album: { cover_medium: 'https://i1.sndcdn.com/artworks-xyz-large.jpg' },
  };
  assert.equal(resolveTrackCover(scTrack), 'https://i1.sndcdn.com/artworks-xyz-t500x500.jpg');

  // 3. Track with cover_url (from DB / liked tracks / history)
  const dbTrack = {
    id: 789,
    title: 'Liked Track',
    cover_url: 'https://cdn.example.com/artwork.jpg',
  };
  assert.equal(resolveTrackCover(dbTrack), 'https://cdn.example.com/artwork.jpg');

  // 4. Track with artist picture fallback
  const artistPicTrack = {
    id: 'art_only',
    title: 'Artist Picture Track',
    artist: { picture_medium: 'https://cdn.example.com/avatar.jpg' },
  };
  assert.equal(resolveTrackCover(artistPicTrack), 'https://cdn.example.com/avatar.jpg');

  // 5. Rejection of broken Unsplash placeholder and fallback to default vinyl placeholder
  const unsplashTrack = {
    id: 'un_1',
    title: 'Unsplash Track',
    album: { cover_medium: 'https://images.unsplash.com/photo-1514525253161?w=500' },
  };
  assert.ok(resolveTrackCover(unsplashTrack).startsWith('data:image/svg+xml'));
});
