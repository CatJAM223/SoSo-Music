import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const checks = [
  [
    'Code style',
    'node_modules/prettier/bin/prettier.cjs',
    '--check',
    'src',
    'scripts',
    'tests',
    '*.json',
    '*.js',
    '*.ts',
  ],
  ['TypeScript', 'node_modules/typescript/bin/tsc', '--noEmit'],
  ['Architecture', 'scripts/architecture/checkBoundaries.cjs'],
  ['Release metadata', 'scripts/release/checkRelease.cjs'],
  ['Node behavior', 'tests/runAllTests.mjs'],
  ['Test sensitivity', 'scripts/testing/testTestSensitivity.mjs'],
  ['Playback startup sensitivity', 'scripts/testing/testPlaybackStartupSensitivity.mjs'],
  ['React player state', 'scripts/testing/testPlayerState.mjs'],
  ['Production main and preload wiring', 'scripts/testing/testDesktopBootstrap.mjs'],
  [
    'Native crash recovery and local reports',
    'scripts/testing/testDesktopBootstrap.mjs',
    '--crashes',
  ],
  ['Selected media file access', 'scripts/testing/testMediaFileAccess.mjs'],
  ['Desktop UI', 'scripts/testing/testDesktopUi.mjs'],
  ['YouTube local login fixture', 'scripts/testing/testYouTubeLogin.mjs'],
  ['Audio transitions', 'scripts/testing/testAudioTransitions.mjs'],
  ['UI interactions', 'scripts/testing/testUiInteractions.mjs'],
  ['Settings lifecycle', 'scripts/testing/testSettingsLifecycle.mjs'],
  ['UI rendering bounds', 'scripts/testing/testUiResponsiveness.mjs'],
  ['Background resource lifecycle', 'scripts/testing/testBackgroundMemory.mjs'],
  ['Widget resource isolation', 'scripts/testing/testWidgetResources.mjs'],
  ['Rust in Chromium', 'scripts/testing/testRustComputeBrowser.mjs'],
  ['Integration test sensitivity', 'scripts/testing/testIntegrationSensitivity.mjs'],
];
const logs = path.join(root, 'scratch/check-logs');
fs.mkdirSync(logs, { recursive: true });
const completed = [];
for (const [label, entry, ...args] of checks) {
  console.log('\nCHECK_START ' + label);
  const result = spawnSync(
    process.execPath,
    [
      '--experimental-strip-types',
      fileURLToPath(new URL('../../' + entry, import.meta.url)),
      ...args,
    ],
    {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 120000,
      maxBuffer: 32 * 1024 * 1024,
    },
  );
  const output = (result.stdout || '') + (result.stderr || '');
  const filename = label.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.log';
  fs.writeFileSync(
    path.join(logs, filename),
    output + (result.error ? '\n' + result.error.stack : ''),
  );
  completed.push({
    label,
    entry,
    status: result.status,
    signal: result.signal,
    error: result.error?.message,
    log: filename,
  });
  fs.writeFileSync(path.join(logs, 'summary.json'), JSON.stringify(completed, null, 2));
  if (result.error || result.status !== 0) {
    console.error(output.slice(-16000));
    if (result.error) console.error(result.error);
    console.error('CHECK_FAILED ' + label);
    process.exitCode = result.status ?? 1;
    break;
  }
  console.log('CHECK_PASS ' + label);
}
