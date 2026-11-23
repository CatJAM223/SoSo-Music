'use strict';

const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { statFile } = require('@electron/asar');
const { readVersion, assertArchiveVersion } = require('./version.cjs');

const root = path.resolve(__dirname, '../..');
const release = path.join(root, 'release');

async function build() {
  if (process.platform !== 'linux' || process.arch !== 'x64') {
    throw new Error('Run the Linux x64 build on an x64 Linux host or in WSL.');
  }

  const options = { cwd: root, stdio: 'inherit' };
  execFileSync('npm', ['run', 'build:renderer'], options);
  execFileSync('npm', ['run', 'build:rooms'], options);
  execFileSync(
    process.execPath,
    [require.resolve('electron-builder/cli.js'), '--linux', '--x64', '--publish', 'never'],
    options,
  );

  const { version, linuxDeb, linuxAppImage } = readVersion(root);
  const resources = path.join(release, 'linux-unpacked', 'resources');
  const archive = path.join(resources, 'app.asar');
  assertArchiveVersion(archive, version);
  statFile(archive, 'dist/compute/soso-core.wasm');
  statFile(archive, 'node_modules/sql.js/dist/sql-wasm.wasm');
  fs.accessSync(path.join(resources, 'native', 'soso-rooms'), fs.constants.X_OK);

  for (const file of [linuxDeb, linuxAppImage]) {
    const artifact = path.join(release, file);
    const hash = createHash('sha256');
    for await (const chunk of fs.createReadStream(artifact)) hash.update(chunk);
    fs.writeFileSync(artifact + '.sha256', hash.digest('hex') + '  ' + file + '\n');
    console.log('Linux package: ' + artifact);
  }
}

build().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
