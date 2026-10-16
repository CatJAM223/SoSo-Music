import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  LibraryPageController,
  libraryQueryKey,
} from '../src/shared/utils/libraryPageController.ts';
const repo = process.env.SOSO_TEST_REPO || fileURLToPath(new URL('../', import.meta.url));
const { hookRuntime } = await import(
  pathToFileURL(path.join(repo, 'tests/helpers/hookRuntime.mjs'))
);
const defer = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { resolve, promise };
};
const page = (id) => ({
  kind: 'artists',
  items: [{ id, name: id }],
  total: 1,
  offset: 0,
  nextOffset: null,
});
function fixture(read, extra = {}) {
  const h = hookRuntime(new URL('../src/shared/hooks/usePagedLibrary.ts', import.meta.url), {
    '../utils/libraryPageController': { LibraryPageController, libraryQueryKey },
  });
  h.render({ kind: 'artists', query: '', sort: 'recent', enabled: true, read, ...extra });
  return h;
}
test('real paging hook rejects old query response and publishes new query', async () => {
  const old = defer(),
    fresh = defer();
  let reads = 0;
  const read = () => (++reads === 1 ? old.promise : fresh.promise);
  const h = fixture(read);
  h.render({ kind: 'artists', query: 'new', sort: 'title', enabled: true, read });
  fresh.resolve(page('new'));
  await h.flush();
  old.resolve(page('old'));
  await h.flush();
  assert.equal(h.api().items[0].id, 'new');
  h.unmount();
});
test('real paging hook unmount removes subscription before pending result', async () => {
  const response = defer();
  const h = fixture(() => response.promise);
  h.unmount();
  response.resolve(page('late'));
  await new Promise((r) => setImmediate(r));
  assert.equal(h.lateUpdates(), 0);
});
test('real paging hook leaves inactive collections unloaded', async () => {
  let calls = 0;
  const h = fixture(
    async () => {
      calls++;
      return page('a');
    },
    { enabled: false },
  );
  await h.flush();
  assert.equal(calls, 0);
  h.unmount();
});
