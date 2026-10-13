import { requestSignal } from '../../../shared/utils/requestSignal.ts';
import {
  createStreamResolveError,
  streamHttpFailure,
  streamTransportFailure,
  type StreamResolveFailure,
} from '../../../shared/utils/streamResolveError.ts';
import { PlaybackLogger } from './playbackLogger.ts';
import { withSoundCloudClientId } from '../../../shared/utils/soundcloudUrl.ts';
import { desktopFetch, recoverDesktopNetwork } from './desktopFetch.ts';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

export class SoundCloudTransport {
  static fetch(url: string, init?: RequestInit): Promise<Response> {
    return desktopFetch(url, init);
  }

  static async fetchJson(
    endpoint: string,
    proxyUrl: string,
    refreshKey: () => Promise<string>,
    isRetry = false,
    retryTransient = false,
    strictPlayback = retryTransient,
    signal?: AbortSignal,
  ): Promise<any> {
    signal?.throwIfAborted();
    let transientFailure = false;
    let failure: StreamResolveFailure | null = null;
    try {
      const response = await this.fetch(endpoint, {
        headers: { 'User-Agent': USER_AGENT },
        signal: requestSignal(signal, 8000),
      });
      if (response.ok) return await response.json();
      await response.body?.cancel().catch(() => {});
      const requestPath = new URL(endpoint).pathname;
      const kind = requestPath.includes('/media/')
        ? 'media'
        : requestPath.includes('/search/')
          ? 'search'
          : 'metadata';
      PlaybackLogger.warn(
        '[SoundCloud:HTTP] kind=' + kind + ' status=' + response.status + ' keyRetry=' + isRetry,
      );
      failure = streamHttpFailure(response.status);
      transientFailure = response.status >= 500;
      if ((response.status === 401 || response.status === 403) && !isRetry) {
        signal?.throwIfAborted();
        const key = await refreshKey();
        signal?.throwIfAborted();
        if (key)
          return this.fetchJson(
            withSoundCloudClientId(endpoint, key),
            proxyUrl,
            refreshKey,
            true,
            retryTransient,
            strictPlayback,
            signal,
          );
      }
    } catch (error) {
      signal?.throwIfAborted();
      transientFailure = true;
      failure = streamTransportFailure(error);
      console.debug('[SoundCloudTransport] Direct request failed:', error);
    }
    // Playback may recover a dropped connection once; typing/search never multiplies retries.
    if (transientFailure && retryTransient) {
      try {
        await recoverDesktopNetwork();
      } catch {
        /* Retry the request even if proxy reload failed. */
      }
      return this.fetchJson(endpoint, proxyUrl, refreshKey, isRetry, false, strictPlayback, signal);
    }
    if (!proxyUrl) {
      if (strictPlayback && failure) throw createStreamResolveError(failure);
      return null;
    }
    try {
      const proxyEndpoint =
        proxyUrl.includes('?url=') || proxyUrl.endsWith('=')
          ? `${proxyUrl}${encodeURIComponent(endpoint)}`
          : proxyUrl.includes('?')
            ? `${proxyUrl}&url=${encodeURIComponent(endpoint)}`
            : `${proxyUrl.endsWith('/') ? proxyUrl : `${proxyUrl}/`}${encodeURIComponent(endpoint)}`;
      const response = await this.fetch(proxyEndpoint, {
        headers: { 'User-Agent': USER_AGENT },
        signal: requestSignal(signal, 8000),
      });
      if (response.ok) return await response.json();
      await response.body?.cancel().catch(() => {});
      PlaybackLogger.warn('[SoundCloud:HTTP] kind=relay status=' + response.status);
      failure = streamHttpFailure(response.status) || failure;
    } catch (error) {
      signal?.throwIfAborted();
      failure = streamTransportFailure(error);
      console.debug('[SoundCloudTransport] Proxy request failed:', error);
    }
    if (strictPlayback && failure) throw createStreamResolveError(failure);
    return null;
  }
}
