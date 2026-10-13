import test from 'node:test';
import assert from 'node:assert/strict';
import {
  recoverPlayerStream,
  resolvePlayerStream,
} from '../src/shared/services/playerStreamResolution.ts';

const track = {
  id: 'sc_fixture',
  title: 'Fixture',
  artist: 'Artist',
  source: 'soundcloud',
  preview: 'https://test.invalid/preview.mp3',
};

test('stream requests normalize artist metadata, preserve format options and release their abort deadline', async () => {
  const controller = new AbortController();
  let request;
  const options = {
    forceRefresh: true,
    allowSessionRecovery: true,
    preferAlternateFormat: true,
    excludeItag: 140,
  };
  const pending = resolvePlayerStream(track, options, controller.signal, (item, settings) => {
    request = { item, settings };
    return new Promise(() => {});
  });
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.deepEqual(request.item.artist, { name: 'Artist' });
  assert.equal(request.item.id, track.id);
  assert.deepEqual(request.settings, options);
  assert.equal(track.artist, 'Artist');
});

test('recovery permits preview only explicitly and never lets a stale response or failure change playback', async () => {
  for (const outcome of ['full', 'preview', 'unavailable', 'stale-success', 'stale-failure']) {
    const events = [],
      current = !outcome.startsWith('stale');
    await recoverPlayerStream(
      {
        track,
        options: {},
        signal: new AbortController().signal,
        allowPreview: outcome === 'preview',
      },
      {
        resolve: async () => {
          if (outcome === 'stale-failure') throw new Error('Old failure');
          return outcome === 'full' ? 'https://test.invalid/full.mp3' : '';
        },
        isCurrent: () => current,
        isPlayable: (url) => Boolean(url),
        resolved: () => events.push('resolved'),
        load: (url) => events.push(['load', url]),
        preview: (url) => events.push(['preview', url]),
        unavailable: () => events.push('unavailable'),
        failed: (error) => events.push(error.message),
      },
    );
    assert.deepEqual(
      events,
      outcome === 'full'
        ? ['resolved', ['load', 'https://test.invalid/full.mp3']]
        : outcome === 'preview'
          ? ['resolved', ['preview', track.preview]]
          : outcome === 'unavailable'
            ? ['resolved', 'unavailable']
            : [],
    );
  }
});
