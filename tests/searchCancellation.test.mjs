import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { runProgressiveSearch } from '../src/shared/utils/progressiveSearch.ts';
import { registerSearchHandlers } from '../src/desktop/main/ipc/searchHandlers.ts';
import { currentStreamResolveSignal } from '../src/desktop/main/services/streamResolveContext.ts';

test('Progressive search distinguishes a provider failure from an empty catalog and keeps healthy results', async () => {
  const updates = [];
  await runProgressiveSearch(
    'Song',
    'all',
    {
      search: async (_q, _n, source) => {
        if (source === 'soundcloud') throw Error('STREAM_NETWORK_UNAVAILABLE');
        return {
          data: [
            {
              id: 'yt_fixture',
              title: 'Song',
              artist: { name: 'Singer' },
              duration: 180,
              source: 'youtube',
            },
          ],
        };
      },
    },
    (snapshot) => updates.push(snapshot),
  );
  assert.deepEqual(updates.at(-1).failedSources, ['soundcloud']);
  assert.equal(updates.at(-1).tracks[0].id, 'yt_fixture');
  assert.equal(updates.at(-1).pending, false);
});

test('Search timeout cancels the actual IPC request and does not publish its late response', async () => {
  let complete;
  const cancelled = [],
    updates = [];
  await runProgressiveSearch(
    'Song',
    'soundcloud',
    {
      search: () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
      cancelSearch: async (id) => {
        cancelled.push(id);
      },
    },
    (snapshot) => updates.push(snapshot),
    5,
  );
  assert.equal(cancelled.length, 1);
  assert.deepEqual(updates.at(-1).failedSources, ['soundcloud']);
  const count = updates.length;
  complete({ data: [{ id: 1 }] });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(updates.length, count);
});

test('Retry calls only the failed part and keeps every successful result visible', async () => {
  const queries = [];
  const song = { id: 'yt_song', title: 'Song', artist: { name: 'Singer' }, source: 'youtube' };
  let shouldFail = true;
  const updates = [];
  const api = {
    search: async (_q, _n, source) => {
      queries.push([source, 'tracks']);
      return { data: source === 'youtube' ? [song] : [] };
    },
    searchArtists: async (_q, _n, source) => {
      queries.push([source, 'artists']);
      if (source === 'soundcloud' && shouldFail) throw Error('offline');
      return { data: [] };
    },
  };
  await runProgressiveSearch('Song', 'all', api, (value) => updates.push(value));
  const previous = updates.at(-1);
  assert.deepEqual(previous.failures, [{ source: 'soundcloud', part: 'artists' }]);
  shouldFail = false;
  queries.length = 0;
  updates.length = 0;
  await runProgressiveSearch(
    'Song',
    'all',
    api,
    (value) => updates.push(value),
    15000,
    undefined,
    previous,
  );
  assert.deepEqual(queries, [['soundcloud', 'artists']]);
  assert.ok(updates.every((value) => value.tracks[0] === song));
  assert.deepEqual(updates.at(-1).failures, []);
  assert.deepEqual(previous.failures, [{ source: 'soundcloud', part: 'artists' }]);
});

test('Layout recovery only runs on a weak search and publishes the recovered track', async () => {
  const queries = [];
  const hit = { id: 'yt_hit', title: 'Группа крови', artist: { name: 'Кино' }, source: 'youtube' };
  const updates = [];
  await runProgressiveSearch(
    'rbyj',
    'youtube',
    {
      search: async (query) => {
        queries.push(query);
        return { data: query === 'кино' ? [hit] : [] };
      },
    },
    (value) => updates.push(value),
  );
  assert.deepEqual(queries, ['rbyj', 'кино']);
  assert.equal(updates.at(-1).tracks[0], hit);
});

test('A hanging provider cannot block another provider from correcting a query', async () => {
  const hit = { id: 'yt_hit', title: 'Группа крови', artist: { name: 'Кино' }, source: 'youtube' };
  const updates = [];
  await runProgressiveSearch(
    'rbyj',
    'all',
    {
      search: async (query, _limit, source) => {
        if (source === 'soundcloud') return new Promise(() => {});
        return { data: query === 'кино' ? [hit] : [] };
      },
    },
    (value) => updates.push(value),
    35,
  );
  assert.ok(updates.some((value) => value.pending && value.tracks[0] === hit));
  assert.equal(updates.at(-1).tracks[0], hit);
});

test('Replacing a search aborts its renderer leases and suppresses later snapshots', async () => {
  const controller = new AbortController(),
    cancelled = [],
    updates = [];
  const task = runProgressiveSearch(
    'Song',
    'all',
    {
      search: () => new Promise(() => {}),
      searchArtists: () => new Promise(() => {}),
      cancelSearch: async (id) => {
        cancelled.push(id);
      },
    },
    (snapshot) => updates.push(snapshot),
    15000,
    controller.signal,
  );
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort();
  await task;
  assert.equal(cancelled.length, 4);
  assert.equal(new Set(cancelled).size, 4);
  assert.equal(updates.length, 0);
});

test('Real search handlers carry cancellation to the provider and isolate owners with identical IDs', async () => {
  const handlers = new Map(),
    signals = [];
  registerSearchHandlers(
    { handle: (channel, handler) => handlers.set(channel, handler) },
    {
      search: () => {
        const signal = currentStreamResolveSignal();
        signals.push(signal);
        return new Promise((resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
      },
      searchArtists: async () => ({ data: [] }),
    },
  );
  const a = { sender: new EventEmitter() },
    b = { sender: new EventEmitter() };
  const first = handlers.get('music:search')(a, 'Song', 20, 'soundcloud', 'same-id');
  const second = handlers.get('music:search')(b, 'Song', 20, 'soundcloud', 'same-id');
  const firstRejected = assert.rejects(first, { name: 'AbortError' });
  const secondRejected = assert.rejects(second, { name: 'AbortError' });
  handlers.get('music:cancelSearch')(a, 'same-id');
  await firstRejected;
  assert.equal(signals[0].aborted, true);
  assert.equal(signals[1].aborted, false);
  b.sender.emit('destroyed');
  await secondRejected;
  assert.equal(a.sender.listenerCount('destroyed'), 0);
  assert.equal(b.sender.listenerCount('destroyed'), 0);
});
