import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { isCurrentPlaybackRequest } from '../src/shared/utils/playbackRecovery.ts';
const source = readFileSync(
  new URL('../src/shared/hooks/useAudioPlayerCore.ts', import.meta.url),
  'utf8',
);
function stalledFixture(readyState = 2) {
  const begin = source.indexOf('    const scheduleStalledRecovery =');
  const end = source.indexOf('\n    const handleStalled =', begin);
  assert.ok(begin >= 0 && end > begin);
  let timer,
    recoveries = 0;
  const audio = {
    paused: false,
    src: 'https://audio.test/track',
    currentSrc: 'https://audio.test/track',
    currentTime: 0,
    readyState,
  };
  const context = {
    NativeAudioElement: class {},
    false: false,
    audio,
    currentTrackRef: { current: { id: 'track' } },
    streamRequestIdRef: { current: 1 },
    stalledRecoveryTimerRef: { current: null },
    isCurrentPlaybackRequest,
    setTimeout(fn) {
      timer = fn;
      return 1;
    },
    PlaybackLogger: { warn() {} },
    handleErrorRef: { current: () => recoveries++ },
  };
  vm.runInNewContext(
    stripTypeScriptTypes(source.slice(begin, end)) + '\nthis.schedule=scheduleStalledRecovery;',
    context,
  );
  return {
    audio,
    context,
    fire() {
      context.schedule();
      timer?.();
    },
    recoveries: () => recoveries,
  };
}
test('Audio watchdog retries a stalled source with only the current frame buffered', () => {
  const h = stalledFixture();
  h.fire();
  assert.equal(h.recoveries(), 1);
});
test('Audio watchdog leaves future buffered data and actual playback progress alone', () => {
  const buffered = stalledFixture(3);
  buffered.fire();
  assert.equal(buffered.recoveries(), 0);
  const progressed = stalledFixture();
  progressed.context.schedule();
  progressed.audio.currentTime = 1;
  progressed.fire();
  assert.equal(progressed.recoveries(), 0);
});
import { HlsRecoveryBudget } from '../src/shared/utils/hlsRecovery.ts';
function hlsFixture({
  snippet = false,
  stale = false,
  throws = false,
  destroyThrows = false,
} = {}) {
  const begin = source.indexOf('        const recoveryBudget = new HlsRecoveryBudget();');
  const end = source.indexOf('\n      } else {', begin);
  assert.ok(begin >= 0 && end > begin);
  let callback;
  const calls = [],
    positions = [];
  const hls = {
    on(_event, fn) {
      callback = fn;
    },
    startLoad() {
      calls.push('reload');
      if (throws) throw new Error('network');
    },
    recoverMediaError() {
      calls.push('recover');
    },
    destroy() {
      calls.push('destroy');
      context.audio.currentTime = 0;
      if (destroyThrows) throw new Error('detach');
    },
  };
  const context = {
    HlsRecoveryBudget,
    hls,
    hlsRef: { current: hls },
    Hls: {
      Events: { ERROR: 'error' },
      ErrorTypes: { NETWORK_ERROR: 'network', MEDIA_ERROR: 'media' },
    },
    isStaleLoad: () => stale,
    isSnippet: snippet,
    audio: {
      currentTime: 42,
      pause() {
        calls.push('pause');
      },
    },
    handleErrorRef: {
      current: (forced, position) => {
        positions.push(position);
        calls.push(forced ? 'refresh' : 'wrong-refresh');
      },
    },
    PlaybackLogger: { warn() {} },
  };
  vm.runInNewContext(stripTypeScriptTypes(source.slice(begin, end)), context);
  return {
    context,
    calls,
    positions,
    emit(type = 'network', fatal = true) {
      callback('error', { type, fatal });
    },
  };
}
test('HLS failure retries once and then releases the worker before forcing URL recovery', () => {
  const h = hlsFixture();
  h.emit();
  h.emit();
  h.emit();
  assert.deepEqual(h.calls, ['reload', 'destroy', 'refresh']);
  assert.equal(h.context.hlsRef.current, null);
});
test('HLS decoder failure has a bounded recovery and nonfatal errors do not use the budget', () => {
  const h = hlsFixture();
  h.emit('network', false);
  h.emit('media');
  h.emit('media');
  assert.deepEqual(h.calls, ['recover', 'destroy', 'refresh']);
});
test('An HLS recovery exception cannot leave playback pending forever', () => {
  const h = hlsFixture({ throws: true });
  h.emit();
  assert.deepEqual(h.calls, ['reload', 'destroy', 'refresh']);
});
test('Failed snippets and stale HLS sources cannot refresh or skip the main track', () => {
  const snippet = hlsFixture({ snippet: true });
  snippet.emit('other');
  assert.deepEqual(snippet.calls, ['destroy', 'pause']);
  const stale = hlsFixture({ stale: true });
  stale.emit();
  assert.deepEqual(stale.calls, []);
});
test('A later source change or pause cancels a scheduled stall recovery', () => {
  for (const change of ['source', 'request', 'pause']) {
    const h = stalledFixture();
    h.context.schedule();
    if (change === 'source') h.audio.currentSrc = 'another';
    if (change === 'request') h.context.streamRequestIdRef.current = 2;
    if (change === 'pause') h.audio.paused = true;
    h.fire();
    assert.equal(h.recoveries(), 0);
  }
});
test('HLS detach preserves resume position and cleanup failures still reach URL recovery', () => {
  for (const destroyThrows of [false, true]) {
    const h = hlsFixture({ destroyThrows });
    h.emit('other');
    assert.deepEqual(h.calls, ['destroy', 'refresh']);
    assert.deepEqual(h.positions, [42]);
    assert.equal(h.context.hlsRef.current, null);
  }
});
