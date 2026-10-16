export type ProgressRecovery = 'nudge' | 'reload' | 'exhausted';
export interface ProgressSample {
  requestId: number;
  source: string;
  position: number;
  now: number;
  shouldProgress: boolean;
}

/** Decoder recovery is separate from network starvation; attempts belong to one playback request. */
export class AudioProgressWatchdog {
  private requestId: number | undefined;
  private source = '';
  private position = 0;
  private since: number | null = null;
  private attempts = 0;
  private exhausted = false;
  suspend(): void {
    this.since = null;
  }
  observe(sample: ProgressSample): ProgressRecovery | null {
    if (sample.requestId !== this.requestId) {
      this.requestId = sample.requestId;
      this.attempts = 0;
      this.exhausted = false;
      this.since = null;
    }
    if (sample.source !== this.source) {
      this.source = sample.source;
      this.since = null;
    }
    if (
      !sample.shouldProgress ||
      !sample.source ||
      !Number.isFinite(sample.position) ||
      !Number.isFinite(sample.now)
    ) {
      this.suspend();
      return null;
    }
    if (
      this.since === null ||
      Math.abs(sample.position - this.position) > 0.05 ||
      sample.now < this.since
    ) {
      this.position = sample.position;
      this.since = sample.now;
      return null;
    }
    if (this.exhausted || sample.now - this.since < 4000) return null;
    this.since = sample.now;
    this.position = sample.position;
    if (this.attempts++ === 0) return 'nudge';
    if (this.attempts === 2) return 'reload';
    this.exhausted = true;
    return 'exhausted';
  }
}
