import test from 'node:test';
import assert from 'node:assert/strict';
import { SoundCloudService as sc } from '../src/desktop/main/services/soundcloud.ts';
import {
  isValidTrackForArtist,
  transformSCTrack,
} from '../src/shared/services/parsers/soundCloudParser.ts';
import { downloadAudioBytes } from '../src/desktop/main/services/audioDownload.ts';
import { trackArtworkCandidates, advanceTrackArtwork } from '../src/shared/utils/trackArtwork.ts';

test('Album recovery rejects unrelated playlists and another artist even when marked as an album', async (t) => {
  const opened = [];
  t.mock.method(sc, 'fetchPlaylistTracksById', async (id) => {
    opened.push(id);
    return id === '111' ? null : [{ id: 1 }];
  });
  t.mock.method(sc, 'searchPlaylists', async () => [
    { id: 222, title: 'Unrelated', user: { username: 'Other' } },
    { id: 333, title: 'Wanted album', is_album: true, user: { username: 'Other' } },
    { id: 334, title: 'Wanted album', is_album: true, user: { username: 'Singer tribute' } },
  ]);
  assert.deepEqual(await sc.getAlbumTracks(111, 'Wanted album', 'Singer'), []);
  assert.deepEqual(opened, ['111']);
  sc.searchPlaylists.mock.mockImplementation(async () => [
    { id: 444, title: 'Wanted album', user: { username: 'Singer' } },
  ]);
  assert.deepEqual(await sc.getAlbumTracks(111, 'Wanted album', 'Singer'), [{ id: 1 }]);
  assert.equal(opened.at(-1), '444');
});

test('Old numeric track-as-album IDs cannot open an unrelated existing playlist', async (t) => {
  t.mock.method(sc, 'getSoundCloudKey', async () => 'fixture');
  t.mock.method(sc, 'fetchWithRelay', async () => ({
    id: 123,
    title: 'Other album',
    user: { username: 'Other' },
    tracks: [{ id: 1, title: 'Wrong song', duration: 180000 }],
  }));
  t.mock.method(sc, 'searchPlaylists', async () => []);
  assert.deepEqual(await sc.getAlbumTracks(123, 'Wanted album', 'Singer'), []);
});

test('Track metadata does not manufacture a numeric playlist ID for an album', () => {
  const track = transformSCTrack({
    id: 123,
    title: 'Song',
    duration: 180000,
    publisher_metadata: { artist: 'Singer', album_title: 'Album' },
  });
  assert.equal(track.id, 123);
  assert.equal(track.album.title, 'Album');
  assert.equal(track.album.id, 'sc_track_album_123');
});

test('Artist filtering preserves exact names across scripts and Unicode compatibility forms', () => {
  for (const name of [
    '宇多田ヒカル',
    '아이유',
    'Μουσική',
    'Молчат Дома',
    'Beyoncé',
    'Ｓｉｎｇｅｒ',
  ]) {
    assert.equal(
      isValidTrackForArtist({ title: 'Song', artist: { name } }, name.normalize('NFKC')),
      true,
      name,
    );
  }
  assert.equal(
    isValidTrackForArtist({ title: 'Song', artist: { name: 'Other' } }, '宇多田ヒカル'),
    false,
  );
});

test('All artist tracks follows next_href, deduplicates tracks and stops repeated pages', async (t) => {
  const calls = [];
  t.mock.method(sc, 'getSoundCloudKey', async () => 'fixture');
  t.mock.method(sc, 'fetchWithRelay', async (raw) => {
    const url = new URL(raw);
    calls.push(url.href);
    if (url.pathname !== '/users/123/tracks') return { collection: [] };
    const second = url.searchParams.has('offset');
    return {
      collection: [
        { id: second ? 2 : 1, title: 'Song', duration: 180000, user: { username: 'Singer' } },
      ],
      next_href: 'https://api-v2.soundcloud.com/users/123/tracks?offset=1',
    };
  });
  assert.deepEqual((await sc.getArtistAllTracks(123, 'Singer')).map((t) => t.id).sort(), [1, 2]);
  assert.equal(calls.filter((url) => new URL(url).pathname === '/users/123/tracks').length, 2);
});

test('Native downloads accept the current SoundCloud CDN with the provider headers', async () => {
  const bytes = new Uint8Array(20000);
  let requests = 0;
  const result = await downloadAudioBytes(
    'https://playback.media-streaming.soundcloud.cloud/audio.m4s',
    {
      fetcher: async (_url, init) => {
        requests++;
        assert.equal(init.headers.Referer, 'https://soundcloud.com/');
        return new Response(bytes, { headers: { 'content-type': 'audio/mp4' } });
      },
    },
  );
  assert.equal(requests, 1);
  assert.equal(result.byteLength, bytes.byteLength);
});

test('Small artwork requests use small provider images and retain the same fallback sequence', () => {
  const track = {
    album: { cover_medium: 'https://i1.sndcdn.com/artworks-fixture-t500x500.jpg' },
    artist: { picture: 'https://i1.sndcdn.com/avatars-fixture-t500x500.jpg' },
  };
  assert.ok(trackArtworkCandidates(track)[0].endsWith('-t500x500.jpg'));
  const candidates = trackArtworkCandidates(track, 'thumbnail');
  assert.ok(candidates[0].endsWith('-large.jpg'));
  const image = {
    src: candidates[0],
    getAttribute() {
      return this.src;
    },
  };
  advanceTrackArtwork(image, track, 'thumbnail');
  assert.equal(image.src, candidates[1]);
});
