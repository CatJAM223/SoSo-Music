import test from 'node:test';
import assert from 'node:assert/strict';
import { fixMojibake, isMojibake } from '../src/shared/utils/formatters.ts';

import { SoundCloudService } from '../src/desktop/main/services/soundcloud.ts';

const transformSCTrack = SoundCloudService.transformSCTrack.bind(SoundCloudService);
const toSoundCloudHdCover = SoundCloudService.toSoundCloudHdCover.bind(SoundCloudService);
const extractPlaylistCover = SoundCloudService.extractPlaylistCover.bind(SoundCloudService);

export { transformSCTrack, toSoundCloudHdCover, extractPlaylistCover };

// ---------------------------------------------------------
// TESTS
// ---------------------------------------------------------

test('SoundCloud Service: Transform valid track with HD artwork and progressive stream', () => {
  const rawSC = {
    id: 123456789,
    title: 'The Weeknd - Blinding Lights',
    duration: 200000,
    artwork_url: 'https://i1.sndcdn.com/artworks-12345-0-large.jpg',
    user: {
      id: 999,
      username: 'The Weeknd',
      avatar_url: 'https://i1.sndcdn.com/avatars-999-large.jpg',
    },
    genre: 'R&B & Soul',
    media: {
      transcodings: [
        {
          format: { protocol: 'progressive', mime_type: 'audio/mpeg' },
          url: 'https://api-v2.soundcloud.com/media/tracks:123/stream/progressive',
        },
      ],
    },
  };

  const track = transformSCTrack(rawSC);
  assert.ok(track);
  assert.equal(track.id, 123456789);
  assert.equal(track.title, 'Blinding Lights');
  assert.equal(track.artist.name, 'The Weeknd');
  assert.equal(track.album.cover_medium, 'https://i1.sndcdn.com/artworks-12345-0-t500x500.jpg');
  assert.equal(track.duration, 200);
  assert.equal(track.preview, 'https://api-v2.soundcloud.com/media/tracks:123/stream/progressive');
});

test('SoundCloud Service: Automatic Mojibake recovery on track transformation', () => {
  const corruptedSC = {
    id: 531013077,
    title: 'Ãðàæäàíñêàÿ Îáîðîíà - Íåêðîôèëèÿ',
    duration: 185000,
    artwork_url: 'https://i1.sndcdn.com/artworks-000441101730-wdcvfu-large.jpg',
    publisher_metadata: {
      artist: 'Ãðàæäàíñêàÿ Îáîðîíà',
      album_title: 'Íåêðîôèëèÿ',
    },
    user: {
      id: 464015331,
      username: 'Ãðàæäàíñêàÿ Îáîðîíà',
      avatar_url: 'https://i1.sndcdn.com/avatars-000536762667-c3fpks-large.jpg',
    },
    media: {
      transcodings: [
        {
          format: { protocol: 'progressive' },
          url: 'https://api-v2/stream/progressive',
        },
      ],
    },
  };

  const track = transformSCTrack(corruptedSC);
  assert.ok(track);
  assert.equal(track.title, 'Некрофилия');
  assert.equal(track.artist.name, 'Гражданская Оборона');
  assert.equal(track.album.title, 'Некрофилия');
  assert.equal(
    track.album.cover,
    'https://i1.sndcdn.com/artworks-000441101730-wdcvfu-t500x500.jpg',
  );
});

test('SoundCloud Service: Exclude invalid, zero duration, or Go+ DRM locked tracks', () => {
  assert.equal(transformSCTrack(null), null);
  assert.equal(transformSCTrack({ id: 1 }), null);
  assert.equal(transformSCTrack({ id: 2, title: 'Zero dur', duration: 0 }), null);
  assert.equal(
    transformSCTrack({ id: 3, title: 'Blocked', duration: 180000, policy: 'BLOCK' }),
    null,
  );
  assert.equal(
    transformSCTrack({
      id: 4,
      title: 'Go+ Tier',
      duration: 180000,
      monetization_model: 'SUB_HIGH_TIER',
    }),
    null,
  );
});

test('SoundCloud Service: Prioritizes progressive MP3 over HLS and skips encrypted streams', () => {
  const multiTranscodingTrack = {
    id: 555,
    title: 'Multi Transcoding Track',
    duration: 180000,
    media: {
      transcodings: [
        { format: { protocol: 'cbc-encrypted-hls' }, url: 'https://api-v2/encrypted-1' },
        { format: { protocol: 'hls' }, url: 'https://api-v2/clean-hls' },
        { format: { protocol: 'progressive' }, url: 'https://api-v2/clean-progressive-mp3' },
      ],
    },
  };

  const track = transformSCTrack(multiTranscodingTrack);
  assert.ok(track);
  // Must choose progressive MP3 over HLS
  assert.equal(track.preview, 'https://api-v2/clean-progressive-mp3');
});

test('SoundCloud Service: toSoundCloudHdCover upgrades multiple thumbnail sizes to HD t500x500', () => {
  assert.equal(
    toSoundCloudHdCover('https://i1.sndcdn.com/artworks-000441101730-wdcvfu-large.jpg'),
    'https://i1.sndcdn.com/artworks-000441101730-wdcvfu-t500x500.jpg',
  );
  assert.equal(
    toSoundCloudHdCover('https://i1.sndcdn.com/artworks-000441101730-wdcvfu-t300x300.png'),
    'https://i1.sndcdn.com/artworks-000441101730-wdcvfu-t500x500.png',
  );
  assert.equal(
    toSoundCloudHdCover('https://i1.sndcdn.com/avatars-000536762667-c3fpks-crop.jpg'),
    'https://i1.sndcdn.com/avatars-000536762667-c3fpks-t500x500.jpg',
  );
});

test('SoundCloud Service: extractPlaylistCover correctly extracts track cover when playlist artwork_url is null', () => {
  const scAlbum = {
    id: 645383025,
    title: 'Некрофилия(1987)',
    artwork_url: null,
    track_count: 11,
    tracks: [
      {
        id: 531013077,
        title: 'Волна патриотизма',
        artwork_url: 'https://i1.sndcdn.com/artworks-000441101730-wdcvfu-large.jpg',
      },
      {
        id: 531018042,
        title: 'Какое мне дело',
        artwork_url: 'https://i1.sndcdn.com/artworks-000441106443-bcxltz-large.jpg',
      },
    ],
    user: {
      id: 464015331,
      username: 'Гражданская Оборона',
      avatar_url: 'https://i1.sndcdn.com/avatars-000536762667-c3fpks-large.jpg',
    },
  };

  const cover = extractPlaylistCover(
    scAlbum,
    'https://i1.sndcdn.com/avatars-000536762667-c3fpks-large.jpg',
  );
  assert.equal(cover, 'https://i1.sndcdn.com/artworks-000441101730-wdcvfu-t500x500.jpg');
});

test('SoundCloud Service: extractPlaylistCover prioritizes direct playlist artwork_url if present', () => {
  const scAlbumWithArt = {
    id: 12345,
    title: 'Custom Album',
    artwork_url: 'https://i1.sndcdn.com/artworks-custom-large.jpg',
    tracks: [
      { id: 1, title: 'Track 1', artwork_url: 'https://i1.sndcdn.com/artworks-track-large.jpg' },
    ],
  };

  const cover = extractPlaylistCover(scAlbumWithArt);
  assert.equal(cover, 'https://i1.sndcdn.com/artworks-custom-t500x500.jpg');
});

test('SoundCloud Service: extractPlaylistCover falls back to user avatar when playlist and tracks have no art', () => {
  const scAlbumNoArt = {
    id: 99999,
    title: 'No Art Album',
    artwork_url: null,
    tracks: [{ id: 1, title: 'Track 1', artwork_url: null }],
    user: {
      id: 777,
      avatar_url: 'https://i1.sndcdn.com/avatars-user-large.jpg',
    },
  };

  const cover = extractPlaylistCover(scAlbumNoArt);
  assert.equal(cover, 'https://i1.sndcdn.com/avatars-user-t500x500.jpg');
});

test('SoundCloud Service: Third-party uploader is not assigned as artist ID or avatar (madk1d vs chainsuvv!)', () => {
  const thirdPartyUpload = {
    id: 1828890516,
    title: 'madk1d - питер паркер',
    duration: 119000,
    artwork_url: 'https://i1.sndcdn.com/artworks-peterparker-large.jpg',
    user: {
      id: 1206154156,
      username: 'chainsuvv!',
      avatar_url: 'https://i1.sndcdn.com/avatars-chainsuvv-large.jpg',
    },
    media: {
      transcodings: [
        { format: { protocol: 'progressive' }, url: 'https://api-v2.soundcloud.com/stream/prog' },
      ],
    },
  };

  const track = transformSCTrack(thirdPartyUpload);
  assert.ok(track);
  assert.equal(track.title, 'питер паркер');
  assert.equal(track.artist.name, 'madk1d');
  // Must NOT assign chainsuvv's user ID to madk1d!
  assert.equal(track.artist.id, 'sc_art_madk1d');
  assert.notEqual(track.artist.id, 'sc_art_1206154156');
  // Must NOT assign chainsuvv's avatar to madk1d!
  assert.equal(track.artist.picture_medium, '');
  // Cover should remain the track's own artwork
  assert.equal(track.album.cover_medium, 'https://i1.sndcdn.com/artworks-peterparker-t500x500.jpg');
});

test('SoundCloud Service: Authentic artist uploader keeps their SoundCloud user ID and avatar', () => {
  const authenticUpload = {
    id: 1997776195,
    title: 'питер паркер',
    duration: 119000,
    artwork_url: 'https://i1.sndcdn.com/artworks-official-large.jpg',
    publisher_metadata: {
      artist: 'madk1d',
    },
    user: {
      id: 1250707696,
      username: 'madk1d',
      avatar_url: 'https://i1.sndcdn.com/avatars-madk1d-large.jpg',
    },
    media: {
      transcodings: [
        { format: { protocol: 'progressive' }, url: 'https://api-v2.soundcloud.com/stream/prog' },
      ],
    },
  };

  const track = transformSCTrack(authenticUpload);
  assert.ok(track);
  assert.equal(track.title, 'питер паркер');
  assert.equal(track.artist.name, 'madk1d');
  assert.equal(track.artist.id, 'sc_art_1250707696');
  assert.equal(track.artist.picture_medium, 'https://i1.sndcdn.com/avatars-madk1d-large.jpg');
});

test('SoundCloud excludes subscription policies and preview-only renditions despite full song duration', () => {
  const song = { id: 123, title: 'Nirvana - Lithium', duration: 250000 };
  const tc = (extra = {}) => ({
    url: 'https://api-v2.soundcloud.com/media/tracks:123/stream/progressive',
    format: { protocol: 'progressive' },
    ...extra,
  });
  for (const extra of [
    { policy: 'SNIP' },
    { policy: 'BLOCK' },
    { monetization_model: 'SUB_HIGH_TIER' },
    { media: { transcodings: [tc({ snipped: true })] } },
    { media: { transcodings: [tc({ url: 'https://api-v2.soundcloud.com/media/preview/123' })] } },
    { media: { transcodings: [tc({ duration: 30000 })] } },
    { duration: 30000, full_duration: 250000 },
  ])
    assert.equal(transformSCTrack({ ...song, ...extra }), null, JSON.stringify(extra));
});

test('SoundCloud chooses a full rendition over a progressive preview and preserves short full recordings', () => {
  const fullUrl = 'https://api-v2.soundcloud.com/media/tracks:124/stream/hls';
  const track = transformSCTrack({
    id: 124,
    title: 'Full song',
    duration: 180000,
    media: {
      transcodings: [
        {
          url: 'https://api-v2.soundcloud.com/media/short',
          snipped: true,
          duration: 30000,
          format: { protocol: 'progressive' },
        },
        { url: fullUrl, duration: 180000, format: { protocol: 'hls' } },
      ],
    },
  });
  assert.equal(track.preview, fullUrl);
  assert.ok(
    transformSCTrack({
      id: 125,
      title: 'Short interlude',
      duration: 30000,
      full_duration: 30000,
      media: {
        transcodings: [{ url: fullUrl, duration: 30000, format: { protocol: 'progressive' } }],
      },
    }),
  );
});

test('SoundCloud refuses a saved subscription track before falling back to its old stream endpoint', async (t) => {
  const urls = [];
  t.mock.method(SoundCloudService, 'getSoundCloudKey', async () => 'fixture');
  t.mock.method(SoundCloudService, 'fetchWithRelay', async (url) => {
    urls.push(url);
    return url.includes('/tracks/')
      ? { id: 910001, duration: 200000, policy: 'SNIP', media: { transcodings: [] } }
      : { url: 'https://cdn.example/preview/recording.mp3' };
  });
  const url = await SoundCloudService.getFullStreamUrl(
    {
      id: 910001,
      title: 'Saved premium recording',
      artist: { name: 'Artist' },
      album: {},
      duration: 200,
      preview: 'https://api-v2.soundcloud.com/media/old-stream',
    },
    { forceRefresh: true },
  );
  assert.equal(url, '');
  assert.equal(urls.length, 1);
});
