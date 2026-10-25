import {
  EQUALIZER_KEY,
  EQUALIZER_PRESETS,
  EQUALIZER_Q,
  EQUALIZER_PRESET_TIME_CONSTANT,
  clampEqualizerGain,
  equalizerFilter,
  equalizerPresetId,
  equalizerResponse,
  readEqualizerSettings,
  type EqualizerSettings,
  type EqualizerResponse,
} from '../utils/equalizer.ts';
import { logger } from '../utils/logger.ts';

type Binding = {
  source: MediaElementAudioSourceNode;
  filters: BiquadFilterNode[];
  preamp: GainNode;
  normalization: GainNode;
  connected: boolean;
};
type Target = { start: () => void; stop: () => void; normalizationGain: number; binding?: Binding };
export class AudioEqualizer {
  private settings: EqualizerSettings;
  private context: AudioContext | null = null;
  private limiter: DynamicsCompressorNode | null = null;
  private targets = new Map<HTMLAudioElement, Target>();
  // A media element can have only one source node, including after release/reattach.
  private bindings = new WeakMap<HTMLAudioElement, Binding>();
  private listeners = new Set<() => void>();
  private response: EqualizerResponse;
  private error: string | null = null;
  private transitionKind: 'preset' | 'manual' = 'manual';
  private storage?: Pick<Storage, 'getItem' | 'setItem'>;
  constructor(storage?: Pick<Storage, 'getItem' | 'setItem'>) {
    this.storage = storage;
    let raw: string | null = null;
    try {
      raw = storage?.getItem(EQUALIZER_KEY) ?? null;
    } catch {}
    this.settings = readEqualizerSettings(raw);
    this.response = equalizerResponse(this.settings.gains);
  }
  getSnapshot = (): EqualizerSettings => this.settings;
  getResponse = (): EqualizerResponse => this.response;
  getError = (): string | null => this.error;
  getTransitionKind = (): 'preset' | 'manual' => this.transitionKind;
  getLiveGains = (): number[] | null => {
    if (this.context?.state !== 'running') return null;
    for (const [audio, target] of this.targets) {
      if (!audio.paused && !audio.ended && target.binding?.connected)
        return target.binding.filters.map((filter) => filter.gain.value);
    }
    return null;
  };
  responseForGains = (gains: readonly number[]): EqualizerResponse =>
    equalizerResponse(gains, this.context?.sampleRate);
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  setEnabled = (enabled: boolean): void => {
    this.update({ ...this.settings, enabled });
  };
  selectPreset = (id: string): void => {
    const preset = EQUALIZER_PRESETS.find((preset) => preset.id === id);
    if (preset)
      this.update({ enabled: true, gains: [...preset.gains], presetId: preset.id }, 'preset');
  };
  setBandGain = (index: number, gain: number): void => {
    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index >= this.settings.gains.length ||
      !Number.isFinite(gain)
    )
      return;
    const gains = [...this.settings.gains];
    gains[index] = clampEqualizerGain(gain);
    this.update({ ...this.settings, gains, presetId: equalizerPresetId(gains) });
  };
  /** Keep recording correction separate from the user's bounded volume/fade envelope. */
  setNormalizationGain(audio: HTMLAudioElement, gain: number): boolean {
    const target = this.targets.get(audio);
    if (!target || !Number.isFinite(gain)) return false;
    gain = Math.max(0, Math.min(10 ** (18 / 20), gain));
    if (target.normalizationGain === gain && target.binding?.connected) return true;
    target.normalizationGain = gain;
    this.updateOutputGuard();
    if (!target.binding && gain === 1) return true;
    this.connect(audio);
    if (!target.binding?.connected) {
      target.normalizationGain = 1;
      this.updateOutputGuard();
      return false;
    }
    this.applyNormalization(target.binding, gain, audio.paused);
    return true;
  }
  private updateOutputGuard(): void {
    if (this.limiter)
      this.limiter.ratio.value = [...this.targets.values()].some(
        (target) => target.normalizationGain !== 1,
      )
        ? 20
        : 1;
  }
  private applyNormalization(binding: Binding, gain: number, immediate: boolean): void {
    if (!this.context) return;
    const param = binding.normalization.gain,
      time = this.context.currentTime;
    param.cancelAndHoldAtTime(time);
    if (immediate) param.setValueAtTime(gain, time);
    else param.setTargetAtTime(gain, time, 0.015);
  }
  attach(audio: HTMLAudioElement): void {
    if (this.targets.has(audio)) return;
    const target: Target = {
      normalizationGain: 1,
      start: () => {
        this.connect(audio);
        this.resume();
      },
      stop: () => this.suspendIfIdle(),
    };
    this.targets.set(audio, target);
    audio.addEventListener('play', target.start);
    audio.addEventListener('playing', target.start);
    for (const event of ['pause', 'ended', 'emptied']) audio.addEventListener(event, target.stop);
    if (this.settings.enabled && this.settings.gains.some((gain) => gain !== 0))
      this.connect(audio);
  }
  release(audio: HTMLAudioElement): void {
    const target = this.targets.get(audio);
    if (!target) return;
    audio.removeEventListener('play', target.start);
    audio.removeEventListener('playing', target.start);
    for (const event of ['pause', 'ended', 'emptied'])
      audio.removeEventListener(event, target.stop);
    if (target.binding) {
      target.binding.source.disconnect();
      target.binding.normalization.disconnect();
      target.binding.filters.forEach((filter) => filter.disconnect());
      target.binding.preamp.disconnect();
      target.binding.connected = false;
    }
    this.targets.delete(audio);
    this.updateOutputGuard();
    this.suspendIfIdle();
  }
  private notify(): void {
    this.settings = { ...this.settings };
    this.listeners.forEach((listener) => listener());
  }
  private suspendIfIdle(): void {
    if (
      this.context?.state === 'running' &&
      ![...this.targets.keys()].some((audio) => !audio.paused && !audio.ended)
    )
      void this.context.suspend().catch(() => {});
  }
  private resume(): void {
    if (
      this.context &&
      this.context.state !== 'closed' &&
      [...this.targets.keys()].some((audio) => !audio.paused && !audio.ended)
    )
      void this.context.resume().catch((error) => {
        logger.warn('[Equalizer] Audio context could not resume', error);
      });
  }
  private update(settings: EqualizerSettings, kind: 'preset' | 'manual' = 'manual'): void {
    if (
      settings.enabled === this.settings.enabled &&
      settings.gains.every((gain, i) => gain === this.settings.gains[i])
    )
      return;
    this.transitionKind = kind;
    this.settings = settings;
    this.response = equalizerResponse(settings.gains, this.context?.sampleRate);
    try {
      this.storage?.setItem(EQUALIZER_KEY, JSON.stringify(settings));
    } catch {}
    this.error = null;
    const smoothing = kind === 'preset' ? EQUALIZER_PRESET_TIME_CONSTANT : 0.015;
    for (const [audio, target] of this.targets) {
      if (target.binding?.connected) this.apply(target.binding, false, smoothing);
      else if (settings.enabled && settings.gains.some((gain) => gain !== 0))
        this.connect(audio, smoothing);
    }
    this.resume();
    this.notify();
  }
  private connect(audio: HTMLAudioElement, smoothing = 0.015): void {
    const target = this.targets.get(audio);
    if (!target || target.binding?.connected) return;
    if (
      target.normalizationGain === 1 &&
      (!this.settings.enabled || !this.settings.gains.some((gain) => gain !== 0))
    ) {
      // Reconnect an already captured element even when the equalizer is now flat.
      if (!this.bindings.has(audio)) return;
    }
    let binding = this.bindings.get(audio);
    try {
      if (!this.context) {
        this.context = new AudioContext({ latencyHint: 'playback' });
        this.response = equalizerResponse(this.settings.gains, this.context.sampleRate);
        // One output guard also covers overlapping sources. Ordinary recording
        // levels remain below threshold; extreme boosted peaks are compressed.
        this.limiter = this.context.createDynamicsCompressor();
        this.limiter.threshold.value = -2;
        this.limiter.knee.value = 0;
        this.updateOutputGuard();
        this.limiter.attack.value = 0;
        this.limiter.release.value = 0.15;
        this.limiter.connect(this.context.destination);
      }
      const context = this.context;
      if (!binding) {
        // Create everything that can fail before taking ownership of the native output.
        const filters = this.settings.gains.map((_, index) => {
          const filter = context.createBiquadFilter(),
            config = equalizerFilter(index, context.sampleRate);
          filter.type = config.type;
          filter.frequency.value = config.frequency;
          filter.Q.value = EQUALIZER_Q;
          return filter;
        });
        const preamp = context.createGain();
        const normalization = context.createGain();
        const source = context.createMediaElementSource(audio);
        binding = { source, filters, preamp, normalization, connected: false };
        this.bindings.set(audio, binding);
      }
      target.binding = binding;
      binding.source.disconnect();
      binding.source.connect(binding.normalization);
      binding.normalization.connect(binding.filters[0]);
      binding.filters.forEach((filter, index) =>
        filter.connect(binding!.filters[index + 1] ?? binding!.preamp),
      );
      binding.preamp.connect(this.limiter ?? context.destination);
      binding.connected = true;
      this.apply(binding, audio.paused, smoothing);
      this.applyNormalization(binding, target.normalizationGain, audio.paused);
      this.resume();
      this.suspendIfIdle();
      this.notify();
    } catch (error) {
      // After capture, preserve an audible direct path if building the effects chain fails.
      if (binding && this.context) {
        binding.source.disconnect();
        binding.normalization.disconnect();
        binding.filters.forEach((filter) => filter.disconnect());
        binding.preamp.disconnect();
        binding.source.connect(this.context.destination);
        binding.connected = false;
        target.binding = binding;
      }
      this.error = 'unavailable';
      logger.warn('[Equalizer] Could not connect audio effects', error);
      this.notify();
    }
  }
  private apply(binding: Binding, immediate = false, smoothing = 0.015): void {
    if (!this.context) return;
    const time = this.context.currentTime;
    const change = (param: AudioParam, value: number) => {
      if (immediate) {
        param.cancelScheduledValues(time);
        param.setValueAtTime(value, time);
      } else {
        param.cancelAndHoldAtTime(time);
        param.setTargetAtTime(value, time, smoothing);
      }
    };
    // Account for the combined response of overlapping bands, not just the largest slider.
    // Lower preamp first; gain reductions settle more quickly than filter changes.
    const preamp = this.settings.enabled ? 10 ** (this.response.headroomDb / 20) : 1;
    if (!immediate && preamp < binding.preamp.gain.value) {
      binding.preamp.gain.cancelAndHoldAtTime(time);
      binding.preamp.gain.setTargetAtTime(preamp, time, 0.005);
    } else if (!immediate) {
      binding.preamp.gain.cancelAndHoldAtTime(time);
      binding.preamp.gain.setTargetAtTime(preamp, time, 0.08);
    } else change(binding.preamp.gain, preamp);
    binding.filters.forEach((filter, index) =>
      change(filter.gain, this.settings.enabled ? this.settings.gains[index] : 0),
    );
  }
}
let instance: AudioEqualizer | undefined;
export function audioEqualizer(): AudioEqualizer {
  if (!instance) {
    let storage: Storage | undefined;
    try {
      storage = globalThis.localStorage;
    } catch {}
    instance = new AudioEqualizer(storage);
  }
  return instance;
}
