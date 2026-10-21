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
const sevenZip = process.argv.includes('--7z');
if (process.platform !== 'win32') throw new Error('Windows packaging requires Windows and tar.exe.');
assertArchiveVersion(path.join(packed, 'resources/app.asar'), info.version);
if (!fs.statSync(path.join(packed, 'SoSo Music.exe')).isFile()) throw new Error('Нет исполняемого файла сборки.');
const archiveName = sevenZip ? info.windows7z : info.windowsZip;
const target = path.join(release, archiveName);
if (fs.existsSync(target) || fs.existsSync(target + '.sha256')) throw new Error('Архив уже существует: ' + target + '. Сохраните его отдельно или измените номер версии.');
const temporary = path.join(release, '.soso-' + crypto.randomUUID() + (sevenZip ? '.7z' : '.zip'));
const installed7z = path.join(process.env.ProgramFiles || "C:\\Program Files", '7-Zip', '7z.exe');
const archiver = fs.existsSync(installed7z) ? installed7z : require('7zip-bin').path7za;
(async () => {
  let published = false;
  try {
    const result = sevenZip
      ? spawnSync(archiver, ['a', '-t7z', '-mx=5', '-md=32m', '-mmt=2', temporary, 'win-unpacked'],
          { cwd: release, stdio: 'inherit', windowsHide: true })
      : spawnSync('tar.exe', ['-a', '-c', '-f', temporary, '-C', release, 'win-unpacked'],
          { cwd: root, stdio: 'inherit', windowsHide: true });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error('Не удалось упаковать сборку: ' + result.status);
    const checked = spawnSync(archiver, ['t', temporary],
      { cwd: root, stdio: 'inherit', windowsHide: true });
    if (checked.error) throw checked.error;
    if (checked.status !== 0) throw new Error('Проверка архива не пройдена: ' + checked.status);
    const hash = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(temporary)) hash.update(chunk);
    const checksum = hash.digest('hex');
    // Exclusive publication preserves an archive created by another packaging process.
    await fs.promises.link(temporary, target);
    published = true;
    await fs.promises.writeFile(target + '.sha256', checksum + '  ' + archiveName + '\n', { flag: 'wx' });
    console.log('Release archive: ' + target);
    console.log('SHA-256: ' + checksum);
  } catch (error) {
    // Roll back only our own archive if checksum publication fails.
    if (published) await fs.promises.rm(target, { force: true });
    throw error;
  } finally { await fs.promises.rm(temporary, { force: true }); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
