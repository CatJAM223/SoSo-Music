/** Bound the whole provider lookup, including chained key refreshes and format fallbacks. */
export class StreamResolveTimeoutError extends Error {
  constructor() {
    super('Audio stream resolution timed out');
    this.name = 'StreamResolveTimeoutError';
  }
}

export function withStreamResolveDeadline<T>(
  request: Promise<T>,
  timeoutMs = 30000,
  signal?: AbortSignal,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', aborted);
    };
    const finish = (value: T | unknown, failed = false) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (failed) reject(value);
      else resolve(value as T);
    };
    const aborted = () =>
      finish(Object.assign(new Error('Playback request cancelled'), { name: 'AbortError' }), true);
    const timer = setTimeout(() => finish(new StreamResolveTimeoutError(), true), timeoutMs);
    signal?.addEventListener('abort', aborted, { once: true });
    request.then(
      (value) => finish(value),
      (error) => finish(error, true),
    );
    if (signal?.aborted) aborted();
  });
}
