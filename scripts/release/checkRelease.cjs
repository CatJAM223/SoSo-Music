'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { readVersion } = require('./version.cjs');
const root = path.resolve(__dirname, '../..');
const info = readVersion(root);
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
if (lock.version !== info.version || lock.packages?.['']?.version !== info.version) {
  throw new Error(
    'package-lock.json расходится с package.json. Используйте npm run release:version -- X.Y.Z.',
  );
}
const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
if (!changelog.split(/\r?\n/).some((line) => line.startsWith('### [' + info.version + ']'))) {
  throw new Error('Добавьте запись для версии ' + info.version + ' в CHANGELOG.md.');
}
for (const file of ['README.md', 'README.ru.md', 'CHANGELOG.md', 'LICENSE', 'USAGE_NOTICE.txt']) {
  if (!fs.statSync(path.join(root, file)).isFile()) throw new Error('Отсутствует ' + file);
}
console.log('Release metadata OK: ' + info.version);
console.log('Windows: ' + info.windowsZip);
console.log('This verifies release metadata, not publication or playback on a device.');
