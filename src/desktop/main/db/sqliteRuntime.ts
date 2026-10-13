import initSqlJs from 'sql.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export async function loadSqliteRuntime(appPath: string) {
  const directory =
    typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url));
  const resources = process.resourcesPath || '';
  const candidates = [
    path.join(directory, '../node_modules/sql.js/dist/sql-wasm.wasm'),
    path.join(directory, 'sql-wasm.wasm'),
    path.join(resources, 'sql-wasm.wasm'),
    path.join(resources, 'node_modules/sql.js/dist/sql-wasm.wasm'),
    path.join(appPath, 'node_modules/sql.js/dist/sql-wasm.wasm'),
    path.join(process.cwd(), 'node_modules/sql.js/dist/sql-wasm.wasm'),
  ];
  const binary = candidates.find((candidate) => fs.existsSync(candidate));
  return initSqlJs({ locateFile: (filename) => binary || filename });
}
