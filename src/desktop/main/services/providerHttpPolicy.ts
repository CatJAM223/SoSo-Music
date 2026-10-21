import { parseRetryAfter, waitForRetry } from '../../../shared/utils/retryAfter.ts';
import { createStreamResolveError } from '../../../shared/utils/streamResolveError.ts';

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
type ProviderState = {
  until: number;
  revision: number;
  throttled: boolean;
  probe: Promise<void> | null;
  release: (() => void) | null;
};
export class ProviderHttpPolicy {
  private providers = new Map<string, ProviderState>();
  private now: () => number;
  private wait: typeof waitForRetry;
  constructor(now = Date.now, wait = waitForRetry) {
    this.now = now;
    this.wait = wait;
  }
  clear(): void {
    this.providers.clear();
  }
  private key(url: URL): string {
    const host = url.hostname;
    if (
      host === 'youtube.com' ||
      host.endsWith('.youtube.com') ||
      host.endsWith('.googlevideo.com')
    )
      return 'youtube';
    if (
      host === 'soundcloud.com' ||
      host.endsWith('.soundcloud.com') ||
      host.endsWith('.sndcdn.com') ||
      host === 'soundcloud.cloud' ||
      host.endsWith('.soundcloud.cloud')
    )
      return 'soundcloud';
    return url.origin;
  }
  private replayable(url: URL, init: RequestInit): boolean {
    const method = (init.method ?? 'GET').toUpperCase();
    if (method === 'GET' || method === 'HEAD') return !init.body;
    return (
      method === 'POST' &&
      typeof init.body === 'string' &&
      (url.hostname === 'youtube.com' || url.hostname.endsWith('.youtube.com')) &&
      /^\/youtubei\/v1\/(player|search|browse|next|visitor_id)$/.test(url.pathname)
    );
  }
  private async gate(
    state: ProviderState,
    deadline: number,
    signal?: AbortSignal,
  ): Promise<boolean> {
    while (state.throttled) {
      signal?.throwIfAborted();
      const delay = Math.max(0, state.until - this.now());
      if (delay > deadline - this.now()) throw createStreamResolveError('rate-limit');
      if (delay > 0) {
        await this.wait(delay, signal);
        continue;
      }
      if (state.probe) {
        const completed = state.probe;
        // Join the gate, never cancel another request's probe.
        await new Promise<void>((resolve, reject) => {
          const remaining = deadline - this.now();
          if (remaining <= 0) {
            reject(createStreamResolveError('rate-limit'));
            return;
          }
          const timer = setTimeout(() => {
            cleanup();
            reject(createStreamResolveError('rate-limit'));
          }, remaining);
          const cleanup = () => {
            clearTimeout(timer);
            signal?.removeEventListener('abort', abort);
          };
          const abort = () => {
            cleanup();
            reject(signal?.reason ?? new DOMException('Cancelled', 'AbortError'));
          };
          signal?.addEventListener('abort', abort, { once: true });
          completed.then(
            () => {
              cleanup();
              resolve();
            },
            (error) => {
              cleanup();
              reject(error);
            },
          );
          if (signal?.aborted) abort();
        });
      } else {
        state.probe = new Promise((resolve) => {
          state.release = resolve;
        });
        return true;
      }
    }
    return false;
  }
  async fetch(url: string, init: RequestInit = {}, fetcher: Fetcher): Promise<Response> {
    const target = new URL(url);
    if (!['http:', 'https:'].includes(target.protocol)) return fetcher(url, init);
    const key = this.key(target);
    let state = this.providers.get(key);
    if (!state) {
      // Only public origins are retained, never signed URLs or request headers.
      if (this.providers.size >= 128) {
        for (const [oldKey, old] of this.providers)
          if (!old.throttled && !old.probe) {
            this.providers.delete(oldKey);
            break;
          }
      }
      state = { until: 0, revision: 0, throttled: false, probe: null, release: null };
      if (this.providers.size < 128) this.providers.set(key, state);
    }
    const deadline = this.now() + 15000;
    const replay = this.replayable(target, init);
    for (let attempt = 0; ; attempt++) {
      init.signal?.throwIfAborted();
      const probe = state.throttled
        ? await this.gate(state, deadline, init.signal ?? undefined)
        : false;
      const revision = state.revision;
      let response: Response;
      try {
        init.signal?.throwIfAborted();
        response = await fetcher(url, init);
        if (init.signal?.aborted) {
          await response.body?.cancel().catch(() => {});
          init.signal.throwIfAborted();
        }
        const retryAfter = parseRetryAfter(
          response.headers?.get?.('retry-after') ?? null,
          this.now(),
        );
        const limited = response.status === 429 || (response.status === 503 && retryAfter !== null);
        if (!limited) {
          if (probe && revision === state.revision) {
            state.throttled = false;
            state.until = 0;
          }
          return response;
        }
        const delay = retryAfter ?? Math.min(4000, 500 * 2 ** attempt);
        state.until = Math.max(state.until, this.now() + delay);
        state.throttled = true;
        state.revision++;
        if (!replay || attempt >= 2 || state.until > deadline) return response;
        await response.body?.cancel().catch(() => {});
      } finally {
        if (probe) {
          const release = state.release;
          state.probe = null;
          state.release = null;
          release?.();
        }
      }
    }
  }
}
