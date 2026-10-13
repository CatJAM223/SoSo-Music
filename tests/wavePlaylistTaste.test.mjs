import test from 'node:test';
import assert from 'node:assert/strict';
import {
  selectPlaylistWaveSeeds,
  mergeWaveTasteSeeds,
  waveTasteArtistWeights,
} from '../src/shared/utils/waveTaste.ts';
import { selectWaveRelatedSeeds } from '../src/shared/utils/waveRecommendations.ts';
import { spreadWaveSeedArtists } from '../src/shared/utils/waveQueue.ts';
import { DatabaseManager } from '../src/desktop/main/db/index.ts';
const row = (id, artist, playlist = 'small') => ({
  track_deezer_id: String(id),
  title: 'Song ' + id,
  artist,
  playlist_id: playlist,
  duration: 200,
});

test('A huge imported playlist cannot consume all playlist taste slots or repeat one artist', () => {
  const huge = Array.from({ length: 1000 }, (_, i) => row(i + 1, 'Large artist ' + i, 'import'));
  const small = [row(2001, 'Personal A'), row(2002, 'Personal B'), row(2003, 'Personal C')];
  const selected = selectPlaylistWaveSeeds([...huge, ...small], new Set(['2001']), 6, () => 0.5);
  assert.equal(selected.length, 6);
  assert.ok(selected.some((t) => t.artist.name === 'Personal B'));
  assert.ok(selected.some((t) => t.artist.name === 'Personal C'));
  assert.ok(!selected.some((t) => t.id === '2001'));
  assert.equal(new Set(selected.map((t) => t.artist.name)).size, 6);
  assert.ok(selected.every((t) => t.waveSeedWeight === 0.25));
  assert.equal(selectPlaylistWaveSeeds([row(1, 'Same'), row(2, 'Same', 'other')]).length, 1);
});

test('Likes/listening remain strong, a playlist does not upgrade a disliked song, and payloads do not include artwork', () => {
  const primary = Array.from({ length: 12 }, (_, i) => ({
    ...row(i + 1, 'Strong ' + i),
    cover_url: 'data:image/huge',
  }));
  const merged = mergeWaveTasteSeeds(
    primary,
    [row(1, 'Strong 0'), row(50, 'Weak A'), row(51, 'Weak B'), row(52, 'Weak C')],
    ['51'],
  );
  assert.equal(merged.filter((t) => t.waveSeedWeight === 1).length, 12);
  assert.equal(merged.filter((t) => t.id === '1').length, 1);
  assert.ok(!merged.some((t) => t.id === '51'));
  assert.ok(!JSON.stringify(merged).includes('data:image'));
  const anchors = selectWaveRelatedSeeds(merged, {}, 3, () => 0.5);
  assert.ok(anchors.every((t) => t.waveSeedWeight === 1));
  const cold = mergeWaveTasteSeeds([], [row(50, 'Weak A'), row(51, 'Weak B')], []);
  assert.equal(cold.length, 2);
  const weights = waveTasteArtistWeights([
    ...primary.map((t) => ({
      ...t,
      id: t.track_deezer_id,
      artist: { name: t.artist },
      waveSeedWeight: 1,
    })),
    ...cold,
  ]);
  assert.deepEqual(spreadWaveSeedArtists(['Weak A', 'Strong 0'], [], weights), [
    'Strong 0',
    'Weak A',
  ]);
  assert.deepEqual(
    spreadWaveSeedArtists(
      ['Strong 0', 'Weak A'],
      [['strong 0'], ['strong 0'], ['strong 0']],
      weights,
    ),
    ['Weak A', 'Strong 0'],
  );
});

test('SQLite playlist taste query is bounded, artist-balanced and excludes disliked tracks while freeing statements', async () => {
  const db = new DatabaseManager(':memory:');
  await db.init();
  try {
    db.db.run('BEGIN');
    for (let i = 0; i < 1000; i++)
      db.db.run(
        'INSERT INTO playlist_tracks(playlist_id,track_deezer_id,title,artist,duration,position) VALUES(?,?,?,?,?,?)',
        ['large', String(i + 1), 'Song ' + i, 'Same artist', 200, i],
      );
    for (let i = 0; i < 4; i++)
      db.db.run(
        'INSERT INTO playlist_tracks(playlist_id,track_deezer_id,title,artist,duration,position) VALUES(?,?,?,?,?,?)',
        ['small', String(2001 + i), 'Song ' + i, 'Personal ' + i, 200, i],
      );
    db.db.run('INSERT INTO disliked_tracks(track_id,title,artist) VALUES(?,?,?)', [
      '2001',
      'Song 0',
      'Personal 0',
    ]);
    db.db.run('COMMIT');
    const before = db.statementsFreedCount;
    const rows = db.getPlaylistWaveTracks();
    assert.equal(rows.filter((t) => t.playlist_id === 'large').length, 1);
    assert.equal(rows.filter((t) => t.playlist_id === 'small').length, 3);
    assert.ok(!rows.some((t) => t.track_deezer_id === '2001'));
    assert.equal(db.statementsFreedCount, before + 1);
    assert.ok(!JSON.stringify(rows).includes('cover_url'));
  } finally {
    db.db.close();
  }
});

test('Explicit likes survive a large listening history and lead artist searches without monopolizing rotation', async () => {
  const { buildWaveTasteSeeds } = await import('../src/shared/utils/waveTaste.ts');
  const likes = Array.from({ length: 60 }, (_, i) => row(1000 + i, 'Liked ' + i));
  const history = Array.from({ length: 30 }, (_, i) => row(2000 + i, 'History ' + i));
  const session = Array.from({ length: 12 }, (_, i) => row(3000 + i, 'Session ' + i));
  const seeds = buildWaveTasteSeeds(likes, session, history, [], ['1001']);
  assert.equal(seeds.length, 48);
  assert.equal(seeds.filter((t) => t.waveSeedWeight === 2).length, 32);
  assert.equal(seeds.filter((t) => t.artist.name.startsWith('History')).length, 8);
  assert.equal(seeds.filter((t) => t.artist.name.startsWith('Session')).length, 8);
  assert.ok(!seeds.some((t) => t.id === '1001'));
  const weights = waveTasteArtistWeights(seeds);
  assert.deepEqual(spreadWaveSeedArtists(['History 0', 'Liked 0'], [], weights), [
    'Liked 0',
    'History 0',
  ]);
  assert.deepEqual(
    spreadWaveSeedArtists(['Liked 0', 'History 0'], [['liked 0'], ['liked 0']], weights),
    ['History 0', 'Liked 0'],
  );
  const same = buildWaveTasteSeeds(
    [row(1, 'Favorite')],
    [],
    [row(1, 'Favorite'), row(2, 'Favorite')],
    [],
    [],
  );
  assert.equal(same.find((t) => t.id === '1').waveSeedWeight, 2);
});
