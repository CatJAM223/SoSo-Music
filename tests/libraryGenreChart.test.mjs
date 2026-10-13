import test from 'node:test';
import assert from 'node:assert/strict';
import {
  libraryGenreSegments,
  libraryGenreArc,
  genreTrackCount,
} from '../src/shared/utils/libraryGenreChart.ts';

test('overlapping genre shares produce a complete circle while preserving track counts', () => {
  const genres = [
    { name: 'rock', tracks: 29, share: 0.81 },
    { name: 'punk', tracks: 15, share: 0.51 },
    { name: 'grunge', tracks: 17, share: 0.48 },
  ];
  const segments = libraryGenreSegments(genres);
  assert.equal(
    segments.reduce((sum, genre) => sum + genre.percentage, 0),
    100,
  );
  assert.deepEqual(
    segments.map((genre) => genre.tracks),
    [29, 15, 17],
  );
  assert.deepEqual(
    segments.map((genre) => genre.percentage),
    [45, 28, 27],
  );
  assert.equal(segments[0].start, 0);
  assert.ok(Math.abs(segments.at(-1).end - 1) < 1e-12);
  assert.equal(genres[0].share, 0.81);
});

test('equal shares round deterministically to exactly 100 percent', () => {
  const result = libraryGenreSegments(
    ['a', 'b', 'c'].map((name) => ({ name, tracks: 1, share: 1 })),
  );
  assert.deepEqual(
    result.map((genre) => genre.percentage),
    [34, 33, 33],
  );
});

test('missing and invalid shares do not create chart segments', () => {
  assert.deepEqual(libraryGenreSegments([]), []);
  assert.deepEqual(
    libraryGenreSegments(
      [0, -1, NaN, Infinity].map((share) => ({ name: 'unknown', tracks: 1, share })),
    ),
    [],
  );
});

test('a single known genre fills the circle without losing its track count', () => {
  const [segment] = libraryGenreSegments([{ name: 'rock', tracks: 21, share: 0.4 }]);
  assert.equal(segment.percentage, 100);
  assert.equal(segment.tracks, 21);
  assert.equal(segment.end, 1);
  assert.ok(!libraryGenreArc(segment.start, segment.end).includes('NaN'));
  assert.equal(genreTrackCount(21), '21 трек');
});

test('track tooltip uses Russian plurals for exact counts', () => {
  assert.equal(genreTrackCount(1), '1 трек');
  assert.equal(genreTrackCount(2), '2 трека');
  assert.equal(genreTrackCount(11), '11 треков');
  assert.equal(genreTrackCount(54), '54 трека');
});
