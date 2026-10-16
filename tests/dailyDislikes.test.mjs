import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import ts from 'typescript';
import { createDailyDislikePolicy, dailyDislikeKey } from '../src/shared/utils/dailyDislikes.ts';
import {
  createDailyRecommendationLoader,
  selectDailyRecommendations,
  DAILY_RECOMMENDATIONS_KEY,
  localRecommendationDay,
} from '../src/shared/utils/dailyRecommendations.ts';
import { normalizeWaveSeed } from '../src/shared/utils/waveRecommendations.ts';
import { hookRuntime } from './helpers/hookRuntime.mjs';
const song = (id, artist = 'Rejected Artist', title = 'First constellation') => ({
  id,
  title,
  artist: { name: artist },
  album: { title: '' },
  duration: 180,
  source: 'youtube',
});
const dislike = (id, title = 'First constellation', artist = 'Rejected Artist') => ({
  id,
  title,
  artist,
});
const two = [dislike('a'), dislike('b', 'Second horizon')];
function storage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
  };
}
function deferred() {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { resolve, promise };
}

test('one daily dislike rejects the song and its copies, but only lowers the artist priority', () => {
  const disliked = [dislike('a')],
    policy = createDailyDislikePolicy(disliked);
  assert.equal(policy.accepts(song('a')), false);
  assert.equal(
    policy.accepts(song('copy', 'Rejected Artist', 'First constellation (Official Audio)')),
    false,
  );
  assert.equal(policy.accepts(song('other', 'Rejected Artist', 'Another horizon')), true);
  const selected = selectDailyRecommendations(
    [
      song('other', 'Rejected Artist', 'Another horizon'),
      song('fresh', 'Other artist', 'New orbit'),
    ],
    [],
    disliked,
  );
  assert.deepEqual(
    selected.map((t) => t.id),
    ['fresh', 'other'],
  );
  assert.equal(policy.artistFeedback['rejected artist'], -0.75);
});
test('two distinct songs suppress the artist, including collaborations and credited re-uploads', () => {
  const policy = createDailyDislikePolicy(two);
  assert.equal(policy.acceptsArtist('REJECTED   ARTIST'), false);
  assert.equal(policy.accepts(song('c', 'Rejected Artist', 'Third planet')), false);
  assert.equal(
    policy.accepts(song('collab', 'Other feat. Rejected Artist', 'Third planet')),
    false,
  );
  assert.equal(
    policy.accepts(
      song('upload', 'Music Channel', 'Rejected Artist - Third planet (Official Audio)'),
    ),
    false,
  );
  assert.equal(policy.accepts(song('safe', 'Rejected Artist Junior', 'Third planet')), true);
  assert.equal(policy.accepts(song('safe2', 'Another artist', 'Third planet')), true);
  assert.deepEqual(
    selectDailyRecommendations([song('c', 'Rejected Artist', 'Third planet')], [], two),
    [],
    'Never fill a short daily list with a rejected artist',
  );
});
test('copies, edits and ID aliases of one rejected song do not count as two artist rejections', () => {
  for (const rows of [
    [dislike('a'), dislike('dz_a', 'Second horizon')],
    [dislike('a'), dislike('copy', 'First constellation (slowed + reverb)')],
    [dislike('a'), dislike('copy', 'First constellation (Official Video)')],
  ]) {
    const policy = createDailyDislikePolicy(rows);
    assert.equal(policy.acceptsArtist('Rejected Artist'), true);
    assert.equal(policy.accepts(song('other', 'Rejected Artist', 'Third planet')), true);
  }
});
test('unknown artists do not suppress unrelated unknown recordings; undo recomputes persistent feedback', () => {
  const unknown = createDailyDislikePolicy([
    dislike('u1', 'First constellation', 'Unknown Artist'),
    dislike('u2', 'Second horizon', 'Unknown Artist'),
  ]);
  assert.equal(unknown.accepts(song('u3', 'Unknown Artist', 'Third planet')), true);
  const persisted = JSON.parse(JSON.stringify(two));
  assert.equal(createDailyDislikePolicy(persisted).acceptsArtist('Rejected Artist'), false);
  persisted.pop();
  assert.equal(createDailyDislikePolicy(persisted).acceptsArtist('Rejected Artist'), true);
  assert.equal(dailyDislikeKey(new Set(['dz_a', 'a', 'b'])), dailyDislikeKey(new Set(['b', 'a'])));
  assert.notEqual(dailyDislikeKey(['a']), dailyDislikeKey(['a', 'b']));
});
test('daily cache refreshes on a dislike and undo, survives restart, and rejects an old-policy cache', async () => {
  const saved = storage();
  let calls = 0;
  const now = () => new Date(2026, 9, 16, 12),
    fetch = async () => [song('result-' + ++calls, 'Other artist', 'Different song')];
  saved.setItem(
    DAILY_RECOMMENDATIONS_KEY,
    JSON.stringify({
      day: localRecommendationDay(now()),
      tasteRevision: 0,
      tracks: [song('legacy')],
    }),
  );
  const load = createDailyRecommendationLoader(saved, fetch, now),
    empty = dailyDislikeKey([]),
    one = dailyDislikeKey(['a']),
    both = dailyDislikeKey(['a', 'b']);
  await load(empty);
  assert.equal(calls, 1, 'Invalidate pre-fix persisted lists');
  await load(one);
  await load(both);
  assert.equal(calls, 3);
  await createDailyRecommendationLoader(saved, fetch, now)(both);
  assert.equal(calls, 3, 'Fresh snapshot survives restart');
  await load(one);
  assert.equal(calls, 4, 'Undo also refreshes recommendations');
});
test('a response started before a dislike cannot overwrite a newer daily snapshot', async () => {
  const saved = storage(),
    old = deferred();
  let calls = 0;
  const load = createDailyRecommendationLoader(
    saved,
    () => (++calls === 1 ? old.promise : Promise.resolve([song('fresh', 'Other artist')])),
    () => new Date(2026, 9, 16),
  );
  const pending = load(dailyDislikeKey([]));
  await Promise.resolve();
  await load(dailyDislikeKey(['a', 'b']));
  old.resolve([song('stale')]);
  await pending;
  assert.equal(JSON.parse(saved.getItem(DAILY_RECOMMENDATIONS_KEY)).tracks[0].id, 'fresh');
  assert.equal((await load(dailyDislikeKey(['a', 'b']))).tracks[0].id, 'fresh');
});
function dailyHandler(db, fetch) {
  const source = fs.readFileSync(new URL('../src/desktop/main/index.ts', import.meta.url), 'utf8'),
    tree = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, true);
  let handlerSource, handler;
  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(tree) === 'ipcMain.handle' &&
      ts.isStringLiteral(node.arguments[0]) &&
      node.arguments[0].text === 'music:getRecommendedTracks'
    )
      handlerSource = node.getText(tree);
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.ok(handlerSource);
  vm.runInNewContext(stripTypeScriptTypes(handlerSource), {
    ipcMain: { handle: (_, fn) => (handler = fn) },
    dbManager: db,
    WaveEngine: { getWaveBatch: fetch },
    normalizeWaveSeed,
    selectDailyRecommendations,
    createDailyDislikePolicy,
  });
  return handler;
}
test('actual daily IPC removes rejected seed/followed artists and filters returned candidates using stored dislikes', async () => {
  let rows = JSON.parse(JSON.stringify(two)),
    args;
  const db = {
    getDislikedWaveTracks: () => rows,
    getDislikedTrackIds: () => rows.map((t) => t.id),
    getLikedTracks: () => [
      song('liked', 'Rejected Artist', 'Old favorite'),
      song('good', 'Other artist', 'Good anchor'),
    ],
    getTasteLikedTracks: () => db.getLikedTracks(),
    getWaveTasteTracks: () => [],
    getFollowedArtists: () => [{ name: 'Rejected Artist' }, { name: 'Other artist' }],
    getScrobbledTopArtists: () => [],
    getListeningHistory: () => [],
  };
  const handler = dailyHandler(db, async (...values) => {
    args = values;
    return [
      song('rejected', 'Rejected Artist', 'Third planet'),
      song('accepted', 'Other artist', 'New orbit'),
    ];
  });
  assert.deepEqual(
    Array.from(await handler(null, []), (t) => t.id),
    ['accepted'],
  );
  assert.equal(
    args[1].some((t) => t.artist.name === 'Rejected Artist'),
    false,
  );
  assert.equal(
    args[3].some((a) => a.name === 'Rejected Artist'),
    false,
  );
  assert.equal(args[5].artistFeedback['rejected artist'], -1.5);
  assert.equal(args[6], false, 'Daily feedback must not mutate the wave session');
  rows = rows.slice(0, 1);
  const afterUndo = await handler(null, []);
  assert.ok(afterUndo.some((t) => t.id === 'rejected'));
  assert.equal(args[5].artistFeedback['rejected artist'], -0.75);
});
function dailyHook(fetch) {
  const window = Object.assign(new EventTarget(), {
      localStorage: storage(),
      electronAPI: { getRecommendedTracks: fetch },
    }),
    document = new EventTarget();
  return hookRuntime(
    new URL('../src/desktop/ui/hooks/useDailyRecommendations.ts', import.meta.url),
    {
      '../../../shared/hooks/useTastePolicy': {
        readTastePolicy: () => ({ revision: 0 }),
        refreshTastePolicy: async () => ({ revision: 0 }),
      },
      '../../../shared/utils/dailyRecommendations': {
        createDailyRecommendationLoader,
        localRecommendationDay,
      },
      '../../../shared/utils/dailyDislikes': { dailyDislikeKey },
    },
    { window, document },
  );
}
test('actual daily hook clears the old artist immediately on dislike and publishes the refreshed list', async () => {
  const fresh = deferred();
  let calls = 0;
  const h = dailyHook(() => (++calls === 1 ? Promise.resolve([song('old')]) : fresh.promise));
  h.render(new Set());
  await h.flush();
  assert.equal(h.api().tracks[0].id, 'old');
  h.render(new Set(['a', 'b']));
  assert.equal(h.api().loading, true);
  assert.equal(h.api().tracks.length, 0);
  await h.flush();
  fresh.resolve([song('fresh', 'Other artist')]);
  await h.flush();
  assert.equal(h.api().tracks[0].id, 'fresh');
  assert.equal(calls, 2);
  h.unmount();
  assert.equal(h.timers(), 0);
});
test('actual daily hook ignores late pre-dislike responses and pending completion after unmount', async () => {
  const old = deferred(),
    fresh = deferred();
  let calls = 0;
  const h = dailyHook(() => (++calls === 1 ? old.promise : fresh.promise));
  h.render(new Set());
  await h.flush();
  h.render(new Set(['a', 'b']));
  await h.flush();
  fresh.resolve([song('fresh', 'Other artist')]);
  await h.flush();
  old.resolve([song('stale')]);
  await h.flush();
  assert.equal(h.api().tracks[0].id, 'fresh');
  const pending = deferred(),
    h2 = dailyHook(() => pending.promise);
  h2.render(new Set());
  await h2.flush();
  h2.unmount();
  pending.resolve([song('late')]);
  await new Promise((r) => setImmediate(r));
  assert.equal(h2.lateUpdates(), 0);
  h.unmount();
});
