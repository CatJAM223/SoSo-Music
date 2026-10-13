import test from 'node:test';
import assert from 'node:assert/strict';
import * as hints from '../src/shared/utils/youtubeAccessHint.ts';
function setup(t) {
  const values = new Map(),
    target = new EventTarget();
  target.electronAPI = {
    getYouTubeAccountStatus: async () => ({ connected: false }),
    connectYouTubeAccount: async () => ({ connected: true }),
  };
  const priorWindow = globalThis.window,
    priorStorage = globalThis.localStorage;
  globalThis.window = target;
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  t.after(() => {
    if (priorWindow === undefined) delete globalThis.window;
    else globalThis.window = priorWindow;
    if (priorStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = priorStorage;
  });
  const issues = [];
  target.addEventListener(hints.YOUTUBE_ACCESS_ISSUE_EVENT, (event) => issues.push(event.detail));
  return { values, target, issues };
}
test('Dismissing age hints persists separately from bot hints and can be undone', (t) => {
  const f = setup(t),
    age = { reason: 'age-restricted', source: 'clip', trackId: 'yt_fixture' },
    bot = { ...age, reason: 'verification-required' };
  hints.emitYouTubeAccessIssue(age);
  assert.equal(f.issues.length, 1);
  hints.setYouTubeAccessHintHidden(age.reason, true);
  hints.emitYouTubeAccessIssue(age);
  assert.equal(f.issues.length, 1);
  hints.emitYouTubeAccessIssue(bot);
  assert.equal(f.issues.length, 2);
  assert.equal(hints.isYouTubeAccessHintHidden(bot.reason), false);
  hints.setYouTubeAccessHintHidden(age.reason, false);
  hints.emitYouTubeAccessIssue(age);
  assert.equal(f.issues.length, 3);
});
test('An unsupported platform never offers desktop account settings; storage failure does not break playback', (t) => {
  const f = setup(t),
    issue = { reason: 'verification-required', source: 'track', trackId: 'yt_fixture' };
  f.target.electronAPI = {};
  hints.emitYouTubeAccessIssue(issue);
  assert.equal(f.issues.length, 0);
  globalThis.localStorage = {
    getItem() {
      throw Error('Storage unavailable');
    },
    setItem() {
      throw Error('Storage unavailable');
    },
    removeItem() {
      throw Error('Storage unavailable');
    },
  };
  assert.equal(hints.isYouTubeAccessHintHidden(issue.reason), false);
  assert.doesNotThrow(() => hints.setYouTubeAccessHintHidden(issue.reason, true));
});
test('Generic failures cannot be treated as age or bot checks; copy distinguishes clips and tracks', () => {
  assert.equal(
    hints.isYouTubeAccessIssue({ reason: 'unavailable', source: 'clip', trackId: 'yt_fixture' }),
    false,
  );
  assert.equal(hints.isYouTubeAccessIssue({ reason: 'age-restricted', source: 'clip' }), false);
  const copy = hints.youtubeAccessHintCopy({
    reason: 'age-restricted',
    source: 'clip',
    trackId: 'yt_fixture',
  });
  assert.match(copy.description, /подтверждённым возрастом/);
  assert.match(
    hints.youtubeAccessHintCopy({
      reason: 'verification-required',
      source: 'track',
      trackId: 'yt_fixture',
    }).description,
    /может помочь/,
  );
});
