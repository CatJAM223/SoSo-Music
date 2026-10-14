import test from 'node:test';
import assert from 'node:assert/strict';
import {
  startAppUpdateMonitor,
  UPDATE_POLL_MS,
} from '../src/desktop/main/services/appUpdateMonitor.ts';
function timers() {
  const tasks = new Map();
  let id = 0;
  return {
    tasks,
    schedule: (fn, ms) => {
      const token = { id: ++id, unref() {} };
      tasks.set(token, { fn, ms });
      return token;
    },
    cancel: (token) => tasks.delete(token),
    fire: async () => {
      const [token, task] = tasks.entries().next().value;
      tasks.delete(token);
      task.fn();
      await new Promise((resolve) => setImmediate(resolve));
    },
  };
}
test('Background checks find a newly published version while the app remains running', async () => {
  const clock = timers(),
    messages = [];
  let calls = 0;
  const stop = startAppUpdateMonitor(
    async () =>
      ++calls === 1
        ? { status: 'up-to-date', currentVersion: '3.0.5' }
        : { status: 'available', currentVersion: '3.0.5', latestVersion: '3.1.0' },
    (status) => messages.push(status),
    clock.schedule,
    clock.cancel,
  );
  assert.equal([...clock.tasks.values()][0].ms, 5000);
  await clock.fire();
  assert.equal(messages[0].status, 'up-to-date');
  assert.equal([...clock.tasks.values()][0].ms, UPDATE_POLL_MS);
  await clock.fire();
  assert.equal(messages[1].latestVersion, '3.1.0');
  assert.equal(clock.tasks.size, 1);
  stop();
  assert.equal(clock.tasks.size, 0);
});
test('Failed and rate-limited checks back off without publishing error popups', async () => {
  const clock = timers(),
    messages = [];
  const stop = startAppUpdateMonitor(
    async () => ({ status: 'error', currentVersion: '3.0.5', retryAfterMs: 600_000 }),
    (status) => messages.push(status),
    clock.schedule,
    clock.cancel,
  );
  await clock.fire();
  assert.equal(messages.length, 0);
  assert.ok([...clock.tasks.values()][0].ms >= 600_000);
  stop();
});
test('Disposal during an in-flight check ignores a late result and schedules no more work', async () => {
  const clock = timers(),
    messages = [];
  let finish;
  const stop = startAppUpdateMonitor(
    () => new Promise((resolve) => (finish = resolve)),
    (status) => messages.push(status),
    clock.schedule,
    clock.cancel,
  );
  await clock.fire();
  assert.equal(clock.tasks.size, 0);
  stop();
  finish({ status: 'available', currentVersion: '3.0.5', latestVersion: '3.1.0' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(messages.length, 0);
  assert.equal(clock.tasks.size, 0);
});
