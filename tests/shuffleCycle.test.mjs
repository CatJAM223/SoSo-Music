import test from 'node:test';
import assert from 'node:assert/strict';
import { ShuffleCycle, sameShuffleCollection } from '../src/shared/utils/shuffleCycle.ts';
const queue = (...ids) => ids.map((id) => ({ id }));

test('Shuffle visits every track once and then ends, including an already playing first song', () => {
  const q = queue('a', 'b', 'c', 'd', 'e');
  for (const random of [() => 0, () => 0.999, () => 0.5]) {
    const cycle = new ShuffleCycle();
    let current = 'c';
    const played = [current];
    cycle.visit(q, current);
    while (cycle.hasNext(q, current, false)) {
      const index = cycle.next(q, current, false, random);
      assert.ok(index >= 0);
      current = q[index].id;
      played.push(current);
      cycle.visit(q, current);
    }
    assert.equal(played.length, q.length);
    assert.equal(new Set(played).size, q.length);
    assert.equal(cycle.next(q, current, false), -1);
  }
});

test('Repeat-all starts complete new passes without an immediate cycle-boundary repeat', () => {
  const q = queue('a', 'b', 'c', 'd');
  const cycle = new ShuffleCycle();
  let current;
  for (let pass = 0; pass < 8; pass++) {
    const previous = current;
    const played = [];
    for (let i = 0; i < q.length; i++) {
      current = q[cycle.next(q, current, true, () => 0)].id;
      played.push(current);
    }
    assert.equal(new Set(played).size, q.length);
    if (previous) assert.notEqual(played[0], previous);
  }
});

test('Tracks selected manually or skipped are excluded, even if played before enabling shuffle', () => {
  const q = queue('a', 'b', 'c', 'd');
  const cycle = new ShuffleCycle();
  cycle.visit(q, 'a');
  cycle.visit(q, 'c');
  assert.equal(q[cycle.next(q, 'c', false, () => 0)].id, 'b');
  cycle.visit(q, 'd');
  assert.equal(cycle.next(q, 'd', false), -1);
});

test('Previous and forward use real history without making old songs randomly eligible again', () => {
  const q = queue('a', 'b', 'c', 'd');
  const cycle = new ShuffleCycle();
  cycle.visit(q, 'a');
  assert.equal(cycle.previous(q, 'a'), -1);
  assert.equal(q[cycle.next(q, 'a', false, () => 0.999)].id, 'd');
  assert.equal(q[cycle.next(q, 'd', false, () => 0.999)].id, 'c');
  assert.equal(q[cycle.previous(q, 'c')].id, 'd');
  assert.equal(q[cycle.previous(q, 'd')].id, 'a');
  assert.equal(q[cycle.next(q, 'a', false, () => 0)].id, 'd');
  assert.equal(q[cycle.next(q, 'd', false, () => 0)].id, 'c');
  assert.equal(q[cycle.next(q, 'c', false, () => 0)].id, 'b');
  assert.equal(cycle.hasNext(q, 'b', false), false);
});

test('Reordering, metadata updates, removal and additions preserve the current pass by ID', () => {
  const cycle = new ShuffleCycle();
  cycle.visit(queue('a', 'b', 'c'), 'a');
  cycle.visit(queue('a', 'b', 'c'), 'c');
  const q = queue('d', 'c', 'a', 'b');
  assert.equal(q[cycle.previous(q, 'c')].id, 'a');
  assert.equal(q[cycle.next(q, 'a', false, () => 0)].id, 'c');
  const trimmed = queue('b', 'a', 'd');
  // Playback preserves the order already prepared before removing/reordering a song.
  assert.equal(trimmed[cycle.next(trimmed, 'c', false, () => 0)].id, 'd');
  assert.equal(trimmed[cycle.next(trimmed, 'd', false, () => 0)].id, 'b');
  assert.equal(cycle.next(trimmed, 'd', false), -1);
  assert.equal(sameShuffleCollection(queue(1, '2'), queue('2', '1', '1')), false);
  assert.equal(sameShuffleCollection(queue('a', 'b'), queue('a', 'c')), false);
});

test('Legacy bare track IDs retain compatibility; empty and single-track queues have finite behavior', () => {
  const cycle = new ShuffleCycle();
  assert.equal(cycle.next([], undefined, true), -1);
  const q = queue('a', 'a', 'b');
  cycle.visit(q, 'a');
  assert.equal(q[cycle.next(q, 'a', false)].id, 'b');
  assert.equal(cycle.next(q, 'b', false), -1);
  cycle.reset();
  const single = queue('a');
  cycle.visit(single, 'a');
  assert.equal(cycle.hasNext(single, 'a', false), false);
  assert.equal(cycle.next(single, 'a', false), -1);
  assert.equal(cycle.hasNext(single, 'a', true), true);
  assert.equal(cycle.next(single, 'a', true), 0);
});

test('Resetting a listening collection clears both exclusions and stale history', () => {
  const cycle = new ShuffleCycle();
  const q = queue('a', 'b', 'c');
  cycle.visit(q, 'a');
  cycle.visit(q, 'b');
  cycle.reset();
  cycle.visit(q, 'b');
  assert.equal(cycle.previous(q, 'b'), -1);
  assert.equal(q[cycle.next(q, 'b', false, () => 0)].id, 'a');
});

test('Queue preview stays stable and matches every next track, across repeats and history', () => {
  const q = queue('a', 'b', 'c', 'd', 'e');
  const cycle = new ShuffleCycle();
  let current = 'c';
  for (let step = 0; step < 25; step++) {
    const shown = cycle.upcoming(q, current, true, () => 0.7);
    assert.deepEqual(
      cycle.upcoming(q, current, true, () => 0),
      shown,
      'Opening the queue must not reshuffle',
    );
    assert.equal(
      cycle.next(q, current, true, () => 0),
      shown[0],
    );
    current = q[shown[0]].id;
    if (step % 4 === 3) {
      const previous = cycle.previous(q, current);
      current = q[previous].id;
      const afterBack = cycle.upcoming(q, current, true);
      assert.equal(cycle.next(q, current, true), afterBack[0]);
      current = q[afterBack[0]].id;
    }
  }
});
test('Preparing the next pass does not mark songs played and cancelling repeat clears it', () => {
  const q = queue('a', 'b', 'c');
  const cycle = new ShuffleCycle();
  let current = 'a';
  while (cycle.hasNext(q, current, false)) current = q[cycle.next(q, current, false, () => 0)].id;
  assert.equal(cycle.upcoming(q, current, true).length, 3);
  assert.equal(cycle.hasNext(q, current, false), false);
  assert.deepEqual(cycle.upcoming(q, current, false), []);
});
test('Play-next, queue drag and new additions change both preview and playback together', () => {
  let q = queue('a', 'b', 'c', 'd');
  const cycle = new ShuffleCycle();
  cycle.visit(q, 'a');
  let shown = cycle.upcoming(q, 'a', false, () => 0);
  assert.equal(q[shown[0]].id, 'b');
  cycle.moveUpcoming(q, 'a', false, 'd', 'b');
  shown = cycle.upcoming(q, 'a', false);
  assert.deepEqual(
    shown.map((i) => q[i].id),
    ['d', 'b', 'c'],
  );
  cycle.prioritize('e');
  q = queue('a', 'e', 'b', 'c', 'd');
  assert.equal(q[cycle.upcoming(q, 'a', false)[0]].id, 'e');
  assert.equal(q[cycle.next(q, 'a', false)].id, 'e');
  assert.equal(q[cycle.next(q, 'e', false)].id, 'd');
  const trimmed = queue('a', 'e', 'c');
  assert.equal(trimmed[cycle.next(trimmed, 'd', false)].id, 'c');
  assert.equal(cycle.next(trimmed, 'c', false), -1);
});

test('Reordering forward history keeps availability correct until the explicitly ordered songs finish', () => {
  const q = queue('a', 'b', 'c');
  const cycle = new ShuffleCycle();
  cycle.visit(q, 'a');
  cycle.next(q, 'a', false, () => 0);
  cycle.next(q, 'b', false, () => 0);
  cycle.previous(q, 'c');
  cycle.previous(q, 'b');
  cycle.moveUpcoming(q, 'a', false, 'c', 'b');
  assert.equal(cycle.hasNext(q, 'a', false), true);
  assert.equal(q[cycle.next(q, 'a', false)].id, 'c');
  assert.equal(cycle.hasNext(q, 'c', false), true);
  assert.equal(q[cycle.next(q, 'c', false)].id, 'b');
  assert.equal(cycle.hasNext(q, 'b', false), false);
});
