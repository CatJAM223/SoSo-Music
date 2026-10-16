import {
  assertStreamResolveActive,
  currentStreamResolveSignal,
  streamWait,
} from './streamResolveContext.ts';
import {
  createStreamResolveError,
  getStreamResolveFailure,
  streamHttpFailure,
} from '../../../shared/utils/streamResolveError.ts';
import { youtubeAccountMediaUserAgent } from './youtubeWatchPage.ts';
import { isYouTubeStreamUrl } from './youtubeAccountStream.ts';
import { YouTubeMusicTransport } from './youtubeMusicTransport.ts';
import { PlaybackLogger } from './playbackLogger.ts';

export type YouTubeMediaProbeResult =
  | { ok: true; url: string }
  | {
      ok: false;
      reason: 'cdn-http' | 'cdn-redirect' | 'cdn-response' | 'network';
      status?: number;
    };

/** A deliberately discarded Chromium response can already be aborted by a redirect. */
export async function discardYouTubeResponse(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    /* Cleanup must not replace the HTTP result. */
  }
}

/** Check delivery on the renderer's network route, without exposing account credentials. */
export async function probeYouTubeMedia(
  url: string,
  kind: 'audio' | 'video',
): Promise<YouTubeMediaProbeResult> {
  assertStreamResolveActive();
  if (!isYouTubeStreamUrl(url)) return { ok: false, reason: 'cdn-response' };
  // The resolver reads HLS manifests; segment errors remain the player's responsibility.
  if (/\.m3u8(?:[?#]|$)|\/manifest\/hls(?:_|\/|\?)/i.test(url)) return { ok: true, url };
  const signal = currentStreamResolveSignal()
    ? AbortSignal.any([currentStreamResolveSignal()!, AbortSignal.timeout(5000)])
    : AbortSignal.timeout(5000);
  try {
    for (let redirects = 0; redirects <= 2; redirects++) {
      const userAgent = youtubeAccountMediaUserAgent(url);
      const response = await streamWait(
        YouTubeMusicTransport.fetch(url, {
          headers: { Range: 'bytes=0-1023', ...(userAgent ? { 'User-Agent': userAgent } : {}) },
          cache: 'no-store',
          credentials: 'omit',
          redirect: 'manual',
          signal,
        }),
      );
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        await streamWait(discardYouTubeResponse(response));
        let next = '';
        try {
          if (location) next = new URL(location, url).href;
        } catch {
          assertStreamResolveActive();
          /* Reject invalid redirects. */
        }
        if (redirects < 2 && isYouTubeStreamUrl(next) && next !== url) {
          url = next;
          continue;
        }
        PlaybackLogger.warn(
          '[YouTubeMusic:MediaProbe] media=' +
            kind +
            ' failure=cdn-redirect status=' +
            response.status,
        );
        return { ok: false, reason: 'cdn-redirect', status: response.status };
      }
      const mime = (response.headers.get('content-type') || '').split(';')[0].trim();
      const acceptedMime =
        kind === 'video' ? /^video\//i.test(mime) : /^(audio|video)\/(mp4|webm)$/i.test(mime);
      if (![200, 206].includes(response.status) || !acceptedMime) {
        await streamWait(discardYouTubeResponse(response));
        const failure = streamHttpFailure(response.status);
        if (failure) throw createStreamResolveError(failure);
        const reason = [200, 206].includes(response.status) ? 'cdn-response' : 'cdn-http';
        PlaybackLogger.warn(
          '[YouTubeMusic:MediaProbe] media=' +
            kind +
            ' failure=' +
            reason +
            ' status=' +
            response.status +
            ' mediaMime=' +
            acceptedMime,
        );
        return { ok: false, reason, status: response.status };
      }
      const reader = response.body?.getReader();
      if (!reader) return { ok: false, reason: 'cdn-response' };
      try {
        const chunk = await streamWait(reader.read());
        if (!chunk.done && chunk.value?.byteLength) return { ok: true, url };
        return { ok: false, reason: 'cdn-response' };
      } finally {
        await streamWait(reader.cancel().catch(() => {}));
      }
    }
  } catch (error) {
    assertStreamResolveActive();
    if (getStreamResolveFailure(error)) throw error;
    PlaybackLogger.warn('[YouTubeMusic:MediaProbe] media=' + kind + ' failure=network');
    return { ok: false, reason: 'network' };
  }
  return { ok: false, reason: 'cdn-redirect' };
}
