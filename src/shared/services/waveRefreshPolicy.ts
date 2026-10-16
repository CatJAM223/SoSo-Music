import type { WavePlaybackReason } from '../utils/waveFeedback.ts';

export const WAVE_REFRESH_COOLDOWN_MS = 60_000;
export const WAVE_REFRESH_PENDING_LIMIT = 50;
const SKIPS_TO_REFRESH = 3;

/** User skips can redirect candidate generation without creating a request per click. */
export function createWaveRefreshPolicy(now: () => number = Date.now) {
  const skipped = new Set<string>();
  let lastId: string | null = null;
  let refreshedAt: number | null = null;
  return {
    observe(id: string | number, seconds: number, duration: number, reason: WavePlaybackReason) {
      if (
        reason === 'error' ||
        reason === 'interrupted' ||
        !Number.isFinite(seconds) ||
        seconds < 0
      )
        return false;
      const key = String(id);
      if (lastId === key) return false;
      lastId = key;
      const threshold =
        Number.isFinite(duration) && duration > 0 ? Math.min(25, duration * 0.15) : 15;
      if (reason !== 'skip' || seconds >= threshold) {
        skipped.clear();
        return false;
      }
      skipped.add(key);
      if (skipped.size < SKIPS_TO_REFRESH) return false;
      const stamp = now();
      if (refreshedAt !== null && stamp - refreshedAt < WAVE_REFRESH_COOLDOWN_MS) {
        // Keep the evidence bounded even during prolonged rapid skipping.
        skipped.delete(skipped.values().next().value!);
        return false;
      }
      refreshedAt = stamp;
      skipped.clear();
      return true;
    },
    accept() {
      skipped.clear();
    },
    reset() {
      skipped.clear();
      lastId = null;
      refreshedAt = null;
    },
  };
}
