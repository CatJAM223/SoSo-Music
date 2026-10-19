import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { LanSyncServer } from '../src/desktop/main/services/lanSyncServer.ts';

function fixture(t) {
  const original = http.createServer;
  const servers = [];
  t.mock.method(http, 'createServer', (...args) => {
    const server = original(...args);
    const listen = server.listen.bind(server);
    server.listen = (options, callback) => listen({ ...options, host: '127.0.0.1' }, callback);
    servers.push(server);
    return server;
  });
  const sync = new LanSyncServer({
    exportData: () => ({ success: true, payload: { app: 'fixture' } }),
  });
  t.after(() => {
    sync.stop();
    for (const server of servers) {
      server.closeAllConnections();
      server.close();
    }
  });
  return { sync, servers };
}

test('Concurrent LAN starts share one listener and stop closes it', async (t) => {
  const { sync, servers } = fixture(t);
  const first = sync.start();
  const second = sync.start();
  assert.equal(first, second);
  const [a, b] = await Promise.all([first, second]);
  assert.ok(a.active);
  assert.equal(a.port, b.port);
  assert.equal(a.code, b.code);
  assert.equal(servers.length, 1);
  const response = await fetch(`http://127.0.0.1:${a.port}/library`, {
    headers: { Authorization: `Bearer ${a.code}` },
  });
  assert.equal(response.status, 200);
  await response.text();
  const closed = once(servers[0], 'close');
  assert.equal(sync.stop().active, false);
  await closed;
  assert.equal(servers[0].listening, false);
  await assert.rejects(fetch(`http://127.0.0.1:${a.port}/library`));
});

test('Stop cancels an unfinished start and an immediate restart remains independent', async (t) => {
  const { sync, servers } = fixture(t);
  const first = sync.start();
  const shared = sync.start();
  sync.stop();
  const next = sync.start();
  assert.equal((await first).active, false);
  assert.equal((await shared).active, false);
  const restarted = await next;
  assert.ok(restarted.active);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(servers[0].listening, false);
  assert.equal(servers[1].listening, true);
  assert.equal(sync.status().port, restarted.port);
});

test('Repeated canceled starts leave no listening servers', async (t) => {
  const { sync, servers } = fixture(t);
  for (let i = 0; i < 12; i++) {
    const pending = sync.start();
    sync.stop();
    assert.equal((await pending).active, false);
  }
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(servers.filter((server) => server.listening).length, 0);
  assert.equal(sync.status().active, false);
});
