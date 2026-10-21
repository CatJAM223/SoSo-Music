'use strict';
const fs = require('node:fs');
const path = require('node:path');
function versionInfo(version) {
  if (typeof version !== 'string' || !/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(version)) {
    throw new Error('Версия должна иметь формат MAJOR.MINOR.PATCH.');
  }
  const [major, minor, patch] = version.split('.').map(Number);
  const code = major * 1000000 + minor * 1000 + patch;
  if (!Number.isSafeInteger(code) || minor >= 1000 || patch >= 1000 || code < 1 || code > 2100000000) {
    throw new Error('Версия выходит за поддерживаемый диапазон.');
  }
  return {
    version,
    windowsZip: 'SoSo-Music-' + version + '-windows-x64.zip',
    windows7z: 'SoSo-Music-' + version + '-windows-x64.7z',
  };
}
function readVersion(root) {
  return versionInfo(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version);
}
function assertArchiveVersion(archive, expected) {
  // Inspect the actual packed application, not the folder name or the source version.
  const asar = require('@electron/asar');
  const packaged = JSON.parse(asar.extractFile(archive, 'package.json').toString('utf8'));
  if (packaged.version !== expected) {
    throw new Error('В app.asar версия ' + packaged.version + ', а в проекте ' + expected + '. Сначала выполните npm run build.');
  }
}
module.exports = { versionInfo, readVersion, assertArchiveVersion };
