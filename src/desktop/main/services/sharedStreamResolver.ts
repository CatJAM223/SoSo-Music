import type { StreamResolveOptions } from '../../../shared/types/index.ts';
import { runStreamResolve } from './streamResolveContext.ts';
type Lease = { recovery: boolean };
type Entry = {
  controller: AbortController;
  options: StreamResolveOptions;
  owners: Set<Lease>;
  promise: Promise<string>;
  settled: boolean;
};
/** One transport owner per equivalent recording/options; consumers own detachable leases. */
export class SharedStreamResolver {
  private pending = new Map<string, Entry>();
  private generation = 0;
  invalidate(): void {
    this.generation++;
  }
  resolve(
    track: any,
    options: StreamResolveOptions,
    signal: AbortSignal | undefined,
    task: (track: any, options: StreamResolveOptions) => Promise<string>,
  ): Promise<string> {
    signal?.throwIfAborted();
    const artist = typeof track?.artist === 'object' ? track.artist?.name : track?.artist;
    const key = JSON.stringify([
      this.generation,
      track?.source || '',
      track?.id ?? null,
      track?.preview || '',
      track?.title || '',
      artist || '',
      track?.duration || 0,
      !!track?.forDownload,
      !!options.forceRefresh,
      !!options.preferAlternateFormat,
      options.excludeItag || 0,
    ]);
    let entry = this.pending.get(key);
    if (!entry) {
      const controller = new AbortController();
      entry = {
        controller,
        options: { ...options },
        owners: new Set(),
        settled: false,
        promise: Promise.resolve(''),
      };
      const current = entry;
      this.pending.set(key, current);
      current.promise = Promise.resolve().then(() =>
        runStreamResolve(controller.signal, () => task({ ...track }, current.options)),
      );
      // Cleanup is identity guarded: an abandoned entry cannot delete a replacement.
      const settle = () => {
        current.settled = true;
        if (this.pending.get(key) === current) this.pending.delete(key);
      };
      void current.promise.then(settle, settle);
    }
    const current = entry,
      lease = { recovery: !!options.allowSessionRecovery };
    current.owners.add(lease);
    const promote = () => {
      current.options.allowSessionRecovery = [...current.owners].some((owner) => owner.recovery);
    };
    promote();
    return new Promise<string>((resolve, reject) => {
      let finished = false;
      const release = () => {
        signal?.removeEventListener('abort', abort);
        current.owners.delete(lease);
        promote();
        if (!current.settled && !current.owners.size) {
          if (this.pending.get(key) === current) this.pending.delete(key);
          current.controller.abort();
        }
      };
      const finish = (value: unknown, failed: boolean) => {
        if (finished) return;
        finished = true;
        release();
        if (failed) reject(value);
        else resolve(value as string);
      };
      const abort = () => finish(signal?.reason, true);
      signal?.addEventListener('abort', abort, { once: true });
      current.promise.then(
        (value) => (signal?.aborted ? abort() : finish(value, false)),
        (error) => (signal?.aborted ? abort() : finish(error, true)),
      );
      if (signal?.aborted) abort();
    });
  }
}
export const sharedStreamResolver = new SharedStreamResolver();
