import { isYouTubeItemDisabled } from '../src/shared/services/youtubeAvailability.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

function downloadHarness(results) {
  const source = readFileSync(
    new URL('../src/shared/hooks/useLibraryManager.ts', import.meta.url),
    'utf8',
  );
  const start = source.indexOf('  const cacheTrackForOffline = useCallback(');
  const end = source.indexOf('  const removeOfflineCachedTrack', start);
  const requests = [];
  const progress = [];
  const context = vm.createContext({
    isYouTubeItemDisabled,
    URL,
    console: { error() {} },
    useCallback: (fn) => fn,
    getOfflineDownloadProgress: () => null,
    setOfflineDownloadProgress: (_id, value) => progress.push(value),
    emitToast() {},
    detectTrackSource: () => 'youtube',
    refreshCachedTracks: async () => {},
    platformBridge: {
      getFullStreamUrl: async (_track, options) => {
        requests.push(options);
        return `https://rr1.googlevideo.com/videoplayback?itag=${requests.length === 1 ? 140 : 251}`;
      },
    },
    offlineCacheService: { cacheTrack: async () => results.shift() },
  });
  vm.runInContext(
    stripTypeScriptTypes(source.slice(start, end)) + '\nthis.download = cacheTrackForOffline;',
    context,
  );
  return { download: context.download, requests, progress };
}

test('Routine YouTube offline download reuses stream cache without closing playback network connections', async () => {
  const h = downloadHarness([true]);
  assert.equal(await h.download({ id: 'yt_sample', title: 'Sample' }), true);
  assert.deepEqual(h.requests, [undefined]);
  assert.equal(h.progress.at(-1), null);
});

test('A failed YouTube download still refreshes and requests an alternate format once', async () => {
  const h = downloadHarness([false, true]);
  assert.equal(await h.download({ id: 'yt_sample', title: 'Sample' }), true);
  assert.equal(h.requests.length, 2);
  assert.equal(h.requests[1].forceRefresh, true);
  assert.equal(h.requests[1].preferAlternateFormat, true);
  assert.equal(h.requests[1].excludeItag, 140);
  assert.equal(h.progress.at(-1), null);
});
