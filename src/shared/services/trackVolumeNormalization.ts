import { rustComputeBytes } from '../compute/rustCore.ts';
import type { LoudnessStats } from '../compute/audioCore.ts';
import { audioEqualizer } from './audioEqualizer.ts';
import { PlaybackLogger } from './playbackLogger.ts';
import {
  registerAudioVolumeWriter,
  releaseAudioVolumeWriter,
  resetAudioFadeVolume,
} from '../utils/audioVolume.ts';
import { LoudnessProfiles, normalizationGain, recordingKey } from '../utils/recordingLoudness.ts';
type AudioTarget = HTMLAudioElement & {
  captureStream?: () => MediaStream;
  setTrackNormalization?: (key: string | null, enabled: boolean, gainDb?: number | null) => void;
};
type Capture = {
  context: AudioContext;
  stream: MediaStream;
  nodes: AudioNode[];
  worklet: AudioWorkletNode | null;
  stats: LoudnessStats | null;
  readyTimer: ReturnType<typeof setTimeout> | null;
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
  generation: number;
  capture: Capture | null;
  write: (volume: number) => void;
  start: () => void;
  stop: () => void;
  seek: () => void;
  seeked: () => void;
  original: PropertyDescriptor | undefined;
}
/** Analysis uses a silent branch; fixed recording correction uses the shared output graph. */
export class TrackVolumeNormalization {
  private controllers = new Map<AudioTarget, Controller>();
  private profiles: LoudnessProfiles;
  private enabled = false;
  private outputGain?: (audio: HTMLAudioElement, gain: number) => boolean;
  constructor(
    storage?: Pick<Storage, 'getItem' | 'setItem'>,
    outputGain?: (audio: HTMLAudioElement, gain: number) => boolean,
  ) {
    this.outputGain = outputGain;
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
      generation: 0,
      capture: null,
      write,
      start: () => {},
      stop: () => {},
      seek: () => {},
      seeked: () => {},
      original: Object.getOwnPropertyDescriptor(audio, 'volume'),
    };
    c.start = () => {
      c.started = true;
      void this.capture(c);
    };
    c.stop = () => {
      const capture = c.capture;
      if (!capture) return;
      capture.worklet?.port.postMessage({ type: 'active', active: false });
      if (capture.readyTimer) clearTimeout(capture.readyTimer);
      capture.readyTimer = null;
      void capture.context.suspend().catch(() => {});
      this.saveProfile(c, capture);
    };
    c.seek = () => c.capture?.worklet?.port.postMessage({ type: 'active', active: false });
    c.seeked = () =>
      c.capture?.worklet?.port.postMessage({ type: 'active', active: !c.audio.paused });
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
    audio.addEventListener('seeking', c.seek);
    audio.addEventListener('seeked', c.seeked);
  }
  prepare(audio: AudioTarget, track: { id: string | number; source?: string }): void {
    this.attach(audio);
    const c = this.controllers.get(audio);
    if (!c) return;
    resetAudioFadeVolume(audio);
    this.stopCapture(c);
    c.key = recordingKey(track);
    c.started = false;
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
      this.stopCapture(c, false);
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
    this.outputGain?.(audio, 1);
    for (const event of ['playing', 'pause', 'emptied', 'ended'])
      audio.removeEventListener(event, event === 'playing' ? c.start : c.stop);
    if (!audio.setTrackNormalization) {
      if (c.original) Object.defineProperty(audio, 'volume', c.original);
      else delete (audio as Partial<HTMLAudioElement>).volume;
      c.write(c.logicalVolume);
    }
    audio.removeEventListener('seeking', c.seek);
    audio.removeEventListener('seeked', c.seeked);
    releaseAudioVolumeWriter(audio);
    this.controllers.delete(audio);
  }
  private writeVolume(c: Controller): void {
    // Graph gain is independent of the bounded slider and fade. Without Web Audio,
    // saturate the endpoint before fading so boosting cannot flatten the envelope.
    const gain = this.enabled ? c.gain : 1;
    const graphOwnsGain = this.outputGain?.(c.audio, gain) ?? false;
    c.write((graphOwnsGain ? c.baseVolume : Math.min(1, c.baseVolume * gain)) * c.fadeFactor);
  }
  getGain(audio: AudioTarget): number {
    return this.controllers.get(audio)?.gain ?? 1;
  }
  private saveProfile(c: Controller, capture: Capture): void {
    const stats = capture.stats;
    if (!stats || !Number.isFinite(stats.gainDb)) return;
    this.profiles.set(c.key, stats.gainDb);
    // Apply only when the recording starts again, preserving a fixed gain during playback.
  }
  private watchCapture(c: Controller, capture: Capture): void {
    if (capture.readyTimer) clearTimeout(capture.readyTimer);
    capture.readyTimer = setTimeout(() => {
      if (c.capture === capture && !c.audio.paused) this.stopCapture(c);
    }, 15000);
  }
  private stopCapture(c: Controller, save = true): void {
    c.generation++;
    const capture = c.capture;
    c.capture = null;
    if (!capture) return;
    if (save) this.saveProfile(c, capture);
    if (capture.readyTimer) clearTimeout(capture.readyTimer);
    if (capture.worklet) {
      capture.worklet.port.onmessage = null;
      capture.worklet.port.close();
    }
    capture.nodes.forEach((node) => {
      try {
        node.disconnect();
      } catch {}
    });
    capture.stream.getTracks().forEach((track) => track.stop());
    void capture.context.close().catch(() => {});
  }
  private async capture(c: Controller): Promise<void> {
    if (c.capture) {
      this.watchCapture(c, c.capture);
      c.capture.worklet?.port.postMessage({ type: 'active', active: !c.audio.seeking });
      void c.capture.context.resume().catch(() => {});
      return;
    }
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
      const context = new AudioContext({ sampleRate: 48000 });
      capture = { stream, context, nodes: [], worklet: null, stats: null, readyTimer: null };
      c.capture = capture;
      await context.resume();
      if (generation !== c.generation || c.audio.paused || !this.enabled) {
        if (c.capture === capture) this.stopCapture(c);
        return;
      }
      const workletUrl = new URL('compute/soso-normalization.js', document.baseURI).href;
      await context.audioWorklet.addModule(workletUrl);
      if (generation !== c.generation || c.capture !== capture) return;
      const source = context.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(context, 'soso-normalization', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        channelCount: 2,
        channelCountMode: 'clamped-max',
      });
      capture.worklet = node;
      capture.nodes.push(source, node);
      // No samples are copied to the renderer. The worklet posts scalar metadata once a second.
      node.port.onmessage = ({ data }) => {
        if (generation !== c.generation || c.capture !== capture) return;
        if (data.type === 'ready') {
          if (capture!.readyTimer) clearTimeout(capture!.readyTimer);
          this.watchCapture(c, capture!);
        } else if (data.type === 'stats') {
          this.watchCapture(c, capture!);
          capture!.stats = data.stats;
          this.saveProfile(c, capture!);
        } else if (data.type === 'error') {
          this.stopCapture(c);
          PlaybackLogger.debug('[AudioPlayer:Normalization] Rust analysis unavailable', {
            recording: c.key,
          });
        }
      };
      node.onprocessorerror = () => {
        if (c.capture === capture) this.stopCapture(c);
      };
      capture.readyTimer = setTimeout(() => {
        if (c.capture === capture) this.stopCapture(c);
      }, 10000);
      node.port.postMessage({ type: 'init', bytes: rustComputeBytes() });
      node.port.postMessage({ type: 'active', active: !c.audio.paused && !c.audio.seeking });
      source.connect(node);
      node.connect(context.destination);
      if (c.audio.paused) void context.suspend().catch(() => {});
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
    instance = new TrackVolumeNormalization(storage, (audio, gain) =>
      audioEqualizer().setNormalizationGain(audio, gain),
    );
  }
  return instance;
}
