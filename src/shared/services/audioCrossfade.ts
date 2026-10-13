import { calculateFadeInVolume, calculateFadeOutVolume } from '../utils/crossfade.ts';
import { setAudioFadeVolume, resetAudioFadeVolume } from '../utils/audioVolume.ts';

/** Owns both envelopes until the replacement is actually audible. */
export class AudioCrossfade {
  private outgoing: HTMLAudioElement | null = null;
  private incoming: HTMLAudioElement | null = null;
  private disposeStream: (() => void) | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;
  private volume: (() => number) | null = null;
  private completed: (() => void) | null = null;
  private duration = 0;
  private elapsed = 0;
  private lastTick = 0;
  private waiting = false;
  private markWaiting = () => {
    this.waiting = true;
    this.lastTick = performance.now();
  };
  private markPlaying = () => {
    this.waiting = false;
    this.lastTick = performance.now();
  };
  private markStalled = () => {
    // A network stalled event can arrive while decoded/buffered audio is still playing.
    if (this.incoming && this.incoming.readyState < 3) this.markWaiting();
  };
  private markCanPlay = () => {
    if (this.incoming && !this.incoming.paused && this.incoming.readyState >= 3) this.markPlaying();
  };

  get sourceUrl(): string | null {
    return this.outgoing?.getAttribute('src') || null;
  }
  get active(): boolean {
    return this.outgoing !== null;
  }
  owns(audio: HTMLAudioElement): boolean {
    return this.outgoing === audio;
  }

  hold(audio: HTMLAudioElement, dispose?: () => void, volume?: () => number): void {
    this.stop();
    this.outgoing = audio;
    this.disposeStream = dispose || null;
    this.volume = volume || null;
    // Volume and mute changes also apply while the next URL is still resolving.
    this.lastTick = performance.now();
    this.interval = setInterval(() => this.tick(), 25);
  }

  start(
    incoming: HTMLAudioElement,
    seconds: number,
    volume: () => number,
    completed?: () => void,
  ): boolean {
    const outgoing = this.outgoing;
    if (
      !outgoing ||
      outgoing.paused ||
      outgoing.ended ||
      !Number.isFinite(seconds) ||
      seconds <= 0
    ) {
      this.stop();
      return false;
    }
    if (this.incoming) return this.incoming === incoming;
    const remaining = outgoing.duration - outgoing.currentTime;
    this.duration =
      Math.min(seconds, Number.isFinite(remaining) ? Math.max(0.05, remaining) : seconds) * 1000;
    this.incoming = incoming;
    this.volume = volume;
    this.completed = completed || null;
    this.elapsed = 0;
    this.lastTick = performance.now();
    this.waiting = false;
    incoming.addEventListener?.('waiting', this.markWaiting);
    incoming.addEventListener?.('stalled', this.markStalled);
    incoming.addEventListener?.('canplay', this.markCanPlay);
    incoming.addEventListener?.('playing', this.markPlaying);
    setAudioFadeVolume(incoming, volume(), 0);
    return true;
  }

  private tick(): void {
    const outgoing = this.outgoing;
    if (!outgoing) return;
    const now = performance.now(),
      delta = Math.max(0, now - this.lastTick);
    this.lastTick = now;
    const target = this.volume ? this.volume() : outgoing.volume;
    const incoming = this.incoming;
    // Settings own the current element; the held element also needs its mute flag synchronized.
    outgoing.muted = target <= 0;
    if (incoming) incoming.muted = target <= 0;
    if (!incoming) {
      setAudioFadeVolume(outgoing, target, 1);
      if (outgoing.ended || outgoing.paused) this.stop();
      return;
    }
    if (incoming.paused || incoming.error) {
      this.stop();
      return;
    }
    // A blocked incoming decoder must not consume the healthy outgoing track's fade time.
    const ready = !this.waiting && (incoming.readyState === undefined || incoming.readyState >= 3);
    if (ready) this.elapsed += delta;
    const progress = Math.min(1, this.elapsed / this.duration);
    setAudioFadeVolume(outgoing, target, calculateFadeOutVolume(1, progress));
    setAudioFadeVolume(incoming, target, calculateFadeInVolume(1, progress));
    if (ready && (progress >= 1 || outgoing.ended || outgoing.paused || outgoing.error))
      this.stop();
  }

  stop(): void {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
    const incoming = this.incoming,
      completed = this.completed;
    this.incoming = null;
    this.completed = null;
    if (incoming) {
      incoming.removeEventListener?.('waiting', this.markWaiting);
      incoming.removeEventListener?.('stalled', this.markStalled);
      incoming.removeEventListener?.('canplay', this.markCanPlay);
      incoming.removeEventListener?.('playing', this.markPlaying);
      if (this.volume) setAudioFadeVolume(incoming, this.volume(), 1);
      else resetAudioFadeVolume(incoming);
    }
    this.outgoing?.pause();
    this.disposeStream?.();
    if (this.outgoing) {
      this.outgoing.removeAttribute('src');
      this.outgoing.load();
      (this.outgoing as HTMLAudioElement & { dispose?: () => void }).dispose?.();
    }
    this.outgoing = null;
    this.disposeStream = null;
    this.volume = null;
    completed?.();
  }
}
