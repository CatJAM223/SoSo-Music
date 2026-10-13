/** Stable codes survive Electron's Error serialization; no URL or credentials are carried. */
export type StreamResolveFailure = 'network' | 'timeout' | 'provider' | 'rate-limit';
export const STREAM_NETWORK_UNAVAILABLE = 'STREAM_NETWORK_UNAVAILABLE';
export const STREAM_REQUEST_TIMEOUT = 'STREAM_REQUEST_TIMEOUT';
export const STREAM_PROVIDER_UNAVAILABLE = 'STREAM_PROVIDER_UNAVAILABLE';
export const STREAM_RATE_LIMITED = 'STREAM_RATE_LIMITED';
const codes: Record<StreamResolveFailure, string> = {
  network: STREAM_NETWORK_UNAVAILABLE,
  timeout: STREAM_REQUEST_TIMEOUT,
  provider: STREAM_PROVIDER_UNAVAILABLE,
  'rate-limit': STREAM_RATE_LIMITED,
};

export function createStreamResolveError(kind: StreamResolveFailure): Error {
  return new Error(codes[kind]);
}

/** These failures are temporary; they must not be interpreted as a missing recording. */
export function getStreamResolveFailure(error: unknown): StreamResolveFailure | null {
  const message =
    error && typeof error === 'object' && 'message' in error
      ? String(error.message)
      : String(error);
  for (const [kind, code] of Object.entries(codes))
    if (message.includes(code)) return kind as StreamResolveFailure;
  return null;
}

export function streamHttpFailure(status: number): StreamResolveFailure | null {
  if (!status) return 'network';
  if (status === 429) return 'rate-limit';
  if (status === 408 || status === 504) return 'timeout';
  if (status >= 500) return 'provider';
  return null;
}

/** Transport callers use this only for failed fetch/response decoding, never for access errors. */
export function streamTransportFailure(error: unknown): StreamResolveFailure {
  const known = getStreamResolveFailure(error);
  if (known) return known;
  const value = error as { name?: string; message?: string; code?: string };
  if (
    /timeout|timed.?out|ETIMEDOUT|AbortError/i.test(
      [value?.name, value?.message, value?.code].join(' '),
    )
  )
    return 'timeout';
  if (value?.name === 'SyntaxError') return 'provider';
  return 'network';
}
