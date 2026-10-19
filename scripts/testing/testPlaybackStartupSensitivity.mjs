import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const directory = path.join(root, 'scratch/startup-sensitivity');
fs.mkdirSync(directory, { recursive: true });
// hookRuntime reads the complete production hook. Transform only that read in
// each child process, keeping the real source and the remaining dependency graph intact.
const loader = path.join(directory, 'mutate-hook.mjs');
fs.writeFileSync(
  loader,
  `
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const read = fs.readFileSync;
fs.readFileSync = function(file, ...args) {
  const source = read.call(this, file, ...args);
  if (!String(file).replaceAll('\\\\', '/').endsWith('/src/shared/hooks/useAudioPlayerCore.ts')) return source;
  let changed;
  if (process.env.SOSO_STARTUP_MUTATION === 'cancel-prefetch') {
    changed = source.replace(/audioCacheService\\.setPlaybackBuffering\\(\\s*true,\\s*rejectedStreamTracksRef[\\s\\S]*?\\n      \\);/, 'audioCacheService.setPlaybackBuffering(true);');
  } else {
    const anchor = '        loadStreamIntoAudio(audio, mainHlsRef, cachedSource.url, startPosition, false, track.id);';
    changed = source.replace(anchor, '        await offlineCacheService.getCachedCoverUrl(track.id);\\n' + anchor);
  }
  if (changed === source) throw Error('Startup mutation anchor missing');
  process.stdout.write('STARTUP_MUTATION_APPLIED ' + process.env.SOSO_STARTUP_MUTATION + '\\n');
  return changed;
};
syncBuiltinESMExports();
`,
);
const cases = [
  [
    'cancel-prefetch',
    'selecting an in-flight prefetched track',
    'one transport each for selected and unrelated prefetch',
  ],
  ['wait-for-cover', 'offline audio starts before delayed artwork', 'artwork is still pending'],
];
for (const [mutation, name, expected] of cases) {
  const result = spawnSync(
    process.execPath,
    [
      '--experimental-strip-types',
      '--import',
      pathToFileURL(loader).href,
      '--import',
      new URL('../../tests/helpers/offlineEnvironment.mjs', import.meta.url).href,
      '--test',
      '--test-reporter=spec',
      '--test-timeout=10000',
      '--test-name-pattern=' + name,
      'tests/playbackLifecycle.test.mjs',
    ],
    {
      cwd: root,
      env: { ...process.env, SOSO_STARTUP_MUTATION: mutation },
      windowsHide: true,
      encoding: 'utf8',
      timeout: 15000,
      maxBuffer: 4 * 1024 * 1024,
    },
  );
  const output = (result.stdout || '') + (result.stderr || '');
  fs.writeFileSync(path.join(directory, mutation + '.log'), output);
  if (result.error) throw result.error;
  assert.equal(result.status, 1, 'Broken startup must fail: ' + mutation + '\n' + output);
  assert.ok(output.includes('STARTUP_MUTATION_APPLIED ' + mutation), 'Mutation must execute');
  assert.ok(
    output.includes(expected) && output.includes('AssertionError'),
    'Expected behavioral failure: ' + mutation + '\n' + output,
  );
  assert.ok(
    !/SyntaxError:|ERR_MODULE_NOT_FOUND|Cannot find module|test timed out/.test(output),
    'Import/timeout errors do not count as detected regressions',
  );
  console.log('STARTUP_SENSITIVITY_OK ' + mutation + ': ' + expected);
}
console.log('Both startup regressions were detected; production files were not modified.');
