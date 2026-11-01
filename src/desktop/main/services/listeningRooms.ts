import { app, type BrowserWindow, type IpcMain } from 'electron';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { assertMainWindowSender } from '../ipc/mainWindowHandlers';
import type { RoomRequest, RoomSession } from '../../../shared/types/listeningRoom';
import { PlaybackLogger } from './playbackLogger';

const COMMANDS = new Set([
  'status',
  'networks',
  'create',
  'join',
  'leave',
  'command',
  'pulse',
  'synchronize',
]);

/** Process/IPC adapter only. Networking, validation and synchronization execute in Rust. */
export class ListeningRooms {
  private child: ChildProcessWithoutNullStreams | null = null;
  private sequence = 0;
  private connecting = false;
  private failChild: ((reason: string) => void) | undefined;
  private pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (reason: Error) => void;
      timer: ReturnType<typeof setTimeout>;
      op: RoomRequest['op'];
    }
  >();
  private getWindow: () => BrowserWindow | null = () => null;

  register(ipc: IpcMain, getWindow: () => BrowserWindow | null) {
    this.getWindow = getWindow;
    ipc.handle('rooms:request', (event, request: RoomRequest) => {
      assertMainWindowSender(event, getWindow());
      if (
        !request ||
        typeof request !== 'object' ||
        !COMMANDS.has(request.op) ||
        JSON.stringify(request).length > 64 * 1024
      ) {
        throw Error('invalid_command');
      }
      return this.request(request);
    });
  }

  private start() {
    if (this.child) return this.child;
    const file = process.platform === 'win32' ? 'soso-rooms.exe' : 'soso-rooms';
    const binary = app.isPackaged
      ? path.join(process.resourcesPath, 'native', file)
      : path.join(app.getAppPath(), 'build/native', file);
    const child = spawn(binary, [], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child = child;
    const lines = createInterface({ input: child.stdout });
    // Drain diagnostics without exposing invitations or participant data to logs.
    child.stderr.resume();
    let failed = false;
    const fail = (reason: string) => {
      if (failed) return;
      failed = true;
      lines.close();
      if (this.child !== child) return;
      if (this.child === child) this.child = null;
      this.connecting = false;
      PlaybackLogger.warn('[Rooms] Native session ended', { reason });
      for (const task of this.pending.values()) {
        clearTimeout(task.timer);
        task.reject(Error(reason));
      }
      this.pending.clear();
      const window = this.getWindow();
      if (window && !window.isDestroyed())
        window.webContents.send('rooms:session', {
          status: 'idle',
          error: reason,
        } satisfies RoomSession);
    };
    this.failChild = fail;
    child.once('error', () => fail('native_rooms_unavailable'));
    child.once('exit', (code, signal) => {
      if (this.child === child)
        PlaybackLogger.warn('[Rooms] Native process exited', { code, signal });
      fail('connection_lost');
    });
    child.stdin.on('error', () => fail('connection_lost'));
    lines.on('line', (line) => {
      if (this.child !== child) return;
      if (line.length > 128 * 1024) {
        child.kill();
        return;
      }
      try {
        const message = JSON.parse(line);
        if (
          message.event === 'diagnostic' &&
          typeof message.code === 'string' &&
          /^[a-z_]{1,40}$/.test(message.code)
        ) {
          PlaybackLogger.warn('[Rooms] Transport ended', { code: message.code });
          return;
        }
        if (message.event === 'session') {
          const window = this.getWindow();
          if (window && !window.isDestroyed())
            window.webContents.send('rooms:session', message.session);
          return;
        }
        const task = this.pending.get(message.id);
        if (!task) return;
        this.pending.delete(message.id);
        clearTimeout(task.timer);
        if (task.op === 'create' || task.op === 'join') this.connecting = false;
        if (typeof message.error === 'string') task.reject(Error(message.error));
        else task.resolve(message.result);
      } catch {
        child.kill();
      }
    });
    return child;
  }

  private request(request: RoomRequest): Promise<unknown> {
    if (request.op === 'leave' && this.connecting) {
      this.dispose();
      return Promise.resolve({ status: 'idle' });
    }
    if (!this.child && (request.op === 'status' || request.op === 'leave'))
      return Promise.resolve({ status: 'idle' });
    if (this.pending.size >= 32) return Promise.reject(Error('connection_busy'));
    const child = this.start();
    if (request.op === 'create' || request.op === 'join') this.connecting = true;
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const task = this.pending.get(id);
        if (task) {
          this.pending.delete(id);
          task.reject(Error('native_rooms_timeout'));
        }
        if (this.child === child) this.failChild?.('native_rooms_timeout');
        child.kill();
      }, 35_000);
      this.pending.set(id, { resolve, reject, timer, op: request.op });
      child.stdin.write(JSON.stringify({ ...request, id }) + '\n');
    });
  }

  dispose() {
    for (const task of this.pending.values()) {
      clearTimeout(task.timer);
      task.reject(Error('connection_lost'));
    }
    this.pending.clear();
    this.child?.kill();
    this.child = null;
    this.connecting = false;
  }
}
