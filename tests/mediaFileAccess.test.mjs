import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  MediaFileAccess,
  createMediaHandler,
} from '../src/desktop/main/services/mediaFileAccess.ts';

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'soso-media-access-'));
  t.after(() => {
    assert.equal(path.dirname(directory), os.tmpdir());
    assert.ok(path.basename(directory).startsWith('soso-media-access-'));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const image = path.join(directory, 'wallpaper #1.png');
  const secret = path.join(directory, 'private.txt');
  fs.writeFileSync(image, 'image fixture');
  fs.writeFileSync(secret, 'private fixture');
  const access = new MediaFileAccess(directory);
  return { directory, image, secret, access };
}

test('Media permissions reject arbitrary paths and survive restart only for the selected file', (t) => {
  const { directory, image, secret, access } = fixture(t);
  assert.equal(access.resolve('media://local/' + secret.replaceAll('\\', '/')), null);
  assert.throws(() => access.select(secret), /supported image or video/);
  const url = access.select(image);
  assert.ok(!url.includes(directory));
  assert.equal(access.resolve(url), fs.realpathSync(image));
  const restored = new MediaFileAccess(directory);
  assert.equal(restored.resolve(url), fs.realpathSync(image));
  for (const bad of [
    url + '?path=' + encodeURIComponent(secret),
    url + '#fragment',
    url.replace('media://local/', 'media://attacker/'),
    url.replace(/\/[^/]+$/, '/private.txt'),
    'media://local/?path=' + encodeURIComponent(secret),
    'media://local/C:/Windows/win.ini',
    'media://c/Windows/win.ini',
    'file://' + secret,
  ])
    assert.equal(restored.resolve(bad), null, bad);
  const next = access.select(image);
  assert.notEqual(next, url);
  assert.equal(access.resolve(url), null, 'new selection revokes previous capability');
  fs.unlinkSync(image);
  assert.equal(access.resolve(next), null, 'missing files are unavailable');
});

test('Invalid persisted permissions fail closed', (t) => {
  const { directory, image } = fixture(t);
  const filename = path.join(directory, 'wallpaper-access.json');
  for (const content of [
    '{',
    JSON.stringify({ version: 1, id: '../escape', filePath: image }),
    JSON.stringify({ version: 2, id: 'a'.repeat(36), filePath: image }),
  ]) {
    fs.writeFileSync(filename, content);
    assert.equal(new MediaFileAccess(directory).resolve('media://local/' + image), null);
  }
});

test('Media handler serves actual file ranges and HEAD, denying arbitrary paths and foreign origins', async (t) => {
  const { access, image, secret } = fixture(t);
  const url = access.select(image);
  const handler = createMediaHandler(access, 'http://localhost:5173');
  const denied = await handler(new Request('media://local/?path=' + encodeURIComponent(secret)));
  assert.equal(denied.status, 404);
  assert.ok(!(await denied.text()).includes('private fixture'));
  assert.equal((await handler(new Request(url, { method: 'POST' }))).status, 405);
  assert.equal(
    (await handler(new Request(url, { headers: { Origin: 'https://foreign.invalid' } }))).status,
    403,
  );
  const response = await handler(
    new Request(url, { headers: { Origin: 'null', Range: 'bytes=0-2' } }),
  );
  assert.equal(response.status, 206);
  assert.equal(await response.text(), 'ima');
  assert.equal(response.headers.get('Content-Range'), 'bytes 0-2/13');
  assert.equal(response.headers.get('Content-Length'), '3');
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'null');
  const head = await handler(
    new Request(url, { method: 'HEAD', headers: { Origin: 'http://localhost:5173' } }),
  );
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('Access-Control-Allow-Origin'), 'http://localhost:5173');
  assert.equal(head.headers.get('Content-Length'), '13');
  assert.equal(await head.text(), '');
  assert.equal(await (await handler(new Request(url))).text(), 'image fixture');
});

test('Media ranges support suffixes, open ends and bounds, rejecting invalid intervals', async (t) => {
  const { access, image } = fixture(t);
  const url = access.select(image),
    handler = createMediaHandler(access);
  for (const [range, expected] of [
    ['bytes=-7', 'fixture'],
    ['bytes=6-', 'fixture'],
    ['bytes=6-100', 'fixture'],
  ]) {
    const response = await handler(new Request(url, { headers: { Range: range } }));
    assert.equal(response.status, 206, range);
    assert.equal(await response.text(), expected);
  }
  for (const range of [
    'bytes=13-',
    'bytes=5-3',
    'bytes=-0',
    'bytes=-',
    'bytes=0-1,3-4',
    'bytes=invalid',
    'bytes=99999999999999999999-',
  ]) {
    const response = await handler(new Request(url, { headers: { Range: range } }));
    assert.equal(response.status, 416, range);
    assert.equal(response.headers.get('Content-Range'), 'bytes */13');
  }
  fs.writeFileSync(image, '');
  assert.equal(await (await handler(new Request(url))).text(), '');
  assert.equal((await handler(new Request(url, { headers: { Range: 'bytes=0-' } }))).status, 416);
});
