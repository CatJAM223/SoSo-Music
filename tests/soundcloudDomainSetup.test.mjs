import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';

test('Domain setup detects an old two-domain list and adds the current CDN once while preserving a backup', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'soso-domain-setup-'));
  try {
    const file = path.join(directory, 'list-general.txt');
    const original = 'example.com\r\nsoundcloud.com\r\nsndcdn.com\r\n';
    fs.writeFileSync(file, original);
    const raw = fs.readFileSync(
      new URL('../src/desktop/main/services/zapretService.ts', import.meta.url),
      'utf8',
    );
    const source = stripTypeScriptTypes(raw)
      .replace(/^import[\s\S]*?;\s*/gm, '')
      .replace('export class', 'class');
    const service = vm.runInNewContext(source + '\nZapretService', { fs, path, console });
    assert.equal(service.inspectFile(file).hasSoundcloudCloud, false);
    service.cachedPath = file;
    assert.equal((await service.addDomainsToList()).success, true);
    assert.equal(service.inspectFile(file).hasSoundcloudCloud, true);
    assert.equal(fs.readFileSync(file + '.soso.bak', 'utf8'), original);
    await service.addDomainsToList();
    const content = fs.readFileSync(file, 'utf8');
    assert.equal(content.split('soundcloud.cloud').length - 1, 1);
    assert.equal(content, original + 'soundcloud.cloud\r\n');
  } finally {
    assert.equal(path.dirname(directory), os.tmpdir());
    assert.ok(path.basename(directory).startsWith('soso-domain-setup-'));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
