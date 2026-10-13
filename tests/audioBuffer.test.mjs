import { extractStatementsBetween, extractStatement } from './helpers/sourceInspection.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import {
  hasAudioBufferHeadroom,
  readAudioBufferedRanges,
  sameBufferedRanges,
  bufferedPercentRanges,
} from '../src/shared/utils/audioBuffer.ts';

const makeAudio = (ranges = [[0, 12]], duration = 60, url = 'https://media.test/song.mp3') => {
  const audio = new EventTarget();
  Object.assign(audio, { duration, currentSrc: url, src: url });
  audio.setRanges = (values) => {
    audio.buffered = {
      length: values.length,
      start: (i) => values[i][0],
      end: (i) => values[i][1],
    };
  };
  audio.setRanges(ranges);
  return audio;
};
const sourceFor = (audio) => ({ audio, url: audio.src });

test('Buffered audio reads real partial ranges and preserves gaps after seeking', () => {
  const audio = makeAudio([
    [0, 12],
    [40, 48],
  ]);
  const ranges = readAudioBufferedRanges(audio, sourceFor(audio));
  assert.deepEqual(ranges, [
    { start: 0, end: 12 },
    { start: 40, end: 48 },
  ]);
  assert.deepEqual(bufferedPercentRanges(ranges, 60), [
    { start: 0, end: 20 },
    { start: (40 / 60) * 100, end: 80 },
  ]);
});

test('Unknown duration, empty media and failed TimeRanges reads produce no buffer', () => {
  for (const duration of [0, -1, NaN, Infinity]) {
    const audio = makeAudio([[0, 12]], duration);
    assert.deepEqual(readAudioBufferedRanges(audio, sourceFor(audio)), []);
    assert.deepEqual(bufferedPercentRanges([{ start: 0, end: 12 }], duration), []);
  }
  const audio = makeAudio([]);
  assert.deepEqual(readAudioBufferedRanges(audio, sourceFor(audio)), []);
  audio.buffered = {
    length: 1,
    start() {
      throw new Error('Source emptied');
    },
  };
  assert.deepEqual(readAudioBufferedRanges(audio, sourceFor(audio)), []);
});

test('Out-of-duration and invalid ranges are clipped or omitted', () => {
  const audio = makeAudio([
    [-5, 8],
    [55, 90],
    [30, 30],
    [20, 10],
    [NaN, 25],
    [25, NaN],
    [61, 70],
  ]);
  assert.deepEqual(readAudioBufferedRanges(audio, sourceFor(audio)), [
    { start: 0, end: 8 },
    { start: 55, end: 60 },
  ]);
  assert.deepEqual(
    bufferedPercentRanges(
      [
        { start: -5, end: 8 },
        { start: 55, end: 90 },
        { start: NaN, end: 5 },
      ],
      60,
    ),
    [
      { start: 0, end: (8 / 60) * 100 },
      { start: (55 / 60) * 100, end: 100 },
    ],
  );
});

test('Queued events from a previous source or crossfade element cannot reuse its buffer', () => {
  const audio = makeAudio(),
    other = makeAudio();
  assert.deepEqual(readAudioBufferedRanges(audio, null), []);
  assert.deepEqual(readAudioBufferedRanges(audio, sourceFor(other)), []);
  assert.deepEqual(readAudioBufferedRanges(audio, { audio, url: '' }), []);
  const oldSource = sourceFor(audio);
  audio.src = 'https://media.test/next.mp3';
  assert.deepEqual(readAudioBufferedRanges(audio, sourceFor(audio)), []);
  audio.currentSrc = audio.src;
  assert.deepEqual(readAudioBufferedRanges(audio, oldSource), []);
});

test('Unchanged snapshots bail out; eviction or partial replacement updates the buffer', () => {
  assert.equal(sameBufferedRanges([{ start: 0, end: 12 }], [{ start: 0, end: 12 }]), true);
  assert.equal(sameBufferedRanges([{ start: 0, end: 12 }], [{ start: 5, end: 12 }]), false);
  assert.equal(sameBufferedRanges([{ start: 0, end: 12 }], []), false);
  const audio = makeAudio();
  const source = sourceFor(audio);
  audio.setRanges([[40, 48]]);
  assert.deepEqual(readAudioBufferedRanges(audio, source), [{ start: 40, end: 48 }]);
});

function subscriptionHarness(audio) {
  const source = readFileSync(
    new URL('../src/shared/hooks/useAudioPlayerCore.ts', import.meta.url),
    'utf8',
  );
  const subscriber = extractStatementsBetween(source, 'handleBufferUpdate', 'handleTimeUpdate');
  const cleanup = [
    extractStatement(
      source,
      (text) => text.startsWith('bufferEvents.forEach(') && text.includes('removeEventListener'),
    ),
    extractStatement(source, (text) => text.startsWith("audio.removeEventListener('loadstart'")),
    extractStatement(source, (text) => text.startsWith("audio.removeEventListener('emptied'")),
  ].join('\n');
  let state = [],
    updates = 0;
  const audioRef = { current: audio },
    bufferedSourceRef = { current: sourceFor(audio) };
  const ctx = vm.createContext({
    audio,
    audioRef,
    bufferedSourceRef,
    readAudioBufferedRanges,
    sameBufferedRanges,
    setBufferedRanges(update) {
      const next = update(state);
      if (next !== state) updates++;
      state = next;
    },
  });
  vm.runInContext(
    stripTypeScriptTypes(subscriber + '\nthis.cleanup = () => {\n' + cleanup + '\n};'),
    ctx,
  );
  return {
    audioRef,
    bufferedSourceRef,
    ranges: () => JSON.parse(JSON.stringify(state)),
    updates: () => updates,
    cleanup: ctx.cleanup,
  };
}

test('Native progress/seeked/timeupdate events update the real hook and retain holes/eviction', () => {
  const audio = makeAudio(),
    h = subscriptionHarness(audio);
  assert.deepEqual(h.ranges(), [{ start: 0, end: 12 }]);
  const updates = h.updates();
  audio.dispatchEvent(new Event('timeupdate'));
  assert.equal(h.updates(), updates);
  audio.setRanges([[0, 18]]);
  audio.dispatchEvent(new Event('progress'));
  assert.deepEqual(h.ranges(), [{ start: 0, end: 18 }]);
  audio.setRanges([
    [0, 18],
    [40, 48],
  ]);
  audio.dispatchEvent(new Event('seeked'));
  assert.deepEqual(h.ranges(), [
    { start: 0, end: 18 },
    { start: 40, end: 48 },
  ]);
  audio.setRanges([[40, 48]]);
  audio.dispatchEvent(new Event('timeupdate'));
  assert.deepEqual(h.ranges(), [{ start: 40, end: 48 }]);
});

test('Source reset events clear the hook immediately; a new source starts from its own ranges', () => {
  for (const event of ['loadstart', 'emptied']) {
    const audio = makeAudio(),
      h = subscriptionHarness(audio);
    audio.dispatchEvent(new Event(event));
    assert.deepEqual(h.ranges(), []);
    h.bufferedSourceRef.current = null;
    audio.dispatchEvent(new Event('progress'));
    assert.deepEqual(h.ranges(), []);
    audio.src = 'blob:https://media.test/hls-new';
    audio.currentSrc = audio.src;
    h.bufferedSourceRef.current = sourceFor(audio);
    audio.setRanges([[0, 3]]);
    audio.dispatchEvent(new Event('loadedmetadata'));
    assert.deepEqual(h.ranges(), [{ start: 0, end: 3 }]);
  }
});

test('Old crossfade element events are ignored; hook cleanup removes all native subscriptions', () => {
  const audio = makeAudio(),
    h = subscriptionHarness(audio);
  h.audioRef.current = makeAudio();
  audio.setRanges([[0, 50]]);
  audio.dispatchEvent(new Event('progress'));
  audio.dispatchEvent(new Event('emptied'));
  assert.deepEqual(h.ranges(), [{ start: 0, end: 12 }]);
  h.audioRef.current = audio;
  h.cleanup();
  for (const event of [
    'progress',
    'loadeddata',
    'loadedmetadata',
    'durationchange',
    'canplay',
    'seeked',
    'timeupdate',
    'loadstart',
    'emptied',
  ])
    audio.dispatchEvent(new Event(event));
  assert.deepEqual(h.ranges(), [{ start: 0, end: 12 }]);
});

test('HLS attachment marks the blob source and ignores stale loads and snippets', () => {
  const source = readFileSync(
    new URL('../src/shared/hooks/useAudioPlayerCore.ts', import.meta.url),
    'utf8',
  );
  const start = source.indexOf('        hls.on(Hls.Events.MEDIA_ATTACHED');
  const end =
    source.indexOf('        hls.attachMedia(audio);', start) +
    '        hls.attachMedia(audio);'.length;
  const registration = source.slice(start, end);
  for (const [isSnippet, stale] of [
    [false, false],
    [false, true],
    [true, false],
  ]) {
    const audio = makeAudio();
    const bufferedSourceRef = { current: null };
    let attached;
    const hls = {
      on(event, callback) {
        assert.equal(event, 'mediaAttached');
        attached = callback;
      },
      attachMedia(media) {
        media.src = 'blob:https://media.test/hls';
      },
    };
    const ctx = vm.createContext({
      audio,
      hls,
      Hls: { Events: { MEDIA_ATTACHED: 'mediaAttached' } },
      isSnippet,
      isStaleLoad: () => stale,
      bufferedSourceRef,
    });
    vm.runInContext(registration, ctx);
    attached();
    if (isSnippet || stale) assert.equal(bufferedSourceRef.current, null);
    else {
      assert.equal(bufferedSourceRef.current.audio, audio);
      assert.equal(bufferedSourceRef.current.url, audio.src);
      audio.currentSrc = audio.src;
      audio.setRanges([
        [0, 8],
        [50, 58],
      ]);
      assert.deepEqual(readAudioBufferedRanges(audio, bufferedSourceRef.current), [
        { start: 0, end: 8 },
        { start: 50, end: 58 },
      ]);
    }
  }
});

test('Early preparation requires contiguous audible headroom, handles short endings and stale ranges', () => {
  const audio = makeAudio([
    [0, 10],
    [40, 60],
  ]);
  audio.currentTime = 2;
  assert.equal(hasAudioBufferHeadroom(audio), true);
  audio.currentTime = 3;
  assert.equal(hasAudioBufferHeadroom(audio), false);
  audio.currentTime = 39;
  assert.equal(hasAudioBufferHeadroom(audio), false);
  audio.currentTime = 58;
  assert.equal(hasAudioBufferHeadroom(audio), true);
  audio.currentTime = 60;
  assert.equal(hasAudioBufferHeadroom(audio), false);
  audio.currentTime = NaN;
  assert.equal(hasAudioBufferHeadroom(audio), false);
  audio.currentTime = 2;
  audio.buffered = {
    get length() {
      throw Error('replaced source');
    },
  };
  assert.equal(hasAudioBufferHeadroom(audio), false);
});
