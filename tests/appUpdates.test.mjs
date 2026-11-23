import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppUpdateChecker } from '../src/desktop/main/services/appUpdates.ts';
import { PROJECT_RELEASES_API, PROJECT_REPOSITORY } from '../src/shared/utils/projectRepository.ts';
const response = (body, status = 200) => new Response(JSON.stringify(body), { status });
const release = (tag_name, extra = {}) => ({ tag_name, draft: false, prerelease: false, ...extra });
test('The Rust release decision reaches the update checker over the production adapter', async () => {
  const statusFor = async (tag) =>
    createAppUpdateChecker('3.9.0', async () => response(release(tag)))();
  assert.equal((await statusFor('v3.10.0')).status, 'available');
  assert.equal((await statusFor('3.9.0')).status, 'up-to-date');
  assert.equal((await statusFor('2.9.6')).status, 'up-to-date');
  assert.equal((await statusFor('v3.10.0-beta')).status, 'error');
  assert.equal((await statusFor('3.9.0/../../evil')).status, 'error');
});
test('A release notice uses the Rust-parsed summary, while legacy releases keep their link', async () => {
  const statusFor = async (body) =>
    createAppUpdateChecker('3.9.0', async () => response(release('v3.10.0', { body })))();
  const status = await statusFor(
    '## Главное\r\n\r\nМеньше повторов в рекомендациях.\r\n- **Режимы отличаются.**\r\n- Дневная пятёрка помнит показы.\r\n## Скачать\r\n- Выберите ZIP.',
  );
  assert.deepEqual(status.releaseHighlights, {
    summary: 'Меньше повторов в рекомендациях.',
    changes: ['Режимы отличаются.', 'Дневная пятёрка помнит показы.'],
  });
  const legacy = await statusFor('## Исправления\n- Другое описание');
  assert.equal(legacy.releaseHighlights, undefined);
  assert.equal(legacy.releaseUrl, status.releaseUrl);
});
test('Update checker reads only the configured GitHub repository and constructs the release URL', async () => {
  const requests = [];
  const check = createAppUpdateChecker('3.0.0', async (url, init) => {
    requests.push({ url, init });
    return response(release('v3.1.0', { html_url: 'https://evil.test' }));
  });
  const result = await check();
  assert.equal(result.status, 'available');
  assert.equal(result.releaseUrl, PROJECT_REPOSITORY + '/releases/tag/v3.1.0');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, PROJECT_RELEASES_API);
  assert.ok(requests[0].init.signal);
  assert.ok(!requests[0].init.headers.Authorization);
});
test('Same and older release versions are current, while draft/prerelease responses are excluded', async () => {
  for (const tag of ['v3.0.0', 'v2.9.6'])
    assert.equal(
      (await createAppUpdateChecker('3.0.0', async () => response(release(tag)))()).status,
      'up-to-date',
    );
  for (const flags of [{ draft: true }, { prerelease: true }])
    assert.equal(
      (await createAppUpdateChecker('3.0.0', async () => response(release('v3.1.0', flags)))())
        .status,
      'no-release',
    );
});
test('An empty repository differs from an inaccessible repository and network/API failures', async () => {
  const check = (accessible) =>
    createAppUpdateChecker('3.0.0', async (url) =>
      url === PROJECT_RELEASES_API ? response({}, 404) : response({}, accessible ? 200 : 404),
    );
  assert.equal((await check(true)()).status, 'no-release');
  assert.equal((await check(false)()).status, 'error');
  for (const status of [403, 429, 500])
    assert.equal(
      (await createAppUpdateChecker('3.0.0', async () => response({}, status))()).status,
      'error',
    );
  assert.equal(
    (
      await createAppUpdateChecker('3.0.0', async () => {
        throw Error('connection failed');
      })()
    ).status,
    'error',
  );
});
test('Concurrent checks share a request; a later failure cannot return an old available release', async () => {
  let resolve,
    calls = 0;
  const check = createAppUpdateChecker('3.0.0', async () => {
    calls++;
    if (calls === 1) return new Promise((done) => (resolve = done));
    throw Error('offline');
  });
  const first = check(),
    second = check();
  assert.equal(first, second);
  resolve(response(release('v3.1.0')));
  assert.equal((await first).status, 'available');
  assert.equal((await check()).status, 'error');
  assert.equal(calls, 2);
});
