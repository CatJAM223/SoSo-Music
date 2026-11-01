import test from 'node:test';
import assert from 'node:assert/strict';
import { hookRuntime } from './helpers/hookRuntime.mjs';
const url = new URL('../src/shared/hooks/useAnimationsPaused.ts', import.meta.url);
function fixture(query) {
  const document = new EventTarget();
  document.visibilityState = 'visible';
  let flag = false,
    native,
    subscriptions = 0;
  document.documentElement = {
    toggleAttribute: (key, value) => {
      flag = value;
    },
  };
  const window = {
    electronAPI: {
      onAnimationsPaused: (listener) => {
        native = listener;
        subscriptions++;
        return () => {
          native = null;
          subscriptions--;
        };
      },
      getAnimationsPaused: query,
    },
  };
  const runtime = hookRuntime(url, {}, { document, window });
  return {
    runtime,
    document,
    native: (value) => native(value),
    flag: () => flag,
    subscriptions: () => subscriptions,
  };
}
test('Another window owning focus sleeps effects until focus returns; browser visibility cannot override native sleep', () => {
  const f = fixture();
  assert.equal(f.runtime.render(), false);
  f.native(true);
  assert.equal(f.runtime.render(), true);
  assert.equal(f.flag(), true);
  f.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(f.runtime.render(), true);
  f.native(false);
  assert.equal(f.runtime.render(), false);
  f.document.visibilityState = 'hidden';
  f.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(f.runtime.render(), true);
  f.native(false);
  assert.equal(f.runtime.render(), true);
  f.document.visibilityState = 'visible';
  f.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(f.runtime.render(), false);
  f.runtime.unmount();
  assert.equal(f.subscriptions(), 0);
});
test('An effect mounted after loss of focus retrieves the existing sleep state', async () => {
  const f = fixture(async () => true);
  assert.equal(f.runtime.render(), false);
  assert.equal(await f.runtime.flush(), true);
  f.runtime.unmount();
});
test('A late initial response cannot override a newer focus event or update an unmounted effect', async () => {
  let resolve;
  const f = fixture(() => new Promise((done) => (resolve = done)));
  f.runtime.render();
  f.native(true);
  resolve(false);
  assert.equal(await f.runtime.flush(), true);
  f.runtime.unmount();
  let finish;
  const closed = fixture(() => new Promise((done) => (finish = done)));
  closed.runtime.render();
  closed.runtime.unmount();
  finish(true);
  await new Promise((done) => setImmediate(done));
  assert.equal(closed.runtime.lateUpdates(), 0);
});
