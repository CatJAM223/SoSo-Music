import test from 'node:test';
import assert from 'node:assert/strict';
import { subscribePlaylistUpdates } from '../src/shared/utils/playlistEvents.ts';

test('Playlist subscriptions handle both update channels and detach on cleanup', (context) => {
  const originalWindow = globalThis.window;
  globalThis.window = new EventTarget();
  context.after(() => {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  });
  let updates = 0;
  const unsubscribe = subscribePlaylistUpdates(() => updates++);
  window.dispatchEvent(new Event('soso:playlists-updated'));
  window.dispatchEvent(new Event('storage'));
  assert.equal(updates, 2);
  unsubscribe();
  window.dispatchEvent(new Event('soso:playlists-updated'));
  window.dispatchEvent(new Event('storage'));
  assert.equal(updates, 2);
});
