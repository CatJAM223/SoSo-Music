import { stripModuleImports } from './helpers/sourceInspection.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { DatabaseManager } from '../src/desktop/main/db/index.ts';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const tick = () => new Promise((resolve) => setImmediate(resolve));
function libraryHarness(reader) {
  const source = stripModuleImports(
    readFileSync(new URL('../src/shared/hooks/useLibraryCaches.ts', import.meta.url), 'utf8'),
  ).replace(/^export /gm, '');
  const context = vm.createContext({
    console: { error() {} },
    useState: (state) => [state, () => {}],
    useEffect() {},
    useCallback: (callback) => callback,
    platformBridge: {
      getLikedTrackIds: reader,
      getLikedTracks: () => {
        throw new Error('Full records must not be fetched for hearts');
      },
    },
  });
  vm.runInContext(stripTypeScriptTypes(source) + '\nthis.hook = useLibraryCaches;', context);
  return { api: context.hook(), ids: () => [...context.hook().likedTrackIds].sort() };
}
function bridgeHarness(native, mobile) {
  const source = stripModuleImports(
    readFileSync(new URL('../src/shared/bridge/platformBridge.ts', import.meta.url), 'utf8'),
  ).replace(/^export /gm, '');
  const context = vm.createContext({ window: { electronAPI: native }, MobileStorage: mobile });
  vm.runInContext(stripTypeScriptTypes(source) + '\nthis.bridge = platformBridge;', context);
  return context.bridge;
}

test('Liked IDs use the small native read and preserve older desktop preload fallback', async () => {
  let fullReads = 0,
    mobileReads = 0;
  const mobile = {
    async getLikedTracks() {
      mobileReads++;
      return [{ deezer_id: 'yt_mobile' }];
    },
  };
  const native = {
    async getLikedTrackIds() {
      return ['sc_10'];
    },
    async getLikedTracks() {
      fullReads++;
      return [{ deezer_id: 'dz_20' }];
    },
  };
  assert.deepEqual(Array.from(await bridgeHarness(native, mobile).getLikedTrackIds()), ['sc_10']);
  assert.equal(fullReads, 0);
  assert.equal(mobileReads, 0);
  assert.deepEqual(
    Array.from(
      await bridgeHarness({ getLikedTracks: native.getLikedTracks }, mobile).getLikedTrackIds(),
    ),
    ['dz_20'],
  );
  assert.equal(fullReads, 1);
  assert.equal(mobileReads, 0);
});

test('Liked membership retains existing provider ID aliases', async () => {
  const h = libraryHarness(async () => ['123', 'dz_123', 'sc_77', 'yt_video']);
  await h.api.refreshLikedTracks();
  assert.deepEqual(
    h.ids(),
    ['123', 'dz_123', 'dz_sc_77', 'dz_yt_video', 'sc_77', 'yt_video'].sort(),
  );
});

test('An old refresh cannot undo a like; initial loading still recovers other favorites', async () => {
  const old = deferred(),
    fresh = deferred();
  let reads = 0;
  const h = libraryHarness(() => (++reads === 1 ? old : fresh).promise);
  const initial = h.api.refreshLikedTracks();
  h.api.setLikedTrackIds((prev) => new Set([...prev, 'yt_new']));
  assert.equal(
    reads,
    2,
    'A mutation during initial loading must request a fresh complete snapshot',
  );
  old.resolve([]);
  await initial;
  assert.deepEqual(h.ids(), ['yt_new']);
  fresh.resolve(['sc_existing', 'yt_new']);
  await tick();
  assert.ok(h.ids().includes('sc_existing'));
  assert.ok(h.ids().includes('yt_new'));
});

test('A stale response cannot restore a removed/disliked favorite', async () => {
  const old = deferred(),
    fresh = deferred();
  let reads = 0;
  const h = libraryHarness(() => (++reads === 1 ? old : fresh).promise);
  h.api.setLikedTrackIds(new Set(['sc_removed', 'yt_other']));
  const pending = h.api.refreshLikedTracks();
  h.api.setLikedTrackIds((prev) => {
    const next = new Set(prev);
    next.delete('sc_removed');
    return next;
  });
  old.resolve(['sc_removed', 'yt_other']);
  await pending;
  assert.equal(h.ids().includes('sc_removed'), false);
  fresh.resolve(['yt_other']);
  await tick();
  assert.equal(h.ids().includes('sc_removed'), false);
});

test('Refresh after import wins even when the previous request finishes last; read errors keep state', async () => {
  const beforeImport = deferred(),
    afterImport = deferred();
  let reads = 0;
  const h = libraryHarness(() => (++reads === 1 ? beforeImport : afterImport).promise);
  const old = h.api.refreshLikedTracks(),
    imported = h.api.refreshLikedTracks();
  afterImport.resolve(['yt_imported']);
  await imported;
  beforeImport.resolve(['sc_old']);
  await old;
  assert.ok(h.ids().includes('yt_imported'));
  assert.equal(h.ids().includes('sc_old'), false);
  const failure = libraryHarness(async () => {
    throw new Error('Read failed');
  });
  failure.api.setLikedTrackIds(new Set(['sc_keep']));
  await failure.api.refreshLikedTracks();
  assert.deepEqual(failure.ids(), ['sc_keep']);
});

test('Database ID read preserves favorite records for the wave and reflects additions/removals', async (t) => {
  const db = new DatabaseManager(':memory:');
  db.save = () => {};
  await db.init();
  t.after(() => db.db.close());
  for (const id of ['123', 'dz_456', 'sc_77', 'yt_video'])
    db.toggleLikeTrack({
      deezer_id: id,
      title: 'Full title',
      artist: 'Taste artist',
      duration: 120,
    });
  assert.deepEqual(
    db.getLikedTrackIds().sort(),
    db
      .getLikedTracks()
      .map((track) => String(track.deezer_id))
      .sort(),
  );
  assert.equal(db.getLikedTracks()[0].artist, 'Taste artist');
  db.toggleLikeTrack({ deezer_id: 'sc_77', title: '', artist: '' });
  assert.equal(db.getLikedTrackIds().includes('sc_77'), false);
});

// Settings lifecycle is verified with actual React/Chromium in
// scripts/testing/testSettingsLifecycle.mjs (rerenders, tabs, StrictMode, cleanup).
