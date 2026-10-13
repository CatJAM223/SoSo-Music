export interface BufferedAudioRange {
  start: number;
  end: number;
}

export interface BufferedAudioSource {
  audio: HTMLAudioElement;
  url: string;
}

/** Read the currently selected source only; old media may still emit queued events. */
export function readAudioBufferedRanges(
  audio: HTMLAudioElement,
  source: BufferedAudioSource | null,
): BufferedAudioRange[] {
  if (!source || source.audio !== audio || !source.url || audio.currentSrc !== source.url)
    return [];
  if (!Number.isFinite(audio.duration) || audio.duration <= 0) return [];
  const result: BufferedAudioRange[] = [];
  try {
    const buffered = audio.buffered;
    for (let i = 0; i < buffered.length; i++) {
      const start = Math.max(0, buffered.start(i));
      const end = Math.min(audio.duration, buffered.end(i));
      if (Number.isFinite(start) && Number.isFinite(end) && end > start)
        result.push({ start, end });
    }
  } catch {
    // A source can be emptied while its TimeRanges snapshot is being read.
    return [];
  }
  return result;
}

/** Background preparation may start early only when the audible stream has a safe buffer. */
export function hasAudioBufferHeadroom(
  audio: Pick<HTMLAudioElement, 'currentTime' | 'duration' | 'buffered'>,
  seconds = 8,
): boolean {
  if (!Number.isFinite(audio.currentTime) || audio.currentTime < 0) return false;
  const remaining =
    Number.isFinite(audio.duration) && audio.duration > 0
      ? audio.duration - audio.currentTime
      : seconds;
  const needed = Math.min(seconds, Math.max(0, remaining));
  if (needed <= 0) return false;
  try {
    for (let i = 0; i < audio.buffered.length; i++) {
      if (
        audio.buffered.start(i) <= audio.currentTime &&
        audio.buffered.end(i) - audio.currentTime >= needed - 0.05
      )
        return true;
    }
  } catch {
    /* A source switch can invalidate its TimeRanges. */
  }
  return false;
}

export function sameBufferedRanges(
  left: BufferedAudioRange[],
  right: BufferedAudioRange[],
): boolean {
  return (
    left.length === right.length &&
    left.every((range, i) => range.start === right[i].start && range.end === right[i].end)
  );
}

export function bufferedPercentRanges(
  ranges: BufferedAudioRange[],
  duration: number,
): BufferedAudioRange[] {
  if (!Number.isFinite(duration) || duration <= 0) return [];
  return ranges.flatMap((range) => {
    const start = Math.max(0, Math.min(100, (range.start / duration) * 100));
    const end = Math.max(0, Math.min(100, (range.end / duration) * 100));
    return Number.isFinite(start) && Number.isFinite(end) && end > start ? [{ start, end }] : [];
  });
}
