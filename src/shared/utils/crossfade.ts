export function clampCrossfadeDuration(sec: number): number {
  return Math.max(0, Math.min(12, sec));
}

export function calculateFadeInVolume(targetVol: number, progress: number): number {
  const p = Math.max(0, Math.min(1, progress));
  return targetVol * Math.sin(p * (Math.PI / 2));
}

export function calculateFadeOutVolume(startVol: number, progress: number): number {
  const p = Math.max(0, Math.min(1, progress));
  return startVol * Math.cos(p * (Math.PI / 2));
}

export function shouldTriggerNearEndFade(
  currentTime: number,
  duration: number,
  crossfadeSec: number,
  isCrossfading: boolean,
  playback: { isPlaying: boolean; repeatOne: boolean; stopAtEnd: boolean } = {
    isPlaying: true,
    repeatOne: false,
    stopAtEnd: false,
  },
): boolean {
  return (
    playback.isPlaying &&
    !playback.repeatOne &&
    !playback.stopAtEnd &&
    crossfadeSec > 0 &&
    duration > 15 &&
    currentTime >= duration - crossfadeSec &&
    !isCrossfading
  );
}
