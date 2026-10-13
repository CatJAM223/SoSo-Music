import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getOfflineDownloadProgress,
  setOfflineDownloadProgress,
  subscribeOfflineDownloadProgress,
} from '../src/shared/services/offlineDownloadProgress.ts';

test('Offline progress follows one track and clears after completion', () => {
  let notifications = 0;
  const unsubscribe = subscribeOfflineDownloadProgress(() => {
    notifications++;
  });
  setOfflineDownloadProgress('yt_example', 0.25);
  assert.equal(getOfflineDownloadProgress('yt_example'), 0.25);
  assert.equal(getOfflineDownloadProgress('yt_other'), null);
  setOfflineDownloadProgress('yt_example', 1);
  setOfflineDownloadProgress('yt_example', null);
  unsubscribe();
  assert.equal(getOfflineDownloadProgress('yt_example'), null);
  assert.equal(notifications, 3);
});

test('Progress wakes only subscribers of the downloading track and coalesces sub-percent updates', () => {
  let active = 0,
    unrelated = 0;
  const stopActive = subscribeOfflineDownloadProgress(() => active++, 'yt_active');
  const others = Array.from({ length: 1000 }, (_, i) =>
    subscribeOfflineDownloadProgress(() => unrelated++, `yt_idle_${i}`),
  );
  for (let i = 0; i < 10000; i++) setOfflineDownloadProgress('yt_active', i / 10000);
  assert.equal(active, 101);
  assert.equal(unrelated, 0);
  setOfflineDownloadProgress('yt_active', NaN);
  assert.equal(getOfflineDownloadProgress('yt_active'), 1);
  stopActive();
  others.forEach((stop) => stop());
  setOfflineDownloadProgress('yt_active', null);
});
