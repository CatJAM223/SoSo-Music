import { stripModuleImports } from './helpers/sourceInspection.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const tick = () => new Promise((resolve) => setImmediate(resolve));
const read = (file) =>
  stripModuleImports(readFileSync(new URL('../src/' + file, import.meta.url), 'utf8')).replace(
    /^export /gm,
    '',
  );
function bridgeHarness(native, mobile = {}) {
  const window = new EventTarget();
  window.electronAPI = native;
  const ctx = vm.createContext({ window, CustomEvent, MobileStorage: mobile });
  vm.runInContext(
    stripTypeScriptTypes(read('shared/bridge/platformBridge.ts')) +
      '\nthis.bridge = platformBridge;',
    ctx,
  );
  return { window, bridge: ctx.bridge };
}
function viewHarness(window, reader) {
  let cursor = 0,
    serial = 0,
    pending = [];
  const slots = [],
    timers = new Map();
  const depsChanged = (before, deps) =>
    !before || deps.some((value, i) => value !== before.deps[i]);
  const ctx = vm.createContext({
    window,
    console: { error() {} },
    platformBridge: { getPlaylistTracks: reader },
    detectTrackSource: (row) => row.source,
    useState(initial) {
      const i = cursor++;
      if (!slots[i]) slots[i] = { value: initial };
      return [
        slots[i].value,
        (value) => {
          slots[i].value = typeof value === 'function' ? value(slots[i].value) : value;
        },
      ];
    },
    useRef(initial) {
      const i = cursor++;
      if (!slots[i]) slots[i] = { current: initial };
      return slots[i];
    },
    useCallback(fn, deps) {
      const i = cursor++;
      if (depsChanged(slots[i], deps)) slots[i] = { deps, value: fn };
      return slots[i].value;
    },
    useEffect(fn, deps) {
      const i = cursor++,
        before = slots[i];
      if (depsChanged(before, deps))
        pending.push(() => {
          before?.cleanup?.();
          slots[i] = { deps, cleanup: fn() };
        });
    },
    setTimeout(fn) {
      const id = ++serial;
      timers.set(id, fn);
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
  });
  vm.runInContext(
    stripTypeScriptTypes(read('shared/hooks/usePlaylistTracks.ts')) +
      '\nthis.hook = usePlaylistTracks;',
    ctx,
  );
  return {
    render(id) {
      cursor = 0;
      pending = [];
      const api = ctx.hook(id);
      pending.forEach((fn) => fn());
      return api;
    },
    flush() {
      const callbacks = [...timers.values()];
      timers.clear();
      callbacks.forEach((fn) => fn());
    },
    unmount() {
      slots.forEach((slot) => slot?.cleanup?.());
    },
    pending: () => timers.size,
  };
}
const row = (id) => ({
  track_deezer_id: id,
  title: 'Song ' + id,
  artist: 'Singer',
  album: 'Release',
  duration: 180,
  source: 'youtube',
});

test('Playlist mutations notify after success with identity; failed saves never announce changes', async () => {
  const commit = deferred();
  const { bridge, window } = bridgeHarness({
    addTrackToPlaylist: () => commit.promise,
    removeTrackFromPlaylist: async () => false,
  });
  const events = [];
  window.addEventListener('soso:playlists-updated', (event) =>
    events.push(event.detail.playlistId),
  );
  const saving = bridge.addTrackToPlaylist('one', { id: 'yt_song' });
  assert.deepEqual(events, []);
  commit.resolve(true);
  assert.equal(await saving, true);
  assert.deepEqual(events, ['one']);
  assert.equal(await bridge.removeTrackFromPlaylist('one', 'yt_song'), false);
  assert.deepEqual(events, ['one']);
  const failed = bridgeHarness({
    async addTrackToPlaylist() {
      throw Error('disk full');
    },
  });
  let notifications = 0;
  failed.window.addEventListener('soso:playlists-updated', () => notifications++);
  await assert.rejects(failed.bridge.addTrackToPlaylist('one', { id: 'song' }));
  assert.equal(notifications, 0);
});

test('Open playlist refreshes after a player mutation without replacing the list with a spinner', async () => {
  let rows = [row('old')],
    reads = 0;
  const { bridge, window } = bridgeHarness({
    async addTrackToPlaylist() {
      rows = [...rows, row('new')];
      return true;
    },
  });
  const view = viewHarness(window, async () => {
    reads++;
    return rows;
  });
  view.render('one');
  await tick();
  assert.equal(view.render('one').tracks.length, 1);
  assert.equal(view.render('one').loading, false);
  await bridge.addTrackToPlaylist('other', { id: 'elsewhere' });
  assert.equal(view.pending(), 0);
  // Restore to isolate an unrelated playlist edit from the current storage stub.
  rows = [row('old')];
  await bridge.addTrackToPlaylist('one', { id: 'new' });
  assert.equal(view.render('one').tracks.length, 1);
  assert.equal(view.render('one').loading, false);
  view.flush();
  await tick();
  assert.equal(view.render('one').tracks.length, 2);
  assert.equal(reads, 2);
  view.unmount();
});
test('Pre-mutation and previous-playlist responses cannot overwrite a newer playlist', async () => {
  const window = new EventTarget();
  const reads = [];
  const view = viewHarness(window, (id) => {
    const pending = deferred();
    reads.push({ id, ...pending });
    return pending.promise;
  });
  view.render('one');
  window.dispatchEvent(
    new CustomEvent('soso:playlists-updated', { detail: { playlistId: 'one' } }),
  );
  reads[0].resolve([row('stale')]);
  await tick();
  assert.equal(view.render('one').tracks.length, 0);
  view.flush();
  view.render('two');
  assert.deepEqual(
    reads.map((item) => item.id),
    ['one', 'one', 'two'],
  );
  reads[2].resolve([row('correct')]);
  await tick();
  reads[1].resolve([row('old-playlist')]);
  await tick();
  assert.equal(view.render('two').tracks[0].id, 'correct');
  window.dispatchEvent(
    new CustomEvent('soso:playlists-updated', { detail: { playlistId: 'two' } }),
  );
  assert.equal(view.pending(), 1);
  view.unmount();
  assert.equal(view.pending(), 0);
});
