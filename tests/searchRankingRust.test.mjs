import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { initializeRustCompute, runRustCompute } from '../src/shared/compute/rustCore.ts';
import {
  assessSearchArtists,
  mergeSearchTopTracks,
  rankSearchTracks,
  searchQueryVariants,
} from '../src/shared/utils/searchRanking.ts';
import { rankSearchTracks as reference } from './fixtures/searchRankingBeforeRust.mjs';
import { searchTracks, searchQueries } from './helpers/searchRankingCases.mjs';

assert.equal(
  await initializeRustCompute(
    fs.readFileSync(new URL('../public/compute/soso-core.wasm', import.meta.url)),
  ),
  true,
);

const track = (id, artist, title, extra = {}) => ({
  id,
  title,
  artist: { name: artist },
  album: { title: 'Single' },
  source: 'youtube',
  duration: 210,
  ...extra,
});

test('Search quality on 36 fixed queries improves top three and keeps exact tracks first', (t) => {
  const expected = [
    ['Кино', 'Группа крови'],
    ['a-ha', 'Take On Me'],
    ['Queen', 'Bohemian Rhapsody'],
    ['Depeche Mode', 'Enjoy the Silence'],
    ['Radiohead', 'Creep'],
    ['The Cure', 'Friday I’m in Love'],
    ['Daft Punk', 'One More Time'],
    ['Гражданская Оборона', 'Всё идёт по плану'],
    ['Молчат Дома', 'Судно'],
    ['宇多田ヒカル', '光'],
    ['周杰倫', '晴天'],
    ['Björk', 'Hyperballad'],
  ];
  let oldTopThree = 0,
    newTopThree = 0;
  for (const [artist, title] of expected) {
    const recordings = [
      ...['Early Session', 'Deep Cut', 'Interlude', 'Instrument Sketch'].map((name, i) =>
        track('deep-' + i, artist, name, { searchProviderRank: i + 1 }),
      ),
      track('hit', artist, title, { searchTopRank: 1 }),
      track('live', artist, title + ' (Live)'),
      track('cover', 'Other Performer', title + ' (Cover)'),
    ];
    for (const [query, id] of [
      [artist, 'hit'],
      [artist + ' — ' + title, 'hit'],
      [artist + ' ' + title + ' live', 'live'],
    ]) {
      const before = reference(recordings, query).slice(0, 3);
      const after = rankSearchTracks(recordings, query);
      oldTopThree += Number(before.some((item) => item.id === id));
      newTopThree += Number(after.slice(0, 3).some((item) => item.id === id));
      assert.equal(after[0]?.id, id, query);
    }
  }
  t.diagnostic(
    `Top 3 with the same candidates: legacy ${oldTopThree}/36, current ${newTopThree}/36`,
  );
  assert.equal(newTopThree, 36);
  assert.ok(newTopThree > oldTopThree);
});

test('Rust prefers playable copies, respects Unicode and repairs weak text matches', () => {
  const unavailable = track('bad', '宇多田ヒカル', '光', { playbackUnavailable: true });
  const winner = track('good', '宇多田ヒカル', '光', { source: 'soundcloud' });
  const other = track('other', '宇多田ヒカル', '初恋');
  assert.deepEqual(rankSearchTracks([unavailable, other, winner], '光'), [winner, other]);
  for (const query of ['rbyj', 'kino', 'Кинно', 'групап крови']) {
    const hit = track('hit', 'Кино', 'Группа крови');
    assert.equal(rankSearchTracks([other, hit], query)[0], hit, query);
  }
  assert.ok(searchQueryVariants('rbyj').includes('кино'));
  assert.ok(searchQueryVariants('Kino').includes('кино'));
  assert.ok(searchQueryVariants('Кинно').includes('кино'));
  const performers = [
    ...Array.from({ length: 6 }, (_, i) => ({
      id: 'yt-' + i,
      name: 'Кино ' + i,
      source: 'youtube',
    })),
    { id: 'sc-exact', name: 'Кино', source: 'soundcloud' },
  ];
  assert.equal(assessSearchArtists(performers, 'Кино').items[0].id, 'sc-exact');
});

test('Search ordering is deterministic and preserves original objects', () => {
  for (let seed = 1; seed <= 12; seed++) {
    const tracks = searchTracks(seed * 7, seed);
    const original = tracks.slice();
    for (const query of searchQueries) {
      const ranked = rankSearchTracks(tracks, query);
      assert.deepEqual(rankSearchTracks(tracks, query), ranked, query);
      assert.ok(ranked.every((item) => tracks.includes(item)));
    }
    assert.deepEqual(tracks, original);
  }
});

test('Credited tracks keep priority when names are abbreviated or include a collaborator', () => {
  const actual = track('actual', 'The Beatles', 'Yesterday');
  const reupload = track('reupload', 'DJ World', 'Beatles Yesterday', { source: 'soundcloud' });
  assert.equal(rankSearchTracks([reupload, actual], 'Beatles - Yesterday')[0], actual);
  const fanTrack = track('filler', 'Queen', 'Is This the World We Created?');
  const hit = track('hit', 'Queen & David Bowie', 'Under Pressure', { searchTopRank: 1 });
  assert.equal(rankSearchTracks([fanTrack, hit], 'Queen')[0], hit);
});

test('A popular shelf and the normal search share metadata for the same provider ID', () => {
  const original = track('yt_single', 'Queen', 'Under Pressure', { duration: 240 });
  const shelf = { ...original, duration: 180, searchTopRank: 1 };
  assert.equal(rankSearchTracks([original, shelf], 'Queen').length, 1);
  const ranked = rankSearchTracks(mergeSearchTopTracks([original], [shelf]), 'Queen');
  assert.equal(ranked[0].duration, 240);
  assert.equal(ranked[0].searchTopRank, 1);
});

test('Rust search rejects malformed and truncated packets and remains usable', () => {
  for (const bytes of [
    new Uint8Array(8),
    Uint8Array.from([2, 0, 1, 0, 0, 0, 255]),
    Uint8Array.from([2, 0, 0, 0, 0, 0, 1, 0, 0, 0]),
    Uint8Array.from([2, 2, 0, 0, 0, 0, 1]),
  ]) {
    assert.throws(() => runRustCompute('rank_search', bytes), /rejected/);
  }
  const hit = track('hit', 'Adele', 'Hello');
  assert.deepEqual(rankSearchTracks([hit], 'Adele Hello'), [hit]);
});
