import { AudioCrossfade } from '../../src/shared/services/audioCrossfade';
import { applyAudioVolume, setAudioFadeVolume } from '../../src/shared/utils/audioVolume';
import { TrackVolumeNormalization } from '../../src/shared/services/trackVolumeNormalization';
import { AudioEqualizer } from '../../src/shared/services/audioEqualizer';
import { LoudnessProfiles, normalizationGain } from '../../src/shared/utils/recordingLoudness';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
function tone(amplitude: number): string {
  const rate = 48000,
    frames = rate * 24,
    data = new ArrayBuffer(44 + frames * 4),
    v = new DataView(data);
  const text = (at: number, value: string) =>
    [...value].forEach((ch, i) => v.setUint8(at + i, ch.charCodeAt(0)));
  text(0, 'RIFF');
  v.setUint32(4, 36 + frames * 4, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 2, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 4, true);
  v.setUint16(32, 4, true);
  v.setUint16(34, 16, true);
  text(36, 'data');
  v.setUint32(40, frames * 4, true);
  for (let i = 0; i < frames; i++) {
    const value = Math.round(Math.sin((i / rate) * Math.PI * 1760) * amplitude * 32767);
    v.setInt16(44 + i * 4, value, true);
    v.setInt16(46 + i * 4, value, true);
  }
  return URL.createObjectURL(new Blob([data], { type: 'audio/wav' }));
}
export async function runPlaybackQuality() {
  const values = new Map<string, string>([['soso_volume_normalization', 'true']]);
  let variants: {
    audio: HTMLAudioElement;
    eq: AudioEqualizer;
    id: string;
    url: string;
    volume: number;
  }[] = [];
  const service = new TrackVolumeNormalization(
    {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => {
        values.set(key, value);
      },
    },
    (audio, gain) =>
      variants.find((row) => row.audio === audio)?.eq.setNormalizationGain(audio, gain) ?? false,
  );
  const flat = new AudioEqualizer(),
    colored = new AudioEqualizer();
  colored.selectPreset('vocal');
  const quiet = tone(0.05),
    loud = tone(0.4);
  variants = [
    { id: 'base', url: quiet, volume: 0.8, eq: flat },
    { id: 'low-slider', url: quiet, volume: 0.03, eq: flat },
    { id: 'equalized', url: quiet, volume: 0.8, eq: colored },
    { id: 'loud', url: loud, volume: 0.8, eq: flat },
  ].map((row) => ({ ...row, audio: new Audio(row.url) }));
  const transition = new AudioCrossfade();
  try {
    for (const row of variants) {
      row.audio.loop = true;
      service.prepare(row.audio, { id: row.id });
      row.audio.volume = row.volume;
      row.eq.attach(row.audio);
      await row.audio.play();
    }
    const deadline = performance.now() + 23000;
    let rows: any[] = [];
    while (true) {
      rows = JSON.parse(values.get(LoudnessProfiles.STORAGE_KEY) ?? '[]');
      if (variants.every((row) => rows.some((saved) => saved[0] === 'soundcloud:' + row.id))) break;
      if (performance.now() > deadline)
        throw Error('Profile capture timed out: ' + JSON.stringify(rows));
      await sleep(200);
    }
    const profiles = Object.fromEntries(rows.map((row) => [row[0].split(':')[1], row[1].db]));
    const checks: Record<string, boolean> = {};
    checks.sliderIndependent = Math.abs(profiles.base - profiles['low-slider']) < 0.15;
    checks.equalizerIndependent = Math.abs(profiles.base - profiles.equalized) < 0.25;
    checks.amplitudeDifference =
      Math.abs(profiles.base - profiles.loud - 20 * Math.log10(8)) < 0.15;
    const controllers = Reflect.get(service, 'controllers') as Map<HTMLAudioElement, any>;
    const active = controllers.get(variants[0].audio).capture;
    const originalSamples = active.stats.samples;
    variants[0].audio.pause();
    await sleep(100);
    checks.analysisSuspendsOnPause = active.context.state === 'suspended';
    await variants[0].audio.play();
    await sleep(1200);
    checks.analysisResumes =
      controllers.get(variants[0].audio).capture === active &&
      active.stats.samples > originalSamples;
    variants[0].audio.currentTime = 8;
    await sleep(1200);
    checks.analysisSurvivesSeek =
      controllers.get(variants[0].audio).capture === active &&
      active.stats.samples > originalSamples;
    checks.firstPlayGainFixed = variants.every((row) => service.getGain(row.audio) === 1);
    const captureContexts = variants.map(
      (row) => controllers.get(row.audio).capture.context as AudioContext,
    );
    for (const row of variants) {
      row.audio.pause();
      service.prepare(row.audio, { id: row.id });
    }
    await sleep(100);
    checks.previousAnalysisReleased = captureContexts.every(
      (context) => context.state === 'closed',
    );
    flat.setBandGain(0, 0.5);
    flat.setBandGain(0, 0);
    const a = variants[0].audio,
      b = variants[3].audio;
    a.volume = 0.8;
    b.volume = 0.8;
    await a.play();
    await b.play();
    const context = Reflect.get(flat, 'context') as AudioContext;
    const bindings = Reflect.get(flat, 'bindings') as WeakMap<
      HTMLAudioElement,
      { preamp: GainNode }
    >;
    const meters = [a, b].map((audio) => {
      const node = context.createAnalyser();
      node.fftSize = 4096;
      bindings.get(audio)!.preamp.connect(node);
      return node;
    });
    const sample = () =>
      meters.map((node) => {
        const data = new Float32Array(node.fftSize);
        node.getFloatTimeDomainData(data);
        return Math.sqrt(data.reduce((sum, value) => sum + value * value, 0) / data.length);
      });
    const average = async () => {
      const powers = [0, 0];
      for (let i = 0; i < 8; i++) {
        const values = sample();
        values.forEach((value, index) => {
          powers[index] += (value * value) / 8;
        });
        await sleep(25);
      }
      return powers.map(Math.sqrt);
    };
    await sleep(1000);
    const high = await average(),
      highDifferenceDb = 20 * Math.log10(high[0] / high[1]);
    checks.highSliderMatched = Math.abs(highDifferenceDb) < 0.25;
    a.volume = 0.03;
    b.volume = 0.03;
    await sleep(250);
    const low = await average(),
      lowDifferenceDb = 20 * Math.log10(low[0] / low[1]);
    checks.lowSliderMatched = Math.abs(lowDifferenceDb) < 0.25;
    service.setEnabled(false);
    await sleep(250);
    const bypass = await average();
    service.setEnabled(true);
    await sleep(300);
    const restored = await average();
    checks.toggleRestores = restored.every(
      (value, i) => Math.abs(20 * Math.log10(value / low[i])) < 0.2,
    );
    checks.bypassPreservesDifference =
      Math.abs(20 * Math.log10(bypass[0] / bypass[1]) + 20 * Math.log10(8)) < 0.2;
    // Measure the two decoded stems separately: unrelated songs use equal-power
    // envelopes; coherent test tones must not be summed before this assertion.
    let volume = 0.8,
      completed = 0,
      disposed = 0;
    a.volume = volume;
    b.volume = volume;
    await sleep(250);
    const endpoints = await average();
    setAudioFadeVolume(b, volume, 0);
    transition.hold(
      a,
      () => {
        disposed++;
      },
      () => volume,
    );
    checks.crossfadeStarted = transition.start(
      b,
      2,
      () => volume,
      () => {
        completed++;
      },
    );
    await sleep(400);
    const middle = await average();
    const crossfadePower = middle.reduce((sum, value, i) => sum + (value / endpoints[i]) ** 2, 0);
    checks.crossfadePower = Math.abs(crossfadePower - 1) < 0.04;
    b.dispatchEvent(new Event('waiting'));
    const held = [a.volume, b.volume];
    await sleep(200);
    checks.bufferingHoldsFade =
      Math.abs(a.volume - held[0]) < 1e-8 && Math.abs(b.volume - held[1]) < 1e-8;
    volume = 0;
    applyAudioVolume(b, 0.8, true);
    await sleep(150);
    checks.muteBothTracks = a.muted && b.muted && sample().every((value) => value < 0.00001);
    volume = 0.03;
    applyAudioVolume(b, volume, false);
    await sleep(150);
    checks.unmuteBothTracks = !a.muted && !b.muted && sample().every((value) => value > 0);
    b.dispatchEvent(new Event('playing'));
    await sleep(1700);
    checks.crossfadeCompletes =
      !transition.active && a.paused && !b.paused && completed === 1 && disposed === 1;
    // Stress an unusually quiet profile followed by a full-scale peak.
    service.remember({ id: 'stress' }, 18);
    b.pause();
    service.prepare(b, { id: 'stress' });
    b.volume = 1;
    const output = context.createAnalyser();
    output.fftSize = 4096;
    (Reflect.get(flat, 'limiter') as DynamicsCompressorNode).connect(output);
    await b.play();
    await sleep(800);
    const samples = new Float32Array(output.fftSize);
    output.getFloatTimeDomainData(samples);
    const limitedPeak = Math.max(...samples.map(Math.abs));
    checks.peakGuard = limitedPeak > 0.1 && limitedPeak < 1;
    output.disconnect();
    meters.forEach((node) => node.disconnect());
    return {
      ok: Object.values(checks).every(Boolean),
      checks,
      profiles,
      crossfadePower,
      limitedPeak,
      highDifferenceDb,
      lowDifferenceDb,
      high,
      low,
      restored,
      expectedQuietGain: normalizationGain(profiles.base),
    };
  } catch (error) {
    return { ok: false, error: String(error) };
  } finally {
    transition.stop();
    for (const row of variants) {
      row.audio.pause();
      service.release(row.audio);
      row.eq.release(row.audio);
      row.audio.removeAttribute('src');
      row.audio.load();
    }
    URL.revokeObjectURL(quiet);
    URL.revokeObjectURL(loud);
  }
}
