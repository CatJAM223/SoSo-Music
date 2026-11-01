import type { PlaybackDiagnostic } from './playbackDiagnostics.ts';

/** Aggregate only numeric operational data; titles, URLs and account data never enter the report. */
export function summarizePlaybackQuality(events: readonly PlaybackDiagnostic[]) {
  const sources = new Map<
    string,
    {
      attempts: number;
      automaticRetries: number;
      started: number;
      failed: number;
      cancelled: number;
      interrupted: number;
      bufferingEpisodes: number;
      bufferingMs: number;
      recoveryAttempts: number;
      recovered: number;
      recoveryFailures: number;
      recoveryCancelled: number;
      latencies: number[];
      failures: Record<string, number>;
    }
  >();
  for (const event of events) {
    const source = ['youtube', 'soundcloud', 'deezer'].includes(event.source)
      ? event.source
      : 'unknown';
    let row = sources.get(source);
    if (!row) {
      row = {
        attempts: 0,
        automaticRetries: 0,
        started: 0,
        failed: 0,
        cancelled: 0,
        interrupted: 0,
        bufferingEpisodes: 0,
        bufferingMs: 0,
        latencies: [],
        failures: {},
        recoveryAttempts: 0,
        recovered: 0,
        recoveryFailures: 0,
        recoveryCancelled: 0,
      };
      sources.set(source, row);
    }
    if (event.event === 'playback-attempt') {
      row.attempts++;
      if (event.automaticRetry) row.automaticRetries++;
    } else if (event.event === 'playback-outcome') {
      if (event.outcome === 'started') {
        row.started++;
        if (Number.isFinite(event.elapsedMs) && event.elapsedMs! >= 0)
          row.latencies.push(event.elapsedMs!);
      } else if (event.outcome === 'failed') {
        row.failed++;
        const reason = safeReason(event.reason);
        row.failures[reason] = (row.failures[reason] || 0) + 1;
      } else if (event.outcome === 'cancelled') row.cancelled++;
    } else if (event.event === 'playback-recovery') {
      if (event.recoveryOutcome === 'started') row.recoveryAttempts++;
      else if (event.recoveryOutcome === 'recovered') row.recovered++;
      else if (event.recoveryOutcome === 'failed') row.recoveryFailures++;
      else if (event.recoveryOutcome === 'cancelled') row.recoveryCancelled++;
    } else if (event.event === 'playback-interruption') row.interrupted++;
    else if (
      event.event === 'playback-buffering' &&
      Number.isFinite(event.durationMs) &&
      event.durationMs! >= 0
    ) {
      row.bufferingEpisodes++;
      row.bufferingMs += event.durationMs!;
    }
  }
  return [...sources].map(([source, { latencies, ...row }]) => {
    latencies.sort((a, b) => a - b);
    const quantile = (q: number) =>
      latencies.length ? latencies[Math.max(0, Math.ceil(latencies.length * q) - 1)] : null;
    return {
      source,
      ...row,
      // Rotation can cut either end of an attempt; do not call unmatched entries failures.
      unmatchedAttempts: Math.max(0, row.attempts - row.started - row.failed - row.cancelled),
      latencySamples: latencies.length,
      startupMedianMs: quantile(0.5),
      startupP95Ms: quantile(0.95),
    };
  });
}

function safeReason(reason?: string): string {
  return [
    'network',
    'timeout',
    'provider',
    'rate-limit',
    'unavailable',
    'consecutive-errors',
    'decoder-stall',
    'sign-in-required',
    'verification-required',
    'age-restricted',
    'play-rejected',
  ].includes(reason || '')
    ? reason!
    : 'other';
}
