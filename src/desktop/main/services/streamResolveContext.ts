import { AsyncLocalStorage } from 'node:async_hooks';
const scope = new AsyncLocalStorage<AbortSignal | undefined>();
export const currentStreamResolveSignal = (): AbortSignal | undefined => scope.getStore();
export function assertStreamResolveActive(): void {
  scope.getStore()?.throwIfAborted();
}
export function runStreamResolve<T>(signal: AbortSignal, task: () => T): T {
  signal.throwIfAborted();
  return scope.run(signal, task);
}
export function detachedStreamResolve<T>(task: () => T): T {
  return scope.run(undefined, task);
}
/** Own only the wait; bootstrap/recovery continues for its other callers. */
export function streamShared<T>(task: () => PromiseLike<T> | T): Promise<T> {
  assertStreamResolveActive();
  return streamWait(detachedStreamResolve(task));
}
/** Reject late native/mock completions before the caller can mutate caches or retry. */
export function streamWait<T>(promise: PromiseLike<T> | T): Promise<T> {
  const signal = scope.getStore();
  if (!signal) return Promise.resolve(promise);
  return new Promise<T>((resolve, reject) => {
    let done = false;
    const finish = (value: unknown, failed: boolean) => {
      if (done) return;
      done = true;
      signal.removeEventListener('abort', abort);
      if (failed) reject(value);
      else resolve(value as T);
    };
    const abort = () => finish(signal.reason, true);
    // Observe a losing promise too: a detached failure must not become unhandled.
    Promise.resolve(promise).then(
      (value) => (signal.aborted ? abort() : finish(value, false)),
      (error) => (signal.aborted ? abort() : finish(error, true)),
    );
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}
export function streamRequestInit(init?: RequestInit): RequestInit | undefined {
  const signal = scope.getStore();
  if (!signal) return init;
  signal.throwIfAborted();
  init?.signal?.throwIfAborted();
  return {
    ...init,
    signal:
      init?.signal && init.signal !== signal ? AbortSignal.any([init.signal, signal]) : signal,
  };
}
