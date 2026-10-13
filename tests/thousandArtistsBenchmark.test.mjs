import test from 'node:test';
import assert from 'node:assert/strict';
import { MusicAggregatorService } from '../src/desktop/main/services/musicAggregator.ts';
import { isArtistMatch, isTitleMatch } from '../src/shared/utils/artistParser.ts';
import { SongsterrService } from '../src/shared/services/songsterrService.ts';
import { detectTrackSource } from '../src/shared/utils/formatters.ts';

// Helper to generate varied names for synthetic catalog-scale cases
const GENRE_PREFIXES = [
  'The',
  'DJ',
  'MC',
  'Lil',
  'Big',
  'Dr.',
  'Saint',
  'King',
  'Queen',
  'Captain',
  'Young',
  'Lord',
];
const BASE_NAMES = [
  'Beatles',
  'Queen',
  'Metallica',
  'Nirvana',
  'Radiohead',
  'Pink Floyd',
  'Led Zeppelin',
  'Daft Punk',
  'Eminem',
  'Drake',
  'Taylor Swift',
  'The Weeknd',
  'Coldplay',
  'Arctic Monkeys',
  'Rammstein',
  'Linkin Park',
  'Gorillaz',
  'Red Hot Chili Peppers',
  'Green Day',
  'Muse',
  'Кино',
  'Би-2',
  'Сплин',
  'Земфира',
  'Король и Шут',
  'Ария',
  'Мумий Тролль',
  'ДДТ',
  'Oxxxymiron',
  'Noize MC',
  'Скриптонит',
  'Miyagi',
  'Баста',
  'LSP',
  'Макс Корж',
  'Kish',
  'AC/DC',
  'Guns N Roses',
  'System of a Down',
  'Slipknot',
  'Iron Maiden',
  'Deftones',
  'Kendrick Lamar',
  'Travis Scott',
  'Kanye West',
  'Post Malone',
  'J. Cole',
  'Snoop Dogg',
  'Adele',
  'Billie Eilish',
  'Dua Lipa',
  'Lady Gaga',
  'Rihanna',
  'Beyonce',
  'Lana Del Rey',
  'Avicii',
  'Calvin Harris',
  'David Guetta',
  'Skrillex',
  'Deadmau5',
  'Marshmello',
  'Kygo',
];
const SUFFIXES = [
  'Orchestra',
  'Band',
  'Project',
  'Sound System',
  'Trio',
  'Quartet',
  'Collective',
  'Boys',
  'Club',
];

function generateSoundCloudArtists(count = 500) {
  const artists = [];
  for (let i = 0; i < count; i++) {
    const base = BASE_NAMES[i % BASE_NAMES.length];
    const prefix = GENRE_PREFIXES[(i * 3 + 1) % GENRE_PREFIXES.length];
    const suffix = SUFFIXES[(i * 7 + 2) % SUFFIXES.length];
    const artistName = i < BASE_NAMES.length ? base : `${prefix} ${base} ${suffix} #${i}`;
    const numericId = 1000000 + i * 13;
    const rawId =
      i % 2 === 0
        ? `sc_art_${numericId}`
        : `sc_${artistName.toLowerCase().replace(/[^a-z0-9а-яё]/gi, '_')}`;
    artists.push({
      id: rawId,
      name: artistName,
      numericId,
      source: 'soundcloud',
      nb_fan: 500 + ((i * 29) % 500000),
      picture_medium: `https://i1.sndcdn.com/avatars-${numericId}-medium.jpg`,
    });
  }
  return artists;
}

function generateYouTubeArtists(count = 500) {
  const artists = [];
  for (let i = 0; i < count; i++) {
    const base = BASE_NAMES[(i + 17) % BASE_NAMES.length];
    const prefix = GENRE_PREFIXES[(i * 5 + 3) % GENRE_PREFIXES.length];
    const artistName =
      i < BASE_NAMES.length ? `${base} Official` : `${prefix} ${base} Records #${i}`;
    // Construct valid YouTube channel-like ID (starts with UC...)
    const channelId = `UC${(100000000000000000000n + BigInt(i * 1234567)).toString(36).padEnd(22, 'x')}`;
    const rawId = i % 2 === 0 ? `yt_art_${channelId}` : `yt_${channelId}`;
    artists.push({
      id: rawId,
      name: artistName,
      channelId,
      source: 'youtube',
      subscribers: `${(10 + ((i * 17) % 990)) / 10}M subscribers`,
      picture_medium: `https://yt3.ggpht.com/a/${channelId}=s800-c-k-c0x00ffffff-no-rj`,
    });
  }
  return artists;
}

test('Catalog scale: source isolation across 1000 synthetic artists', () => {
  const scArtists = generateSoundCloudArtists(500);
  const ytArtists = generateYouTubeArtists(500);

  // 1. Verify all 500 SoundCloud artists are cleanly categorized as SoundCloud using production detectTrackSource
  for (const a of scArtists) {
    const source = detectTrackSource(a);
    assert.equal(
      source,
      'soundcloud',
      `Artist ${a.id} must be recognized as soundcloud by detectTrackSource`,
    );
  }

  // 2. Verify all 500 YouTube artists are cleanly categorized as YouTube using production detectTrackSource
  for (const a of ytArtists) {
    const source = detectTrackSource(a);
    assert.equal(
      source,
      'youtube',
      `Artist ${a.id} must be recognized as youtube by detectTrackSource`,
    );
  }
});

test('Catalog scale: cleanArtistId normalizes 1000 synthetic artist IDs', () => {
  const scArtists = generateSoundCloudArtists(500);
  const ytArtists = generateYouTubeArtists(500);
  const allArtists = [...scArtists, ...ytArtists];

  const startTime = performance.now();
  for (const a of allArtists) {
    const cleaned = MusicAggregatorService.cleanArtistId(a.id);
    const expected =
      a.source === 'youtube'
        ? a.channelId
        : a.id.startsWith('sc_art_')
          ? String(a.numericId)
          : a.name
              .toLowerCase()
              .replace(/[^a-z0-9а-яё]/gi, '_')
              .replaceAll('_', ' ');
    assert.equal(cleaned, expected.trim());
    assert.ok(!cleaned.startsWith('yt_art_'), `Cleaned ID should not start with yt_art_`);
    assert.ok(!cleaned.startsWith('sc_art_'), `Cleaned ID should not start with sc_art_`);
  }
  const elapsed = performance.now() - startTime;

  console.log('Timing only: ID normalization ' + elapsed.toFixed(2) + ' ms');
});

test('Catalog scale: artist deduplication handles duplicate injections', () => {
  const scArtists = generateSoundCloudArtists(500);
  const ytArtists = generateYouTubeArtists(500);

  // Clone 200 artists with lowercase and spaces to simulate duplicates across search results
  const duplicates = scArtists.slice(0, 200).map((a) => ({
    id: `dup_${a.id}`,
    name: a.name.toLowerCase(),
    picture_medium: a.picture_medium,
  }));

  const mixedPool = [...scArtists, ...ytArtists, ...duplicates];
  assert.equal(mixedPool.length, 1200, 'Pool should have 1200 artists (with 200 duplicates)');

  const startTime = performance.now();
  const deduped = MusicAggregatorService.deduplicateArtists(mixedPool);
  const elapsed = performance.now() - startTime;

  assert.equal(deduped.length, 1000);
  assert.deepEqual(
    new Set(deduped.map((artist) => artist.name.toLowerCase())),
    new Set([...scArtists, ...ytArtists].map((artist) => artist.name.toLowerCase())),
  );
  console.log('Timing only: Artist deduplication ' + elapsed.toFixed(2) + ' ms');
});

test('Catalog scale: album deduplication and metadata enrichment', () => {
  const albums = [];
  for (let i = 0; i < 1000; i++) {
    const isDuplicate = i % 3 === 0;
    const title = isDuplicate ? `Greatest Hits Vol. ${Math.floor(i / 10)}` : `Album #${i} Opus`;
    albums.push({
      id: `alb_${i}`,
      title,
      cover:
        i % 2 === 0
          ? 'https://images.unsplash.com/photo-fake'
          : `https://images.soso.fm/cover_${i}.jpg`,
      track_count: (i % 12) + 1,
    });
  }

  const startTime = performance.now();
  const dedupedAlbums = MusicAggregatorService.deduplicateAlbums(albums);
  const elapsed = performance.now() - startTime;

  assert.ok(dedupedAlbums.length < 1000, 'Duplicate album titles should be merged');
  console.log('Timing only: Album deduplication ' + elapsed.toFixed(2) + ' ms');

  // Placeholder-first duplicate must inherit the real image from alb_3.
  const testSample = dedupedAlbums.find((a) => a.title === 'Greatest Hits Vol. 0');
  assert.ok(testSample, 'The album must survive deduplication');
  assert.equal(testSample.cover, 'https://images.soso.fm/cover_3.jpg');
  assert.equal(testSample.cover_medium, testSample.cover);
});

test('Catalog scale: search relevance ranking across 1000 tracks', () => {
  const tracks = [];
  for (let i = 0; i < 1000; i++) {
    const isTarget = i === 42 || i === 242 || i === 742;
    tracks.push({
      id: `trk_${i}`,
      title: isTarget ? `Radiohead - Paranoid Android #${i}` : `Some Random Track #${i} ft. Guest`,
      artist: { name: isTarget ? 'Radiohead' : `Artist ${i}` },
      duration: 180 + (i % 120),
    });
  }

  const startTime = performance.now();
  const ranked = MusicAggregatorService.rankSearchTracks(tracks, 'Radiohead Paranoid Android');
  const elapsed = performance.now() - startTime;

  assert.ok(ranked.length === 1000, 'Should rank all 1000 tracks');
  console.log('Timing only: Search ranking ' + elapsed.toFixed(2) + ' ms');
  // Top items must be the exact matches
  assert.ok(ranked[0].title.includes('Paranoid Android'), 'Top ranked track must match query');
  assert.ok(ranked[1].title.includes('Paranoid Android'), 'Second ranked track must match query');
  assert.ok(ranked[2].title.includes('Paranoid Android'), 'Third ranked track must match query');
});

test('Catalog scale: title and artist matching covers five versions and unrelated recordings', () => {
  const testCases = [
    { title: 'Numb (Official Music Video)', query: 'Numb', expected: true },
    { title: 'In the End [HD Remastered]', query: 'In the End', expected: true },
    {
      title: 'Smells Like Teen Spirit - Live at Reading 1992',
      query: 'Smells Like Teen Spirit',
      expected: true,
    },
    { title: 'Кукла колдуна (Remastered 2021)', query: 'Кукла колдуна', expected: true },
    { title: 'Группа крови [HQ Audio]', query: 'Группа крови', expected: true },
  ];

  for (const tc of testCases) assert.equal(isTitleMatch(tc.title, tc.query), tc.expected);
  assert.equal(isTitleMatch('Numb', 'Paranoid Android'), false);
  assert.equal(isArtistMatch({ artist: { name: 'Nirvana' } }, 'Radiohead'), false);
});

test('Catalog scale: Songsterr tuning parser covers five patterns and 500 formatting calls', () => {
  // Test common tuning note arrays (MIDI note numbers)
  const standardGuitar = [64, 59, 55, 50, 45, 40];
  const dropD = [64, 59, 55, 50, 45, 38];
  const halfStepDown = [63, 58, 54, 49, 44, 39];
  const standardBass = [43, 38, 33, 28];
  const dropDBass = [43, 38, 33, 26];

  assert.equal(SongsterrService.formatTuning(standardGuitar), 'Стандартный (E A D G B E)');
  assert.equal(SongsterrService.formatTuning(dropD), 'Drop D (D A D G B E)');
  assert.equal(SongsterrService.formatTuning(halfStepDown), 'Half-Step Down (Eb Ab Db Gb Bb Eb)');
  assert.equal(SongsterrService.formatTuning(standardBass), 'Стандартный бас (E A D G)');
  assert.equal(SongsterrService.formatTuning(dropDBass), 'Drop D бас (D A D G)');

  // Stress-test 500 formatting calls
  const startTime = performance.now();
  for (let i = 0; i < 100; i++) {
    SongsterrService.formatTuning(standardGuitar);
    SongsterrService.formatTuning(dropD);
    SongsterrService.formatTuning(halfStepDown);
    SongsterrService.formatTuning(standardBass);
    SongsterrService.formatTuning(dropDBass);
  }
  const elapsed = performance.now() - startTime;
  console.log('Timing only: Tuning formatting ' + elapsed.toFixed(2) + ' ms');
});
