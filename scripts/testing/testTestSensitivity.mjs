import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const checks = [
  ['bypass-rust', 'wave must call the Rust adapter'],
  ['ignore-history', 'heard family returned'],
  ['ignore-duplicates', 'alternative version returned'],
  ['ignore-offered', 'offered songs must lose priority'],
];
for (const [mutation, expected] of checks) {
  const result = spawnSync(
    process.execPath,
    [
      '--experimental-strip-types',
      '--test',
      '--test-reporter=spec',
      '--test-name-pattern=Public wave queue uses the Rust',
      'tests/waveComputeIntegration.test.mjs',
    ],
    {
      cwd: root,
      env: { ...process.env, SOSO_WAVE_TEST_MUTATION: mutation },
      windowsHide: true,
      encoding: 'utf8',
      timeout: 30000,
    },
  );
  if (result.error) throw result.error;
  const output = (result.stdout || '') + (result.stderr || '');
  assert.equal(result.status, 1, 'Broken behavior must fail: ' + mutation + '\n' + output);
  assert.ok(
    output.includes(expected),
    'Failure must be the intended behavioral assertion: ' + mutation + '\n' + output,
  );
  assert.ok(!output.includes('SyntaxError:'), 'Syntax errors do not count as detected regressions');
  console.log('TEST_SENSITIVITY_OK ' + mutation + ': ' + expected);
}

const callbacks = [
  ['playTrack', 'Playback opt-out gate'],
  ['togglePlay', 'Play/pause opt-out'],
  ['prefetchTrackStream', 'Prefetch opt-out'],
  ['previewSnippet', 'Snippet opt-out'],
  ['cacheTrackForOffline', 'Offline download opt-out'],
];
for (const [callback, name] of callbacks) {
  const result = spawnSync(
    process.execPath,
    [
      '--experimental-strip-types',
      '--test',
      '--test-reporter=spec',
      '--test-name-pattern=' + name,
      'tests/youtubeAvailability.test.mjs',
    ],
    {
      cwd: root,
      env: { ...process.env, SOSO_CALLBACK_TEST_MUTATION: callback },
      windowsHide: true,
      encoding: 'utf8',
      timeout: 30000,
    },
  );
  if (result.error) throw result.error;
  const output = (result.stdout || '') + (result.stderr || '');
  assert.equal(result.status, 1, 'Empty handler must fail: ' + callback + '\n' + output);
  assert.ok(
    output.includes('AssertionError'),
    'Failure must be a behavioral assertion: ' + callback + '\n' + output,
  );
  assert.ok(!output.includes('SyntaxError:'), 'Syntax errors do not count as detected regressions');
  console.log('TEST_SENSITIVITY_OK ' + callback + ': empty callback rejected');
}
console.log('All nine isolated mutations were caught; production source files were not changed.');
