import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import {
  createDailyRecommendationLoader,
  DAILY_HISTORY_LIMIT,
  orderDailyRepeats,
  DAILY_RECOMMENDATIONS_KEY,
  localRecommendationDay,
  readDailyRecommendations,
  selectDailyRecommendations,
} from '../src/shared/utils/dailyRecommendations.ts';
import { normalizeWaveSeed } from '../src/shared/utils/waveRecommendations.ts';
import { createDailyDislikePolicy } from '../src/shared/utils/dailyDislikes.ts';
import { validateWaveContext } from '../src/desktop/main/ipc/waveInput.ts';
import { readWaveMethodScores, readWaveNovelty } from '../src/shared/types/wavePolicy.ts';
import { attributeWaveBatch, readWaveRecommendation } from '../src/shared/services/waveQuality.ts';
import { waveMemoryTrack } from '../src/shared/services/waveMemory.ts';
const track = (id, artist = 'Singer ' + id, title = 'Melody ' + id) => ({
  id,
  title,
  artist: { name: artist },
  album: { title: '' },
  duration: 180,
  source: 'youtube',
  preview: '',
});

test('Daily five excludes IDs and song families past the Rust packet limit and yields during selection', async () => {
  const known = Array.from({ length: 4097 }, (_, index) =>
    track('old-' + index, 'Library artist', 'Original title ' + index),
  );
  known.push(track('last', 'Night Signal', 'Clouds Over the Station'));
  const exact = track('last', 'Different credits', 'Renamed upload');
  const family = track('alias', 'Night Signal', 'Clouds Over the Station (sped up)');
  const picks = Array.from({ length: 5 }, (_, index) =>
    track('new-' + index, 'Singer ' + index, 'Fresh tune ' + index),
  );
  assert.deepEqual(selectDailyRecommendations([exact, family, ...picks], known, [], 3), picks);
  assert.deepEqual(selectDailyRecommendations([family], known), []);
  let turns = 0;
  const result = await createDailyDislikePolicy([]).selectAsync(
    [exact, family, ...picks],
    known,
    3,
    async () => {
      turns++;
    },
  );
  assert.deepEqual(result, picks);
  assert.ok(turns > 1);
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
    DAILY_HISTORY_LIMIT,
    orderDailyRepeats,
    waveMemoryTrack,
    identifyCatalogTracks: (tracks) => tracks,
    createDailyDislikePolicy,
    validateWaveContext,
    readWaveMethodScores,
    readWaveNovelty,
    attributeWaveBatch,
    readWaveRecommendation,
    PlaybackLogger: { info() {} },
    dbManager: {
      getDislikedTrackIds: () => ['yt_blocked'],
      getTastePolicy: () => ({ revision: 2 }),
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
        return [{ ...track('fresh'), waveProvenance: [{ method: 'similar' }] }];
      },
    },
  };
  vm.runInNewContext(stripTypeScriptTypes(handlerSource), ctx);
  assert.equal((await handler(null, ['yesterday'])).length, 1);
  assert.equal(args[6], false);
  assert.ok(args[1].some((t) => t.id === 'yt_liked'));
  for (const id of ['yt_liked', 'yt_recent', 'yt_blocked', 'yesterday'])
    assert.ok(args[2].includes(id));
  const [daily] = await handler(null, ['yesterday'], [], {
    novelty: 'fresh',
    tasteRevision: 2,
    methodScores: { similar: 0.5 },
  });
  assert.equal(args[5].novelty, 'fresh');
  assert.equal(args[5].methodScores.similar, 0.5);
  assert.equal(daily.waveRecommendation.surface, 'daily');
  assert.equal(daily.waveRecommendation.provenance[0].method, 'similar');
  await handler(null, [], [], {
    novelty: 'fresh',
    tasteRevision: 1,
    methodScores: { similar: 0.5 },
  });
  assert.equal(args[5].methodScores, undefined);
  const history = Array.from({ length: 10 }, (_, i) => track('prior-' + i));
  const latest = [...history].reverse();
  ctx.WaveEngine.getWaveBatch = async (...values) => {
    const excluded = new Set(values[2]);
    return latest.filter(({ id }) => !excluded.has(id));
  };
  const repeats = await handler(
    null,
    history.map(({ id }) => id),
    history,
  );
  assert.deepEqual(
    Array.from(repeats, ({ id }) => id),
    history.slice(0, 5).map(({ id }) => id),
  );
  ctx.dbManager.getLikedTracks = () => [];
  ctx.dbManager.getTasteLikedTracks = () => [];
  ctx.dbManager.getWaveTasteTracks = () => [];
  args = null;
  assert.equal((await handler(null, [])).length, 0);
  assert.equal(args, null);
});

test('Daily shows survive restart and exclude the first day on the third day across providers', async () => {
  const saved = storage();
  let date = new Date(2026, 10, 10, 12);
  const catalog = Array.from({ length: 15 }, (_, i) => track('yt_' + i));
  const fetch = async (_, previous) => selectDailyRecommendations(catalog, previous);
  const first = await createDailyRecommendationLoader(saved, fetch, () => date)();
  date.setDate(11);
  const second = await createDailyRecommendationLoader(saved, fetch, () => date)();
  date.setDate(12);
  catalog.splice(
    0,
    5,
    ...first.tracks.map((old, i) => ({
      ...old,
      id: 'sc_' + i,
      source: 'soundcloud',
      title: old.title + ' (Official Audio)',
    })),
  );
  const third = await createDailyRecommendationLoader(saved, fetch, () => date)();
  assert.equal(
    new Set([...first.tracks, ...second.tracks, ...third.tracks].map(({ artist }) => artist.name))
      .size,
    15,
  );
});

test('Daily update accepts a validated replacement or empty response and falls back on error', async () => {
  const saved = storage();
  let date = new Date(2026, 10, 10, 12);
  const old = track('old');
  const fresh = track('new');
  let next = [old];
  const load = createDailyRecommendationLoader(
    saved,
    async () => {
      if (!next) throw new Error('Unavailable');
      return next;
    },
    () => date,
  );
  assert.deepEqual(
    (await load()).tracks.map(({ id }) => id),
    ['old'],
  );
  date = new Date(+date + 301_000);
  next = null;
  assert.deepEqual(
    (await load()).tracks.map(({ id }) => id),
    ['old'],
  );
  date = new Date(+date + 301_000);
  next = [fresh];
  assert.deepEqual(
    (await load()).tracks.map(({ id }) => id),
    ['new'],
  );
  date = new Date(+date + 301_000);
  next = [];
  assert.deepEqual((await load()).tracks, []);
  next = null;
  await assert.rejects(
    createDailyRecommendationLoader(
      saved,
      async () => {
        throw new Error('Unavailable');
      },
      () => date,
    )(),
  );
});

test('Daily retains each source snapshot and carries all shown songs to the next day', async () => {
  const saved = storage();
  const date = new Date(2026, 10, 10, 12);
  const requests = [];
  const fetch = async (_, previous, { source }) => {
    requests.push(previous);
    const provider = source === 'all' ? 'youtube' : source;
    return Array.from({ length: 5 }, (_, i) => ({ ...track(provider + i), source: provider }));
  };
  const load = createDailyRecommendationLoader(saved, fetch, () => date);
  const mixed = await load();
  await load('', 'soundcloud');
  const restarted = createDailyRecommendationLoader(saved, fetch, () => date);
  assert.deepEqual(await restarted(), mixed);
  assert.equal(requests.length, 2);
  date.setDate(11);
  await restarted();
  assert.equal(requests[2].length, 10);
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

test('A completed daily selection stays cached until the next day and forwards the latest Wave policy then', async () => {
  const saved = storage();
  let now = new Date(2026, 10, 14, 15);
  const requests = [];
  const fetch = async (previous, _, options) => {
    requests.push({ previous, options });
    return Array.from({ length: 5 }, (_, i) => track(requests.length + '-' + i));
  };
  const load = createDailyRecommendationLoader(
    saved,
    fetch,
    () => now,
    () => 3,
  );
  const first = await load('', 'all', { tasteRevision: 3, novelty: 'balanced' });
  const second = await load('', 'all', { tasteRevision: 3, novelty: 'fresh' });
  assert.deepEqual(first, second);
  assert.equal(requests.length, 1);
  now = new Date(2026, 10, 15, 0);
  await load('', 'all', { tasteRevision: 3, novelty: 'fresh', methodScores: { similar: 0.5 } });
  assert.equal(requests[1].options.novelty, 'fresh');
  assert.equal(requests[1].options.methodScores.similar, 0.5);
  assert.deepEqual(
    requests[1].previous,
    first.tracks.map((item) => item.id),
  );
});
