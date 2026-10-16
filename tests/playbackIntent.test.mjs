import test from 'node:test';
import assert from 'node:assert/strict';
import {
  beginPlaybackIntent,
  invalidatePlaybackIntent,
} from '../src/shared/utils/playbackIntent.ts';
test('A newer queue preparation supersedes an earlier pending read', () => {
  const old = beginPlaybackIntent();
  const fresh = beginPlaybackIntent();
  assert.equal(old(), false);
  assert.equal(fresh(), true);
});
test('Playback control cancels the commit of a pending queue without preventing a later selection', () => {
  const pending = beginPlaybackIntent();
  invalidatePlaybackIntent();
  assert.equal(pending(), false);
  const later = beginPlaybackIntent();
  assert.equal(later(), true);
  assert.equal(pending(), false);
});
