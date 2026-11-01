export type PlaybackDiagnostic = {
  event:
    | 'playback-attempt'
    | 'playback-outcome'
    | 'playback-buffering'
    | 'playback-interruption'
    | 'playback-recovery';
  requestId: number;
  source: string;
  trackId: string | number;
  elapsedMs?: number;
  outcome?: 'started' | 'failed' | 'cancelled';
  reason?: string;
  delivery?: string;
  durationMs?: number;
  automaticRetry?: boolean;
  recoveryOutcome?: 'started' | 'recovered' | 'failed' | 'cancelled';
};

/** One terminal startup outcome per request; repeated DOM events cannot inflate success counts. */
export class PlaybackDiagnostics {
  private attempt: {
    requestId: number;
    source: string;
    trackId: string | number;
    startedAt: number;
    outcome?: PlaybackDiagnostic['outcome'];
    delivery?: string;
    waitingAt?: number;
    interrupted?: boolean;
    recoveryStartedAt?: number;
  } | null = null;

  private emit: (event: PlaybackDiagnostic) => void;
  private now: () => number;

  constructor(
    emit: (event: PlaybackDiagnostic) => void,
    now: () => number = () => performance.now(),
  ) {
    this.emit = emit;
    this.now = now;
  }

  begin(
    requestId: number,
    trackId: string | number,
    source: string,
    startedAt = this.now(),
    automaticRetry = false,
  ): void {
    this.cancel('superseded');
    this.attempt = { requestId, trackId, source, startedAt };
    this.send({ event: 'playback-attempt', automaticRetry });
  }

  private send(event: Partial<PlaybackDiagnostic> & Pick<PlaybackDiagnostic, 'event'>): void {
    if (!this.attempt) return;
    const { requestId, trackId, source, delivery } = this.attempt;
    // Diagnostic delivery must never throw into audio control or recovery.
    try {
      this.emit({ requestId, trackId, source, delivery, ...event });
    } catch {}
  }

  private closeBuffer(reason: string): void {
    if (this.attempt?.waitingAt === undefined) return;
    const durationMs = Math.max(0, this.now() - this.attempt.waitingAt);
    this.attempt.waitingAt = undefined;
    this.send({ event: 'playback-buffering', durationMs, reason });
  }

  private outcome(outcome: NonNullable<PlaybackDiagnostic['outcome']>, reason?: string): void {
    if (!this.attempt || this.attempt.outcome) return;
    this.attempt.outcome = outcome;
    this.send({
      event: 'playback-outcome',
      outcome,
      reason,
      elapsedMs: Math.max(0, this.now() - this.attempt.startedAt),
    });
  }

  playing(delivery: string): void {
    if (!this.attempt || this.attempt.outcome === 'cancelled') return;
    this.attempt.delivery = delivery;
    this.closeBuffer('recovered');
    this.closeRecovery('recovered');
    this.attempt.interrupted = false;
    this.outcome('started');
  }

  waiting(): void {
    if (this.attempt?.outcome === 'started' && this.attempt.waitingAt === undefined)
      this.attempt.waitingAt = this.now();
  }

  resume(requestId: number, trackId: string | number, source: string): void {
    if (!this.attempt) this.begin(requestId, trackId, source);
  }

  failed(reason: string): void {
    if (!this.attempt || this.attempt.outcome === 'cancelled') return;
    this.closeBuffer('failed');
    this.closeRecovery('failed');
    if (this.attempt.outcome === 'started' && !this.attempt.interrupted) {
      this.attempt.interrupted = true;
      this.send({ event: 'playback-interruption', reason });
    }
    this.outcome('failed', reason);
  }

  pause(reason = 'pause'): void {
    this.closeBuffer(reason);
    this.closeRecovery('cancelled');
    if (this.attempt?.outcome !== 'started') this.cancel('pause');
  }

  cancel(reason: string): void {
    this.closeBuffer(reason);
    this.closeRecovery('cancelled');
    this.outcome('cancelled', reason);
    this.attempt = null;
  }

  recovering(): void {
    if (!this.attempt || this.attempt.recoveryStartedAt !== undefined) return;
    this.attempt.recoveryStartedAt = this.now();
    this.send({ event: 'playback-recovery', recoveryOutcome: 'started' });
  }

  private closeRecovery(recoveryOutcome: 'recovered' | 'failed' | 'cancelled'): void {
    if (this.attempt?.recoveryStartedAt === undefined) return;
    const durationMs = Math.max(0, this.now() - this.attempt.recoveryStartedAt);
    this.attempt.recoveryStartedAt = undefined;
    this.send({ event: 'playback-recovery', recoveryOutcome, durationMs });
  }
}
