import test from 'node:test';
import assert from 'node:assert/strict';
import { cardColumns, cardRowHeight, cardWindow } from '../src/shared/utils/virtualCardGrid.ts';
test('virtual cards use the same default viewport breakpoints and distinct artist layout', () => {
  for (const [width, expected] of [
    [320, 2],
    [639, 2],
    [640, 3],
    [767, 3],
    [768, 4],
    [1023, 4],
    [1024, 5],
  ])
    assert.equal(cardColumns(width, 'albums'), expected);
  assert.equal(cardColumns(1024, 'artists'), 6);
  assert.equal(cardColumns(640, 'artists'), 3);
  assert.ok(cardRowHeight(1200, 5, 1200, 'albums') > cardRowHeight(1200, 6, 1200, 'artists'));
});
test('virtual card geometry bounds DOM size for large lists and correctly accounts partial final row', () => {
  const total = 10001,
    columns = 5,
    height = 300;
  for (const scroll of [0, 500, 50000, 1e9]) {
    const r = cardWindow(total, columns, height, scroll, 800);
    assert.ok(r.start >= 0);
    assert.ok(r.end <= total);
    assert.ok(r.end - r.start <= 45);
    assert.ok(r.top <= r.height);
    assert.ok(r.top >= 0);
  }
  const last = cardWindow(11, 5, 300, 0, 2000, 0);
  assert.equal(last.height, 3 * 316 - 16);
  assert.equal(last.end, 11);
  assert.equal(cardWindow(0, 5, 300, 0, 800).height, 0);
});
test('virtual cards include synthetic create item only in visual count, not DB offset', () => {
  const without = cardWindow(10, 5, 200, 0, 2000),
    withCreate = cardWindow(11, 5, 200, 0, 2000);
  assert.equal(withCreate.height - without.height, 216);
});

test('virtual card spacers plus visible row strides exactly equal total height', () => {
  for (const count of [0, 1, 5, 11, 10001])
    for (const scroll of [0, 600, 5000, 1e9]) {
      const columns = 5,
        r = cardWindow(count, columns, 300, scroll, 800),
        rows = Math.ceil(count / columns);
      const visible =
        (r.last - r.first) * r.stride - (r.last > r.first && r.last === rows ? 16 : 0);
      assert.equal(r.top + visible + r.bottom, r.height, 'count=' + count + ' scroll=' + scroll);
    }
});
