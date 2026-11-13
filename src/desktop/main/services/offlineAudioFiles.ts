import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { downloadAudioBytes } from './audioDownload.ts';

const validId = /^[a-f0-9-]{36}\.(?:mp4|mp3|webm|ogg|aac)$/;
/** Private audio files: the renderer receives opaque IDs, never filesystem paths. */
export class OfflineAudioFiles {
  private directory: string;
  constructor(directory: string) {
    this.directory = directory;
  }
  url(id: string): string | null {
    return validId.test(id) && this.resolve(`media://offline/${id}`)
      ? `media://offline/${id}`
      : null;
  }
  resolve(url: string): string | null {
    const id = url.replace('media://offline/', '');
    if (url !== `media://offline/${id}` || !validId.test(id)) return null;
    const file = path.join(this.directory, id);
    try {
      if (
        fs.realpathSync(file) !== path.join(fs.realpathSync(this.directory), id) ||
        !fs.statSync(file).isFile()
      )
        return null;
      return file;
    } catch {
      return null;
    }
  }
  remove(id: string): void {
    if (!validId.test(id)) throw new Error('Invalid offline audio ID');
    fs.rmSync(path.join(this.directory, id), { force: true });
  }
  async download(
    url: string,
    signal: AbortSignal,
    onProgress?: (received: number, total: number) => void,
  ) {
    fs.mkdirSync(this.directory, { recursive: true });
    const token = randomUUID();
    const temporary = path.join(this.directory, token + '.part');
    const handle = await fs.promises.open(temporary, 'wx+');
    let closed = false;
    try {
      await downloadAudioBytes(url, {
        signal,
        onProgress,
        sink: {
          reset: () => handle.truncate(0),
          write: async (offset, chunk) => {
            for (let written = 0; written < chunk.length;) {
              signal.throwIfAborted();
              const result = await handle.write(
                chunk,
                written,
                chunk.length - written,
                offset + written,
              );
              if (!result.bytesWritten) throw new Error('Offline audio write stalled');
              written += result.bytesWritten;
            }
          },
        },
      });
      signal.throwIfAborted();
      const stat = await handle.stat();
      if (stat.size < 20000) throw new Error('Audio file is too small');
      const header = Buffer.alloc(32);
      await handle.read(header, 0, header.length, 0);
      const tag = header.toString('ascii', 4, 8);
      const extension = ['ftyp', 'styp'].includes(tag)
        ? 'mp4'
        : header.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
          ? 'webm'
          : header.toString('ascii', 0, 4) === 'OggS'
            ? 'ogg'
            : header.toString('ascii', 0, 3) === 'ID3'
              ? 'mp3'
              : header[0] === 0xff && (header[1] & 0xf6) === 0xf0
                ? 'aac'
                : header[0] === 0xff && (header[1] & 0xe0) === 0xe0
                  ? 'mp3'
                  : null;
      if (!extension) throw new Error('Downloaded file is not supported audio');
      await handle.sync();
      await handle.close();
      closed = true;
      signal.throwIfAborted();
      const id = token + '.' + extension;
      fs.renameSync(temporary, path.join(this.directory, id));
      return { id, size: stat.size };
    } finally {
      if (!closed) await handle.close();
      fs.rmSync(temporary, { force: true });
    }
  }
}
