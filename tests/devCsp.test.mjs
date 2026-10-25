import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { devCspHashes } from '../scripts/desktop/devCsp.mts';

test('Development HTML authorizes the actual React Refresh preamble by hash without unsafe-inline', async () => {
  const server = await createServer({
    configFile: false,
    plugins: [react(), devCspHashes()],
    // HTML transforms need neither dependency crawling nor a filesystem watcher.
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, watch: null },
    appType: 'custom',
  });
  try {
    const html = await server.transformIndexHtml(
      '/',
      fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8'),
    );
    const policy = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/i)[1];
    const scripts = policy.match(/(?:^|;)\s*script-src\s+([^;]+)/)[1].split(/\s+/);
    assert.ok(!scripts.includes("'unsafe-inline'"));
    let preambles = 0;
    for (const [, attributes, body] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      if (/\bsrc\s*=/.test(attributes) || !body.trim()) continue;
      preambles++;
      const expected = "'sha256-" + createHash('sha256').update(body).digest('base64') + "'";
      assert.ok(scripts.includes(expected), 'Exact inline preamble must be allowed by its hash');
    }
    assert.ok(preambles > 0, 'Exercise the real React plugin preamble');
  } finally {
    await server.close();
  }
});
