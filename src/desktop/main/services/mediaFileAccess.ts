import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';

export const MEDIA_SCHEME = {
  scheme: 'media',
  privileges: {
    secure: true,
    standard: true,
    supportFetchAPI: true,
    corsEnabled: true,
    stream: true,
  },
};

const extensions = new Set([
  '.mp4',
  '.webm',
  '.ogv',
  '.m4v',
  '.mov',
  '.gif',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
]);
type Grant = { id: string; filePath: string };

/** Only the native picker may create a grant; renderer paths never authorize a file. */
export class MediaFileAccess {
  private grant: Grant | null = null;
  private readonly filename: string;

  constructor(directory: string) {
    this.filename = path.join(directory, 'wallpaper-access.json');
    try {
      const saved = JSON.parse(fs.readFileSync(this.filename, 'utf8'));
      if (
        saved.version === 1 &&
        /^[a-f0-9-]{36}$/.test(saved.id) &&
        typeof saved.filePath === 'string' &&
        path.isAbsolute(saved.filePath) &&
        extensions.has(path.extname(saved.filePath).toLowerCase())
      )
        this.grant = { id: saved.id, filePath: saved.filePath };
    } catch {
      // Missing or damaged permissions fail closed; the user can select the file again.
    }
  }

  private url(grant: Grant): string {
    return `media://local/${grant.id}/${encodeURIComponent(path.basename(grant.filePath))}`;
  }

  select(filePath: string): string {
    const canonical = fs.realpathSync(filePath);
    if (!extensions.has(path.extname(canonical).toLowerCase()) || !fs.statSync(canonical).isFile())
      throw new Error('Select a supported image or video file');
    const grant = { id: randomUUID(), filePath: canonical };
    fs.mkdirSync(path.dirname(this.filename), { recursive: true });
    const temporary = this.filename + '.' + randomUUID() + '.tmp';
    try {
      fs.writeFileSync(temporary, JSON.stringify({ version: 1, ...grant }) + '\n', {
        flag: 'wx',
        mode: 0o600,
      });
      fs.renameSync(temporary, this.filename);
      this.grant = grant;
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
    return this.url(grant);
  }

  resolve(rawUrl: string): string | null {
    const grant = this.grant;
    if (!grant || rawUrl !== this.url(grant)) return null;
    try {
      // Recheck symlinks on every request, including after application restarts.
      if (
        fs.realpathSync(grant.filePath) !== grant.filePath ||
        !fs.statSync(grant.filePath).isFile()
      )
        return null;
      return grant.filePath;
    } catch {
      return null;
    }
  }
}

const contentTypes: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.ogv': 'video/ogg',
  '.mov': 'video/quicktime',
  '.gif': 'image/gif',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

export function createMediaHandler(
  access: MediaFileAccess,
  devUrl?: string,
): (request: Request) => Promise<Response> {
  let devOrigin: string | undefined;
  try {
    if (devUrl) devOrigin = new URL(devUrl).origin;
  } catch {}
  return async (request) => {
    if (request.method !== 'GET' && request.method !== 'HEAD')
      return new Response('Method not allowed', { status: 405 });
    const origin = request.headers.get('origin');
    if (origin && origin !== 'null' && origin !== devOrigin)
      return new Response('Forbidden', { status: 403 });
    const filePath = access.resolve(request.url);
    if (!filePath) return new Response('File not available', { status: 404 });
    let descriptor: number | undefined;
    try {
      descriptor = fs.openSync(filePath, 'r');
      const stat = fs.fstatSync(descriptor);
      if (!stat.isFile()) return new Response('File not available', { status: 404 });
      const size = stat.size;
      const headers = new Headers({
        'Content-Type': contentTypes[path.extname(filePath).toLowerCase()],
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      if (origin) {
        headers.set('Access-Control-Allow-Origin', origin);
        headers.set('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges');
        headers.set('Vary', 'Origin');
      }
      let start = 0,
        end = size - 1,
        status = 200;
      // Electron's file transport ignores Range on some versions; stream the exact interval.
      const range = request.method === 'GET' ? request.headers.get('range') : null;
      if (range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(range);
        if (match && (match[1] || match[2])) {
          if (!match[1]) start = Math.max(0, size - Number(match[2]));
          else {
            start = Number(match[1]);
            if (match[2]) end = Math.min(end, Number(match[2]));
          }
        }
        if (
          !match ||
          (!match[1] && !match[2]) ||
          (!match[1] && Number(match[2]) === 0) ||
          !Number.isSafeInteger(start) ||
          !Number.isSafeInteger(end) ||
          start < 0 ||
          start > end ||
          start >= size
        ) {
          headers.set('Content-Range', 'bytes */' + size);
          return new Response(null, { status: 416, headers });
        }
        status = 206;
        headers.set('Content-Range', 'bytes ' + start + '-' + end + '/' + size);
      }
      headers.set('Content-Length', String(Math.max(0, end - start + 1)));
      if (request.method === 'HEAD' || size === 0) return new Response(null, { status, headers });
      const stream = fs.createReadStream(filePath, {
        fd: descriptor,
        autoClose: true,
        start,
        end,
        signal: request.signal,
      });
      descriptor = undefined; // The stream owns and closes the descriptor, including on cancellation.
      return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
        status,
        headers,
      });
    } catch {
      return new Response('File not available', { status: 404 });
    } finally {
      if (descriptor !== undefined) fs.closeSync(descriptor);
    }
  };
}
