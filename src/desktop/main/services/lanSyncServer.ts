import http from 'node:http';
import os from 'node:os';
import { randomInt, timingSafeEqual } from 'node:crypto';
import type { DatabaseManager } from '../db/index.ts';
import type { LanSyncSession } from '../../../shared/types/index.ts';
import { isPrivateLanIPv4 } from '../../../shared/utils/privateLanIp.ts';

export type LanImportSummary = {
  address: string;
  tracks: number;
  playlists: number;
  albums: number;
  artists: number;
};
type ConfirmImport = (summary: LanImportSummary, signal: AbortSignal) => Promise<boolean>;

export class LanSyncServer {
  private server: http.Server | null = null;
  private code = '';
  private idleTimer: NodeJS.Timeout | null = null;
  private readonly database: DatabaseManager;
  private readonly onImport?: () => void;
  private readonly confirmImport?: ConfirmImport;
  private pendingImport: AbortController | null = null;

  constructor(database: DatabaseManager, onImport?: () => void, confirmImport?: ConfirmImport) {
    this.database = database;
    this.onImport = onImport;
    this.confirmImport = confirmImport;
  }

  status(): LanSyncSession {
    if (!this.server) return { active: false, addresses: [] };
    const port = (this.server.address() as import('node:net').AddressInfo)?.port;
    const addresses = Object.values(os.networkInterfaces())
      .flat()
      .filter((item): item is NonNullable<typeof item> =>
        Boolean(item && item.family === 'IPv4' && !item.internal && isPrivateLanIPv4(item.address)),
      )
      .map((item) => `http://${item.address}:${port}`);
    return { active: true, addresses, code: this.code, port };
  }

  async start(): Promise<LanSyncSession> {
    if (this.server) return this.status();
    this.code = String(randomInt(10000000, 100000000));
    const server = http.createServer((request, response) => {
      void this.handle(request, response);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '0.0.0.0', () => {
          server.off('error', reject);
          resolve();
        });
      });
      this.server = server;
      this.touch();
      return this.status();
    } catch (error) {
      server.close();
      this.code = '';
      throw error;
    }
  }

  stop(): LanSyncSession {
    this.pendingImport?.abort();
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    this.server?.close();
    this.server = null;
    this.code = '';
    return this.status();
  }

  private touch() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.stop(), 10 * 60 * 1000);
  }

  private reply(response: http.ServerResponse, status: number, payload: unknown) {
    response.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    response.end(JSON.stringify(payload));
  }

  private async handle(request: http.IncomingMessage, response: http.ServerResponse) {
    const remote = request.socket.remoteAddress?.replace(/^::ffff:/, '') || '';
    const localPeer = remote === '127.0.0.1' || remote === '::1' || isPrivateLanIPv4(remote);
    if (!localPeer) {
      this.reply(response, 403, { success: false });
      return;
    }
    const supplied = request.headers.authorization?.replace(/^Bearer /, '') || '';
    const expected = Buffer.from(this.code);
    const actual = Buffer.from(supplied);
    if (!this.server || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      this.reply(response, 401, { success: false, message: 'Неверный код сопряжения.' });
      return;
    }
    this.touch();
    if (request.url !== '/library') {
      this.reply(response, 404, { success: false });
      return;
    }
    if (request.method === 'GET') {
      const result = this.database.exportData();
      this.reply(response, result.success ? 200 : 400, result.success ? result.payload : result);
      return;
    }
    if (request.method !== 'POST') {
      this.reply(response, 405, { success: false });
      return;
    }
    if (this.pendingImport) {
      this.reply(response, 409, {
        success: false,
        message: 'На ПК уже ожидается подтверждение другого переноса.',
      });
      return;
    }
    const controller = new AbortController();
    this.pendingImport = controller;
    const cancel = () => controller.abort();
    response.once('close', cancel);
    let confirmationTimer: NodeJS.Timeout | undefined;
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of request) {
        const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += part.length;
        if (size > 15 * 1024 * 1024) {
          this.reply(response, 413, { success: false, message: 'Данные слишком большие.' });
          request.destroy();
          return;
        }
        chunks.push(part);
      }
      const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (
        payload?.app !== 'SoSo Music' ||
        !payload.data ||
        typeof payload.data !== 'object' ||
        Array.isArray(payload.data)
      ) {
        this.reply(response, 400, { success: false, message: 'Некорректная медиатека.' });
        return;
      }
      const count = (field: string) =>
        Array.isArray(payload.data[field]) ? payload.data[field].length : 0;
      const summary = {
        address: remote,
        tracks: count('liked_tracks'),
        playlists: count('playlists'),
        albums: count('saved_albums'),
        artists: count('followed_artists'),
      };
      confirmationTimer = setTimeout(cancel, 60000);
      const canceled = new Promise<boolean>((resolve) => {
        if (controller.signal.aborted) resolve(false);
        else controller.signal.addEventListener('abort', () => resolve(false), { once: true });
      });
      const approved =
        this.confirmImport && !controller.signal.aborted
          ? await Promise.race([this.confirmImport(summary, controller.signal), canceled])
          : false;
      if (!approved || controller.signal.aborted || !this.server) {
        if (!response.destroyed)
          this.reply(response, 403, {
            success: false,
            message:
              'Приём медиатеки не подтверждён на ПК. Отправьте её снова, когда будете готовы.',
          });
        return;
      }
      const result = this.database.importData(payload);
      if (result.success) this.onImport?.();
      this.reply(response, result.success ? 200 : 400, result);
    } catch (error) {
      if (!response.headersSent && !response.destroyed)
        this.reply(response, 400, { success: false, message: 'Ошибка при получении данных.' });
    } finally {
      if (confirmationTimer) clearTimeout(confirmationTimer);
      response.off('close', cancel);
      controller.abort();
      if (this.pendingImport === controller) this.pendingImport = null;
    }
  }
}
