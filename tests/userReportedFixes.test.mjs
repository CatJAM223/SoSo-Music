import test from 'node:test';
import assert from 'node:assert/strict';
import { transformSCTrack } from '../src/shared/services/parsers/soundCloudParser.ts';
import { fixMojibake, decodeHtmlEntities } from '../src/shared/utils/formatters.ts';
import { DatabaseManager } from '../src/desktop/main/db/index.ts';

test('User Reported Fix 1: SoundCloud parser strips ripper file extensions and avoids YouTube.M4A as track title', () => {
  // Case A: Trailing " - YouTube.M4A" file suffix
  const itemA = {
    id: 123456,
    title: 'Music From The Succubus Club 06 (VTM) - YouTube.M4A',
    duration: 180000,
    user: { id: 99, username: 'VampireFan', avatar_url: 'https://example.com/avatar.jpg' },
    media: {
      transcodings: [{ format: { protocol: 'progressive' }, url: 'https://example.com/stream' }],
    },
  };

  const trackA = transformSCTrack(itemA);
  assert.ok(trackA);
  assert.equal(trackA.title, 'Music From The Succubus Club 06 (VTM)');
  assert.equal(trackA.artist.name, 'VampireFan');

  // Case B: Raw filename with .mp3
  const itemB = {
    id: 123457,
    title: 'Nirvana - Smells Like Teen Spirit (YouTube.m4a)',
    duration: 300000,
    user: { id: 100, username: 'GrungeRock' },
    media: {
      transcodings: [{ format: { protocol: 'progressive' }, url: 'https://example.com/stream' }],
    },
  };

  const trackB = transformSCTrack(itemB);
  assert.ok(trackB);
  assert.equal(trackB.title, 'Smells Like Teen Spirit');
  assert.equal(trackB.artist.name, 'Nirvana');

  // Case C: Standard Artist - Title with trailing file extension
  const itemC = {
    id: 123458,
    title: 'Linkin Park - In The End.mp3',
    duration: 216000,
    user: { id: 101, username: 'RockUploader' },
    media: {
      transcodings: [{ format: { protocol: 'progressive' }, url: 'https://example.com/stream' }],
    },
  };

  const trackC = transformSCTrack(itemC);
  assert.ok(trackC);
  assert.equal(trackC.title, 'In The End');
  assert.equal(trackC.artist.name, 'Linkin Park');
});

test('User Reported Fix 2: fixMojibake and decodeHtmlEntities clean playlist titles and mojibake text', () => {
  // HTML entities decoding
  assert.equal(
    decodeHtmlEntities('Rock &amp; Roll &#39;90s &quot;Hits&quot;'),
    'Rock & Roll \'90s "Hits"',
  );

  // Replacement character removal
  assert.equal(fixMojibake('Плейлист\uFFFD 2024'), 'Плейлист 2024');

  // UTF-8 decoded as Latin-1 mojibake
  const utf8Mojibake = 'ÐÐ»ÐµÐ¹Ð»Ð¸ÑÑ'; // "Плейлист"
  assert.equal(fixMojibake(utf8Mojibake), 'Плейлист');
});

test('User Reported Fix 3: DatabaseManager listening history retains repeat plays and normalizes listening time', async (t) => {
  const dbManager = new DatabaseManager(':memory:');
  t.after(() => {
    dbManager.db?.close();
  });
  await dbManager.init();

  // Add 10 plays of the same track to simulate repeats
  for (let i = 0; i < 10; i++) {
    dbManager.addListeningHistory({
      track_id: 'sc_repeat_1',
      title: 'Repeat Song',
      artist: 'Favorite Artist',
      duration: 200,
      source: 'soundcloud',
    });
  }

  // Verify that all 10 repeat play events are retained in listening_history (not wiped to 1)
  const historyList = dbManager.getListeningHistory(20);
  assert.equal(historyList.length, 10, 'Listening history must retain all 10 play occurrences');
  const recentTracks = dbManager.getListeningHistory(20, true);
  assert.equal(recentTracks.length, 1, 'Recent-track view should collapse repeat plays');
  assert.equal(recentTracks[0].track_id, 'sc_repeat_1');

  // Also record scrobbles for listening stats calculation
  for (let i = 0; i < 10; i++) {
    dbManager.recordScrobble({
      track: {
        id: 'sc_repeat_1',
        title: 'Repeat Song',
        artist: 'Favorite Artist',
        duration: 200,
        source: 'soundcloud',
      },
      completed: true,
    });
  }

  const stats = dbManager.getStatsSummary();
  assert.equal(stats.totalPlays, 10);
  assert.ok(stats.approxMinutes < 60, 'Minutes must always be strictly less than 60');

  // Test hour overflow boundary: 3570 seconds (59.5 minutes -> should round to 1 hour, 0 minutes)
  for (let i = 0; i < 8; i++) {
    dbManager.recordScrobble({
      track: {
        id: `trk_${i}`,
        title: `Song ${i}`,
        artist: 'Another Artist',
        duration: 200,
        source: 'soundcloud',
      },
      completed: true,
    });
  }

  const updatedStats = dbManager.getStatsSummary();
  assert.ok(updatedStats.approxMinutes < 60, 'approxMinutes must never be >= 60');
});
