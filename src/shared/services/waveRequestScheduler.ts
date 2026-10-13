interface WaveRequest {
  key: string;
  controller: AbortController;
  owners: Set<symbol>;
  promise: Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  task: (signal: AbortSignal) => Promise<unknown>;
  state: 'queued' | 'active' | 'settled';
}

export function waveAbortError(): DOMException {
  return new DOMException('Wave request cancelled', 'AbortError');
}

/** A wave has many producers; one gate bounds their combined provider work. */
export class WaveRequestScheduler {
  private active = 0;
  private waiting: WaveRequest[] = [];
  private inFlight = new Map<string, WaveRequest>();
  private concurrency: number;
  private maxPending: number;

  constructor(concurrency = 4, maxPending = 96) {
    if (!Number.isInteger(concurrency) || concurrency < 1)
      throw new Error('Invalid wave concurrency');
    if (!Number.isInteger(maxPending) || maxPending < 0)
      throw new Error('Invalid wave queue capacity');
    this.concurrency = concurrency;
    this.maxPending = maxPending;
  }

  /** Each batch owns a subscription; another batch can still need the same provider task. */
  createBatch(signal?: AbortSignal) {
    const owner = Symbol('wave batch');
    const results = new Map<string, Promise<unknown>>();
    const owned = new Map<WaveRequest, (reason: unknown) => void>();
    let disposed = false;
    const dispose = () => {
      if (disposed) return;
      disposed = true;
      signal?.removeEventListener('abort', dispose);
      for (const [entry, reject] of owned) {
        entry.owners.delete(owner);
        reject(waveAbortError());
        if (!entry.owners.size) this.cancel(entry);
      }
      owned.clear();
    };
    signal?.addEventListener('abort', dispose, { once: true });
    if (signal?.aborted) dispose();

    const request = <T>(key: string, task: (signal: AbortSignal) => Promise<T>): Promise<T> => {
      if (disposed) return Promise.reject(waveAbortError());
      const previous = results.get(key);
      if (previous) return previous as Promise<T>;
      const entry = this.inFlight.get(key) || this.schedule(key, task);
      entry.owners.add(owner);
      const reply = new Promise<T>((resolve, reject) => {
        owned.set(entry, reject);
        void entry.promise
          .then((value) => resolve(value as T), reject)
          .finally(() => {
            owned.delete(entry);
            entry.owners.delete(owner);
          });
      });
      results.set(key, reply);
      return reply;
    };
    return Object.assign(request, { dispose });
  }

  private cancel(entry: WaveRequest): void {
    if (entry.state === 'settled') return;
    if (this.inFlight.get(entry.key) === entry) this.inFlight.delete(entry.key);
    entry.controller.abort();
    if (entry.state === 'queued') {
      const index = this.waiting.indexOf(entry);
      if (index >= 0) this.waiting.splice(index, 1);
      entry.state = 'settled';
      entry.reject(waveAbortError());
    }
    // Active transports retain their slot until they actually settle. Native HTTP cannot abort.
  }

  private schedule<T>(key: string, task: (signal: AbortSignal) => Promise<T>): WaveRequest {
    let resolve!: (value: unknown) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<unknown>((ok, fail) => {
      resolve = ok;
      reject = fail;
    });
    const entry: WaveRequest = {
      key,
      controller: new AbortController(),
      owners: new Set(),
      promise,
      resolve,
      reject,
      task,
      state: 'queued',
    };
    this.inFlight.set(key, entry);
    if (this.active < this.concurrency) this.start(entry);
    else if (this.waiting.length < this.maxPending) this.waiting.push(entry);
    else {
      entry.state = 'settled';
      this.inFlight.delete(key);
      reject(new Error('Wave request queue is full'));
    }
    return entry;
  }

  private start(entry: WaveRequest): void {
    entry.state = 'active';
    this.active++;
    void Promise.resolve()
      .then(() => {
        entry.controller.signal.throwIfAborted();
        return entry.task(entry.controller.signal);
      })
      .then(
        (value) => this.finish(entry, value),
        (error) => this.finish(entry, error, true),
      );
  }

  private finish(entry: WaveRequest, value: unknown, failed = false): void {
    entry.state = 'settled';
    if (this.inFlight.get(entry.key) === entry) this.inFlight.delete(entry.key);
    if (failed) entry.reject(value);
    else entry.resolve(value);
    this.active--;
    const next = this.waiting.shift();
    if (next) this.start(next);
  }
}

/** Keep provider and page size separate; whitespace/case do not create extra network work. */
export function waveRequestKey(provider: string, query: string, limit: number): string {
  return JSON.stringify([provider, query.trim().replace(/\s+/g, ' ').toLocaleLowerCase(), limit]);
}
