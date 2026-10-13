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
  ['React player state', 'scripts/testing/testPlayerState.mjs'],
  ['Desktop UI', 'scripts/testing/testDesktopUi.mjs'],
  ['YouTube local login fixture', 'scripts/testing/testYouTubeLogin.mjs'],
  ['Audio transitions', 'scripts/testing/testAudioTransitions.mjs'],
  ['UI interactions', 'scripts/testing/testUiInteractions.mjs'],
  ['Settings lifecycle', 'scripts/testing/testSettingsLifecycle.mjs'],
  ['UI rendering bounds', 'scripts/testing/testUiResponsiveness.mjs'],
  ['Background resource lifecycle', 'scripts/testing/testBackgroundMemory.mjs'],
  ['Rust in Chromium', 'scripts/testing/testRustComputeBrowser.mjs'],
];
for (const [label, entry, ...args] of checks) {
  console.log('\nCHECK_START ' + label);
  const result = spawnSync(
    process.execPath,
    [
      '--experimental-strip-types',
      fileURLToPath(new URL('../../' + entry, import.meta.url)),
      ...args,
    ],
    { cwd: root, stdio: 'inherit', windowsHide: true, timeout: 120000 },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    console.error('CHECK_FAILED ' + label);
    process.exitCode = result.status ?? 1;
    break;
  }
  console.log('CHECK_PASS ' + label);
}
