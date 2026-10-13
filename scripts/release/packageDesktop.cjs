'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { readVersion, assertArchiveVersion } = require('./version.cjs');
const root = path.resolve(__dirname, '../..');
const release = path.join(root, 'release');
const info = readVersion(root);
const packed = path.join(release, 'win-unpacked');
if (process.platform !== 'win32') throw new Error('Windows packaging requires Windows and tar.exe.');
assertArchiveVersion(path.join(packed, 'resources/app.asar'), info.version);
if (!fs.statSync(path.join(packed, 'SoSo Music.exe')).isFile()) throw new Error('Нет исполняемого файла сборки.');
const target = path.join(release, info.windowsZip);
if (fs.existsSync(target) || fs.existsSync(target + '.sha256')) throw new Error('Архив уже существует: ' + target + '. Сохраните его отдельно или измените номер версии.');
const temporary = path.join(release, '.soso-' + crypto.randomUUID() + '.zip');
(async () => {
  let published = false;
  try {
    const result = spawnSync('tar.exe', ['-a', '-c', '-f', temporary, '-C', release, 'win-unpacked'],
      { cwd: root, stdio: 'inherit', windowsHide: true });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error('Не удалось упаковать сборку: ' + result.status);
    const hash = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(temporary)) hash.update(chunk);
    const checksum = hash.digest('hex');
    // Exclusive publication preserves an archive created by another packaging process.
    await fs.promises.link(temporary, target);
    published = true;
    await fs.promises.writeFile(target + '.sha256', checksum + '  ' + info.windowsZip + '\n', { flag: 'wx' });
    console.log('Release archive: ' + target);
    console.log('SHA-256: ' + checksum);
  } catch (error) {
    // Roll back only our own archive if checksum publication fails.
    if (published) await fs.promises.rm(target, { force: true });
    throw error;
  } finally { await fs.promises.rm(temporary, { force: true }); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
