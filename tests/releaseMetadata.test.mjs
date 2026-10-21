import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { versionInfo, assertArchiveVersion } = require('../scripts/release/version.cjs');
test('Release versions produce Windows archive names and reject invalid versions', () => {
  const versions = ['2.9.3', '2.9.4', '2.10.0', '3.0.0'].map(versionInfo);
  assert.equal(versions[0].windowsZip, 'SoSo-Music-2.9.3-windows-x64.zip');
  assert.equal(versions[0].windows7z, 'SoSo-Music-2.9.3-windows-x64.7z');
  for (const value of [
    '../2.9.3',
    'v2.9.3',
    '2.09.3',
    '2.9.3-beta',
    '0.0.0',
    '2.1000.0',
    '2101.0.0',
  ])
    assert.throws(() => versionInfo(value));
});
test('Packaging checks the actual ASAR and refuses to label an old application as a new release', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'soso-release-version-'));
  try {
    const source = path.join(root, 'app');
    await fs.mkdir(source);
    await fs.writeFile(
      path.join(source, 'package.json'),
      JSON.stringify({ name: 'soso-music', version: '2.9.2' }),
    );
    const archive = path.join(root, 'app.asar');
    await require('@electron/asar').createPackage(source, archive);
    assert.throws(() => assertArchiveVersion(archive, '2.9.3'), /2\.9\.2.*2\.9\.3/);
    assert.doesNotThrow(() => assertArchiveVersion(archive, '2.9.2'));
  } finally {
    assert.equal(path.dirname(root), os.tmpdir());
    assert.ok(path.basename(root).startsWith('soso-release-version-'));
    await fs.rm(root, { recursive: true, force: true });
  }
});
