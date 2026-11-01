import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { restrictedIpc } from '../src/desktop/main/ipc/restrictedIpc.ts';
import { WaveBatchRequestRegistry } from '../src/desktop/main/services/waveBatchRequestRegistry.ts';
import { validateWaveContext, validateWaveSeeds } from '../src/desktop/main/ipc/waveInput.ts';
import { createWaveRefreshPolicy } from '../src/shared/services/waveRefreshPolicy.ts';
import { LibraryTasteService } from '../src/desktop/main/services/libraryTaste.ts';
import { waveMusicProfile } from '../src/shared/utils/waveMusicProfile.ts';
import { sequenceWaveTracks } from '../src/shared/utils/waveQueue.ts';

test('All privileged IPC handlers reject secondary windows and child frames before side effects', () => {
  const handlers = new Map(),
    events = new Map();
  let writes = 0;
  const contents = { mainFrame: {} };
  const main = { isDestroyed: () => false, webContents: contents };
  const bridge = restrictedIpc(
    { handle: (key, fn) => handlers.set(key, fn), on: (key, fn) => events.set(key, fn) },
    () => main,
    () => false,
  );
  for (const channel of [
    'db:deletePlaylist',
    'music:getWaveBatch',
    'app:applyZapret',
    'db:exportDatabase',
  ]) {
    bridge.handle(channel, () => ++writes);
    assert.throws(() => handlers.get(channel)({ sender: {}, senderFrame: {} }), /main application/);
    assert.throws(
      () => handlers.get(channel)({ sender: contents, senderFrame: {} }),
      /main application/,
    );
    handlers.get(channel)({ sender: contents, senderFrame: contents.mainFrame });
  }
  assert.equal(writes, 4);
  bridge.on('logger:logPlaybackEvent', () => ++writes);
  events.get('logger:logPlaybackEvent')({ sender: {} });
  assert.equal(writes, 4);
});

test('Legacy requests share the eight-operation budget and are aborted when the sender closes', () => {
  const owner = new EventEmitter(),
    registry = new WaveBatchRequestRegistry();
  const operations = Array.from({ length: 8 }, () => registry.begin(owner));
  assert.throws(() => registry.begin(owner), /Too many/);
  operations[0].finish();
  const replacement = registry.begin(owner);
  owner.emit('destroyed');
  assert.ok(replacement.signal.aborted);
  assert.ok(operations.slice(1).every((op) => op.signal.aborted));
  operations.forEach((op) => op.finish());
  replacement.finish();
  assert.equal(owner.listenerCount('destroyed'), 0);
});

test('Malformed and oversized context is rejected before processing', () => {
  for (const context of [
    null,
    [],
    { learnedTracks: {} },
    { tasteTracks: Array(55).fill({}) },
    { artistFeedback: Array(10) },
    {
      artistFeedback: Object.fromEntries(Array.from({ length: 101 }, (_, i) => ['artist' + i, 1])),
    },
  ])
    assert.throws(() => validateWaveContext(context), /Invalid wave/);
  assert.throws(() => validateWaveSeeds([{ title: 'x'.repeat(100000) }]), /Invalid wave/);
  assert.throws(() => validateWaveSeeds([null]), /Invalid wave/);
  validateWaveContext({ learnedTracks: [{ id: 'a', title: 'Song', artist: { name: 'Artist' } }] });
});

test('Navigation before half a second does not redirect discovery or consume skip evidence', () => {
  const policy = createWaveRefreshPolicy();
  for (let i = 0; i < 30; i++)
    assert.equal(policy.observe(String(i), i % 2 ? 0 : 0.49, 180, 'skip'), false);
  assert.equal(policy.observe('heard-a', 1, 180, 'skip'), false);
  assert.equal(policy.observe('heard-b', 1, 180, 'skip'), false);
  assert.equal(policy.observe('heard-c', 1, 180, 'skip'), true);
});

test('Artist fallback cannot neutralize the track own musical evidence', () => {
  const service = new LibraryTasteService(
    () => null,
    () => {},
  );
  service.store.snapshot = () => ({
    entries: new Map([['artist:fixture band', { genres: ['metal'] }]]),
  });
  const value = {
    id: '1',
    title: 'Quiet',
    artist: { name: 'Fixture Band' },
    genre: 'ambient',
    tags: [],
  };
  const [result] = service.enrichCached([value]);
  assert.equal(waveMusicProfile(result).energy, -1);
  assert.deepEqual(result.tags, []);
});
