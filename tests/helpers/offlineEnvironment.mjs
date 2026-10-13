import { after } from 'node:test';
import assert from 'node:assert/strict';

// Provider tests must supply fixtures. Only local integration servers may use real fetch.
const originalFetch = globalThis.fetch;
const unexpectedRequests = [];
globalThis.fetch = (input, options) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (
    ['blob:', 'data:'].includes(url.protocol) ||
    ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  )
    return originalFetch(input, options);
  unexpectedRequests.push(url.origin + url.pathname); // Never retain query tokens or credentials.
  return Promise.reject(
    new Error('External network request in offline tests: mock the provider transport'),
  );
};
after(() =>
  assert.deepEqual(
    unexpectedRequests,
    [],
    'Tests must not silently depend on a live external provider',
  ),
);
