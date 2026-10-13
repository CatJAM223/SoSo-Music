import crypto from 'node:crypto';
import { withWaveTextCache, cachedWaveText } from '../src/shared/compute/waveTextCache.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  initializeRustCompute,
  createWaveSongMatrix,
} from '../src/shared/compute/waveSongMatrix.ts';
import { areSameWaveSong, buildWaveSongIdentity } from '../src/shared/utils/waveIdentity.ts';
import { sequenceWaveTracks } from '../src/shared/utils/waveQueue.ts';
import { sequenceWaveTracks as referenceSequence } from './fixtures/waveSequenceReference.mjs';

const bytes = fs.readFileSync(new URL('../public/compute/soso-core.wasm', import.meta.url));
assert.equal(await initializeRustCompute(bytes), true, 'The actual Rust artifact must initialize');
const tokenPool = [
  'golden',
  'horizon',
  'mountain',
  'martin',
  'martine',
  'chapter1',
  'chapter2',
  'abcdefgh',
  'abcdefxy',
  'fool',
  'foo',
  'go',
  'Слушать',
  'любовь',
  '𐐀𐐨abcd',
  '\ud800abcd',
  '\udfffabcd',
  '١٢abcd',
  'ǅuro',
  '１２abcd',
  '🇷🇺title',
  'home',
  'snowfall',
  'memories',
  'ocean',
];
let seed = 0x579ab13;
const random = () => {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return (seed >>> 0) / 4294967296;
};
function printSong(index) {
  const tokens = Array.from(
    { length: Math.floor(random() * 6) },
    () => tokenPool[Math.floor(random() * tokenPool.length)],
  );
  return {
    artists: index % 7 ? ['artist' + (index % 5)] : [],
    print: {
      tokens,
      set: new Set(tokens),
      variants: new Set(index % 9 === 0 ? ['live'] : []),
      dur: index % 4 ? 200 + (index % 15) : 0,
    },
  };
}
test('Rust ordered matching agrees with JavaScript for UTF-16, typo, duration and variant edge cases', () => {
  const songs = Array.from({ length: 140 }, (_, i) => printSong(i)),
    recent = songs.slice(35, 110),
    offered = songs.slice(15, 65);
  const matrix = createWaveSongMatrix(songs, recent, offered);
  assert.ok(matrix, 'Fixture must use Rust, not fallback');
  for (let i = 0; i < songs.length; i++) {
    assert.equal(
      matrix.wasHeard(i),
      recent.some((song) => areSameWaveSong(song, songs[i])),
      'recent ' + i,
    );
    assert.equal(
      matrix.wasOffered(i),
      offered.some((song) => areSameWaveSong(song, songs[i])),
      'offered ' + i,
    );
    for (let j = 0; j < songs.length; j++)
      assert.equal(
        matrix.sameSong(i, j),
        areSameWaveSong(songs[i], songs[j]),
        'ordered pair ' + i + ',' + j,
      );
  }
});
const track = (i, title, artist) => ({
  id: 'sc_' + i,
  title,
  artist: { name: artist },
  album: { title: i % 3 ? 'Single' : 'Album' },
  duration: 120 + (i % 260),
  source: i % 2 ? 'youtube' : 'soundcloud',
});
function scenario(count, historyCount) {
  const words = [
    'Golden Horizon',
    'Silent Mountain',
    'Winter Ocean',
    'Burning Sunrise',
    'Lost Memory',
    'Маленький город',
    'Вечный рассвет',
    'After The Storm',
  ];
  const all = Array.from({ length: count + historyCount + 80 }, (_, i) =>
    track(
      i,
      words[i % words.length] +
        ' ' +
        tokenPool[i % tokenPool.length] +
        (i % 7 === 0 ? ' (Live)' : i % 11 === 0 ? ' (Slowed)' : ''),
      'Artist ' + (i % 29),
    ),
  );
  return {
    tracks: all.slice(0, count),
    options: {
      recentTracks: all.slice(count, count + historyCount),
      offeredTracks: all.slice(count + historyCount),
      recentArtists: ['Artist 2', 'Artist 4'],
      artistFeedback: new Map([
        ['artist 2', -0.9],
        ['artist 4', 0.7],
      ]),
    },
  };
}
test('All six wave modes preserve complete track ordering with the Rust kernel enabled', () => {
  for (const [count, history] of [
    [60, 40],
    [120, 300],
    [200, 300],
  ]) {
    const { tracks, options } = scenario(count, history);
    for (const mood of ['default', 'energy', 'chill', 'discover', 'mix', 'favorites']) {
      assert.deepEqual(
        sequenceWaveTracks(tracks, mood, ['Artist 2', 'Artist 6'], 25, options),
        referenceSequence(tracks, mood, ['Artist 2', 'Artist 6'], 25, options),
        mood + ' ' + count,
      );
    }
  }
});
test('Rust results remain owned by their batch and oversized work uses JavaScript', () => {
  const songs = Array.from({ length: 90 }, (_, i) =>
    buildWaveSongIdentity(track(i, 'Golden horizon ' + i, 'Artist ' + (i % 4))),
  );
  const first = createWaveSongMatrix(songs, [], []);
  assert.ok(first);
  const before = first.sameSong(0, 1);
  const changed = songs.map((song, i) => ({ ...song, artists: ['new' + i] }));
  assert.ok(createWaveSongMatrix(changed, [], []));
  assert.equal(
    first.sameSong(0, 1),
    before,
    'A later WASM allocation must not overwrite an earlier result',
  );
  assert.equal(createWaveSongMatrix(Array(1001).fill(songs[0]), [], []), null);
  assert.equal(
    createWaveSongMatrix(songs.slice(0, 2), [], []),
    null,
    'Tiny batches avoid Rust transfer overhead',
  );
});
test('Actual Rust ABI rejects malformed input and has no imported host capabilities', async () => {
  const module = await WebAssembly.compile(bytes);
  assert.deepEqual(WebAssembly.Module.imports(module), []);
  const instance = await WebAssembly.instantiate(module),
    e = instance.exports;
  assert.equal(e.abi_version(), 2);
  assert.throws(() => e.memory.grow(257), RangeError, 'WASM memory is capped at 16 MiB');
  assert.equal(e.reserve(2 * 1024 * 1024 + 1), 0);
  assert.equal(e.calculate(2 * 1024 * 1024 + 1), -1);
  const pointer = e.reserve(2);
  new Uint8Array(e.memory.buffer, pointer, 2).set([255, 255]);
  assert.equal(e.calculate(2), -1);
});
test('A missing or corrupt Rust artifact leaves the full JavaScript path available', async () => {
  const fresh = await import('../src/shared/compute/waveSongMatrix.ts?unavailable');
  assert.equal(await fresh.initializeRustCompute(new Uint8Array([0, 1, 2, 3])), false);
  const songs = Array.from({ length: 90 }, (_, i) =>
    buildWaveSongIdentity(track(i, 'Song ' + i, 'Artist')),
  );
  assert.equal(fresh.createWaveSongMatrix(songs, [], []), null);
});

test('Generated Rust artifact matches the current source and build settings', () => {
  const hash = crypto.createHash('sha256');
  for (const file of ['Cargo.toml', 'Cargo.lock', 'src/lib.rs'])
    hash.update(fs.readFileSync(new URL('../native/compute-core/' + file, import.meta.url)));
  hash.update(fs.readFileSync(new URL('../scripts/native/buildComputeCore.mjs', import.meta.url)));
  const metadata = JSON.parse(
    fs.readFileSync(new URL('../public/compute/soso-core.json', import.meta.url)),
  );
  assert.equal(metadata.sourceSha256, hash.digest('hex'));
  assert.equal(metadata.wasmSha256, crypto.createHash('sha256').update(bytes).digest('hex'));
  assert.equal(metadata.abi, 2);
});
test('Text memo is bounded, nested and released after errors and between batches', () => {
  let calls = 0;
  const compute = (value) => {
    calls++;
    return value.toLowerCase();
  };
  withWaveTextCache(() => {
    for (let i = 0; i < 2100; i++) cachedWaveText('artist', 'Artist' + i, compute);
    assert.equal(calls, 2100);
    withWaveTextCache(() => cachedWaveText('artist', 'Artist0', compute));
    assert.equal(calls, 2100);
    cachedWaveText('artist', 'Artist2099', compute);
    assert.equal(calls, 2101, 'Entries beyond the bound are not retained');
  });
  cachedWaveText('artist', 'Artist0', compute);
  assert.equal(calls, 2102);
  assert.throws(() =>
    withWaveTextCache(() => {
      cachedWaveText('title', 'X', compute);
      throw Error('cancel');
    }),
  );
  const before = calls;
  cachedWaveText('title', 'X', compute);
  assert.equal(calls, before + 1);
});

test('Packing stops at its token budget and does not disable later valid Rust work', () => {
  const oversized = Array.from({ length: 200 }, (_, i) => {
    const tokens = Array.from({ length: 64 }, (_, j) => 'unique' + i + 'token' + j);
    return {
      artists: ['artist'],
      print: { tokens, set: new Set(tokens), variants: new Set(), dur: 0 },
    };
  });
  assert.equal(createWaveSongMatrix(oversized, [], []), null);
  const valid = Array.from({ length: 90 }, (_, i) =>
    buildWaveSongIdentity(track(i, 'Golden horizon ' + i, 'Artist')),
  );
  assert.ok(
    createWaveSongMatrix(valid, [], []),
    'Unsupported input must leave the kernel available',
  );
});
