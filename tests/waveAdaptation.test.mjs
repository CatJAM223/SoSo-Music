import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createWavePreferences,
  WAVE_PREFERENCES_KEY,
  WAVE_SESSION_IDLE_MS,
} from '../src/shared/services/wavePreferences.ts';
import {
  getWavePlaybackFeedback,
  waveDiscoveryTarget,
  reconcileWavePositiveFeedback,
} from '../src/shared/utils/waveFeedback.ts';
import { sequenceWaveTracks, resequenceWaveQueue } from '../src/shared/utils/waveQueue.ts';
import { createWaveMusicScorer, waveMusicProfile } from '../src/shared/utils/waveMusicProfile.ts';
import {
  normalizeWaveBatchContext,
  waveQueueContext,
} from '../src/shared/utils/waveRecommendations.ts';

const song = (id, genre = 'Jazz', artist = 'Artist ' + id) => ({
  id,
  title: 'Melody ' + id,
  artist: { name: artist },
  duration: 200,
  source: 'soundcloud',
  genre,
  tags: [genre],
  preview: 'https://signed.invalid/audio',
  album: { title: 'Single', cover: 'data:image/png,private' },
});
const storage = () => {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
  };
};

test('relative listening and playback reason separate early rejection, late switching and failures', () => {
  assert.ok(getWavePlaybackFeedback(5, 200) < getWavePlaybackFeedback(20, 200));
  assert.equal(getWavePlaybackFeedback(50, 200), 0);
  assert.equal(getWavePlaybackFeedback(165, 200), 0.2);
  assert.equal(getWavePlaybackFeedback(195, 200), 0.35);
  for (const reason of ['error', 'interrupted'])
    for (const seconds of [5, 195]) assert.equal(getWavePlaybackFeedback(seconds, 200, reason), 0);
  assert.equal(
    getWavePlaybackFeedback(5, 200, 'ended'),
    0,
    'Seeking to the end cannot create a negative signal',
  );
  assert.equal(getWavePlaybackFeedback(195, 200, 'ended'), 0.35);
  assert.equal(getWavePlaybackFeedback(Infinity, 200), 0);
});

test('one or two unfamiliar skips cannot change novelty and repeated signals on one song do not fake evidence', () => {
  const p = createWavePreferences(storage());
  p.record(song('a'), -0.6, true);
  p.record(song('a'), -0.6, true);
  p.record(song('a'), -0.6, true);
  assert.equal(p.discoveryAdjustment(), 0);
  p.record(song('b'), -0.6, true);
  assert.equal(p.discoveryAdjustment(), 0);
  p.record(song('c'), -0.6, true);
  assert.ok(p.discoveryAdjustment() < 0 && p.discoveryAdjustment() >= -0.2);
});

test('successful discoveries widen the search; skips of familiar artists do not suppress exploration', () => {
  const positive = createWavePreferences(storage()),
    familiar = createWavePreferences(storage());
  for (let i = 0; i < 12; i++) {
    positive.record(song('new-' + i), 0.35, true);
    familiar.record(song('known-' + i), -0.6, false);
  }
  assert.ok(positive.discoveryAdjustment() > 0.1);
  assert.ok(positive.discoveryAdjustment() <= 0.2);
  assert.equal(familiar.discoveryAdjustment(), 0);
});

test('each station retains its identity even with extreme or invalid adjustments', () => {
  assert.equal(waveDiscoveryTarget('discover', -10), 0.6);
  assert.equal(waveDiscoveryTarget('discover', 10), 0.9);
  assert.equal(waveDiscoveryTarget('favorites', 10), 0.35);
  assert.equal(waveDiscoveryTarget('default', NaN), 0.25);
  assert.ok(waveDiscoveryTarget('default', -0.2) < waveDiscoveryTarget('default', 0.2));
});

test('the actual queue changes unfamiliar-track share in both directions on a balanced candidate pool', () => {
  const known = Array.from({ length: 40 }, (_, i) => song('known-' + i, '', 'Known artist ' + i));
  const fresh = Array.from({ length: 40 }, (_, i) => song('fresh-' + i, '', 'Fresh artist ' + i));
  const familiar = known.map((track) => track.artist.name),
    artists = new Set(familiar);
  const novelty = (adjustment) =>
    sequenceWaveTracks([...known, ...fresh], 'default', familiar, 24, {
      discoveryAdjustment: adjustment,
    }).filter((track) => !artists.has(track.artist.name)).length;
  assert.ok(novelty(-0.2) < novelty(0));
  assert.ok(novelty(0) < novelty(0.2));
  const discoveries = sequenceWaveTracks([...known, ...fresh], 'discover', familiar, 24, {
    discoveryAdjustment: -0.2,
  });
  assert.ok(discoveries.filter((track) => !artists.has(track.artist.name)).length >= 14);
});

test('reranking preserves the played prefix and does not restart the familiar/novel pattern after each skip', () => {
  const first = song('heard', '', 'Familiar first');
  const known = song('known', '', 'Known next'),
    fresh = song('new', '', 'New next');
  const queue = [first, first, first, known, fresh];
  const ranked = resequenceWaveQueue(
    queue,
    2,
    'default',
    ['Familiar first', 'Known next'],
    new Map(),
  );
  assert.deepEqual(ranked.slice(0, 3), queue.slice(0, 3));
  assert.equal(ranked[3].id, 'new');
});

test('lasting preferences require corroboration, persist across restart and omit playback URLs and artwork', () => {
  const saved = storage(),
    track = song('anchor');
  const first = createWavePreferences(saved);
  first.record(track, 0.2, true);
  assert.equal(first.learnedTracks().length, 0);
  first.record(track, 0.2, true);
  assert.equal(first.learnedTracks()[0].genre, 'Jazz');
  const restored = createWavePreferences(saved);
  assert.equal(restored.learnedTracks()[0].id, 'anchor');
  const raw = saved.getItem(WAVE_PREFERENCES_KEY);
  assert.ok(!raw.includes('signed.invalid') && !raw.includes('data:image'));
  assert.equal(
    restored.discoveryAdjustment(),
    0,
    'Session mood is not restored as permanent taste',
  );
});

test('a like is strong lasting evidence while implicit rejection never bans a genre', () => {
  const p = createWavePreferences(storage());
  p.record(song('liked'), 1, true, 'like');
  assert.equal(p.learnedTracks()[0].id, 'liked');
  p.record(song('liked'), -0.6, false);
  assert.equal(
    p.learnedTracks()[0].id,
    'liked',
    'One skip cannot erase an explicit favorite affinity',
  );
  const unrelated = createWavePreferences(storage());
  unrelated.record(song('rejected'), -0.6, true);
  assert.equal(unrelated.learnedTracks().length, 0);
  p.record(song('liked'), -0.75, false, 'dislike');
  assert.equal(p.learnedTracks().length, 0);
});

test('session hints expire after inactivity while confirmed taste decays over weeks', () => {
  let now = 100000;
  const p = createWavePreferences(storage(), () => now);
  p.record(song('anchor'), 1, false, 'like');
  for (let i = 0; i < 4; i++) p.record(song('skip-' + i), -0.6, true);
  assert.ok(p.discoveryAdjustment() < 0);
  now += WAVE_SESSION_IDLE_MS + 1;
  assert.equal(p.touchSession(), true);
  assert.equal(p.discoveryAdjustment(), 0);
  assert.equal(p.learnedTracks()[0].id, 'anchor');
  now += 91 * 24 * 60 * 60 * 1000;
  assert.equal(p.learnedTracks().length, 0);
});

test('learned taste preserves several artists and survives blocked or corrupt storage', () => {
  for (const saved of [
    { getItem: () => '{broken', setItem() {} },
    {
      getItem() {
        throw Error('blocked');
      },
      setItem() {
        throw Error('full');
      },
    },
  ]) {
    const p = createWavePreferences(saved);
    for (let i = 0; i < 8; i++)
      p.record(song('same-' + i, 'Jazz', 'Same artist'), 1, false, 'like');
    p.record(song('other', 'Rock'), 1, false, 'like');
    const learned = p.learnedTracks();
    assert.equal(learned.filter((t) => t.artist.name === 'Same artist').length, 2);
    assert.ok(learned.some((t) => t.genre === 'Rock'));
    assert.equal(p.metrics().liked, 9);
  }
});

test('long-term learning and short-term mood remain separately weighted', () => {
  const jazz = waveMusicProfile(song('jazz', 'Jazz')),
    rock = waveMusicProfile(song('rock', 'Rock'));
  const base = createWaveMusicScorer([], [], [], [song('learned', 'Rock')]);
  assert.ok(base(rock, 'default') > base(jazz, 'default'));
  const today = createWaveMusicScorer([], [song('today', 'Jazz')], [], [song('learned', 'Rock')]);
  assert.ok(today(jazz, 'default') > today(rock, 'default'));
  const skippedOnce = createWaveMusicScorer([], [], [song('skip', 'Jazz')]);
  const skippedSeveral = createWaveMusicScorer(
    [],
    [],
    [song('s1', 'Jazz'), song('s2', 'Jazz'), song('s3', 'Jazz')],
  );
  assert.ok(skippedOnce(jazz, 'default') > skippedSeveral(jazz, 'default'));
});

test('IPC carries a bounded learned profile and sanitizes novelty independently of session hints', () => {
  const context = normalizeWaveBatchContext({
    learnedTracks: Array.from({ length: 100 }, (_, i) => song(String(i))),
    discoveryAdjustment: 500,
  });
  assert.equal(context.learnedTracks.length, 48);
  assert.equal(context.discoveryAdjustment, 0.2);
  assert.equal(context.learnedTracks[0].preview, '');
  assert.equal(context.learnedTracks[0].album.cover, undefined);
  assert.equal(waveQueueContext(context).learnedTracks.length, 48);
  assert.equal(waveQueueContext(context).discoveryAdjustment, 0.2);
  assert.equal(normalizeWaveBatchContext({ discoveryAdjustment: '0.2' }).discoveryAdjustment, 0);
});

test('different successful songs corroborate a lasting style without requiring repeats', () => {
  const p = createWavePreferences(storage());
  p.record(song('first', 'Jazz'), 0.2, true);
  assert.equal(p.learnedTracks().length, 0);
  p.record(song('second', 'Jazz'), 0.2, true);
  assert.equal(p.learnedTracks().length, 2);
  p.record(song('unrelated', 'Country'), 0.2, true);
  assert.ok(!p.learnedTracks().some((track) => track.genre === 'Country'));
});

test('local discovery metrics do not count a like and completion of one song as two new finds', () => {
  const p = createWavePreferences(storage());
  p.record(song('one'), 1, true, 'like');
  p.record(song('one'), 0.2, true);
  assert.equal(p.metrics().discoveries, 1);
  assert.equal(p.metrics().successfulListens, 1);
});

test('several similar skips can redirect an old successful style, while one skip remains counterbalanced', () => {
  const jazz = waveMusicProfile(song('jazz', 'Jazz')),
    rock = waveMusicProfile(song('rock', 'Rock'));
  const positive = [song('old-success', 'Jazz')];
  const one = createWaveMusicScorer([], positive, [song('skip', 'Jazz')]);
  const three = createWaveMusicScorer([], positive, [
    song('s1', 'Jazz'),
    song('s2', 'Jazz'),
    song('s3', 'Jazz'),
  ]);
  assert.ok(one(jazz, 'default') > one(rock, 'default'));
  assert.ok(three(jazz, 'default') < three(rock, 'default'));
});

test('new success reconciles one matching skip and restores that style without erasing unrelated reactions', () => {
  const rejected = [
    song('s1', 'Jazz'),
    song('s2', 'Jazz'),
    song('s3', 'Jazz'),
    song('country', 'Country'),
  ];
  const positive = song('new-success', 'Jazz');
  const recovered = reconcileWavePositiveFeedback(rejected, positive);
  assert.deepEqual(
    recovered.map((track) => track.id),
    ['s2', 's3', 'country'],
  );
  const score = createWaveMusicScorer([], [positive], recovered);
  assert.ok(
    score(waveMusicProfile(positive), 'default') >
      score(waveMusicProfile(song('rock', 'Rock')), 'default'),
  );
  assert.equal(rejected.length, 4);
});

test('a successful energetic song does not erase rejection of a calm song in the same broad genre', () => {
  const calm = { ...song('calm', 'Rock'), tags: ['calm'] },
    active = { ...song('active', 'Rock'), tags: ['energetic'] };
  assert.deepEqual(reconcileWavePositiveFeedback([calm], active), [calm]);
});

test('Discovery feedback cannot change novelty in other modes, while lasting liked taste stays shared', () => {
  const p = createWavePreferences(storage());
  for (let i = 0; i < 3; i++)
    p.record(song('discovery-skip-' + i), -0.3, true, 'listen', 'discover');
  assert.equal(p.discoveryAdjustment('default'), 0);
  assert.equal(p.discoveryAdjustment('chill'), 0);
  assert.ok(p.discoveryAdjustment('discover') < 0);
  assert.ok(p.discoveryAdjustment('discover') >= -0.1);
  p.record(song('liked-discovery'), 1, true, 'like', 'discover');
  assert.ok(p.learnedTracks().some((track) => track.id === 'liked-discovery'));
  for (let i = 0; i < 3; i++) p.record(song('ordinary-skip-' + i), -0.6, true, 'listen', 'default');
  assert.ok(p.discoveryAdjustment('default') < p.discoveryAdjustment('discover'));
});

test('Discovery is more tolerant of implicit skips; measured successes and media errors keep their meaning', () => {
  for (const seconds of [5, 20]) {
    const ordinary = getWavePlaybackFeedback(seconds, 200, 'skip', 'default');
    const discovery = getWavePlaybackFeedback(seconds, 200, 'skip', 'discover');
    assert.ok(discovery < 0 && discovery > ordinary);
  }
  for (const reason of ['error', 'interrupted'])
    assert.equal(getWavePlaybackFeedback(5, 200, reason, 'discover'), 0);
  assert.equal(getWavePlaybackFeedback(195, 200, 'ended', 'discover'), 0.35);
});

test('Idle sessions clear every mode temporary buffer while preserving confirmed discoveries', () => {
  let stamp = 100000;
  const p = createWavePreferences(storage(), () => stamp);
  for (const mood of ['default', 'discover', 'chill'])
    for (let i = 0; i < 3; i++) p.record(song(mood + '-' + i), -0.6, true, 'listen', mood);
  p.record(song('liked'), 1, true, 'like', 'discover');
  stamp += WAVE_SESSION_IDLE_MS + 1;
  assert.equal(p.touchSession(), true);
  for (const mood of ['default', 'discover', 'chill']) assert.equal(p.discoveryAdjustment(mood), 0);
  assert.equal(p.learnedTracks()[0].id, 'liked');
});
