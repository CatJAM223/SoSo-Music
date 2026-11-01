import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import net from 'node:net';
const root = fileURLToPath(new URL('../../', import.meta.url));
const executable = fileURLToPath(
  new URL(
    '../../build/native/' + (process.platform === 'win32' ? 'soso-rooms.exe' : 'soso-rooms'),
    import.meta.url,
  ),
);
const processes = [];
let bridge;
function peer() {
  const child = spawn(executable, [], { cwd: root, windowsHide: true });
  processes.push(child);
  let seq = 0;
  const pending = new Map();
  const events = [];
  child.stderr.resume();
  createInterface({ input: child.stdout }).on('line', (line) => {
    const message = JSON.parse(line);
    if (message.event === 'session') events.push(message.session);
    const task = pending.get(message.id);
    if (!task) return;
    pending.delete(message.id);
    clearTimeout(task.timer);
    if (message.error) task.reject(Error(message.error));
    else task.resolve(message.result);
  });
  child.on('exit', (code) => {
    for (const task of pending.values()) {
      clearTimeout(task.timer);
      task.reject(Error('Native process exited: ' + code));
    }
    pending.clear();
  });
  return {
    child,
    events,
    request(op, payload) {
      const id = ++seq;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(Error('Native command timed out: ' + op));
        }, 7000);
        pending.set(id, { resolve, reject, timer });
        child.stdin.write(JSON.stringify({ id, op, payload }) + '\n');
      });
    },
  };
}
async function until(read, predicate) {
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    const value = await read();
    if (predicate(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw Error('Room state did not converge');
}
try {
  const relay = spawn(executable, ['--relay', '127.0.0.1:0'], { cwd: root, windowsHide: true });
  processes.push(relay);
  const port = await new Promise((resolve, reject) => {
    let diagnostics = '';
    const timer = setTimeout(() => reject(Error('Relay startup timed out: ' + diagnostics)), 15000);
    relay.once('error', reject);
    relay.once('exit', (code) => {
      clearTimeout(timer);
      reject(Error('Relay exited during startup: ' + code + ' ' + diagnostics));
    });
    relay.stderr.on('data', (bytes) => {
      diagnostics += bytes.toString();
      const match = diagnostics.match(/\(port (\d+)\)/);
      if (match) {
        clearTimeout(timer);
        resolve(Number(match[1]));
      }
    });
  });
  const host = peer(),
    guest = peer(),
    extra = peer();
  const room = await host.request('create', {
    mode: 'relay',
    relay: `ws://127.0.0.1:${port}/`,
    displayName: 'Host',
    name: 'Test room',
  });
  assert.equal(room.role, 'host');
  assert.equal(room.members.length, 1);
  assert.match(room.invitation, /^SOSO1\./);
  await assert.rejects(
    guest.request('join', {
      displayName: 'Guest',
      invitation: room.invitation.slice(0, -32) + '0'.repeat(32),
    }),
    /room_not_found/,
  );
  await assert.rejects(
    guest.request('join', { displayName: 'Guest', invitation: 'SOSO1.éé.' + '0'.repeat(32) }),
    /invalid_invitation/,
  );
  const joined = await guest.request('join', { displayName: 'Guest', invitation: room.invitation });
  assert.equal(joined.role, 'guest');
  assert.equal(joined.members.length, 2);
  const song = {
    id: 'yt_test123',
    source: 'youtube',
    title: 'Fixture',
    artist: 'Artist',
    album: '',
    duration: 200,
  };
  const playback = {
    track: song,
    queue: [{ ...song, id: 'yt_next' }],
    playing: true,
    position: 15,
  };
  assert.equal(joined.playback.track, null);
  assert.deepEqual(joined.playback.queue, []);
  await Promise.all([
    host.request('command', { action: 'enqueue', song }),
    guest.request('command', { action: 'enqueue', song: { ...song, id: 'yt_next' } }),
  ]);
  const queued = await until(
    () => guest.request('status'),
    (s) => s.playback?.queue.length === 1 && s.playback?.playing,
  );
  assert.equal(queued.playback.playing, true);
  assert.ok(queued.playback.track);
  for (const action of ['play', 'pause', 'next', 'remove', 'seek'])
    await assert.rejects(guest.request('command', { action }), /host_only/);
  await assert.rejects(
    guest.request('command', { action: 'enqueue', song: { ...song, preview: 'file:///private' } }),
    /unsupported_track/,
  );
  assert.equal((await guest.request('status')).status, 'connected');
  await host.request('command', { action: 'play' });
  const synced = await until(
    () => guest.request('status'),
    (s) => s.playback?.playing,
  );
  const local = {
    id: synced.playback.track.id,
    source: song.source,
    entryId: synced.playback.track.entryId,
    position: 0,
    playing: true,
    loading: false,
    blocked: false,
    queue: synced.playback.queue,
  };
  assert.equal((await guest.request('synchronize', local)).replaceQueue, false);
  await host.request('command', { action: 'pause' });
  await until(
    () => guest.request('status'),
    (s) => !s.playback.playing,
  );
  assert.equal((await guest.request('synchronize', local)).action, 'pause');
  await host.request('command', { action: 'seek', position: 33 });
  await until(
    () => guest.request('status'),
    (s) => s.playback.position === 33,
  );
  await host.request('command', { action: 'remove', entryId: synced.playback.queue[0].entryId });
  await until(
    () => guest.request('status'),
    (s) => s.playback.queue.length === 0,
  );
  await host.request('command', { action: 'next' });
  await until(
    () => guest.request('status'),
    (s) => s.playback.track === null,
  );
  await guest.request('leave');
  await until(
    () => host.request('status'),
    (s) => s.members?.length === 1,
  );
  await guest.request('join', { displayName: 'Guest again', invitation: room.invitation });
  const occupied = [host, guest];
  for (let i = 0; i < 6; i++) {
    const listener = peer();
    occupied.push(listener);
    await listener.request('join', { displayName: 'Listener ' + i, invitation: room.invitation });
  }
  await assert.rejects(
    extra.request('join', { displayName: 'Ninth', invitation: room.invitation }),
    /room_full/,
  );
  await host.request('leave');
  const closed = await until(
    () => guest.request('status'),
    (s) => s.status === 'idle',
  );
  assert.equal(closed.error, 'room_closed');
  await assert.rejects(
    extra.request('join', { displayName: 'Late', invitation: room.invitation }),
    /room_not_found/,
  );
  // The same native process can create a fresh room after losing its previous host.
  const reopened = await guest.request('create', {
    mode: 'relay',
    relay: `ws://127.0.0.1:${port}/`,
    displayName: 'New host',
    name: 'New room',
  });
  assert.equal(reopened.role, 'host');
  assert.notEqual(reopened.invitation, room.invitation);
  // A delayed stream must recover without tearing down an otherwise live room.
  const proxiedSockets = new Set();
  let upstream;
  const delayed = net.createServer((socket) => {
    const remote = net.connect(port, '127.0.0.1');
    upstream = remote;
    proxiedSockets.add(socket);
    proxiedSockets.add(remote);
    socket.pipe(remote);
    remote.pipe(socket);
    socket.on('error', () => {});
    remote.on('error', () => {});
  });
  await new Promise((resolve) => delayed.listen(0, '127.0.0.1', resolve));
  try {
    const invitation =
      'SOSO1.' +
      Buffer.from('ws://127.0.0.1:' + delayed.address().port + '/').toString('hex') +
      '.' +
      reopened.invitation.split('.')[2];
    await extra.request('join', { displayName: 'Delayed guest', invitation });
    upstream.pause();
    await new Promise((resolve) => setTimeout(resolve, 12000));
    assert.equal((await extra.request('status')).status, 'connected');
    upstream.resume();
    await until(
      () => extra.request('status'),
      (s) => s.status === 'connected' && s.members.length >= 2,
    );
    await extra.request('leave');
  } finally {
    for (const socket of proxiedSockets) socket.destroy();
    await new Promise((resolve) => delayed.close(resolve));
  }
  const [, encodedEndpoint, code] = reopened.invitation.split('.');
  const attacker = new WebSocket(Buffer.from(encodedEndpoint, 'hex').toString());
  try {
    const messages = [];
    attacker.addEventListener('message', (event) => messages.push(JSON.parse(String(event.data))));
    await new Promise((resolve, reject) => {
      attacker.addEventListener('open', resolve, { once: true });
      attacker.addEventListener('error', reject, { once: true });
    });
    attacker.send(JSON.stringify({ op: 'join', version: 1, displayName: 'Protocol guest', code }));
    await until(
      async () => messages,
      (value) => value.some((message) => message.type === 'snapshot'),
    );
    attacker.send(JSON.stringify({ op: 'publish', playback }));
    await until(
      async () => messages,
      (value) => value.some((message) => message.error === 'host_only'),
    );
    assert.equal((await guest.request('status')).playback.track, null);
  } finally {
    attacker.close();
  }
  // A selected VPN/interface disappearing must never silently expose a room
  // through a different local interface.
  await assert.rejects(
    extra.request('create', {
      mode: 'local',
      address: '192.0.2.1',
      displayName: 'Local host',
      name: 'Local room',
    }),
    /no_local_network/,
  );
  const interfaces = await extra.request('networks');
  if (interfaces.length) {
    const localHost = peer(),
      localGuest = peer();
    const localRoom = await localHost.request('create', {
      mode: 'local',
      address: interfaces[0],
      displayName: 'LAN host',
      name: 'LAN room',
    });
    await localGuest.request('join', {
      displayName: 'LAN guest',
      invitation: localRoom.invitation,
    });
    assert.equal((await localGuest.request('status')).members.length, 2);
    await localHost.request('leave');
    await until(
      () => localGuest.request('status'),
      (status) => status.status === 'idle',
    );
    console.log('Embedded Rust relay connected through local interface ' + interfaces[0]);
  }
  // Repeat short sessions while the old worker is still unwinding its socket.
  for (let attempt = 0; attempt < 8; attempt++) {
    const short = await extra.request('join', {
      displayName: 'Rapid guest',
      invitation: reopened.invitation,
    });
    await extra.request('leave');
    const after = extra.events.length;
    await new Promise((resolve) => setTimeout(resolve, 125));
    assert.equal(
      extra.events
        .slice(after)
        .some((event) => event.status === 'connected' && event.selfId === short.selfId),
      false,
    );
  }
  const sockets = new Set();
  const silent = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise((resolve) => silent.listen(0, '127.0.0.1', resolve));
  try {
    const started = Date.now();
    await assert.rejects(
      extra.request('create', {
        mode: 'relay',
        relay: `ws://127.0.0.1:${silent.address().port}/`,
        displayName: 'Timeout test',
        name: 'Timeout room',
      }),
      /relay_unreachable/,
    );
    assert.ok(Date.now() - started < 6500, 'Handshake timeout must be bounded inside Rust');
    assert.equal((await extra.request('status')).status, 'idle');
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => silent.close(resolve));
  }
  // Exercise the real main-process adapter against native Rust, while replacing
  // only Electron's window objects in this Node fixture.
  const fixture = path.join(root, 'scratch/listening-room-ipc.cjs');
  fs.mkdirSync(path.dirname(fixture), { recursive: true });
  await build({
    stdin: {
      contents: "export { ListeningRooms } from './src/desktop/main/services/listeningRooms';",
      resolveDir: root,
      loader: 'ts',
    },
    outfile: fixture,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    plugins: [
      {
        name: 'electron-window-fixture',
        setup(builder) {
          builder.onResolve({ filter: /^electron$/ }, () => ({
            path: 'electron',
            namespace: 'fixture',
          }));
          builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
            contents:
              'export const app={isPackaged:false,getAppPath:()=>' + JSON.stringify(root) + '};',
          }));
        },
      },
    ],
  });
  const { ListeningRooms } = createRequire(import.meta.url)(fixture);
  bridge = new ListeningRooms();
  const handlers = new Map(),
    events = [];
  const window = {
    isDestroyed: () => false,
    webContents: { mainFrame: {}, send: (...args) => events.push(args) },
  };
  bridge.register({ handle: (key, handler) => handlers.set(key, handler) }, () => window);
  const invoke = handlers.get('rooms:request');
  const sender = { sender: window.webContents, senderFrame: window.webContents.mainFrame };
  assert.throws(
    () => invoke({ sender: {}, senderFrame: {} }, { op: 'status' }),
    /main application window/,
  );
  assert.throws(() => invoke(sender, { op: 'unknown' }), /invalid_command/);
  const ipcRoom = await invoke(sender, {
    op: 'create',
    payload: {
      mode: 'relay',
      relay: `ws://127.0.0.1:${port}/`,
      displayName: 'IPC host',
      name: 'IPC room',
    },
  });
  assert.equal(ipcRoom.role, 'host');
  await until(
    async () => events,
    (value) =>
      value.some(
        ([channel, status]) => channel === 'rooms:session' && status.status === 'connected',
      ),
  );
  assert.equal((await invoke(sender, { op: 'leave' })).status, 'idle');
  bridge.dispose();
  // Restart the same adapter before the old child's exit callback fires.
  const restarted = await invoke(sender, {
    op: 'create',
    payload: {
      mode: 'relay',
      relay: `ws://127.0.0.1:${port}/`,
      displayName: 'Restarted host',
      name: 'Restarted room',
    },
  });
  assert.equal(restarted.role, 'host');
  const afterRestart = events.length;
  bridge.child.kill();
  await until(
    async () => events.slice(afterRestart),
    (value) =>
      value.some(([channel, status]) => channel === 'rooms:session' && status.status === 'idle'),
  );
  assert.equal((await invoke(sender, { op: 'status' })).status, 'idle');
  const afterCrash = await invoke(sender, {
    op: 'create',
    payload: {
      mode: 'relay',
      relay: `ws://127.0.0.1:${port}/`,
      displayName: 'Recovered host',
      name: 'Recovered room',
    },
  });
  assert.equal(afterCrash.role, 'host');
  await invoke(sender, { op: 'leave' });
  bridge.dispose();
  bridge = undefined;
  relay.kill();
  await until(
    () => guest.request('status'),
    (s) => s.status === 'idle' && s.error === 'connection_lost',
  );
  console.log(
    'Rust room integration passed: relay, invitations, 8 participants, host authority, queue, synchronization, leave, host loss, reconnect, relay failure and real main IPC with foreign-window rejection.',
  );
} finally {
  bridge?.dispose();
  for (const child of processes) child.kill();
}
