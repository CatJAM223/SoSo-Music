import { filterLibraryTracks } from '../src/shared/utils/librarySearch.ts';
import { stripModuleImports } from './helpers/sourceInspection.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseManager } from '../src/desktop/main/db/index.ts';
import {
  formatCacheSizeBytes,
  toMetaRecord,
  getPossibleKeyVariants,
  parseHlsSegments,
} from '../src/shared/services/offlineCacheService.ts';
import { LyricsService } from '../src/desktop/main/services/lyricsService.ts';

import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Execute the same handlers/filter expressions the app uses, instead of orphaned helper copies.
function initializer(relativePath, name) {
  const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
  const sf = ts.createSourceFile(relativePath, source, ts.ScriptTarget.Latest, true);
  let expression;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(sf) === name)
      expression = node.initializer.getText(sf);
    ts.forEachChild(node, visit);
  }
  visit(sf);
  assert.ok(expression, 'Production declaration must exist: ' + name);
  return ts.transpileModule('const actual = ' + expression + ';', {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText;
}
function filterTracksByQuery(tracks, query) {
  const ctx = vm.createContext({
    tracks,
    queryLower: query.trim().toLowerCase(),
    filterLibraryTracks,
    useMemo: (callback) => callback(),
  });
  vm.runInContext(
    initializer('../src/shared/hooks/useMyMusicViewModel.ts', 'filteredTracks') +
      '\nthis.result = actual;',
    ctx,
  );
  return Array.from(ctx.result);
}

function sleepTimerHarness() {
  let now = 100000,
    cursor = 0,
    expires = 0,
    serial = 0;
  const slots = [],
    intervals = new Map();
  let pending = [];
  const ctx = vm.createContext({
    Date: { now: () => now },
    emitToast() {},
    useState(initial) {
      const i = cursor++;
      if (!slots[i]) slots[i] = { value: initial };
      return [
        slots[i].value,
        (value) => {
          slots[i].value = typeof value === 'function' ? value(slots[i].value) : value;
        },
      ];
    },
    useRef(initial) {
      const i = cursor++;
      if (!slots[i]) slots[i] = { current: initial };
      return slots[i];
    },
    useCallback: (callback) => callback,
    useEffect(callback, deps) {
      const i = cursor++,
        before = slots[i];
      if (!before || deps.some((v, j) => v !== before.deps[j])) {
        pending.push(() => {
          before?.cleanup?.();
          slots[i] = { deps, cleanup: callback() };
        });
      }
    },
    setInterval(callback) {
      const id = ++serial;
      intervals.set(id, callback);
      return id;
    },
    clearInterval: (id) => intervals.delete(id),
  });
  const source = stripModuleImports(
    readFileSync(new URL('../src/shared/hooks/useSleepTimer.ts', import.meta.url), 'utf8'),
  ).replace(/^export /gm, '');
  vm.runInContext(
    ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText +
      '\nthis.hook = useSleepTimer;',
    ctx,
  );
  const render = () => {
    cursor = 0;
    pending = [];
    const api = ctx.hook({ onTimerExpire: () => expires++ });
    pending.forEach((callback) => callback());
    return api;
  };
  return {
    render,
    advance(seconds) {
      now += seconds * 1000;
      [...intervals.values()].forEach((callback) => callback());
    },
    expires: () => expires,
    intervals: () => intervals.size,
  };
}

test('Phases: Listening History DB Schema & Operations', async (t) => {
  const dbManager = new DatabaseManager(':memory:');
  t.after(() => {
    dbManager.db?.close();
  });
  await dbManager.init();

  // Record 3 listening history entries via real DatabaseManager
  dbManager.addListeningHistory({
    track_id: '101',
    title: 'Track One',
    artist: 'Artist A',
    album: 'Album A',
    cover_url: 'cover1.jpg',
    duration: 200,
    source: 'soundcloud',
  });
  dbManager.addListeningHistory({
    track_id: '102',
    title: 'Track Two',
    artist: 'Artist B',
    album: 'Album B',
    cover_url: 'cover2.jpg',
    duration: 180,
    source: 'youtube',
  });
  dbManager.addListeningHistory({
    track_id: '103',
    title: 'Track Three',
    artist: 'Artist C',
    album: 'Album C',
    cover_url: 'cover3.jpg',
    duration: 240,
    source: 'soundcloud',
  });

  const items = dbManager.getListeningHistory(10);
  assert.equal(items.length, 3);
  assert.equal(items[0].track_id, '103');
  assert.equal(items[1].track_id, '102');
  assert.equal(items[2].track_id, '101');

  // Clear history
  dbManager.clearListeningHistory();
  const clearedItems = dbManager.getListeningHistory(10);
  assert.equal(clearedItems.length, 0);
});

test('Phases: LRCLIB Best Match Selection with duration proximity scoring', () => {
  const targetTitle = 'Blinding Lights';
  const targetArtist = 'The Weeknd';
  const targetDuration = 200; // 3:20

  const candidates = [
    {
      id: 1,
      trackName: 'Blinding Lights (Extended Club Mix)',
      artistName: 'The Weeknd',
      duration: 340, // 5:40 (Too long, delta = 140s)
      syncedLyrics: '[00:01.00] Line 1\n[00:05.00] Line 2\n[00:10.00] Line 3\n[00:15.00] Line 4',
    },
    {
      id: 2,
      trackName: 'Blinding Lights',
      artistName: 'The Weeknd',
      duration: 202, // 3:22 (Delta = 2s <= 3s, perfect!)
      syncedLyrics: '[00:01.00] Line 1\n[00:05.00] Line 2\n[00:10.00] Line 3\n[00:15.00] Line 4',
    },
    {
      id: 3,
      trackName: 'Blinding Lights (Live)',
      artistName: 'The Weeknd',
      duration: 245, // Live delta = 45s
      syncedLyrics: '[00:01.00] Line 1\n[00:05.00] Line 2\n[00:10.00] Line 3\n[00:15.00] Line 4',
    },
  ];

  const scored = candidates.map((c) => ({
    cand: c,
    score: LyricsService.scoreLyricsCandidate(c, targetTitle, targetArtist, targetDuration),
  }));
  scored.sort((a, b) => b.score - a.score);

  assert.equal(
    scored[0].cand.id,
    2,
    'Candidate 2 (studio version with delta <= 3s) must have highest score',
  );
  assert.ok(scored[0].score > scored[1].score);
});

test('Phases: Production sleep timer countdown, cancellation and end-of-track mode', () => {
  const h = sleepTimerHarness();
  let timer = h.render();
  for (const mode of ['15', '30', '45', '60']) {
    timer.setSleepTimer(mode);
    timer = h.render();
    assert.equal(timer.sleepTimerRemaining, Number(mode) * 60);
    assert.equal(h.intervals(), 1);
  }
  timer.setSleepTimer('15');
  timer = h.render();
  h.advance(811);
  timer = h.render();
  assert.equal(timer.sleepTimerRemaining, 89);
  h.advance(89);
  timer = h.render();
  assert.equal(timer.sleepTimerMode, 'off');
  assert.equal(h.expires(), 1);
  assert.equal(h.intervals(), 0);
  timer.setSleepTimer('30');
  timer = h.render();
  timer.setSleepTimer('off');
  timer = h.render();
  h.advance(1800);
  assert.equal(h.expires(), 1);
  assert.equal(h.intervals(), 0);
  timer.setSleepTimer('end_of_track');
  timer = h.render();
  assert.equal(timer.sleepTimerRemaining, null);
  assert.equal(h.intervals(), 0);
  assert.equal(timer.shouldStopOnTrackEnd(), true);
  timer = h.render();
  assert.equal(timer.sleepTimerMode, 'off');
  assert.equal(timer.shouldStopOnTrackEnd(), false);
});

test('Phases: Instant Search & Filter Multi-Field Matching', () => {
  const sampleTracks = [
    {
      id: 1,
      title: 'After Hours',
      artist: { name: 'The Weeknd' },
      album: { title: 'After Hours' },
    },
    {
      id: 2,
      title: 'Save Your Tears',
      artist: { name: 'The Weeknd' },
      album: { title: 'After Hours' },
    },
    { id: 3, title: 'Levitating', artist: 'Dua Lipa', album: { title: 'Future Nostalgia' } },
    {
      id: 4,
      title: 'Starboy',
      artist: { name: 'The Weeknd feat. Daft Punk' },
      album: { title: 'Starboy' },
    },
  ];

  // Exact artist search
  assert.equal(filterTracksByQuery(sampleTracks, 'dua lipa').length, 1);
  assert.equal(filterTracksByQuery(sampleTracks, 'dua lipa')[0].title, 'Levitating');

  // Multi-result search
  assert.equal(filterTracksByQuery(sampleTracks, 'weeknd').length, 3);

  // Album match
  assert.equal(filterTracksByQuery(sampleTracks, 'nostalgia').length, 1);
  assert.equal(filterTracksByQuery(sampleTracks, 'nostalgia')[0].id, 3);

  // No match
  assert.equal(filterTracksByQuery(sampleTracks, 'nonexistent query 12345').length, 0);
});

test('Phases: Offline Cache Record Size Accounting with Cover Blob', () => {
  const audioBlobSize = 4 * 1024 * 1024; // 4 MB
  const coverBlobSize = 120 * 1024; // 120 KB
  const totalSizeBytes = audioBlobSize + coverBlobSize;

  const formattedMb = formatCacheSizeBytes(totalSizeBytes);
  assert.equal(formattedMb, '4.1');

  const meta = toMetaRecord({
    trackId: 'sc_123',
    title: 'Song Name',
    artist: 'Artist',
    sizeBytes: totalSizeBytes,
  });
  assert.equal(meta.trackId, 'sc_123');
  assert.equal(meta.sizeBytes, totalSizeBytes);
  assert.equal(formatCacheSizeBytes(meta.sizeBytes), '4.1');
});

test('Phases: Offline Cache Key Normalization & Prefix Resolution', () => {
  const keysFromNumeric = getPossibleKeyVariants(123456);
  assert.ok(keysFromNumeric.includes('123456'));
  assert.ok(keysFromNumeric.includes('dz_123456'));
  assert.ok(keysFromNumeric.includes('sc_123456'));

  const keysFromDeezer = getPossibleKeyVariants('dz_987654');
  assert.ok(keysFromDeezer.includes('987654'));
  assert.ok(keysFromDeezer.includes('dz_987654'));

  const keysFromSC = getPossibleKeyVariants('sc_456789');
  assert.ok(keysFromSC.includes('456789'));
  assert.ok(keysFromSC.includes('sc_456789'));
});

test('Phases: HLS Manifest Segment URL Parsing and Base URL Resolution', () => {
  const sampleManifest = `
#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:10
#EXTINF:10.0,
001.ts
#EXTINF:10.0,
002.ts
#EXTINF:9.5,
https://cdn.example.com/audio/003.ts
#EXT-X-ENDLIST
  `.trim();

  const streamUrl = 'https://cf-media.sndcdn.com/stream/playlist.m3u8?token=xyz';
  const segmentUrls = parseHlsSegments(sampleManifest, streamUrl);

  assert.equal(segmentUrls.length, 3);
  assert.equal(segmentUrls[0], 'https://cf-media.sndcdn.com/stream/001.ts');
  assert.equal(segmentUrls[1], 'https://cf-media.sndcdn.com/stream/002.ts');
  assert.equal(segmentUrls[2], 'https://cdn.example.com/audio/003.ts');
});

test('Sleep timer mode changes take effect immediately and track-end consumption is idempotent', () => {
  const h = sleepTimerHarness(),
    timer = h.render();
  timer.setSleepTimer('end_of_track');
  assert.equal(timer.sleepTimerModeRef.current, 'end_of_track');
  assert.equal(timer.shouldStopOnTrackEnd(), true);
  assert.equal(timer.shouldStopOnTrackEnd(), false);
  timer.setSleepTimer('end_of_track');
  timer.setSleepTimer('off');
  assert.equal(timer.shouldStopOnTrackEnd(), false);
});
