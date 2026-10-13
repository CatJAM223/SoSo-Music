import test from 'node:test';
import assert from 'node:assert/strict';
import { getKaraokeWaitFrame } from '../src/shared/utils/karaokeWaitAnimation.ts';

test('Karaoke wait: bouncing dots join a line then count 3, 2, 1 before the lyric', () => {
  assert.equal(getKaraokeWaitFrame(5, 12, true).phase, 'dots');
  assert.equal(getKaraokeWaitFrame(8.25, 12, true).phase, 'line');
  assert.equal(getKaraokeWaitFrame(8.8, 12, true).digit, 3);
  assert.equal(getKaraokeWaitFrame(9.4, 12, true).digit, 3);
  assert.equal(getKaraokeWaitFrame(10.4, 12, true).digit, 2);
  assert.equal(getKaraokeWaitFrame(11.4, 12, true).digit, 1);
  assert.equal(getKaraokeWaitFrame(12, 12, true).phase, 'hidden');
  assert.deepEqual(getKaraokeWaitFrame(13, 12, true).paths, []);
});

test('Karaoke wait: motion freezes with a stalled clock and seeks have no residual timer state', () => {
  const initial = getKaraokeWaitFrame(9.72, 12, true);
  for (let i = 0; i < 300; i++) assert.deepEqual(getKaraokeWaitFrame(9.72, 12, true), initial);
  assert.notDeepEqual(getKaraokeWaitFrame(9.8, 12, true).paths, initial.paths);
  assert.equal(getKaraokeWaitFrame(2, 12, true).phase, 'dots');
  assert.equal(getKaraokeWaitFrame(11.9, 12, true).digit, 1);
  assert.equal(getKaraokeWaitFrame(0, 40, true).phase, 'dots');
});

test('Karaoke wait: dots, line and digit morphs stay continuous at each boundary', () => {
  const coordinates = (frame) =>
    frame.paths.flatMap((path) => path.match(/-?\d+(?:\.\d+)?/g).map(Number));
  for (const remaining of [3.6, 3, 2.6, 2, 1.6, 1]) {
    const before = coordinates(getKaraokeWaitFrame(12 - remaining - 0.00001, 12, true));
    const after = coordinates(getKaraokeWaitFrame(12 - remaining + 0.00001, 12, true));
    assert.equal(before.length, after.length);
    assert.ok(
      before.every((value, i) => Math.abs(value - after[i]) < 0.02),
      'Morph must not jump at ' + remaining,
    );
  }
});

test('Karaoke wait: inactive breaks are static, finite and never show another fragment countdown', () => {
  const inactive = getKaraokeWaitFrame(0, 12, false);
  for (const time of [5, 9.5, 11.9, 13])
    assert.deepEqual(getKaraokeWaitFrame(time, 12, false), inactive);
  for (const time of [NaN, Infinity, -Infinity])
    assert.deepEqual(getKaraokeWaitFrame(time, 12, true), inactive);
  assert.deepEqual(getKaraokeWaitFrame(0, NaN, true), inactive);
  assert.notDeepEqual(
    getKaraokeWaitFrame(0.2, 12, true).paths,
    getKaraokeWaitFrame(0.4, 12, true).paths,
  );
});

test('Karaoke wait: long instrumental sections count down to their own next fragment', () => {
  assert.equal(getKaraokeWaitFrame(60, 90, true).phase, 'dots');
  assert.equal(getKaraokeWaitFrame(87.5, 90, true).digit, 3);
  assert.equal(getKaraokeWaitFrame(88.5, 90, true).digit, 2);
  assert.equal(getKaraokeWaitFrame(89.5, 90, true).digit, 1);
});

test('Karaoke wait: a single continuous stroke carries line → 3 → 2 → 1 at a fixed thin weight', () => {
  const joined = getKaraokeWaitFrame(8.25, 12, true),
    three = getKaraokeWaitFrame(9.4, 12, true),
    two = getKaraokeWaitFrame(10.4, 12, true),
    one = getKaraokeWaitFrame(11.4, 12, true);
  for (const frame of [joined, three, two, one]) {
    assert.equal(frame.paths.length, 1);
    assert.equal(
      (frame.paths[0].match(/M/g) || []).length,
      1,
      'After joining there must be one unbroken line',
    );
    assert.equal(frame.strokeWidth, 3.2);
  }
  const from = getKaraokeWaitFrame(9.6, 12, true).paths[0],
    mid = getKaraokeWaitFrame(9.8, 12, true).paths[0],
    to = getKaraokeWaitFrame(10, 12, true).paths[0];
  assert.notEqual(mid, from);
  assert.notEqual(mid, to);
  assert.equal((mid.match(/Q/g) || []).length, 5);
  assert.deepEqual(
    joined.paths[0]
      .match(/-?\d+(?:\.\d+)?/g)
      .map(Number)
      .filter((_, i) => i % 2),
    Array(11).fill(26),
  );
});

test('Karaoke wait: the visible stroke contracts, curls and redraws without whole-glyph stretching', () => {
  const frame = (remaining) => getKaraokeWaitFrame(12 - remaining, 12, true);
  const coordinates = (f) => f.paths[0].match(/-?\d+(?:\.\d+)?/g).map(Number);
  const span = (f) => (f.strokeDasharray ? Number(f.strokeDasharray.split(' ')[0]) : 1);
  const start = (f) => -(f.strokeDashoffset ?? 0);
  for (const [from, to] of [
    [3.6, 3],
    [2.6, 2],
    [1.6, 1],
  ]) {
    const first = frame(from),
      last = frame(to),
      a = coordinates(first),
      b = coordinates(last),
      duration = from - to;
    const contracting = frame(from - duration * 0.2),
      turning = frame(from - duration * 0.5),
      drawing = frame(from - duration * 0.8);
    assert.ok(span(turning) < span(contracting));
    assert.ok(span(turning) < span(drawing));
    assert.ok(
      span(turning) > 0.04 && span(turning) < 0.4,
      'Keep a short visible curl throughout the transition',
    );
    assert.equal(span(first), 1);
    assert.equal(span(last), 1);
    for (let elapsed = 1 / 120; elapsed < duration; elapsed += 1 / 120) {
      const current = frame(from - elapsed);
      assert.equal(current.paths.length, 1);
      assert.equal((current.paths[0].match(/M/g) || []).length, 1);
      assert.ok(start(current) >= 0 && start(current) + span(current) <= 1.0001);
      coordinates(current).forEach((value, i) =>
        assert.ok(
          value >= Math.min(a[i], b[i]) - 0.01 && value <= Math.max(a[i], b[i]) + 0.01,
          'No elastic overshoot',
        ),
      );
    }
  }
});

test('Karaoke wait: the visible stroke is continuous at contract, turn, draw and digit boundaries', () => {
  const window = (f) => [
    -(f.strokeDashoffset ?? 0),
    f.strokeDasharray ? Number(f.strokeDasharray.split(' ')[0]) : 1,
  ];
  for (const [from, to] of [
    [3.6, 3],
    [2.6, 2],
    [1.6, 1],
  ])
    for (const p of [0, 0.28, 0.42, 0.58, 0.72, 1]) {
      const time = 12 - from + (from - to) * p;
      const before = window(getKaraokeWaitFrame(time - 0.00001, 12, true)),
        after = window(getKaraokeWaitFrame(time + 0.00001, 12, true));
      assert.ok(
        before.every((value, i) => Math.abs(value - after[i]) <= 0.0002),
        'The pen must not jump at ' + time,
      );
    }
});
