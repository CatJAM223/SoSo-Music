import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const binary = fileURLToPath(new URL('../../build/native/soso-rooms.exe', import.meta.url));
const children = [];
const relayOnly = !process.argv.includes('--allow-direct');
function peer() {
  const env = { ...process.env };
  if (relayOnly) env.SOSO_ROOMS_RELAY_ONLY = '1';
  else delete env.SOSO_ROOMS_RELAY_ONLY;
  const child = spawn(binary, [], { windowsHide: true, env });
  children.push(child);
  let diagnostics = '';
  child.stderr.on('data', (bytes) => {
    diagnostics = (diagnostics + bytes.toString()).slice(-4096);
  });
  let sequence = 0;
  const pending = new Map();
  createInterface({ input: child.stdout }).on('line', (line) => {
    const message = JSON.parse(line);
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
      task.reject(Error('Native peer exited (' + code + '): ' + diagnostics));
    }
    pending.clear();
  });
  return (op, payload) =>
    new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(Error('Timed out: ' + op));
      }, 30000);
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(JSON.stringify({ id, op, payload }) + '\n');
    });
}
async function until(read, condition) {
  const end = Date.now() + 10000;
  while (Date.now() < end) {
    const value = await read();
    if (condition(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw Error('Internet room state did not converge');
}
try {
  const host = peer(),
    guest = peer(),
    attacker = peer();
  const room = await host('create', {
    mode: 'internet',
    displayName: 'Internet host',
    name: 'Public relay test',
  });
  const endpoint = Buffer.from(room.invitation.split('.')[1], 'hex').toString();
  assert.ok(endpoint.startsWith('iroh://'));
  assert.ok(!endpoint.includes('127.0.0.1'));
  // No renderer heartbeat, playback, guests or user actions: native keepalive
  // must preserve a creator's empty room on its own.
  await new Promise((resolve) => setTimeout(resolve, 60000));
  const idleHost = await host('status');
  assert.equal(idleHost.status, 'connected');
  assert.equal(idleHost.invitation, room.invitation);
  const pulse = setInterval(() => host('pulse').catch(() => {}), 500);
  try {
    await assert.rejects(
      attacker('join', {
        displayName: 'Wrong key',
        invitation: room.invitation.slice(0, -32) + '0'.repeat(32),
      }),
      /invalid_invitation/,
    );
    const joined = await guest('join', {
      displayName: 'Internet guest',
      invitation: room.invitation,
    });
    assert.equal(joined.role, 'guest');
    assert.equal(joined.members.length, 2);
    const song = {
      id: 'sc_internet',
      source: 'soundcloud',
      title: 'Internet fixture',
      artist: 'Fixture',
      album: '',
      duration: 100,
    };
    await guest('command', { action: 'enqueue', song });
    await until(
      () => host('status'),
      (value) => value.playback.playing && value.playback.track?.id === song.id,
    );
    await assert.rejects(guest('command', { action: 'play' }), /host_only/);
    await until(
      () => guest('status'),
      (value) => value.playback.playing && value.playback.track.id === song.id,
    );
    await host('command', { action: 'pause' });
    await until(
      () => guest('status'),
      (value) => !value.playback.playing,
    );
    await guest('leave');
    await guest('join', { displayName: 'Internet rejoin', invitation: room.invitation });
    await host('leave');
    await until(
      () => guest('status'),
      (value) => value.status === 'idle',
    );
    console.log(
      'Internet room passed (' +
        (relayOnly
          ? 'public relay only, direct IP transports disabled'
          : 'automatic with direct paths enabled') +
        '): idle creator keepalive, invitation, wrong-key rejection, join, shared queue, host authority, playback, leave/rejoin and host close.',
    );
  } finally {
    clearInterval(pulse);
  }
} finally {
  for (const child of children) child.kill();
}
