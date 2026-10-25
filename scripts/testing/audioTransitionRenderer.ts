import { AudioCrossfade } from '../../src/shared/services/audioCrossfade';
import { TrackVolumeNormalization } from '../../src/shared/services/trackVolumeNormalization';
import { applyAudioVolume, setAudioFadeVolume } from '../../src/shared/utils/audioVolume';
import { LoudnessProfiles, normalizationGain } from '../../src/shared/utils/recordingLoudness';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const assert = (condition: boolean, message: string) => {
  if (!condition) throw Error(message);
};
const descriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'volume')!;
const raw = (audio: HTMLAudioElement) => descriptor.get!.call(audio) as number;
function sineWave(): string {
  const rate = 24000,
    frames = rate * 24,
    buffer = new ArrayBuffer(44 + frames * 2),
    view = new DataView(buffer);
  const text = (at: number, value: string) =>
    [...value].forEach((character, i) => view.setUint8(at + i, character.charCodeAt(0)));
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
    view.setInt16(44 + i * 2, Math.round(Math.sin((i / rate) * Math.PI * 880) * 0.1 * 32767), true);
  return URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
}
export async function runAudioTransitions() {
  const results: Record<string, unknown>[] = [],
    url = sineWave();
  const values = new Map<string, string>([['soso_volume_normalization', 'true']]);
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
  const service = new TrackVolumeNormalization(storage),
    old = new Audio(url),
    next = new Audio(url),
    fresh = new Audio(url);
  const transition = new AudioCrossfade();
  let volume = 0.8;
  try {
    service.remember({ id: 'old' }, 12);
    service.remember({ id: 'next' }, 12);
    service.prepare(old, { id: 'old' });
    service.prepare(next, { id: 'next' });
    old.volume = volume;
    setAudioFadeVolume(next, volume, 0);
    await Promise.all([old.play(), next.play()]);
    transition.hold(
      old,
      () => service.release(old),
      () => volume,
    );
    assert(
      transition.start(next, 1, () => volume),
      'Transition failed to start',
    );
    await sleep(400);
    const power = raw(old) ** 2 + raw(next) ** 2;
    assert(
      raw(old) < 0.99 && raw(next) < 0.99 && Math.abs(power - 1) < 0.001,
      'Normalized endpoints flattened the fade',
    );
    assert(old.currentTime > 0.2 && next.currentTime > 0.2, 'Real decoders must advance');
    results.push({ scenario: 'normalized-real-audio', ok: true, combinedPower: power });
    volume = 0.03;
    applyAudioVolume(next, volume, false);
    await sleep(75);
    const lowPower = raw(old) ** 2 + raw(next) ** 2,
      expected = (volume * normalizationGain(12)) ** 2;
    assert(Math.abs(lowPower - expected) < 0.00001, '3% slider broke the transition');
    next.dispatchEvent(new Event('waiting'));
    const held = raw(old);
    await sleep(350);
    assert(
      Math.abs(raw(old) - held) < 0.00001 && !old.paused,
      'Buffering consumed the outgoing fade',
    );
    next.dispatchEvent(new Event('playing'));
    await sleep(700);
    assert(!transition.active && old.paused && raw(next) > 0, 'Transition did not complete');
    results.push({ scenario: 'low-volume-and-buffering', ok: true, combinedPower: lowPower });
    next.pause();
    service.prepare(fresh, { id: 'fresh' });
    fresh.volume = 0.03;
    await fresh.play();
    const deadline = performance.now() + 21000;
    while (
      !values.has(LoudnessProfiles.STORAGE_KEY) ||
      !JSON.parse(values.get(LoudnessProfiles.STORAGE_KEY)!).some(
        (row: any) => row[0] === 'soundcloud:fresh',
      )
    ) {
      if (performance.now() > deadline) throw Error('Real capture did not save a profile');
      await sleep(200);
    }
    assert(Math.abs(raw(fresh) - 0.03) < 1e-8, 'First-play gain changed halfway through playback');
    const profile = JSON.parse(values.get(LoudnessProfiles.STORAGE_KEY)!).find(
      (row: any) => row[0] === 'soundcloud:fresh',
    )[1];
    fresh.pause();
    service.prepare(fresh, { id: 'fresh' });
    fresh.volume = 0.03;
    assert(
      Math.abs(raw(fresh) - 0.03 * normalizationGain(profile.db)) < 1e-8,
      'Learned gain was not applied on replay',
    );
    results.push({
      scenario: 'real-capture-and-fixed-replay-gain',
      ok: true,
      gainDb: profile.db,
      profileBytes: values.get(LoudnessProfiles.STORAGE_KEY)!.length,
    });
    return { ok: true, results };
  } catch (error) {
    return { ok: false, error: String(error), results };
  } finally {
    transition.stop();
    for (const audio of [old, next, fresh]) {
      audio.pause();
      service.release(audio);
      audio.removeAttribute('src');
      audio.load();
    }
    URL.revokeObjectURL(url);
  }
}
