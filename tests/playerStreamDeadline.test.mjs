import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePlayerStream } from '../src/shared/services/playerStreamResolution.ts';
import { StreamResolveTimeoutError } from '../src/shared/utils/streamResolveDeadline.ts';
const track = { id: 'sc_1', title: 'Fixture', artist: { name: 'Artist' }, source: 'soundcloud' };

test('an empty cached lookup has one fresh retry while preserving the requested recording/options', async () => {
  const calls = [];
  const result = await resolvePlayerStream(
    track,
    { allowSessionRecovery: true },
    new AbortController().signal,
    async (item, options) => {
      calls.push({ item, options });
      return calls.length === 1 ? '' : 'https://fixture.invalid/audio.mp3';
    },
  );
  assert.equal(result, 'https://fixture.invalid/audio.mp3');
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call.item.id === track.id && call.options.allowSessionRecovery));
  assert.equal(calls[1].options.forceRefresh, true);
  let freshCalls = 0;
  assert.equal(
    await resolvePlayerStream(
      track,
      { forceRefresh: true },
      new AbortController().signal,
      async () => {
        freshCalls++;
        return '';
      },
    ),
    '',
  );
  assert.equal(freshCalls, 1);
});

test('a late empty answer after the whole lookup deadline cannot launch fresh provider work', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let finish,
    calls = 0;
  const pending = resolvePlayerStream(track, {}, new AbortController().signal, () => {
    calls++;
    return new Promise((resolve) => (finish = resolve));
  });
  const rejected = assert.rejects(pending, StreamResolveTimeoutError);
  t.mock.timers.tick(30000);
  await rejected;
  finish('');
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(calls, 1);
});

test('access errors and cancelled selections do not receive an empty-answer retry', async () => {
  let calls = 0;
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    resolvePlayerStream(track, {}, controller.signal, async () => {
      calls++;
      return '';
    }),
    (error) => error.name === 'AbortError',
  );
  assert.equal(calls, 0);
  await assert.rejects(
    resolvePlayerStream(track, {}, new AbortController().signal, async () => {
      calls++;
      throw new Error('YOUTUBE_AUDIO_LOGIN_REQUIRED');
    }),
    /LOGIN_REQUIRED/,
  );
  assert.equal(calls, 1);
});
