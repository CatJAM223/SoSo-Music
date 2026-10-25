import type {
  WaveResequenceArgs,
  WaveWorkerReply,
  WaveWorkerRequest,
} from './waveWorkerProtocol.ts';
export interface ComputeWorkerPort {
  postMessage: (message: WaveWorkerRequest, transfer?: Transferable[]) => void;
  terminate: () => void;
  onmessage: ((event: MessageEvent<WaveWorkerReply>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
}
interface Pending {
  resolve: (indices: number[]) => void;
  reject: (error: Error) => void;
  cleanup: () => void;
}
/** Lifecycle/transport only. There is no synchronous or JavaScript algorithm fallback. */
export class WaveWorkerTransport {
  private worker: ComputeWorkerPort | null = null;
  private ready: Promise<void> | null = null;
  private readyResolve: (() => void) | null = null;
  private readyReject: ((error: Error) => void) | null = null;
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private idle: ReturnType<typeof setTimeout> | null = null;
  private startup: ReturnType<typeof setTimeout> | null = null;
  private create: () => ComputeWorkerPort;
  private bytes: () => Uint8Array<ArrayBuffer>;
  private idleMs: number;
  private timeoutMs: number;
  constructor(
    create: () => ComputeWorkerPort,
    bytes: () => Uint8Array<ArrayBuffer>,
    idleMs = 30000,
    timeoutMs = 20000,
  ) {
    this.create = create;
    this.bytes = bytes;
    this.idleMs = idleMs;
    this.timeoutMs = timeoutMs;
  }
  private stopIdle() {
    if (this.idle !== null) clearTimeout(this.idle);
    this.idle = null;
  }
  private armIdle() {
    this.stopIdle();
    if (!this.pending.size && this.worker)
      this.idle = setTimeout(() => this.dispose(), this.idleMs);
  }
  private fail(error: Error) {
    this.stopIdle();
    if (this.startup !== null) clearTimeout(this.startup);
    this.startup = null;
    const worker = this.worker;
    this.worker = null;
    this.ready = null;
    this.readyReject?.(error);
    this.readyReject = null;
    this.readyResolve = null;
    for (const item of this.pending.values()) {
      item.cleanup();
      item.reject(error);
    }
    this.pending.clear();
    if (worker) {
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
    }
  }
  private ensure(): Promise<void> {
    this.stopIdle();
    if (this.ready) return this.ready;
    const ready = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });
    this.ready = ready;
    try {
      const worker = this.create();
      this.worker = worker;
      worker.onmessage = (event) => {
        if (this.worker !== worker) return;
        const message = event.data;
        if (message.kind === 'ready') {
          if (this.startup !== null) clearTimeout(this.startup);
          this.startup = null;
          this.readyResolve?.();
          this.readyResolve = null;
          this.readyReject = null;
          this.armIdle();
          return;
        }
        if (message.kind === 'error') {
          this.fail(Error(message.message));
          return;
        }
        const pending = this.pending.get(message.id);
        if (!pending) return;
        if (
          message.kind !== 'result' ||
          !Array.isArray(message.indices) ||
          message.indices.some((i) => !Number.isSafeInteger(i) || i < 0)
        ) {
          this.fail(Error('Invalid Rust worker reply'));
          return;
        }
        this.pending.delete(message.id);
        pending.cleanup();
        pending.resolve(message.indices);
        this.armIdle();
      };
      worker.onerror = (event) => {
        event.preventDefault?.();
        this.fail(Error(event.message || 'Rust worker failed'));
      };
      worker.onmessageerror = () => this.fail(Error('Invalid Rust worker message'));
      this.startup = setTimeout(
        () => this.fail(Error('Rust worker initialization timed out')),
        this.timeoutMs,
      );
      const bytes = this.bytes();
      worker.postMessage({ kind: 'init', bytes }, [bytes.buffer]);
    } catch (error) {
      this.fail(error instanceof Error ? error : Error('Rust worker unavailable'));
    }
    return ready;
  }
  async resequence(args: WaveResequenceArgs, signal?: AbortSignal): Promise<number[]> {
    signal?.throwIfAborted();
    const ready = this.ensure();
    if (signal) {
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => signal.removeEventListener('abort', abort);
        const abort = () => {
          cleanup();
          reject(new DOMException('Wave calculation cancelled', 'AbortError'));
        };
        signal.addEventListener('abort', abort, { once: true });
        ready.then(
          () => {
            cleanup();
            resolve();
          },
          (error) => {
            cleanup();
            reject(error);
          },
        );
        if (signal.aborted) abort();
      });
    } else await ready;
    signal?.throwIfAborted();
    this.stopIdle();
    return new Promise<number[]>((resolve, reject) => {
      const id = this.nextId++;
      const abort = () => {
        const item = this.pending.get(id);
        if (!item) return;
        this.pending.delete(id);
        item.cleanup();
        reject(new DOMException('Wave calculation cancelled', 'AbortError'));
        this.armIdle();
      };
      const timer = setTimeout(
        () => this.fail(Error('Rust worker calculation timed out')),
        this.timeoutMs,
      );
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
      };
      this.pending.set(id, { resolve, reject, cleanup });
      signal?.addEventListener('abort', abort, { once: true });
      try {
        this.worker!.postMessage({ kind: 'resequence', id, args });
      } catch (error) {
        this.fail(error instanceof Error ? error : Error('Rust worker message failed'));
      }
    });
  }
  dispose() {
    this.fail(new DOMException('Wave worker disposed', 'AbortError'));
  }
}
