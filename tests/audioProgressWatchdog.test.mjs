import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioProgressWatchdog } from '../src/shared/utils/audioProgressWatchdog.ts';
const sample = (now, overrides = {}) => ({
  requestId: 1,
  source: 'media:one',
  position: 10,
  now,
  shouldProgress: true,
  ...overrides,
});

test('Buffered stall escalates once through nudge/reload/exhaustion, retaining its budget across source renewal', () => {
  const monitor = new AudioProgressWatchdog();
  assert.equal(monitor.observe(sample(0)), null);
  assert.equal(monitor.observe(sample(3999)), null);
  assert.equal(monitor.observe(sample(4000)), 'nudge');
  assert.equal(monitor.observe(sample(8000, { position: 10.001 })), 'reload');
  assert.equal(monitor.observe(sample(9000, { source: 'media:renewed' })), null);
  assert.equal(monitor.observe(sample(13000, { source: 'media:renewed' })), 'exhausted');
  assert.equal(monitor.observe(sample(100000, { source: 'media:renewed' })), null);
  assert.equal(monitor.observe(sample(100000, { requestId: 2 })), null);
  assert.equal(monitor.observe(sample(104000, { requestId: 2 })), 'nudge');
});

test('Actual progress, pause/buffering/seek suspension and backwards clock prevent false recovery', () => {
  const monitor = new AudioProgressWatchdog();
  for (let now = 0; now < 20000; now += 1000)
    assert.equal(monitor.observe(sample(now, { position: 10 + now / 1000 })), null);
  assert.equal(monitor.observe(sample(60000, { shouldProgress: false })), null);
  assert.equal(monitor.observe(sample(60001)), null);
  monitor.suspend();
  assert.equal(monitor.observe(sample(90000)), null);
  assert.equal(monitor.observe(sample(89000)), null);
  assert.equal(monitor.observe(sample(92999)), null);
  assert.equal(monitor.observe(sample(93000)), 'nudge');
});
