import test from 'node:test';
import assert from 'node:assert/strict';
import { sequenceWaveTracks, resequenceWaveQueue } from '../src/shared/utils/waveQueue.ts';
import { getWaveArtistKeys } from '../src/shared/utils/waveIdentity.ts';
import { WaveEngine } from '../src/desktop/main/services/waveEngine.ts';
import { SoundCloudService } from '../src/desktop/main/services/soundcloud.ts';
import { YouTubeMusicService } from '../src/desktop/main/services/youtubeMusic.ts';

const track = (id, title, artist, duration = 200, source = 'soundcloud') => ({
  id,
  title,
  artist: { name: artist },
  duration,
  source,
  album: { title: 'Single' },
});
const original = track('original', 'Smells Like Teen Spirit', 'Nirvana', 301);
const versions = [
  track('cover', 'Smells Like Teen’s Spirit', 'Neo Acoustix', 234, 'youtube'),
  track('live', 'Smells Like Teen Spirit (Live at Reading)', 'Nirvana', 283, 'youtube'),
  track('upload', 'SMELLS LIKE TEEN SPIRIT (REMASTERED)', 'NIRVANA', 296),
  track('slow', 'Smells Like Teen Spirit (Slowed + Reverb)', 'Nirvana', 374),
  track('swapped', 'Nirvana (Sped Up)', 'Smells Like Teen Spirit', 248),
];
const fresh = track('blew', 'Blew', 'Nirvana');
const unrelated = track('unik', 'Unik – NIRVANA', 'Unik');
const ids = (tracks) => tracks.map((item) => item.id).sort();

for (const mood of ['default', 'energy', 'chill', 'discover', 'mix', 'favorites']) {
  test(
    mood +
      ': screenshot queue contains one Teen Spirit recording despite covers and swapped credits',
    () => {
      assert.deepEqual(
        ids(sequenceWaveTracks([original, ...versions, fresh, unrelated], mood, ['Nirvana'])),
        ['blew', 'original', 'unik'],
      );
    },
  );
}

test('Refill removes every Teen Spirit version while preserving the playing track and history', () => {
  const history = track('past', 'Past song', 'Other artist');
  const queue = [history, original, ...versions, fresh, unrelated];
  const result = resequenceWaveQueue(queue, 1, 'energy', ['Nirvana'], new Map());
  assert.equal(result[0], history);
  assert.equal(result[1], original);
  assert.deepEqual(ids(result.slice(2)), ['blew', 'unik']);
  assert.equal(queue.length, 9, 'The input queue is not mutated');
});

test('Ordinary recording wins over earlier live or speed edits, across different uploaders', () => {
  for (const mood of ['default', 'energy', 'mix']) {
    assert.deepEqual(ids(sequenceWaveTracks([...versions, original], mood, ['Nirvana'])), [
      'original',
    ]);
  }
  assert.deepEqual(ids(sequenceWaveTracks([versions[0]], 'default', ['Nirvana'])), ['cover']);
});

test('A swapped song title must not become an artist credit of the original or live version', () => {
  for (const item of [original, versions[1]]) {
    assert.deepEqual(getWaveArtistKeys(item, ['Nirvana', 'Smells Like Teen Spirit']), ['nirvana']);
  }
});

test('Unrelated homonyms and partial or different long titles remain separate compositions', () => {
  const distinct = [
    track('homeA', 'Home', 'A'),
    track('homeB', 'Home', 'B'),
    track('genericA', 'You And Me', 'C'),
    track('genericB', 'You And Me', 'D'),
    original,
    track('partial', 'Teen Spirit', 'Different artist'),
    track('different', 'Smells Like Teen Depression', 'Another artist'),
    track('long', 'The light beyond the mountain', 'E'),
    track('otherLong', 'The light beyond the ocean', 'F'),
    track('chapter1', 'After The Storm Chapter1', 'G'),
    track('chapter2', 'After The Storm Chapter2', 'H'),
  ];
  assert.deepEqual(ids(sequenceWaveTracks(distinct, 'default', [])), ids(distinct));
});

test('Energy excludes explicitly slowed and acoustic versions without banning their ordinary songs', () => {
  const candidates = [
    track('slowOnly', 'Golden horizon (Slowed)', 'A'),
    track('acousticOnly', 'Open road - Acoustic Version', 'B'),
    track('russianSlow', 'Яркий рассвет (замедленная версия)', 'C'),
    track('ordinary', 'New chapter', 'D'),
  ];
  assert.deepEqual(ids(sequenceWaveTracks(candidates, 'energy', [])), ['ordinary']);
  assert.deepEqual(ids(sequenceWaveTracks(candidates, 'chill', [])), ids(candidates));
});

for (const platform of ['desktop']) {
  test(`${platform} energy batches prefer the original even if live arrives first and exclude heard covers`, async (t) => {
    const data = [
      versions[1],
      versions[3],
      ...versions.filter((item) => !['live', 'slow'].includes(item.id)),
      original,
      fresh,
    ];
    {
      t.mock.method(SoundCloudService, 'search', async (query) => ({
        data: query === 'Nirvana' ? data : [],
      }));
      t.mock.method(YouTubeMusicService, 'search', async () => ({ data: [] }));
    }
    const seed = track('seed', 'In Bloom', 'Nirvana');
    const batch = (context) => WaveEngine.getWaveBatch('energy', [seed], [], [], [], context);
    assert.deepEqual(ids(await batch({})), ['blew', 'original']);
    assert.deepEqual(ids(await batch({ recentTracks: [original] })), ['blew']);
  });
}
