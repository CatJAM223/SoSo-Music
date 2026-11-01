import { performance } from 'node:perf_hooks';
import { PlaybackLogger } from './playbackLogger.ts';
import { currentStreamResolveSignal, streamWait } from './streamResolveContext.ts';

type Stage =
  | 'session-wait'
  | 'account'
  | 'visitor'
  | 'player-request'
  | 'player-body'
  | 'account-cookies'
  | 'account-bootstrap'
  | 'account-player'
  | 'account-watch'
  | 'account-extract'
  | 'account-delivery';

/** Inclusive wait durations: account contains its more detailed account-* stages. */
export async function timeYouTubeResolve<T>(
  videoId: string,
  stage: Stage,
  task: () => T | PromiseLike<T>,
): Promise<T> {
  const start = performance.now();
  let outcome = 'failed';
  try {
    const result = await streamWait(task());
    outcome = 'ok';
    return result;
  } finally {
    const elapsedMs = Math.max(0, Math.round(performance.now() - start));
    if (elapsedMs >= 2000) {
      if (currentStreamResolveSignal()?.aborted) outcome = 'cancelled';
      // IDs and fixed stage names only; never log signed addresses, cookies or error bodies.
      try {
        PlaybackLogger.info(
          `[YouTubeMusic:Timing] track=${videoId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64)} stage=${stage} elapsedMs=${elapsedMs} outcome=${outcome}`,
        );
      } catch {
        /* Diagnostics must not replace a stream result or provider failure. */
      }
    }
  }
}
