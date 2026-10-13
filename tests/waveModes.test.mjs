import test from 'node:test';
import assert from 'node:assert/strict';
import { sequenceWaveTracks, resequenceWaveQueue } from '../src/shared/utils/waveQueue.ts';
import { selectWaveMoodSeeds } from '../src/shared/utils/waveRecommendations.ts';
import { waveMusicProfile } from '../src/shared/utils/waveMusicProfile.ts';
import { fillWaveMoodCandidates } from '../src/desktop/main/services/waveMoodCandidates.ts';
import { WaveCandidatePool } from '../src/desktop/main/services/waveCandidatePool.ts';

const song = (id, genre, artist = `Musician ${id}`) => ({
  id,
  title: `Melody ${id}`,
  artist: { name: artist },
  album: { title: 'Single' },
  duration: 200,
  source: 'soundcloud',
  genre,
});

for (const [mood, matchingGenre, oppositeGenre, direction] of [
  ['energy', 'Metal', 'Ambient', 1],
  ['chill', 'Ambient', 'Metal', -1],
]) {
  test(`${mood} remains audible across a batch despite opposite likes and recent successes`, () => {
    const matching = Array.from({ length: 16 }, (_, i) => song(`fit-${i}`, matchingGenre));
    const opposite = Array.from({ length: 16 }, (_, i) => song(`opposite-${i}`, oppositeGenre));
    const unknown = Array.from({ length: 16 }, (_, i) => song(`unknown-${i}`));
    const familiar = opposite.map((track) => track.artist.name);
    const options = {
      tasteTracks: opposite.map((track) => ({ ...track, waveSeedWeight: 2 })),
      positiveTracks: [song('success', oppositeGenre)],
      learnedTracks: [song('learned', oppositeGenre)],
      recentTracks: [song('previous', oppositeGenre)],
    };
    const pool = [...opposite, ...unknown, ...matching];
    const result = sequenceWaveTracks(pool, mood, familiar, 12, options);
    assert.ok(result.filter((track) => waveMusicProfile(track).energy === direction).length >= 11);
    const resequenced = resequenceWaveQueue(result, -1, mood, familiar, new Map(), [], [], options);
    assert.equal(waveMusicProfile(resequenced[0]).energy, direction);
    assert.equal(
      sequenceWaveTracks(pool, 'default', familiar, 12, options)[0].genre,
      oppositeGenre,
    );
  });

  test(`${mood} anchors exclude unknown songs when classified matching songs exist`, () => {
    const fit = song('fit', matchingGenre);
    const seeds = [
      song('opposite', oppositeGenre),
      ...Array.from({ length: 12 }, (_, i) => song(`unknown-${i}`)),
      fit,
    ];
    assert.deepEqual(
      selectWaveMoodSeeds(seeds, mood).map((track) => track.id),
      ['fit'],
    );
  });

  test(`${mood} considers classified results before the per-artist candidate limit`, async () => {
    const artist = 'Personal Musician';
    const tracks = [
      ...Array.from({ length: 3 }, (_, i) => song(`opposite-${i}`, oppositeGenre, artist)),
      ...Array.from({ length: 3 }, (_, i) => song(`matching-${i}`, matchingGenre, artist)),
    ];
    const pool = new WaveCandidatePool({
      mood,
      familiarArtists: [artist],
      heard: [],
      excluded: [],
      disliked: [],
    });
    await fillWaveMoodCandidates({
      mood,
      seeds: [song('seed', matchingGenre, artist)],
      artists: [artist],
      hasTaste: true,
      pool,
      rotate: (names) => names,
      catalog: { both: async () => ({ data: tracks }) },
    });
    assert.equal(pool.size, 3);
    assert.ok(pool.values().every((track) => waveMusicProfile(track).energy === direction));
  });

  test(`${mood} directs metadata-free personal searches by mood without inventing classifications`, async () => {
    const artist = 'Personal Musician';
    const queries = [];
    const pool = new WaveCandidatePool({
      mood,
      familiarArtists: [artist],
      heard: [],
      excluded: [],
      disliked: [],
    });
    await fillWaveMoodCandidates({
      mood,
      seeds: [song('seed', undefined, artist)],
      artists: [artist],
      hasTaste: true,
      pool,
      rotate: (names) => names,
      catalog: {
        both: async (query) => {
          queries.push(query);
          return {
            data: [song('result-' + mood, undefined, artist), song('unrelated', matchingGenre)],
          };
        },
      },
    });
    assert.deepEqual(queries, [artist + (mood === 'energy' ? ' energetic' : ' chill')]);
    assert.equal(pool.size, 1);
    assert.equal(pool.values()[0].id, 'result-' + mood);
    assert.equal(waveMusicProfile(pool.values()[0]).energy, 0);
  });
}

test('personal mood searches fall back to the artist when qualified results are empty or unrelated', async () => {
  for (const response of [
    [],
    [song('unrelated', 'Ambient')],
    [song('wrong-mood', 'Metal', 'Personal Musician')],
    [
      {
        ...song('unavailable', 'Ambient', 'Personal Musician'),
        playbackUnavailable: true,
      },
    ],
  ]) {
    const artist = 'Personal Musician';
    const queries = [];
    const pool = new WaveCandidatePool({
      mood: 'chill',
      familiarArtists: [artist],
      heard: [],
      excluded: [],
      disliked: [],
    });
    await fillWaveMoodCandidates({
      mood: 'chill',
      seeds: [song('seed', undefined, artist)],
      artists: [artist],
      hasTaste: true,
      pool,
      rotate: (names) => names,
      catalog: {
        both: async (query) => {
          queries.push(query);
          return {
            data: query === artist ? [song('fallback', undefined, artist)] : response,
          };
        },
      },
    });
    assert.deepEqual(queries, [artist + ' chill', artist]);
    assert.equal(pool.values()[0].id, 'fallback');
  }
});

test('mix changes musical styles while flow follows the preceding style', () => {
  const pool = [song('jazz', 'Jazz'), song('rock', 'Rock')];
  const options = {
    recentTracks: [song('previous', 'Jazz')],
    tasteTracks: [song('jazz-taste', 'Jazz'), song('rock-taste', 'Rock')],
  };
  assert.equal(sequenceWaveTracks(pool, 'default', [], 2, options)[0].genre, 'Jazz');
  assert.equal(sequenceWaveTracks(pool, 'mix', [], 2, options)[0].genre, 'Rock');
});

test('discover keeps new artists in the opening despite stronger affinity for familiar artists', () => {
  const known = Array.from({ length: 24 }, (_, i) => song(`known-${i}`, 'Jazz'));
  const fresh = Array.from({ length: 24 }, (_, i) => song(`fresh-${i}`, 'Rock'));
  const familiar = known.map((track) => track.artist.name);
  const options = {
    tasteTracks: known.map((track) => ({ ...track, waveSeedWeight: 2 })),
    positiveTracks: [song('success', 'Jazz')],
    learnedTracks: [song('learned', 'Jazz')],
  };
  const result = sequenceWaveTracks([...known, ...fresh], 'discover', familiar, 12, options);
  assert.ok(result.filter((track) => track.genre === 'Rock').length >= 9);
  assert.equal(
    sequenceWaveTracks([...known, ...fresh], 'default', familiar, 12, options)[0].genre,
    'Jazz',
  );
});
