import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { waveCoreScenarios } from './fixtures/waveCoreScenarios.mjs';

test('critical wave refactoring preserves provider work and exact results across 18 mood/profile scenarios', async () => {
  const baseline = JSON.parse(
    fs.readFileSync(new URL('./fixtures/wave-core-baseline.json', import.meta.url), 'utf8'),
  );
  const actual = await waveCoreScenarios();
  assert.deepEqual(actual, baseline);
});
