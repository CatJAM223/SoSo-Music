import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

test('manual Electron fetch supplies valid credentials without inventing a request origin', async () => {
  const seen = [];
  const net = {
    request(options) {
      if (options.credentials === 'same-origin' && !options.origin) throw Error('origin required');
      seen.push(options);
      const request = new EventEmitter();
      request.setHeader = () => {};
      request.abort = () => request.emit('close');
      request.end = () =>
        queueMicrotask(() => request.emit('redirect', 302, 'GET', 'https://cdn.example/next', {}));
      return request;
    },
  };
  const source = stripTypeScriptTypes(
    readFileSync(new URL('../src/desktop/main/services/electronFetch.ts', import.meta.url), 'utf8'),
  )
    .replace(/^import .*;$/gm, '')
    .replace('export async function', 'async function');
  const fetcher = vm.runInNewContext(source + ';electronFetch', {
    net,
    Request,
    Response,
    Headers,
    Buffer,
  });
  await fetcher('https://cdn.example/audio', { redirect: 'manual' });
  await fetcher('https://cdn.example/audio', {
    redirect: 'manual',
    headers: { Origin: 'https://source.example' },
  });
  await fetcher('https://cdn.example/audio', { redirect: 'manual', credentials: 'include' });
  await fetcher('https://cdn.example/audio', { redirect: 'manual', credentials: 'omit' });
  assert.deepEqual(
    seen.map((row) => row.credentials),
    ['omit', 'same-origin', 'include', 'omit'],
  );
  assert.equal(seen[0].origin, undefined);
  assert.equal(seen[1].origin, 'https://source.example');
});
