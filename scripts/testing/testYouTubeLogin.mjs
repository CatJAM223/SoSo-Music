import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';
const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
const scratch = path.join(root, 'scratch');
fs.mkdirSync(scratch, { recursive: true });
const folder = fs.mkdtempSync(path.join(scratch, 'youtube-login-regression-'));
try {
  const entry = path.join(folder, 'probe.cjs');
  await build({
    entryPoints: [path.join(root, 'scripts/testing/youtubeLoginProbe.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['electron', 'youtubei.js'],
    outfile: entry,
  });
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(require('electron'), [entry, folder], {
    cwd: root,
    env,
    windowsHide: true,
    stdio: 'inherit',
    timeout: 20000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error('Native YouTube login regression failed: ' + result.status);
  console.log(
    'Native Chromium login lifecycle: local HTTPS fixtures, no Google account or external requests.',
  );
} finally {
  if (
    path.dirname(folder) !== scratch ||
    !path.basename(folder).startsWith('youtube-login-regression-')
  )
    throw new Error('Unexpected test profile path');
  fs.rmSync(folder, { recursive: true, force: true });
}
