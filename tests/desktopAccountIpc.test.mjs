import test from 'node:test';
import assert from 'node:assert/strict';
import { registerYouTubeAccountHandlers } from '../src/desktop/main/ipc/youtubeAccountHandlers.ts';
import { registerMainWindowHandlers } from '../src/desktop/main/ipc/mainWindowHandlers.ts';
function fixture() {
  const handlers = new Map();
  let destroyed = false;
  const calls = [];
  const frame = {};
  const contents = { mainFrame: frame };
  const win = { webContents: contents, isDestroyed: () => destroyed };
  const ipc = {
    handle(channel, handler) {
      if (handlers.has(channel)) throw new Error('Already registered');
      handlers.set(channel, handler);
    },
    removeHandler(channel) {
      handlers.delete(channel);
    },
  };
  const status = { connected: false, loginOpen: false };
  const account = Object.fromEntries(
    ['status', 'connect', 'refresh', 'importSession', 'disconnect'].map((action) => [
      action,
      async () => {
        calls.push(action);
        return status;
      },
    ]),
  );
  return {
    handlers,
    ipc,
    account,
    win,
    calls,
    status,
    event: { sender: contents, senderFrame: frame },
    destroy() {
      destroyed = true;
    },
  };
}
test('Account IPC invokes the intended service command for the main frame and cleans up registrations', async () => {
  const f = fixture();
  const dispose = registerYouTubeAccountHandlers(f.ipc, () => f.win, f.account);
  const channels = [
    'youtube:accountStatus',
    'youtube:connectAccount',
    'youtube:refreshSession',
    'youtube:importSession',
    'youtube:disconnectAccount',
  ];
  for (const channel of channels)
    assert.deepEqual(await f.handlers.get(channel)(f.event), f.status);
  assert.deepEqual(f.calls, ['status', 'connect', 'refresh', 'importSession', 'disconnect']);
  dispose();
  assert.equal(f.handlers.size, 0);
});
test('Account IPC rejects other windows, child frames and destroyed windows without invoking privileged services', () => {
  const f = fixture();
  registerYouTubeAccountHandlers(f.ipc, () => f.win, f.account);
  const connect = f.handlers.get('youtube:connectAccount');
  assert.throws(() => connect({ ...f.event, sender: {} }), /main application window/);
  assert.throws(() => connect({ ...f.event, senderFrame: {} }), /main application window/);
  f.destroy();
  assert.throws(() => connect(f.event), /main application window/);
  assert.equal(f.calls.length, 0);
});
test('Partial IPC registration failure restores previously registered handlers and preserves existing commands', () => {
  const f = fixture();
  const existing = () => 42;
  f.handlers.set('already', existing);
  assert.throws(
    () => registerMainWindowHandlers(f.ipc, () => f.win, { first: () => 1, already: () => 2 }),
    /Already registered/,
  );
  assert.equal(f.handlers.size, 1);
  assert.equal(f.handlers.get('already'), existing);
});
