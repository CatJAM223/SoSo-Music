import { PlaybackLogger } from './playbackLogger.ts';
import {
  registerAudioVolumeWriter,
  releaseAudioVolumeWriter,
  resetAudioFadeVolume,
} from '../utils/audioVolume.ts';
import {
  RecordingLoudness,
  LoudnessProfiles,
  normalizationGain,
  recordingKey,
} from '../utils/recordingLoudness.ts';
type AudioTarget = HTMLAudioElement & {
  captureStream?: () => MediaStream;
  setTrackNormalization?: (key: string | null, enabled: boolean, gainDb?: number | null) => void;
};
type Capture = {
  context: AudioContext;
  stream: MediaStream;
  nodes: AudioNode[];
  timer: ReturnType<typeof setInterval> | null;
};
interface Controller {
  audio: AudioTarget;
  key: string;
  logicalVolume: number;
  baseVolume: number;
  fadeFactor: number;
  gain: number;
  known: boolean;
  started: boolean;
  meter: RecordingLoudness;
  generation: number;
  capture: Capture | null;
  write: (volume: number) => void;
  start: () => void;
  stop: () => void;
  original: PropertyDescriptor | undefined;
}
/** Analysis is a separate, silent branch; the normal playback decoder/output is untouched. */
export class TrackVolumeNormalization {
  private controllers = new Map<AudioTarget, Controller>();
  private profiles: LoudnessProfiles;
  private enabled = false;
  constructor(storage?: Pick<Storage, 'getItem' | 'setItem'>) {
    this.profiles = new LoudnessProfiles(storage);
    try {
      this.enabled = storage?.getItem('soso_volume_normalization') === 'true';
    } catch {}
  }
  attach(audio: AudioTarget): void {
    if (this.controllers.has(audio)) return;
    let proto: object | null = audio,
      descriptor: PropertyDescriptor | undefined;
    while (proto && !descriptor) {
      descriptor = Object.getOwnPropertyDescriptor(proto, 'volume');
      proto = Object.getPrototypeOf(proto);
    }
    if (!audio.setTrackNormalization && (!descriptor?.get || !descriptor?.set)) return;
    const write = audio.setTrackNormalization
      ? (_value: number) => {}
      : (value: number) => descriptor!.set!.call(audio, Math.max(0, Math.min(1, value)));
    const c: Controller = {
      audio,
      key: '',
      logicalVolume: audio.volume,
      baseVolume: audio.volume,
      fadeFactor: 1,
      gain: 1,
      known: false,
      started: false,
      meter: new RecordingLoudness(),
      generation: 0,
      capture: null,
      write,
      start: () => {},
      stop: () => {},
      original: Object.getOwnPropertyDescriptor(audio, 'volume'),
    };
    c.start = () => {
      c.started = true;
      void this.capture(c);
    };
    c.stop = () => this.stopCapture(c);
    if (!audio.setTrackNormalization)
      Object.defineProperty(audio, 'volume', {
        configurable: true,
        get: () => c.logicalVolume,
        set: (value: number) => {
          if (!Number.isFinite(value) || value < 0 || value > 1)
            throw new RangeError('Invalid audio volume');
          c.logicalVolume = value;
          c.baseVolume = value;
          c.fadeFactor = 1;
          this.writeVolume(c);
        },
      });
    if (!audio.setTrackNormalization)
      registerAudioVolumeWriter(audio, (volume, factor) => {
        c.baseVolume = volume;
        c.fadeFactor = factor;
        c.logicalVolume = volume * factor;
        this.writeVolume(c);
      });
    this.controllers.set(audio, c);
    audio.addEventListener('playing', c.start);
    audio.addEventListener('pause', c.stop);
    audio.addEventListener('emptied', c.stop);
    audio.addEventListener('ended', c.stop);
  }
  prepare(audio: AudioTarget, track: { id: string | number; source?: string }): void {
    this.attach(audio);
    const c = this.controllers.get(audio);
    if (!c) return;
    resetAudioFadeVolume(audio);
    this.stopCapture(c);
    c.key = recordingKey(track);
    c.started = false;
    c.meter = new RecordingLoudness();
    const db = this.profiles.get(c.key);
    c.known = db !== null;
    c.gain = db === null ? 1 : normalizationGain(db);
    audio.setTrackNormalization?.(c.key, this.enabled, db);
    this.writeVolume(c);
    PlaybackLogger.debug('[AudioPlayer:Normalization] Recording prepared', {
      recording: c.key,
      enabled: this.enabled,
      profile: c.known ? 'known' : 'unknown',
      gainDb: db ?? 0,
      firstPlay: c.known ? 'fixed-gain' : 'unchanged',
    });
  }
  remember(track: { id: string | number; source?: string }, db: number): void {
    if (!Number.isFinite(db)) return;
    const key = recordingKey(track);
    if (!key) return;
    db = Math.max(-24, Math.min(18, db));
    this.profiles.set(key, db);
    for (const c of this.controllers.values()) {
      if (c.key !== key) continue;
      c.known = true;
      this.stopCapture(c);
      // Late metadata is saved for the next play, never applied halfway through a song.
      if (!c.started) {
        c.gain = normalizationGain(db);
        c.audio.setTrackNormalization?.(c.key, this.enabled, db);
        this.writeVolume(c);
      }
    }
  }
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    for (const c of this.controllers.values()) {
      c.audio.setTrackNormalization?.(null, enabled);
      this.writeVolume(c);
      if (!enabled) this.stopCapture(c);
      else if (!c.audio.paused) c.start();
    }
  }
  release(audio: AudioTarget): void {
    const c = this.controllers.get(audio);
    if (!c) return;
    this.stopCapture(c);
    for (const event of ['playing', 'pause', 'emptied', 'ended'])
      audio.removeEventListener(event, event === 'playing' ? c.start : c.stop);
    if (!audio.setTrackNormalization) {
      if (c.original) Object.defineProperty(audio, 'volume', c.original);
      else delete (audio as Partial<HTMLAudioElement>).volume;
      c.write(c.logicalVolume);
    }
    releaseAudioVolumeWriter(audio);
    this.controllers.delete(audio);
  }
  private writeVolume(c: Controller): void {
    // Saturate the normalized endpoint before fading; boosting must not flatten the envelope.
    c.write(Math.min(1, c.baseVolume * (this.enabled ? c.gain : 1)) * c.fadeFactor);
  }
  getGain(audio: AudioTarget): number {
    return this.controllers.get(audio)?.gain ?? 1;
  }
  private stopCapture(c: Controller): void {
    c.generation++;
    const capture = c.capture;
    c.capture = null;
    if (!capture) return;
    if (capture.timer) clearInterval(capture.timer);
    capture.nodes.forEach((node) => {
      try {
        node.disconnect();
      } catch {}
    });
    capture.stream.getTracks().forEach((track) => track.stop());
    void capture.context.close().catch(() => {});
  }
  private async capture(c: Controller): Promise<void> {
    if (
      !this.enabled ||
      !c.key ||
      c.known ||
      c.capture ||
      c.audio.paused ||
      !c.audio.captureStream ||
      typeof AudioContext === 'undefined'
    )
      return;
    const generation = ++c.generation;
    let capture: Capture | null = null;
    let stream: MediaStream | null = null;
    try {
      stream = c.audio.captureStream();
      const context = new AudioContext({ sampleRate: 24000 });
      capture = { stream, context, nodes: [], timer: null };
      c.capture = capture;
      await context.resume();
      if (generation !== c.generation || c.audio.paused || !this.enabled) {
        if (c.capture === capture) this.stopCapture(c);
        return;
      }
      const source = context.createMediaStreamSource(stream),
        splitter = context.createChannelSplitter(2);
      const silent = context.createGain();
      silent.gain.value = 0;
      source.connect(splitter);
      silent.connect(context.destination);
      capture.nodes.push(source, splitter, silent);
      const meters = [0, 1].map((channel) => {
        const shelf = context.createBiquadFilter();
        shelf.type = 'highshelf';
        shelf.frequency.value = 1500;
        shelf.gain.value = 4;
        const highpass = context.createBiquadFilter();
        highpass.type = 'highpass';
        highpass.frequency.value = 60;
        highpass.Q.value = 0.5;
        const analyser = context.createAnalyser();
        analyser.fftSize = 4096;
        splitter.connect(shelf, channel);
        shelf.connect(highpass);
        highpass.connect(analyser);
        analyser.connect(silent);
        capture!.nodes.push(shelf, highpass, analyser);
        return { analyser, samples: new Float32Array(4096) };
      });
      const began = performance.now();
      capture.timer = setInterval(() => {
        if (generation !== c.generation || c.capture !== capture) return;
        if (!c.audio.paused && !c.audio.seeking && c.audio.readyState >= 2) {
          let power = 0;
          for (const meter of meters) {
            meter.analyser.getFloatTimeDomainData(meter.samples);
            let sum = 0;
            for (const sample of meter.samples) sum += sample * sample;
            power += sum / meter.samples.length;
          }
          c.meter.addPower(power);
          const db = c.meter.gainDb();
          if (db !== null && c.meter.frames >= 80) {
            this.profiles.set(c.key, db);
            c.known = true;
            PlaybackLogger.debug(
              '[AudioPlayer:Normalization] Estimated profile saved for the next playback',
              { recording: c.key, gainDb: db, frames: c.meter.frames },
            );
            this.stopCapture(c);
            return;
          }
        }
        // Silence/inaccessible cross-origin audio must never be boosted or analysed indefinitely.
        if (performance.now() - began > 45000) {
          PlaybackLogger.debug(
            '[AudioPlayer:Normalization] Analysis stopped without a usable profile',
            { recording: c.key, frames: c.meter.frames },
          );
          this.stopCapture(c);
        }
      }, 200);
    } catch {
      if (capture && c.capture === capture) this.stopCapture(c);
      else if (!capture) stream?.getTracks().forEach((track) => track.stop());
      PlaybackLogger.debug(
        '[AudioPlayer:Normalization] Analysis unavailable; keeping the current gain',
        { recording: c.key },
      );
      // A failed analysis never changes the working playback path.
    }
  }
}
let instance: TrackVolumeNormalization | null = null;
export function trackVolumeNormalization(): TrackVolumeNormalization {
  if (!instance) {
    let storage: Storage | undefined;
    try {
      storage = globalThis.localStorage;
    } catch {}
    instance = new TrackVolumeNormalization(storage);
  }
  return instance;
}
