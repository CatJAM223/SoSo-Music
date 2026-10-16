let sequence = 0;
/** Keep AbortSignal renderer-local; only a per-invocation ID crosses Electron IPC. */
export function invokeStreamRequest(
  invoke: (requestId?: string) => Promise<string>,
  cancel: ((requestId: string) => unknown) | undefined,
  signal?: AbortSignal,
): Promise<string> {
  signal?.throwIfAborted();
  if (!signal) return invoke();
  const requestId = 'stream-' + Date.now() + '-' + ++sequence;
  return new Promise<string>((resolve, reject) => {
    let done = false;
    const finish = (value: unknown, failed: boolean) => {
      if (done) return;
      done = true;
      signal.removeEventListener('abort', abort);
      if (failed) reject(value);
      else resolve(value as string);
    };
    const abort = () => {
      if (done) return;
      try {
        void Promise.resolve(cancel?.(requestId)).catch(() => {});
      } catch {
        /* IPC closed */
      }
      finish(signal.reason, true);
    };
    // Send invoke first, so a following cancel cannot overtake begin on the sender's IPC stream.
    let request: Promise<string>;
    try {
      request = invoke(requestId);
    } catch (error) {
      finish(error, true);
      return;
    }
    signal.addEventListener('abort', abort, { once: true });
    request.then(
      (value) => (signal.aborted ? abort() : finish(value, false)),
      (error) => (signal.aborted ? abort() : finish(error, true)),
    );
    if (signal.aborted) abort();
  });
}
