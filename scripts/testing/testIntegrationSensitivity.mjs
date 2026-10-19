import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const directory = path.join(root, 'scratch/check-logs');
fs.mkdirSync(directory, { recursive: true });
const cases = [
  [
    'media-wiring',
    'scripts/testing/testDesktopBootstrap.mjs',
    'SOSO_DESKTOP_PROBE_MUTATION',
    'initial decoded video',
  ],
  [
    'sync-wiring',
    'scripts/testing/testDesktopBootstrap.mjs',
    'SOSO_DESKTOP_PROBE_MUTATION',
    'Production sync:start IPC must start its server',
  ],
  [
    'wallpaper-src',
    'scripts/testing/testDesktopBootstrap.mjs',
    'SOSO_DESKTOP_PROBE_MUTATION',
    'initial decoded video',
  ],
  [
    'csp-remote',
    'scripts/testing/testDesktopBootstrap.mjs',
    'SOSO_DESKTOP_PROBE_MUTATION',
    'Remote script must be blocked by application CSP',
  ],
  [
    'player-button',
    'scripts/testing/testUiInteractions.mjs',
    'SOSO_UI_TEST_MUTATION',
    'Player did not dispatch cancel',
  ],
];
for (const [mutation, entry, variable, expected] of cases) {
  const result = spawnSync(process.execPath, [entry], {
    cwd: root,
    env: { ...process.env, [variable]: mutation },
    windowsHide: true,
    encoding: 'utf8',
    timeout: 45000,
    maxBuffer: 4 * 1024 * 1024,
  });
  const output = (result.stdout || '') + (result.stderr || '');
  fs.writeFileSync(path.join(directory, 'mutation-' + mutation + '.log'), output);
  if (result.error) throw result.error;
  assert.equal(result.status, 1, 'Broken integration must fail: ' + mutation + '\n' + output);
  assert.ok(
    output.includes(expected),
    'Mutation must fail its intended behavior: ' + mutation + '\n' + output,
  );
  assert.ok(
    !/SyntaxError:|ERR_MODULE_NOT_FOUND|Cannot find module/.test(output),
    'Build/import errors do not count as detected regressions',
  );
  console.log('INTEGRATION_SENSITIVITY_OK ' + mutation + ': ' + expected);
}
console.log('All five previously missed integrations are detected in isolated builds.');
