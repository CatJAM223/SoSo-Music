import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { hookRuntime } from './helpers/hookRuntime.mjs';
import { discoverNodeTests } from './helpers/discoverNodeTests.mjs';
async function directory(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'soso-test-harness-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}
test('Discovery includes nested tests and legacy suites, excluding helpers and utility scripts', async (t) => {
  const root = await directory(t);
  for (const file of [
    'first.test.mjs',
    'nested/deep/second.test.mjs',
    'stressTestHardcore.mjs',
    'tool.mjs',
    'helpers/hidden.test.mjs',
    'fixtures/data.test.mjs',
  ]) {
    await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await fs.writeFile(path.join(root, file), '');
  }
  assert.deepEqual(
    (await discoverNodeTests(root))
      .map((file) => path.relative(root, file).replaceAll('\\', '/'))
      .sort(),
    ['first.test.mjs', 'nested/deep/second.test.mjs', 'stressTestHardcore.mjs'],
  );
});
test('Hook harness selects the named hook instead of the first exported helper', async (t) => {
  const root = await directory(t),
    file = path.join(root, 'useFixture.ts');
  await fs.writeFile(
    file,
    'export function unrelated(){throw Error("Wrong export");} export function useFixture(){return {ok:true};}',
  );
  const h = hookRuntime(pathToFileURL(file), {});
  assert.equal(h.render().ok, true);
  h.unmount();
});
test('Hook harness tears down once and records updates during and after cleanup', async (t) => {
  const root = await directory(t),
    file = path.join(root, 'useFixture.ts');
  await fs.writeFile(
    file,
    "import {useState,useEffect} from 'react'; export function useFixture(){const [value,setValue]=useState(0);useEffect(()=>()=>{cleanup();setValue(1);},[]);return {value,setValue};}",
  );
  let cleanups = 0;
  const h = hookRuntime(pathToFileURL(file), {}, { cleanup: () => cleanups++ });
  const api = h.render();
  h.unmount();
  h.unmount();
  assert.equal(cleanups, 1);
  assert.equal(h.lateUpdates(), 1);
  api.setValue(2);
  assert.equal(h.lateUpdates(), 2);
  assert.throws(() => h.render(), /unmounted/);
});
