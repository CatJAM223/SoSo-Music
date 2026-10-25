import React from 'react';
import { createRoot } from 'react-dom/client';
import { SettingsEqualizer } from '../../src/desktop/ui/components/modals/SettingsEqualizer';
import { AudioEqualizer, audioEqualizer } from '../../src/shared/services/audioEqualizer';
import {
  EQUALIZER_FREQUENCIES,
  EQUALIZER_PRESETS,
  EQUALIZER_Q,
  EQUALIZER_PRESET_TIME_CONSTANT,
  equalizerFilter,
  equalizerResponse,
} from '../../src/shared/utils/equalizer';
import '../../src/shared/components/settings/settings.css';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const assert = (condition: boolean, message: string) => {
  if (!condition) throw Error(message);
};
function sineWave(): string {
  const rate = 48000,
    frames = rate * 3,
    data = new ArrayBuffer(44 + frames * 2),
    view = new DataView(data);
  const text = (offset: number, value: string) =>
    [...value].forEach((character, i) => view.setUint8(offset + i, character.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, 36 + frames * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, frames * 2, true);
  for (let i = 0; i < frames; i++)
    view.setInt16(
      44 + i * 2,
      Math.round(Math.sin((i / rate) * Math.PI * 2000) * 0.1 * 32767),
      true,
    );
  return URL.createObjectURL(new Blob([data], { type: 'audio/wav' }));
}
(globalThis as any).equalizerResult = (async () => {
  const results: unknown[] = [];
  // Compare our graph and headroom model against Chromium's actual filter implementation.
  for (const sampleRate of [32000, 44100, 48000, 96000]) {
    const context = new OfflineAudioContext(2, 1, sampleRate);
    for (const gains of [
      Array(10).fill(0),
      Array(10).fill(12),
      [12, -8, 6, -3, 5, -11, 7, 2, -4, 9],
      ...EQUALIZER_PRESETS.map((preset) => preset.gains),
    ]) {
      const modeled = equalizerResponse(gains, sampleRate),
        frequencies = new Float32Array(modeled.frequencies),
        mag = new Float32Array(frequencies.length),
        phase = new Float32Array(frequencies.length),
        measured = new Float64Array(frequencies.length);
      gains.forEach((gain, index) => {
        const filter = context.createBiquadFilter(),
          config = equalizerFilter(index, sampleRate);
        filter.type = config.type;
        filter.frequency.value = config.frequency;
        filter.Q.value = EQUALIZER_Q;
        filter.gain.value = gain;
        filter.getFrequencyResponse(frequencies, mag, phase);
        for (let i = 0; i < measured.length; i++) measured[i] += 20 * Math.log10(mag[i]);
      });
      assert(
        modeled.db.every((db, i) => Math.abs(db - measured[i]) < 0.003),
        `Frequency model differs from native Web Audio at ${sampleRate}`,
      );
      assert(
        [...measured].every((db) => db + modeled.headroomDb <= 0.003),
        'Combined curve exceeds headroom',
      );
    }
  }
  results.push('40 native frequency-response comparisons at four sample rates');
  const service = new AudioEqualizer(),
    url = sineWave(),
    audio = new Audio(url),
    next = new Audio(url);
  audio.loop = true;
  next.loop = true;
  audio.volume = 0.8;
  next.volume = 0.4;
  service.attach(audio);
  service.attach(next);
  assert(
    Reflect.get(service, 'context') === null,
    'Default profile should keep native output untouched',
  );
  service.setBandGain(5, -12);
  await audio.play();
  await next.play();
  await sleep(250);
  const context = Reflect.get(service, 'context') as AudioContext;
  const bindings = Reflect.get(service, 'bindings') as WeakMap<
    HTMLAudioElement,
    { source: MediaElementAudioSourceNode; preamp: GainNode }
  >;
  const binding = bindings.get(audio)!;
  const analyser = context.createAnalyser();
  analyser.fftSize = 4096;
  binding.preamp.connect(analyser);
  const samples = new Float32Array(analyser.fftSize);
  const rms = async () => {
    await sleep(220);
    analyser.getFloatTimeDomainData(samples);
    return Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
  };
  const cut = await rms();
  service.setEnabled(false);
  const flat = await rms();
  assert(cut > 0.001 && flat > 0.01, 'Audio graph must output a real signal');
  const delta = 20 * Math.log10(cut / flat);
  assert(Math.abs(delta + 12) < 0.5, `Actual 1 kHz cut differs from -12 dB: ${delta}`);
  audio.volume = 0.4;
  const quiet = await rms();
  assert(Math.abs(quiet / flat - 0.5) < 0.03, 'Media volume/crossfade gain must remain effective');
  service.setEnabled(true);
  const restored = await rms();
  assert(Math.abs(restored / quiet - cut / flat) < 0.02, 'Bypass must restore the saved curve');
  service.selectPreset('bass');
  await sleep(25);
  const sampledAt = context.currentTime;
  const live = service.getLiveGains()!;
  assert(
    live[5] > -12 && live[5] < -0.1,
    'Preset should interpolate real AudioParams instead of jumping',
  );
  service.selectPreset('vocal');
  const retargeted = service.getLiveGains()![5];
  // AudioParam reads span independently advancing render quanta. Bound the
  // legitimate exponential movement using the audio clock, rather than assuming
  // that two JavaScript reads happen in the same audio block.
  const elapsed = context.currentTime - sampledAt + 128 / context.sampleRate;
  const allowedChange =
    (Math.abs(live[5]) + 3) * (1 - Math.exp(-elapsed / EQUALIZER_PRESET_TIME_CONSTANT)) + 0.05;
  assert(
    Math.abs(retargeted - live[5]) < allowedChange,
    `Audio retarget discontinuity: ${live[5]} -> ${retargeted}, elapsed ${elapsed}`,
  );
  await sleep(550);
  assert(
    Math.abs(service.getLiveGains()![5] - 3) < 0.02,
    'Live gains should settle on the selected preset',
  );
  results.push('Audio: smooth live preset transition and continuous retarget');
  audio.pause();
  service.release(audio);
  service.attach(audio);
  await audio.play();
  assert(
    bindings.get(audio)?.source === binding.source && service.getError() === null,
    'Reattach must reuse the media source',
  );
  audio.pause();
  next.pause();
  await sleep(80);
  assert(context.state === 'suspended', 'Idle audio graph should suspend');
  service.release(audio);
  service.release(next);
  analyser.disconnect();
  URL.revokeObjectURL(url);
  results.push({
    actualCutDb: delta,
    volumeRatio: quiet / flat,
    reattach: 'ok',
    idleSuspend: 'ok',
  });
  audioEqualizer().selectPreset('headphones');
  createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <div
        className="settings-modal"
        style={{ width: '100%', height: 'auto', padding: 32, boxSizing: 'border-box' }}
      >
        <SettingsEqualizer />
      </div>
    </React.StrictMode>,
  );
  await sleep(100);
  assert(
    !document.querySelector(
      '.equalizer-help, .equalizer-caption, .equalizer-dot, .equalizer-panel-top strong, .equalizer-heading p',
    ),
    'Removed equalizer captions must stay hidden',
  );
  const circles = document.querySelectorAll<SVGCircleElement>('[role="slider"]');
  assert(
    circles.length === EQUALIZER_FREQUENCIES.length,
    'All graph bands must be keyboard accessible',
  );
  circles[5].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
  await sleep(30);
  assert(audioEqualizer().getSnapshot().gains[5] === 0.5, 'Graph keyboard control failed');
  const buttons = [...document.querySelectorAll<HTMLButtonElement>('.equalizer-presets button')];
  buttons.find((button) => button.textContent?.includes('Колонки'))!.click();
  await sleep(30);
  assert(audioEqualizer().getSnapshot().presetId === 'speakers', 'Preset selection failed');
  const toggle = document.querySelector<HTMLButtonElement>('[role="switch"]')!;
  toggle.click();
  await sleep(30);
  assert(circles[0].getAttribute('tabindex') === '-1', 'Disabled graph should leave the tab order');
  toggle.click();
  await sleep(30);
  audioEqualizer().selectPreset('headphones');
  await sleep(50);
  results.push('UI: StrictMode mount, keyboard adjustment, presets, bypass');
  const equalizer = audioEqualizer();
  const pointY = () => Number(document.querySelector('.equalizer-handle')!.getAttribute('cy'));
  const curve = () => document.querySelector('.equalizer-curve')!.getAttribute('d');
  equalizer.selectPreset('flat');
  await sleep(650);
  const neutralCurve = curve(),
    neutralY = pointY();
  equalizer.selectPreset('bass');
  await sleep(70);
  const earlyCurve = curve(),
    earlyY = pointY();
  assert(
    earlyCurve !== neutralCurve && earlyY < neutralY,
    `Preset curve should move through intermediate frames: ${neutralY} -> ${earlyY}; ${document.visibilityState}`,
  );
  await sleep(90);
  const beforeRetarget = pointY();
  equalizer.selectPreset('vocal');
  await sleep(20);
  const afterRetarget = pointY();
  assert(
    Math.abs(afterRetarget - beforeRetarget) < 18,
    'Rapid preset selection should continue from the displayed curve',
  );
  await sleep(650);
  const finalY = pointY();
  assert(finalY > neutralY && curve() !== earlyCurve, 'Animation should finish on the new preset');
  assert(
    equalizer.getSnapshot().presetId === 'vocal',
    'Animation must not persist intermediate settings',
  );
  equalizer.selectPreset('headphones');
  await sleep(650);
  results.push({
    presetMorph: 'intermediate frames verified',
    rapidRetarget: 'continuous',
    finalPreset: 'settled',
  });
  return { ok: true, results };
})().catch((error) => ({ ok: false, error: String(error), stack: error.stack }));
