import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { check } = require('../scripts/architecture/checkBoundaries.cjs');
test('Architecture parses actual imports, re-exports and dynamic imports across platform boundaries', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'soso-boundary-fixture-'));
  try {
    const sources = {
      'src/desktop/main/service.ts': 'export const service=1;',
      'src/mobile/service.ts': 'export const service=1;',
      'src/desktop/main/bad.ts': "import '../../mobile/service';",
      'src/shared/utils/bad.ts': "export * from '../../desktop/main/service';",
      'src/shared/utils/dynamic.ts': "export const load=()=>import('../../mobile/service');",
      'src/shared/utils/node.ts': "const fs=require('fs');",
      'src/shared/utils/alias.ts': "import '@/desktop/main/service';",
      'src/shared/utils/types.ts': "import type { Service } from '../../desktop/main/service';",
      'src/shared/bridge/platformBridge.ts': "import '../../mobile/service';",
    };
    for (const [file, contents] of Object.entries(sources)) {
      const target = path.join(root, file);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, contents);
    }
    const report = check(root);
    assert.equal(report.issues.length, 6);
    assert.deepEqual(report.issues.map((issue) => issue.from).sort(), [
      'src/desktop/main/bad.ts',
      'src/shared/bridge/platformBridge.ts',
      'src/shared/utils/alias.ts',
      'src/shared/utils/bad.ts',
      'src/shared/utils/dynamic.ts',
      'src/shared/utils/node.ts',
    ]);
  } finally {
    assert.equal(path.dirname(root), os.tmpdir());
    assert.ok(path.basename(root).startsWith('soso-boundary-fixture-'));
    await fs.rm(root, { recursive: true, force: true });
  }
});
