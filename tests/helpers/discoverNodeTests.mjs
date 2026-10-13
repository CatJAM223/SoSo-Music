import { readdir } from 'node:fs/promises';
import path from 'node:path';
const legacy = new Set([
  'bandcampAndLastFmTests.mjs',
  'stressTestHardcore.mjs',
  'youtubeAndLoggingTests.mjs',
]);
export async function discoverNodeTests(directory) {
  const files = [];
  async function visit(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name);
      if (entry.isDirectory() && !['helpers', 'fixtures', 'node_modules'].includes(entry.name))
        await visit(file);
      else if (entry.isFile() && (entry.name.endsWith('.test.mjs') || legacy.has(entry.name)))
        files.push(file);
    }
  }
  await visit(directory);
  return files.sort();
}
