import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createWaveRefreshPolicy,
  WAVE_REFRESH_COOLDOWN_MS,
} from '../src/shared/services/waveRefreshPolicy.ts';
import { createWaveSessionState } from '../src/shared/services/waveSession.ts';

test('Refresh requires three distinct early manual skips and never double-counts a transition', () => {
  const policy = createWaveRefreshPolicy(() => 100000);
  assert.equal(policy.observe('a', 0, 200, 'skip'), false);
  assert.equal(policy.observe('a', 5, 200, 'skip'), false);
  assert.equal(policy.observe('b', 5, 200, 'skip'), false);
  assert.equal(policy.observe('a', 5, 200, 'skip'), false);
  assert.equal(policy.observe('c', 5, 200, 'skip'), true);
  assert.equal(policy.observe('c', 5, 200, 'skip'), false);
});

test('Normal completion, late skips and accepted discoveries break the early-skip streak', () => {
  for (const end of ['ended', 'late', 'like']) {
    const policy = createWaveRefreshPolicy();
    policy.observe('a', 5, 200, 'skip');
    policy.observe('b', 5, 200, 'skip');
    if (end === 'like') policy.accept();
    else
      policy.observe('success', end === 'late' ? 80 : 195, 200, end === 'late' ? 'skip' : 'ended');
    assert.equal(policy.observe('c', 5, 200, 'skip'), false);
  }
});

test('Playback failures and invalid samples cannot create refresh requests', () => {
  const policy = createWaveRefreshPolicy();
  for (const reason of ['error', 'interrupted'])
    for (let i = 0; i < 10; i++) assert.equal(policy.observe(reason + i, 5, 200, reason), false);
  for (const seconds of [NaN, Infinity, -1])
    assert.equal(policy.observe(String(seconds), seconds, 200, 'skip'), false);
  assert.equal(policy.observe('a', 5, 200, 'skip'), false);
  assert.equal(policy.observe('b', 5, 200, 'skip'), false);
});

test('Cooldown bounds requests during a skip storm and a new session clears it', () => {
  let stamp = 100000;
  const policy = createWaveRefreshPolicy(() => stamp);
  let refreshes = 0;
  for (let i = 0; i < 1000; i++) refreshes += Number(policy.observe(i, 5, 200, 'skip'));
  assert.equal(refreshes, 1);
  stamp += WAVE_REFRESH_COOLDOWN_MS;
  assert.equal(policy.observe('after-cooldown', 5, 200, 'skip'), true);
  policy.reset();
  assert.equal(policy.observe('new-a', 5, 200, 'skip'), false);
  assert.equal(policy.observe('new-b', 5, 200, 'skip'), false);
  assert.equal(policy.observe('new-c', 5, 200, 'skip'), true);
});

test('Mode sessions restore their own reactions and idle reset releases them all', () => {
  const state = createWaveSessionState();
  const ordinary = state.forMode('default');
  ordinary.artistFeedback.set('artist', -0.6);
  ordinary.skippedTracks.push({ id: 'skipped' });
  const discovery = state.forMode('discover');
  assert.equal(discovery.artistFeedback.size, 0);
  assert.equal(discovery.skippedTracks.length, 0);
  assert.equal(state.forMode('default'), ordinary);
  state.clear();
  assert.equal(state.forMode('default').artistFeedback.size, 0);
  assert.equal(state.forMode('discover').skippedTracks.length, 0);
});
