import { mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { discoverNodeTests } from './helpers/discoverNodeTests.mjs';

// Separate files cannot share global mocks, storage or singleton caches.
const testFiles = await discoverNodeTests(fileURLToPath(new URL('.', import.meta.url)));
console.log('NODE_TEST_FILES ' + testFiles.length);
if (!testFiles.length) throw new Error('No test files discovered');
const temporary = await mkdtemp(path.join(os.tmpdir(), 'soso-node-tests-'));
try {
  const code = await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        '--experimental-strip-types',
        '--import',
        new URL('helpers/offlineEnvironment.mjs', import.meta.url).href,
        '--test',
        '--test-concurrency=4',
        '--test-timeout=60000',
        ...testFiles,
      ],
      { stdio: 'inherit', windowsHide: true, env: { ...process.env, APPDATA: temporary } },
    );
    child.once('error', reject);
    child.once('exit', (exitCode, signal) => resolve(signal ? 1 : (exitCode ?? 1)));
  });
  process.exitCode = code;
} finally {
  if (
    path.dirname(temporary) !== os.tmpdir() ||
    !path.basename(temporary).startsWith('soso-node-tests-')
  ) {
    throw new Error('Unexpected test profile path');
  }
  await rm(temporary, { recursive: true, force: true });
}
