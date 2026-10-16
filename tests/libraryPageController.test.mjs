import test from 'node:test';
import assert from 'node:assert/strict';
import { LibraryPageController } from '../src/shared/utils/libraryPageController.ts';
const tick = () => new Promise((resolve) => setImmediate(resolve));
const pending = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { resolve, reject, promise };
};
const ids100 = Array.from({ length: 100 }, (_, i) => String(i));
const page = (offset, ids, total = ids.length + offset) => ({
  kind: 'artists',
  offset,
  total,
  nextOffset: offset + ids.length < total ? offset + ids.length : null,
  items: ids.map((id) => ({ id, name: id })),
});
function fixture() {
  const requests = [],
    timers = new Map();
  let serial = 0;
  const controller = new LibraryPageController(
    'artists',
    (request) => {
      const deferred = pending();
      requests.push({ request, ...deferred });
      return deferred.promise;
    },
    {
      set: (fn) => {
        const id = ++serial;
        timers.set(id, fn);
        return id;
      },
      clear: (id) => timers.delete(id),
    },
  );
  return {
    controller,
    requests,
    timers,
    fire() {
      for (const [id, fn] of [...timers]) {
        timers.delete(id);
        fn();
      }
    },
  };
}
test('page controller rejects stale query and disabled/unmounted results', async () => {
  const f = fixture();
  f.controller.configure('old', 'recent', true);
  f.controller.configure('new', 'title', true);
  f.requests[1].resolve(page(0, ['new']));
  await tick();
  f.requests[0].resolve(page(0, ['old']));
  await tick();
  assert.equal(f.controller.getSnapshot().items[0].id, 'new');
  f.controller.configure('pending', 'recent', true);
  f.controller.deactivate();
  f.requests[2].resolve(page(0, ['late']));
  await tick();
  assert.equal(f.controller.getSnapshot().items.length, 0);
  assert.equal(f.controller.getSnapshot().loading, false);
});
test('page controller invalidates immediately but coalesces mutation burst', async () => {
  const f = fixture();
  f.controller.configure('', 'recent', true);
  f.requests[0].resolve(page(0, ids100, 101));
  await tick();
  const append = f.controller.loadMore();
  for (let i = 0; i < 30; i++) f.controller.invalidate();
  assert.equal(f.timers.size, 1);
  assert.equal(f.requests.length, 2);
  f.requests[1].resolve(page(100, ['stale'], 101));
  await append;
  assert.deepEqual(
    f.controller.getSnapshot().items.map((x) => x.id),
    ids100,
  );
  f.fire();
  assert.equal(f.requests.length, 3);
  f.requests[2].resolve(page(0, ['fresh']));
  await tick();
  assert.deepEqual(
    f.controller.getSnapshot().items.map((x) => x.id),
    ['fresh'],
  );
});
test('page controller keeps previous successful prefix after failed refresh/append, serializes append', async () => {
  const f = fixture();
  f.controller.configure('', 'recent', true);
  f.requests[0].resolve(page(0, ids100, 101));
  await tick();
  const append = f.controller.loadMore();
  void f.controller.loadMore();
  assert.equal(f.requests.length, 2);
  f.requests[1].reject(Error('append failed'));
  await append;
  assert.deepEqual(
    f.controller.getSnapshot().items.map((x) => x.id),
    ids100,
  );
  assert.match(f.controller.getSnapshot().error, /append failed/);
  const refresh = f.controller.refresh();
  f.requests[2].reject(Error('refresh failed'));
  await refresh;
  assert.deepEqual(
    f.controller.getSnapshot().items.map((x) => x.id),
    ids100,
  );
  assert.match(f.controller.getSnapshot().error, /refresh failed/);
});
test('page controller reloads saved prefix for deep navigation and preserves final partial page', async () => {
  const f = fixture();
  f.controller.configure('', 'recent', true, 205);
  f.requests[0].resolve(
    page(
      0,
      Array.from({ length: 100 }, (_, i) => String(i)),
      205,
    ),
  );
  await tick();
  assert.equal(f.requests[1].request.offset, 100);
  f.requests[1].resolve(
    page(
      100,
      Array.from({ length: 100 }, (_, i) => String(i + 100)),
      205,
    ),
  );
  await tick();
  f.requests[2].resolve(page(200, ['200', '201', '202', '203', '204'], 205));
  await tick();
  assert.equal(f.controller.getSnapshot().items.length, 205);
  assert.equal(f.controller.getSnapshot().nextOffset, null);
});
test('page controller protects against nonadvancing cursors and inactive background loads', async () => {
  const f = fixture();
  f.controller.configure('', 'recent', false);
  assert.equal(f.requests.length, 0);
  f.controller.invalidate();
  assert.equal(f.timers.size, 0);
  f.controller.configure('', 'recent', true);
  f.requests[0].resolve({ ...page(0, ['a'], 2), nextOffset: 0 });
  await tick();
  assert.match(f.controller.getSnapshot().error, /cursor/);
  assert.equal(f.controller.getSnapshot().loading, false);
});

test('page controller rejects empty advancing, oversized, nonfinite and inconsistent snapshots', async () => {
  for (const value of [
    { ...page(0, [], 1), nextOffset: 1 },
    { ...page(0, ['a'], 3), nextOffset: 2 },
    { ...page(0, ['a']), total: Infinity },
    { ...page(0, ['a']), kind: 'tracks' },
    { ...page(0, ['a']), total: 0 },
    page(
      0,
      Array.from({ length: 101 }, (_, i) => String(i)),
    ),
  ]) {
    const f = fixture();
    f.controller.configure('', 'recent', true);
    f.requests[0].resolve(value);
    await tick();
    assert.match(f.controller.getSnapshot().error, /cursor/);
    assert.equal(f.requests.length, 1);
  }
});
test('page controller refreshes instead of appending across changed collection totals', async () => {
  const f = fixture();
  f.controller.configure('', 'recent', true);
  f.requests[0].resolve(page(0, ids100, 101));
  await tick();
  const append = f.controller.loadMore();
  f.requests[1].resolve(page(100, ['new', 'extra'], 102));
  await append;
  assert.equal(f.timers.size, 1);
  assert.equal(f.controller.getSnapshot().items.length, 100);
});
