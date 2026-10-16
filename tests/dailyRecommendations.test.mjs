import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import {
  createDailyRecommendationLoader,
  DAILY_RECOMMENDATIONS_KEY,
  localRecommendationDay,
  readDailyRecommendations,
  selectDailyRecommendations,
} from '../src/shared/utils/dailyRecommendations.ts';
import { normalizeWaveSeed } from '../src/shared/utils/waveRecommendations.ts';
import { createDailyDislikePolicy } from '../src/shared/utils/dailyDislikes.ts';
const track = (id, artist = 'Singer ' + id, title = 'Melody ' + id) => ({
  id,
  title,
  artist: { name: artist },
  album: { title: '' },
  duration: 180,
  source: 'youtube',
  preview: '',
});
function storage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
  };
}
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
test('Daily recommendations fetch once, survive restart, and refresh at local midnight excluding yesterday', async () => {
  const saved = storage();
  let date = new Date(2026, 9, 2, 22),
    calls = 0,
    previous;
  const fetch = async (ids) => {
    calls++;
    previous = ids;
    return [track(String(calls))];
  };
  const load = createDailyRecommendationLoader(saved, fetch, () => date);
  const first = await load();
  assert.equal(first.day, localRecommendationDay(date));
  assert.deepEqual(await load(), first);
  assert.equal(calls, 1);
  assert.deepEqual(await createDailyRecommendationLoader(saved, fetch, () => date)(), first);
  assert.equal(calls, 1);
  date = new Date(2026, 9, 3, 0, 0, 1);
  assert.equal((await load()).tracks[0].id, '2');
  assert.deepEqual(previous, ['1']);
  assert.equal(calls, 2);
});
test('Concurrent requests share a fetch; errors and empty candidates remain retryable', async () => {
  const result = deferred();
  let calls = 0;
  const load = createDailyRecommendationLoader(storage(), () => {
    calls++;
    return calls === 1 ? result.promise : Promise.resolve([track('retry')]);
  });
  const first = load(),
    second = load();
  assert.equal(first, second);
  result.reject(Error('offline'));
  await assert.rejects(first);
  assert.equal(calls, 1);
  assert.equal((await load()).tracks[0].id, 'retry');
  assert.equal(calls, 2);
  let emptyCalls = 0;
  const empty = createDailyRecommendationLoader(storage(), async () => {
    emptyCalls++;
    return emptyCalls === 1 ? [] : [track('new')];
  });
  assert.deepEqual((await empty()).tracks, []);
  assert.equal((await empty()).tracks.length, 1);
});
test('A request spanning midnight cannot overwrite the new snapshot; expired stream URLs are removed', async () => {
  const saved = storage();
  let date = new Date(2026, 9, 2, 23, 59);
  const old = deferred();
  let calls = 0;
  const load = createDailyRecommendationLoader(
    saved,
    () => (++calls === 1 ? old.promise : Promise.resolve([track('today')])),
    () => date,
  );
  const pending = load();
  await Promise.resolve();
  date = new Date(2026, 9, 3, 0, 1);
  await load();
  old.resolve([
    { ...track('old'), resolvedStreamUrl: 'https://expired.invalid', resolvedStreamTimestamp: 1 },
  ]);
  assert.equal((await pending).tracks[0].resolvedStreamUrl, undefined);
  assert.equal(
    readDailyRecommendations(saved.getItem(DAILY_RECOMMENDATIONS_KEY)).tracks[0].id,
    'today',
  );
});
test('Corrupt cache and unavailable storage recover; same-day memory remains stable', async () => {
  let calls = 0;
  const load = createDailyRecommendationLoader(
    {
      getItem() {
        throw Error('denied');
      },
      setItem() {
        throw Error('full');
      },
    },
    async () => {
      calls++;
      return [track('memory')];
    },
  );
  await load();
  await load();
  assert.equal(calls, 1);
  assert.equal(readDailyRecommendations('{broken'), null);
  assert.equal(
    readDailyRecommendations(JSON.stringify({ day: 'today', tracks: [track('bad')] })),
    null,
  );
});
test('Five daily songs exclude known recordings and unavailable songs, with artist diversity', () => {
  const liked = track('liked', 'Known', 'Existing song');
  const candidates = [
    track('copy', 'Known', 'Existing song (Official Audio)'),
    { ...track('blocked'), playbackUnavailable: true },
    track('a', 'One'),
    track('b', 'One'),
    track('c', 'Two'),
    track('d', 'Three'),
    track('e', 'Four'),
    track('f', 'Five'),
  ];
  const selected = selectDailyRecommendations(candidates, [liked]);
  assert.deepEqual(
    selected.map((t) => t.id),
    ['a', 'c', 'd', 'e', 'f'],
  );
});
test('Daily IPC uses taste and dislikes, excludes recent/previous songs, and leaves wave session untouched', async () => {
  const source = readFileSync(new URL('../src/desktop/main/index.ts', import.meta.url), 'utf8');
  const tree = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, true);
  let handlerSource;
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(tree) === 'ipcMain.handle' &&
      ts.isStringLiteral(node.arguments[0]) &&
      node.arguments[0].text === 'music:getRecommendedTracks'
    )
      handlerSource = node.getText(tree);
    ts.forEachChild(node, visit);
  };
  visit(tree);
  assert.ok(handlerSource, 'Actual daily IPC registration must exist');
  let handler, args;
  const likes = [{ deezer_id: 'yt_liked', title: 'Liked song', artist: 'Favorite' }];
  const ctx = {
    ipcMain: {
      handle(name, fn) {
        assert.equal(name, 'music:getRecommendedTracks');
        handler = fn;
      },
    },
    normalizeWaveSeed,
    selectDailyRecommendations,
    createDailyDislikePolicy,
    dbManager: {
      getDislikedTrackIds: () => ['yt_blocked'],
      getLikedTracks: () => likes,
      getTasteLikedTracks: () => likes,
      getWaveTasteTracks: () => [track('taste')],
      getFollowedArtists: () => [],
      getScrobbledTopArtists: () => [],
      getListeningHistory: () => [
        { id: 77, track_id: 'yt_recent', title: 'Recent', artist: 'Recent Artist' },
      ],
      getDislikedWaveTracks: () => [],
    },
    WaveEngine: {
      async getWaveBatch(...values) {
        args = values;
        return [track('fresh')];
      },
    },
  };
  vm.runInNewContext(stripTypeScriptTypes(handlerSource), ctx);
  assert.equal((await handler(null, ['yesterday'])).length, 1);
  assert.equal(args[6], false);
  assert.ok(args[1].some((t) => t.id === 'yt_liked'));
  for (const id of ['yt_liked', 'yt_recent', 'yt_blocked', 'yesterday'])
    assert.ok(args[2].includes(id));
  ctx.dbManager.getLikedTracks = () => [];
  ctx.dbManager.getTasteLikedTracks = () => [];
  ctx.dbManager.getWaveTasteTracks = () => [];
  args = null;
  assert.equal((await handler(null, [])).length, 0);
  assert.equal(args, null);
});

test('An old persisted snapshot cannot replace today when writing storage fails', async () => {
  const yesterday = JSON.stringify({
    day: localRecommendationDay(new Date(2026, 9, 1)),
    tracks: [track('yesterday')],
  });
  let calls = 0;
  const load = createDailyRecommendationLoader(
    {
      getItem: () => yesterday,
      setItem() {
        throw Error('quota exceeded');
      },
    },
    async () => {
      calls++;
      return [track('today')];
    },
    () => new Date(2026, 9, 2),
  );
  await load();
  assert.equal((await load()).tracks[0].id, 'today');
  assert.equal(calls, 1);
});
