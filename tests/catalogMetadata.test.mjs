import test from 'node:test';
import assert from 'node:assert/strict';
import { extractAlbumFromFlexColumns } from '../src/shared/services/parsers/youtubeMusicParser.ts';
import { cleanAlbumTitle } from '../src/shared/utils/albumMetadata.ts';
import { likedTrackToTrack } from '../src/shared/utils/libraryTrack.ts';
import { getGenreArtists, loadGenreCatalog } from '../src/shared/services/genreCatalog.ts';

const column = (runs) => ({ musicResponsiveListItemFlexColumnRenderer: { text: { runs } } });
const artistRun = {
  text: 'Uploader',
  navigationEndpoint: { browseEndpoint: { browseId: 'UC_channel' } },
};

test('Video view counts do not become albums, including old library metadata', () => {
  for (const value of [
    '732 тыс. просмотров',
    '687 просмотров',
    '1.2M views',
    '26 просмотров',
    '2,451 plays',
  ]) {
    assert.equal(
      extractAlbumFromFlexColumns([{}, column([artistRun, { text: ' • ' }, { text: value }])])
        .albumTitle,
      'Single',
    );
    assert.equal(
      extractAlbumFromFlexColumns([{}, column([artistRun]), column([{ text: value }])]).albumTitle,
      'Single',
    );
    assert.equal(cleanAlbumTitle(value), 'Single');
  }
  assert.equal(cleanAlbumTitle('Views'), 'Views');
  assert.equal(cleanAlbumTitle('1989 (Taylor’s Version)'), '1989 (Taylor’s Version)');
  assert.equal(
    extractAlbumFromFlexColumns([
      {},
      column([
        artistRun,
        { text: ' • ' },
        { text: 'White Pony' },
        { text: ' • ' },
        { text: '3:45' },
      ]),
    ]).albumTitle,
    'White Pony',
  );
  assert.equal(
    extractAlbumFromFlexColumns([
      {},
      column([artistRun]),
      column([
        { text: 'Meteora', navigationEndpoint: { browseEndpoint: { browseId: 'MPREb_release' } } },
      ]),
    ]).albumBrowseId,
    'MPREb_release',
  );
});

test('Library picker retains source, recording ID and release ID while cleaning legacy counters', () => {
  const result = likedTrackToTrack({
    deezer_id: 'yt_recording',
    title: 'Song',
    artist: 'Artist',
    album: '117 просмотров',
    album_id: 'yt_album',
    duration: 123,
    source: 'youtube',
    cover_url: '',
    preview_url: 'preview',
  });
  assert.equal(result.id, 'yt_recording');
  assert.equal(result.source, 'youtube');
  assert.equal(result.album.title, 'Single');
  assert.equal(result.album.id, 'yt_album');
  assert.equal(result.duration, 123);
  assert.equal(result.preview, 'preview');
});

test('Genre artist pools generate a substantial YouTube selection with bounded requests and diverse ordering', async () => {
  let active = 0;
  let maxActive = 0;
  const artists = getGenreArtists(8);
  assert.equal(artists.length, 6);
  const result = await loadGenreCatalog(8, 'youtube', {
    soundcloud: async () => {
      assert.fail('YouTube selection must be independent');
    },
    youtube: async (query) => {
      active++;
      maxActive = Math.max(active, maxActive);
      await new Promise((resolve) => setImmediate(resolve));
      active--;
      const artist = artists.find((name) => query === name);
      if (!artist) return { data: [] };
      return {
        data: [
          {
            id: 'wrong',
            title: `${artist} documentary`,
            artist: { name: 'Unrelated' },
            source: 'youtube',
            duration: 7200,
          },
          {
            id: 'cover',
            title: 'Cover',
            artist: { name: artist },
            source: 'youtube',
            duration: 180,
          },
          ...['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo'].map((title, index) => ({
            id: `${artist}-${index}`,
            title,
            artist: { name: artist },
            source: 'youtube',
            duration: 180,
          })),
        ],
      };
    },
  });
  assert.equal(result.data.length, 30);
  assert.ok(maxActive <= 3);
  assert.deepEqual(
    result.data.slice(0, 6).map((track) => track.artist.name),
    artists,
  );
  assert.ok(!result.data.some((track) => ['wrong', 'cover'].includes(track.id)));
});

test('Mixed genres remove duplicate songs across services and survive a single artist query failing', async () => {
  const song = {
    id: 'sc-song',
    title: 'Creep',
    artist: { name: 'Radiohead' },
    source: 'soundcloud',
    duration: 238,
  };
  const result = await loadGenreCatalog(8, 'all', {
    soundcloud: async () => ({ data: [song] }),
    youtube: async (query) => {
      if (query === 'Muse') throw new Error('One query failed');
      return {
        data: query.startsWith('Radiohead') ? [{ ...song, id: 'yt-song', source: 'youtube' }] : [],
      };
    },
  });
  assert.equal(result.data.length, 1);
  assert.equal(result.data[0].source, 'youtube');
});
