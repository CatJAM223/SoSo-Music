/** Preserve the transport deadline while allowing its owner to cancel the request. */
export function requestSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  signal?.throwIfAborted();
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}
