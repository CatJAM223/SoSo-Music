import * as karaokeProcessing from '../src/shared/utils/karaokeProcessing.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {
  createLyricsCacheKey,
  getLyricsTitleMatchScore,
} from '../src/shared/utils/lyricsIdentity.ts';
import { LyricsService } from '../src/desktop/main/services/lyricsService.ts';

const compile = (source) =>
  ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
const plain = (value) => JSON.parse(JSON.stringify(value));
const lrc = '[00:10.00] One\n[00:20.00] Two\n[00:30.00] Three\n[00:40.00] Four';

function lyricsFixture(fetcher) {
  const exports = {};
  vm.runInNewContext(
    compile(
      fs.readFileSync(
        new URL('../src/desktop/main/services/lyricsService.ts', import.meta.url),
        'utf8',
      ),
    ),
    {
      exports,
      console,
      URLSearchParams,
      AbortSignal,
      Buffer,
      require(name) {
        if (name.endsWith('/karaokeProcessing.ts')) return karaokeProcessing;
        if (name === './desktopFetch.ts') return { desktopFetch: fetcher };
        if (name.endsWith('/lyricsIdentity.ts'))
          return { createLyricsCacheKey, getLyricsTitleMatchScore };
        throw new Error(`Unexpected dependency ${name}`);
      },
    },
  );
  return exports.LyricsService;
}

test('Karaoke cache: duration, original version title and unknown duration stay separate', () => {
  const key = createLyricsCacheKey('Song', 'Artist', 200);
  assert.notEqual(key, createLyricsCacheKey('Song', 'Artist', 210));
  assert.notEqual(key, createLyricsCacheKey('Song (Live)', 'Artist', 200));
  assert.notEqual(key, createLyricsCacheKey('Song', 'Artist'));
  assert.equal(key, createLyricsCacheKey(' song ', ' ARTIST ', 200.1));
  assert.equal(
    createLyricsCacheKey('Song', 'Artist', NaN),
    createLyricsCacheKey('Song', 'Artist', 0),
  );
});

test('Karaoke service: a second recording gets its own aligned timings and can reuse them', async () => {
  let requests = 0;
  const service = lyricsFixture(async () => {
    requests++;
    return Response.json({
      trackName: 'Song',
      artistName: 'Artist',
      duration: 200,
      syncedLyrics: lrc,
    });
  });
  const first = await service.getLyricsDetailed('Song', 'Artist', 200);
  const second = await service.getLyricsDetailed('Song', 'Artist', 210);
  assert.deepEqual(plain(first.lines.map((l) => l.time)), [10, 20, 30, 40]);
  assert.deepEqual(plain(second.lines.map((l) => l.time)), [20, 30, 40, 50]);
  await service.getLyricsDetailed('Song', 'Artist', 210);
  assert.equal(requests, 2, 'same recording should still use its cached result');
  await service.getLyricsDetailed('Song (Live)', 'Artist', 200);
  assert.equal(requests, 3, 'original version title must not collide after query cleanup');
});

test('Karaoke IPC: persistent cache distinguishes recordings and ignores legacy entries', async () => {
  const main = fs.readFileSync(
    new URL('../src/desktop/main/ipc/lyricsHandlers.ts', import.meta.url),
    'utf8',
  );
  const handlerSource = main.slice(
    main.indexOf("  ipcMain.handle('music:getLyrics'"),
    main.indexOf('  // Guitar Chords API'),
  );
  const cache = new Map([['artist|song', { lines: [{ time: 999, text: 'Old incorrect cache' }] }]]);
  let handler,
    requests = 0;
  vm.runInNewContext(compile(handlerSource), {
    console,
    exports: {},
    createLyricsCacheKey,
    ipcMain: {
      handle(_name, fn) {
        handler = fn;
      },
    },
    dbManager: {
      getCachedLyrics: (key) => cache.get(key),
      saveLyricsCache: (key, lines, synced) => cache.set(key, { lines, synced }),
    },
    LyricsService: {
      async getLyricsDetailed(_title, _artist, duration) {
        requests++;
        return { synced: true, lines: [{ time: duration - 190, text: 'Correct recording' }] };
      },
    },
  });
  const request = (duration) => handler(null, { title: 'Song', artist: 'Artist', duration });
  assert.equal((await request(200))[0].time, 10);
  assert.equal((await request(210))[0].time, 20);
  assert.equal((await request(210))[0].time, 20);
  assert.equal(requests, 2);
});

test('Karaoke matching: short and empty titles cannot identify another song by artist/duration', () => {
  for (const title of ['Я', 'Ты', 'ABC', '', '!!!']) {
    const candidate = {
      trackName: 'Совсем другая песня ABC',
      artistName: 'Artist',
      duration: 200,
      syncedLyrics: lrc,
    };
    assert.equal(LyricsService.scoreLyricsCandidate(candidate, title, 'Artist', 200), -999);
  }
  assert.ok(
    LyricsService.scoreLyricsCandidate(
      { trackName: 'Я', artistName: 'Artist', duration: 200, syncedLyrics: lrc },
      'Я',
      'Artist',
      200,
    ) >= 500,
  );
  assert.equal(getLyricsTitleMatchScore('СДВГ', 'сдвг'), 500);
  assert.equal(getLyricsTitleMatchScore('Long song (2011 Remaster)', 'Long song'), 250);
});

test('Karaoke lookup: unrelated search results produce no lyrics; exact short titles still work', async () => {
  const run = async (candidateTitle) => {
    const service = lyricsFixture(async (url) =>
      url.includes('/api/search')
        ? Response.json([
            { trackName: candidateTitle, artistName: 'Artist', duration: 200, syncedLyrics: lrc },
          ])
        : new Response('', { status: 404 }),
    );
    return service.getLyricsDetailed('Я', 'Artist', 200);
  };
  assert.equal(await run('Совсем другая песня'), null);
  assert.equal((await run('Я')).lines.length, 4);
});

test('Karaoke lookup: KuGou fallback cannot match a short title inside another song name', async () => {
  let lyricDownloads = 0;
  const service = lyricsFixture(async (url) => {
    if (url.includes('mobilecdn.kugou.com'))
      return Response.json({
        data: { info: [{ songname: 'Другая', singername: 'Artist', duration: 200 }] },
      });
    if (url.includes('krcs.kugou.com')) {
      lyricDownloads++;
      return Response.json({ candidates: [{ id: 'wrong', accesskey: 'test' }] });
    }
    if (url.includes('lyrics.kugou.com/download'))
      return Response.json({ content: Buffer.from(lrc).toString('base64') });
    return new Response('', { status: 404 });
  });
  assert.equal(await service.getLyricsDetailed('Я', 'Artist', 200), null);
  assert.equal(lyricDownloads, 0);
});

test('Karaoke clock: buffering and pauses freeze lyrics; playback, seeks and track reset follow media time', () => {
  const exports = {};
  let state,
    cleanup,
    frameId = 0,
    mediaTime = 9.9;
  const frames = new Map();
  vm.runInNewContext(
    compile(
      fs.readFileSync(new URL('../src/shared/hooks/useKaraokeTime.ts', import.meta.url), 'utf8'),
    ),
    {
      exports,
      require: () => ({
        useState(initial) {
          state = initial();
          return [
            state,
            (value) => {
              state = value;
            },
          ];
        },
        useEffect(effect) {
          cleanup = effect();
        },
      }),
      requestAnimationFrame(callback) {
        const id = ++frameId;
        frames.set(id, callback);
        return id;
      },
      cancelAnimationFrame(id) {
        frames.delete(id);
      },
    },
  );
  const nextFrame = () => {
    const [id, callback] = frames.entries().next().value;
    frames.delete(id);
    callback();
  };
  exports.useKaraokeTime(true, () => mediaTime);
  for (let i = 0; i < 600; i++) nextFrame();
  assert.equal(
    state,
    9.9,
    'ten seconds of animation frames must not advance a stalled media clock',
  );
  mediaTime = 12.3;
  nextFrame();
  assert.equal(state, 12.3);
  for (let i = 0; i < 120; i++) nextFrame();
  assert.equal(state, 12.3);
  mediaTime = 38;
  nextFrame();
  assert.equal(state, 38);
  mediaTime = 4;
  nextFrame();
  assert.equal(state, 4, 'backward seek must update immediately');
  mediaTime = 0;
  nextFrame();
  assert.equal(state, 0, 'track change must reset the clock');
  cleanup();
  assert.equal(frames.size, 0);
  exports.useKaraokeTime(false, () => mediaTime);
  assert.equal(frames.size, 0, 'closed karaoke must not run an animation loop');
});
