import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { initializeRustCompute, runRustCompute } from '../src/shared/compute/rustCore.ts';
import { rankSearchTracks } from '../src/shared/utils/searchRanking.ts';
import { rankSearchTracks as reference } from './fixtures/searchRankingBeforeRust.mjs';
import { searchTracks, searchQueries } from './helpers/searchRankingCases.mjs';
assert.equal(
  await initializeRustCompute(
    fs.readFileSync(new URL('../public/compute/soso-core.wasm', import.meta.url)),
  ),
  true,
);
test('Rust search preserves complete legacy ordering, duplicates and input identity', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const tracks = searchTracks(seed * 7, seed),
      original = tracks.slice();
    for (const query of searchQueries) {
      const expected = reference(tracks, query),
        actual = rankSearchTracks(tracks, query);
      assert.deepEqual(actual, expected, query);
      for (let i = 0; i < actual.length; i++) assert.equal(actual[i], expected[i]);
    }
    assert.deepEqual(tracks, original);
  }
});
test('Rust search rejects malformed packets and remains usable', () => {
  for (const bytes of [new Uint8Array(8), new Uint8Array(41)])
    assert.throws(() => runRustCompute('rank_search', bytes), /rejected/);
  assert.deepEqual(rankSearchTracks([], ''), []);
  const tracks = searchTracks(80);
  assert.deepEqual(rankSearchTracks(tracks, 'love'), reference(tracks, 'love'));
});
