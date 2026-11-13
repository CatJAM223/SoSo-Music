import { desktopFetch } from './desktopFetch.ts';

const MAX_AUDIO_SIZE = 100 * 1024 * 1024;
const RANGE_SIZE = 1024 * 1024;
const RANGE_WORKERS = 2;

function isAllowedUrl(url: string): boolean {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') return false;
  const host = parsed.hostname.toLowerCase();
  return (
    [
      'sndcdn.com',
      'soundcloud.com',
      'soundcloud.cloud',
      'bcbits.com',
      'bandcamp.com',
      'googlevideo.com',
      'youtube.com',
      'ytimg.com',
      'googleusercontent.com',
      'kugou.com',
    ].some(
      (domain) =>
        host.endsWith(`.${domain}`) ||
        ([
          'sndcdn.com',
          'soundcloud.com',
          'soundcloud.cloud',
          'bcbits.com',
          'bandcamp.com',
        ].includes(domain) &&
          host === domain),
    ) ||
    host === 'images.unsplash.com' ||
    host === 'lrclib.net'
  );
}

type Options = {
  maxBytes?: number;
  signal?: AbortSignal;
  fetcher?: typeof desktopFetch;
  onProgress?: (receivedBytes: number, totalBytes: number) => void;
  rangeMode?: 'auto' | 'force';
  sink?: {
    write: (offset: number, chunk: Uint8Array) => Promise<void>;
    reset: () => Promise<void>;
  };
};

class SlowAudioTransfer extends Error {}

/** Bounded transfers on the same Chromium/proxy connection used to resolve media URLs. */
let transferTail: Promise<void> = Promise.resolve();
/** Serialize whole-file allocations across all windows; queued owners can cancel immediately. */
export async function downloadAudioBytes(url: string, options: Options = {}): Promise<Buffer> {
  options.signal?.throwIfAborted();
  const previous = transferTail;
  let release!: () => void;
  const slot = new Promise<void>((resolve) => {
    release = resolve;
  });
  transferTail = previous.then(() => slot);
  let abort!: () => void;
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(options.signal?.reason);
    options.signal?.addEventListener('abort', abort, { once: true });
  });
  try {
    await Promise.race([previous, cancelled]);
    options.signal?.throwIfAborted();
    return await transferAudioBytes(url, options);
  } finally {
    options.signal?.removeEventListener('abort', abort);
    release();
  }
}
async function transferAudioBytes(url: string, options: Options): Promise<Buffer> {
  const maxAudioSize = Math.min(MAX_AUDIO_SIZE, options.maxBytes ?? MAX_AUDIO_SIZE);
  if (!Number.isFinite(maxAudioSize) || maxAudioSize <= 0)
    throw new Error('Invalid audio size limit');
  const fetcher = options.fetcher ?? desktopFetch;
  const controller = new AbortController();
  const signal = AbortSignal.any([
    controller.signal,
    AbortSignal.timeout(60000),
    ...(options.signal ? [options.signal] : []),
  ]);
  signal.throwIfAborted();
  let lastProgressTime = 0;
  let receivedBytes = 0;
  let expectedBytes = 0;
  const requestControllers = new WeakMap<Response, AbortController>();
  const report = (force = false) => {
    const now = Date.now();
    if (force || now - lastProgressTime >= 100) {
      lastProgressTime = now;
      options.onProgress?.(receivedBytes, expectedBytes);
    }
  };

  const request = async (
    target: string,
    range?: string,
  ): Promise<{ response: Response; url: string }> => {
    const requestController = new AbortController();
    const requestSignal = AbortSignal.any([signal, requestController.signal]);
    for (let redirects = 0; redirects <= 5; redirects++) {
      if (!isAllowedUrl(target)) throw new Error('Audio URL is not an allowed HTTPS CDN');
      const host = new URL(target).hostname;
      const headers: Record<string, string> = {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      };
      if (range) headers.Range = range;
      if (
        host.endsWith('.sndcdn.com') ||
        host.endsWith('.soundcloud.com') ||
        host.endsWith('.soundcloud.cloud') ||
        host === 'soundcloud.cloud' ||
        host === 'soundcloud.com'
      ) {
        headers.Referer = 'https://soundcloud.com/';
        headers.Origin = 'https://soundcloud.com';
      }
      if (
        host.endsWith('.bcbits.com') ||
        host.endsWith('.bandcamp.com') ||
        host === 'bandcamp.com'
      ) {
        headers.Referer = 'https://bandcamp.com/';
        headers.Origin = 'https://bandcamp.com';
      }
      // Offline files have their own IndexedDB cache. Chromium's HTTP cache can hold a
      // URL's cache-entry lock while an abandoned bulk response is still in flight,
      // delaying the first range by ~20s. Avoid a redundant second cache here.
      const response = await fetcher(target, {
        headers,
        redirect: 'manual',
        signal: requestSignal,
        cache: 'no-store',
      });
      requestControllers.set(response, requestController);
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        await response.body?.cancel();
        if (!location) throw new Error('Audio redirect has no destination');
        target = new URL(location, target).href;
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`Audio HTTP ${response.status}`);
      }
      if (
        /text\/html|text\/plain|application\/json|application\/xml|text\/xml/i.test(
          response.headers.get('content-type') || '',
        )
      ) {
        await response.body?.cancel();
        throw new Error('Audio CDN returned an error document');
      }
      return { response, url: target };
    }
    throw new Error('Too many audio redirects');
  };

  const read = async (
    response: Response,
    limit: number,
    detectSlowTransfer = false,
    offset = 0,
  ): Promise<{ length: number; bytes: Buffer }> => {
    if (!response.body) throw new Error('Audio response has no body');
    const length = Number(response.headers.get('content-length')) || 0;
    if (length > limit) {
      await response.body.cancel();
      throw new Error('Audio response exceeds size limit');
    }
    const reader = response.body.getReader();
    const target = !options.sink && length > 0 ? Buffer.allocUnsafe(length) : undefined;
    const chunks: Uint8Array[] = [];
    let loaded = 0;
    const startedAt = Date.now();
    try {
      while (true) {
        let stallTimer: ReturnType<typeof setTimeout> | undefined;
        const pendingRead = reader.read();
        const { done, value } = await (detectSlowTransfer
          ? Promise.race([
              pendingRead,
              new Promise<never>((_, reject) => {
                stallTimer = setTimeout(
                  () => reject(new SlowAudioTransfer('Audio download stalled')),
                  3000,
                );
              }),
            ]).finally(() => clearTimeout(stallTimer))
          : pendingRead);
        if (done) break;
        loaded += value.byteLength;
        if (loaded > limit) throw new Error('Audio response exceeds size limit');
        if (options.sink) await options.sink.write(offset + loaded - value.byteLength, value);
        else if (target) target.set(value, loaded - value.byteLength);
        else chunks.push(value);
        receivedBytes += value.byteLength;
        report();
        const elapsed = Date.now() - startedAt;
        if (detectSlowTransfer && elapsed >= 1500 && loaded / (elapsed / 1000) < 192 * 1024) {
          throw new SlowAudioTransfer('Audio download is throttled');
        }
      }
      if (length && loaded !== length) throw new Error('Incomplete audio response');
      // Buffer.concat accepts Uint8Array directly; avoid a second copy of every chunk.
      return {
        length: loaded,
        bytes: options.sink ? Buffer.alloc(0) : target || Buffer.concat(chunks, loaded),
      };
    } catch (error) {
      requestControllers.get(response)?.abort();
      await reader.cancel().catch(() => {});
      throw error;
    } finally {
      reader.releaseLock();
    }
  };

  const validateRange = (response: Response, start: number, end: number, total?: number) => {
    const match = /^bytes (\d+)-(\d+)\/(\d+)$/i.exec(response.headers.get('content-range') || '');
    if (response.status !== 206 || !match) throw new Error('Invalid audio range response');
    const size = Number(match[3]);
    if (
      size <= 0 ||
      size > maxAudioSize ||
      Number(match[1]) !== start ||
      Number(match[2]) !== Math.min(end, size - 1) ||
      (total !== undefined && size !== total)
    ) {
      throw new Error('Mismatched audio range response');
    }
    return size;
  };

  try {
    const youtube = new URL(url).hostname.endsWith('.googlevideo.com');
    const useRanges = youtube && options.rangeMode === 'force';
    // Short, bounded requests avoid treating an offline transfer as one long playback stream.
    // Do not alter signed URL parameters. A CDN ignoring Range can return the full file once.
    let first = await request(url, useRanges ? `bytes=0-${RANGE_SIZE - 1}` : undefined);
    let result: { length: number; bytes: Buffer };
    if (youtube && !useRanges && first.response.status === 200) {
      expectedBytes =
        Number(first.response.headers.get('content-length')) ||
        Number(new URL(first.url).searchParams.get('clen')) ||
        0;
      if (expectedBytes > maxAudioSize) {
        await first.response.body?.cancel();
        throw new Error('Audio exceeds size limit');
      }
      try {
        result = await read(first.response, maxAudioSize, expectedBytes >= 2 * RANGE_SIZE);
        if (expectedBytes && result.length !== expectedBytes)
          throw new Error('Incomplete audio file');
        expectedBytes = result.length;
        report(true);
        return result.bytes;
      } catch (error) {
        if (!(error instanceof SlowAudioTransfer)) throw error;
        receivedBytes = 0;
        await options.sink?.reset();
        first = await request(first.url, `bytes=0-${RANGE_SIZE - 1}`);
      }
    }
    if (youtube && first.response.status === 206) {
      try {
        expectedBytes = validateRange(first.response, 0, RANGE_SIZE - 1);
      } catch (error) {
        await first.response.body?.cancel();
        throw error;
      }
      const firstBytes = await read(first.response, Math.min(RANGE_SIZE, expectedBytes));
      if (firstBytes.length !== Math.min(RANGE_SIZE, expectedBytes))
        throw new Error('Incomplete first audio range');
      const complete = options.sink ? undefined : Buffer.allocUnsafe(expectedBytes);
      complete?.set(firstBytes.bytes, 0);
      let nextStart = RANGE_SIZE;
      const workers = Array.from(
        { length: Math.min(RANGE_WORKERS, Math.ceil(expectedBytes / RANGE_SIZE) - 1) },
        async () => {
          while (nextStart < expectedBytes) {
            const start = nextStart;
            nextStart += RANGE_SIZE;
            const end = Math.min(expectedBytes - 1, start + RANGE_SIZE - 1);
            const part = await request(first.url, `bytes=${start}-${end}`);
            try {
              validateRange(part.response, start, end, expectedBytes);
            } catch (error) {
              await part.response.body?.cancel();
              throw error;
            }
            const bytes = await read(part.response, end - start + 1, false, start);
            if (bytes.length !== end - start + 1) throw new Error('Incomplete audio range');
            complete?.set(bytes.bytes, start);
          }
        },
      );
      try {
        await Promise.all(workers);
      } catch (error) {
        controller.abort();
        await Promise.allSettled(workers);
        throw error;
      }
      result = { length: expectedBytes, bytes: complete ?? Buffer.alloc(0) };
    } else {
      // An unsolicited partial response cannot safely be stored as a complete song.
      if (first.response.status === 206) {
        await first.response.body?.cancel();
        throw new Error('Unexpected partial audio');
      }
      expectedBytes =
        Number(first.response.headers.get('content-length')) ||
        Number(new URL(first.url).searchParams.get('clen')) ||
        0;
      if (expectedBytes > maxAudioSize) {
        await first.response.body?.cancel();
        throw new Error('Audio exceeds size limit');
      }
      result = await read(first.response, maxAudioSize);
      if (expectedBytes && result.length !== expectedBytes)
        throw new Error('Incomplete audio file');
    }
    expectedBytes = result.length;
    report(true);
    return result.bytes;
  } catch (error) {
    controller.abort(); // Stop sibling ranges when one fails; never store a partial song.
    throw error;
  }
}
