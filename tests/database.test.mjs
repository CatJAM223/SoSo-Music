import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseManager } from '../src/desktop/main/db/index.ts';

function createTestDb() {
  return new DatabaseManager(':memory:');
}

test('Wave taste favors completed plays and ignores repeatedly skipped tracks', async () => {
  const db = createTestDb();
  await db.init();
  db.recordScrobble({
    track: { id: 'liked-play', title: 'Played Through', artist: 'Artist A' },
    completed: true,
  });
  db.recordScrobble({
    track: { id: 'quick-skip', title: 'Always Skipped', artist: 'Artist B' },
    skipped: true,
  });
  db.recordScrobble({
    track: { id: 'quick-skip', title: 'Always Skipped', artist: 'Artist B' },
    skipped: true,
  });
  const taste = db.getWaveTasteTracks();
  assert.deepEqual(
    taste.map((track) => track.id),
    ['liked-play'],
  );
});

test('SQLite DB: Initialization and Schema Creation', async () => {
  const db = createTestDb();
  await db.init();
  assert.ok(db.db !== null, 'Database must be initialized');

  // Verify tables exist
  const stmt = db.prepare("SELECT name FROM sqlite_master WHERE type='table'");
  const tables = [];
  while (stmt.step()) {
    tables.push(stmt.getAsObject().name);
  }
  stmt.free();

  assert.ok(tables.includes('liked_tracks'));
  assert.ok(tables.includes('playlists'));
  assert.ok(tables.includes('playlist_tracks'));
  assert.ok(tables.includes('search_history'));
});

test('SQLite DB: Liked Tracks CRUD & Statement Freeing', async () => {
  const db = createTestDb();
  await db.init();

  assert.equal(db.isTrackLiked(12345), false);
  const beforeFreed = db.statementsFreedCount;

  // Toggle Like (Add)
  const addRes = db.toggleLikeTrack({
    deezer_id: 12345,
    title: 'Get Lucky',
    artist: 'Daft Punk',
    album: 'Random Access Memories',
    duration: 248,
    cover_url: 'https://cover.jpg',
    preview_url: 'https://preview.mp3',
  });
  assert.equal(addRes.liked, true);
  assert.equal(db.isTrackLiked(12345), true);

  const likedList = db.getLikedTracks();
  assert.equal(likedList.length, 1);
  assert.equal(likedList[0].title, 'Get Lucky');
  assert.equal(likedList[0].artist, 'Daft Punk');
  assert.equal(likedList[0].duration, 248);

  // Toggle Like (Remove)
  const removeRes = db.toggleLikeTrack({ deezer_id: 12345 });
  assert.equal(removeRes.liked, false);
  assert.equal(db.isTrackLiked(12345), false);
  assert.equal(db.getLikedTracks().length, 0);

  // Ensure statements were freed on every call
  assert.ok(db.statementsFreedCount > beforeFreed, 'All prepared statements must be freed');
});

test('SQLite DB: Playlists and Playlist Tracks CRUD', async () => {
  const db = createTestDb();
  await db.init();

  // Create Playlists
  const pl1 = db.createPlaylist('Workout Mix', 'High energy music');
  const pl2 = db.createPlaylist('Chill Vibes');
  assert.ok(pl1.id.startsWith('pl_'));
  assert.equal(pl1.name, 'Workout Mix');

  let playlists = db.getPlaylists();
  assert.equal(playlists.length, 2);

  // Add Tracks to pl1
  db.addTrackToPlaylist(pl1.id, {
    deezer_id: '101',
    title: 'Stronger',
    artist: 'Kanye West',
    duration: 312,
  });
  db.addTrackToPlaylist(pl1.id, {
    deezer_id: '102',
    title: 'Eye of the Tiger',
    artist: 'Survivor',
    duration: 245,
  });

  const pl1Tracks = db.getPlaylistTracks(pl1.id);
  assert.equal(pl1Tracks.length, 2);
  assert.equal(pl1Tracks[0].title, 'Stronger');
  assert.equal(pl1Tracks[0].position, 0);
  assert.equal(pl1Tracks[1].title, 'Eye of the Tiger');
  assert.equal(pl1Tracks[1].position, 1);

  // Verify track_count in getPlaylists()
  playlists = db.getPlaylists();
  const pl1Entry = playlists.find((p) => p.id === pl1.id);
  assert.equal(pl1Entry.track_count, 2);

  // Remove track from playlist
  db.removeTrackFromPlaylist(pl1.id, '101');
  const pl1AfterRemove = db.getPlaylistTracks(pl1.id);
  assert.equal(pl1AfterRemove.length, 1);
  assert.equal(pl1AfterRemove[0].track_deezer_id, '102');

  // Delete Playlist
  db.deletePlaylist(pl1.id);
  playlists = db.getPlaylists();
  assert.equal(playlists.length, 1);
  assert.equal(db.getPlaylistTracks(pl1.id).length, 0);
});

test('SQLite DB: Search History CRUD and Deduplication', async () => {
  const db = createTestDb();
  await db.init();

  db.addSearchHistory('Daft Punk');
  db.addSearchHistory('The Weeknd');
  db.addSearchHistory('Daft Punk'); // Should update timestamp, not create duplicate

  let history = db.getSearchHistory(10);
  assert.equal(history.length, 2);
  assert.equal(history[0].query, 'Daft Punk'); // Most recent first

  // Remove single item
  db.removeSearchHistoryItem(history[1].id);
  assert.equal(db.getSearchHistory(10).length, 1);

  // Clear all
  db.clearSearchHistory();
  assert.equal(db.getSearchHistory(10).length, 0);
});

test('SQLite DB: Saved Albums CRUD and Toggle', async () => {
  const db = createTestDb();
  await db.init();

  assert.equal(db.isAlbumSaved('302127'), false);

  // Toggle Save (Add)
  const addRes = db.toggleSaveAlbum({
    id: '302127',
    title: 'Discovery',
    artist: { id: '27', name: 'Daft Punk' },
    cover_url: 'https://cover-discovery.jpg',
    release_date: '2001-03-12',
    record_type: 'album',
    track_count: 14,
  });
  assert.equal(addRes.saved, true);
  assert.equal(db.isAlbumSaved('302127'), true);

  const savedList = db.getSavedAlbums();
  assert.equal(savedList.length, 1);
  assert.equal(savedList[0].title, 'Discovery');
  assert.equal(savedList[0].artist_name, 'Daft Punk');
  assert.equal(savedList[0].track_count, 14);

  // Toggle Save (Remove)
  const removeRes = db.toggleSaveAlbum({ id: '302127' });
  assert.equal(removeRes.saved, false);
  assert.equal(db.isAlbumSaved('302127'), false);
  assert.equal(db.getSavedAlbums().length, 0);
});

test('SQLite DB Export: Empty database returns error', async () => {
  const db = createTestDb();
  await db.init();

  const res = db.exportData();
  assert.equal(res.success, false);
  assert.equal(res.error, 'EMPTY_DATABASE');
  assert.ok(res.message && res.message.length > 0);
});

test('SQLite DB Export: Only Liked Tracks', async () => {
  const db = createTestDb();
  await db.init();

  db.toggleLikeTrack({
    deezer_id: '1001',
    title: 'Blinding Lights',
    artist: 'The Weeknd',
    album: 'After Hours',
    duration: 200,
  });

  const res = db.exportData();
  assert.equal(res.success, true);
  assert.equal(res.stats.tracks, 1);
  assert.equal(res.stats.albums, 0);
  assert.equal(res.stats.playlists, 0);
  assert.equal(res.payload.data.liked_tracks.length, 1);
  assert.equal(res.payload.data.liked_tracks[0].title, 'Blinding Lights');
});

test('SQLite DB Export: Only Saved Albums', async () => {
  const db = createTestDb();
  await db.init();

  db.toggleSaveAlbum({
    id: 'alb_999',
    title: 'Starboy',
    artist: { id: 'weeknd', name: 'The Weeknd' },
    track_count: 18,
  });

  const res = db.exportData();
  assert.equal(res.success, true);
  assert.equal(res.stats.tracks, 0);
  assert.equal(res.stats.albums, 1);
  assert.equal(res.stats.playlists, 0);
  assert.equal(res.payload.data.saved_albums.length, 1);
  assert.equal(res.payload.data.saved_albums[0].title, 'Starboy');
});

test('SQLite DB Export: Only Playlists and Playlist Tracks', async () => {
  const db = createTestDb();
  await db.init();

  const pl = db.createPlaylist('Road Trip', 'Best driving tunes');
  db.addTrackToPlaylist(pl.id, {
    deezer_id: '500',
    title: 'Drive',
    artist: 'Kavinsky',
    duration: 250,
  });

  const res = db.exportData();
  assert.equal(res.success, true);
  assert.equal(res.stats.tracks, 0);
  assert.equal(res.stats.albums, 0);
  assert.equal(res.stats.playlists, 1);
  assert.equal(res.stats.playlistTracks, 1);
  assert.equal(res.payload.data.playlists[0].name, 'Road Trip');
  assert.equal(res.payload.data.playlist_tracks[0].title, 'Drive');
});

test('SQLite DB Export & Import: Full Database round-trip into fresh DB', async () => {
  const dbSource = createTestDb();
  await dbSource.init();

  // Populate all entities
  dbSource.toggleLikeTrack({ deezer_id: '1', title: 'Track 1', artist: 'Artist 1' });
  dbSource.toggleLikeTrack({ deezer_id: '2', title: 'Track 2', artist: 'Artist 2' });
  dbSource.toggleSaveAlbum({ id: 'a1', title: 'Album 1', artist: 'Artist 1' });
  const pl = dbSource.createPlaylist('Favorites');
  dbSource.addTrackToPlaylist(pl.id, { deezer_id: '10', title: 'PL Track 1', artist: 'Artist PL' });
  dbSource.addSearchHistory('Synthwave');

  // Export
  const exportRes = dbSource.exportData();
  assert.equal(exportRes.success, true);
  assert.equal(exportRes.stats.tracks, 2);
  assert.equal(exportRes.stats.albums, 1);
  assert.equal(exportRes.stats.playlists, 1);
  assert.equal(exportRes.stats.playlistTracks, 1);

  // Import into new empty DB
  const dbTarget = createTestDb();
  await dbTarget.init();

  const importRes = dbTarget.importData(JSON.stringify(exportRes.payload));
  assert.equal(importRes.success, true);
  assert.equal(importRes.stats.tracks, 2);
  assert.equal(importRes.stats.albums, 1);
  assert.equal(importRes.stats.playlists, 1);
  assert.equal(importRes.stats.playlistTracks, 1);

  // Verify target DB data integrity
  const targetTracks = dbTarget.getLikedTracks();
  assert.equal(targetTracks.length, 2);
  assert.equal(dbTarget.isTrackLiked('1'), true);
  assert.equal(dbTarget.isTrackLiked('2'), true);

  const targetAlbums = dbTarget.getSavedAlbums();
  assert.equal(targetAlbums.length, 1);
  assert.equal(dbTarget.isAlbumSaved('a1'), true);

  const targetPlaylists = dbTarget.getPlaylists();
  assert.equal(targetPlaylists.length, 1);
  assert.equal(targetPlaylists[0].name, 'Favorites');

  const targetPlTracks = dbTarget.getPlaylistTracks(pl.id);
  assert.equal(targetPlTracks.length, 1);
  assert.equal(targetPlTracks[0].title, 'PL Track 1');
});

test('SQLite DB Import: Invalid JSON returns error', async () => {
  const db = createTestDb();
  await db.init();

  const res = db.importData('{ invalid json ...');
  assert.equal(res.success, false);
  assert.equal(res.error, 'INVALID_JSON');
});

test('SQLite DB Import: Empty backup object returns error', async () => {
  const db = createTestDb();
  await db.init();

  const res = db.importData(JSON.stringify({ version: 1, data: {} }));
  assert.equal(res.success, false);
  assert.equal(res.error, 'EMPTY_BACKUP');
});

test('SQLite DB Import: Duplicate and Merge Idempotency', async () => {
  const db = createTestDb();
  await db.init();

  // Pre-seed track 1
  db.toggleLikeTrack({ deezer_id: '1', title: 'Old Title', artist: 'Old Artist' });

  // Backup with updated track 1 and new track 2
  const backup = {
    data: {
      liked_tracks: [
        { deezer_id: '1', title: 'Updated Title', artist: 'Updated Artist' },
        { deezer_id: '2', title: 'Track 2', artist: 'Artist 2' },
      ],
    },
  };

  const res = db.importData(backup);
  assert.equal(res.success, true);
  assert.equal(res.stats.tracks, 2);

  const tracks = db.getLikedTracks();
  assert.equal(tracks.length, 2);
  const track1 = tracks.find((t) => t.deezer_id === '1');
  assert.equal(track1.title, 'Updated Title');
});

test('SQLite DB Followed Artists: CRUD and follow toggle', async () => {
  const db = createTestDb();
  await db.init();

  assert.equal(db.isArtistFollowed('art_1'), false);

  // 1. Follow artist
  const res1 = db.toggleFollowArtist({
    id: 'art_1',
    name: 'The Weeknd',
    picture_url: 'https://img/weeknd.jpg',
  });
  assert.equal(res1.followed, true);
  assert.equal(db.isArtistFollowed('art_1'), true);

  const list = db.getFollowedArtists();
  assert.equal(list.length, 1);
  assert.equal(list[0].name, 'The Weeknd');

  // 2. Unfollow artist
  const res2 = db.toggleFollowArtist({ id: 'art_1', name: 'The Weeknd' });
  assert.equal(res2.followed, false);
  assert.equal(db.isArtistFollowed('art_1'), false);
  assert.equal(db.getFollowedArtists().length, 0);
});

test('SQLite DB Export and Import with Followed Artists roundtrip', async () => {
  const dbSrc = createTestDb();
  await dbSrc.init();

  dbSrc.toggleLikeTrack({ deezer_id: '101', title: 'Song A', artist: 'Artist A' });
  dbSrc.toggleSaveAlbum({ id: 'alb_1', title: 'Album 1', artist_name: 'Artist A' });
  dbSrc.toggleFollowArtist({ id: 'art_1', name: 'Artist A', picture_url: 'https://img/a.jpg' });

  const exportRes = dbSrc.exportData();
  assert.equal(exportRes.success, true);
  assert.equal(exportRes.stats.tracks, 1);
  assert.equal(exportRes.stats.albums, 1);
  assert.equal(exportRes.stats.artists, 1);

  // Import to target
  const dbTarget = createTestDb();
  await dbTarget.init();

  const importRes = dbTarget.importData(exportRes.payload);
  assert.equal(importRes.success, true);
  assert.equal(importRes.stats.artists, 1);
  assert.equal(dbTarget.isArtistFollowed('art_1'), true);

  const followed = dbTarget.getFollowedArtists();
  assert.equal(followed.length, 1);
  assert.equal(followed[0].name, 'Artist A');
});

test('SQLite DB: Local Scrobbles, Repeats and Quick-Skip Penalties', async () => {
  const db = createTestDb();
  await db.init();

  // Record 1 complete listen
  db.recordScrobble({
    track: { id: 'sc_1', title: 'Hate.', artist: 'ThxSoMch' },
    completed: true,
  });

  // Record 2 repeat listens
  db.recordScrobble({
    track: { id: 'sc_1', title: 'Hate.', artist: 'ThxSoMch' },
    repeated: true,
  });

  // Record 1 quick skip on another artist
  db.recordScrobble({
    track: { id: 'sc_2', title: 'Bad Song', artist: 'Annoying Artist' },
    skipped: true,
  });

  const topArtists = db.getScrobbledTopArtists();
  assert.ok(topArtists.length > 0);
  assert.equal(topArtists[0].name, 'ThxSoMch');
  assert.ok(topArtists[0].score >= 8);
});

test('SQLite DB: Dislike and Undislike Track Exclusion', async () => {
  const db = createTestDb();
  await db.init();

  // First like a track
  db.toggleLikeTrack({ deezer_id: '12345', title: 'Track To Dislike', artist: 'Artist X' });
  assert.equal(db.isTrackLiked('12345'), true);

  // Dislike it
  db.dislikeTrack({ id: '12345', title: 'Track To Dislike', artist: 'Artist X' });
  assert.equal(db.isTrackDisliked('12345'), true);
  assert.equal(db.isTrackLiked('12345'), false);

  const dislikedList = db.getDislikedTrackIds();
  assert.ok(dislikedList.includes('12345'));
  assert.deepEqual(db.getDislikedWaveTracks(), [
    { id: '12345', title: 'Track To Dislike', artist: 'Artist X' },
  ]);

  // Undislike
  db.undislikeTrack('12345');
  assert.equal(db.isTrackDisliked('12345'), false);
});
