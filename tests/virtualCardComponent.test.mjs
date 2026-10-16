import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as jsxRuntime from 'react/jsx-runtime';
import * as geometry from '../src/shared/utils/virtualCardGrid.ts';
const source = ts.transpileModule(
  fs.readFileSync(
    new URL('../src/desktop/ui/components/VirtualCardGrid.tsx', import.meta.url),
    'utf8',
  ),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  },
).outputText;
function render(props, scroll = 0, focused = null) {
  const exports = {};
  let state = 0;
  vm.runInNewContext(source, {
    exports,
    require(name) {
      if (name === 'react/jsx-runtime') return jsxRuntime;
      if (name === 'react')
        return {
          useEffect() {},
          useRef: () => ({ current: null }),
          useState: () => [
            state++ === 0 ? { width: 1000, viewportWidth: 1200, scroll, viewport: 800 } : focused,
            () => {},
          ],
        };
      if (name === '../../../shared/utils/virtualCardGrid') return geometry;
      throw Error('Unexpected dependency ' + name);
    },
  });
  return exports.VirtualCardGrid(props);
}
function visit(node, fn) {
  if (Array.isArray(node)) {
    node.forEach((child) => visit(child, fn));
    return;
  }
  if (!node || typeof node !== 'object' || !node.props) return;
  fn(node);
  visit(node.props.children, fn);
}
const items = Array.from({ length: 10000 }, (_, i) => ({ id: String(i) }));
const props = {
  items,
  kind: 'albums',
  itemKey: (item) => item.id,
  renderItem: (item) => jsxRuntime.jsx('button', { children: item.id }),
  label: 'Albums',
};
test('Production card component renders a bounded window for 10000 cards at several scroll positions', () => {
  for (const scroll of [0, 500, 50000, 1e9]) {
    const tree = render(props, scroll),
      keys = [];
    visit(tree, (node) => {
      if (node.props['data-card-key']) keys.push(node.props['data-card-key']);
    });
    assert.ok(keys.length <= 45);
    assert.equal(new Set(keys).size, keys.length);
  }
});
test('Production card component pins a focused offscreen row without adding it to spacer flow', () => {
  const tree = render(props, 50000, 'entity:9999'),
    cards = [],
    pinned = [];
  visit(tree, (node) => {
    if (node.props['data-card-key']) cards.push(node.props['data-card-key']);
    if (node.props.style?.position === 'absolute') pinned.push(node);
  });
  assert.ok(cards.includes('entity:9999'));
  assert.equal(pinned.length, 1);
  assert.ok(cards.length <= 50);
  assert.equal(
    pinned[0].props.style.top,
    1999 *
      geometry.cardWindow(10000, 5, geometry.cardRowHeight(1000, 5, 1200, 'albums'), 50000, 800)
        .stride,
  );
});
test('Production card component gives the create card a separate identity from an entity of the same name', () => {
  const tree = render({
      ...props,
      items: [{ id: 'create-playlist' }],
      leading: jsxRuntime.jsx('button', { children: 'Create' }),
    }),
    keys = [];
  visit(tree, (node) => {
    if (node.props['data-card-key']) keys.push(node.props['data-card-key']);
  });
  assert.deepEqual(keys, ['leading:create-playlist', 'entity:create-playlist']);
});
