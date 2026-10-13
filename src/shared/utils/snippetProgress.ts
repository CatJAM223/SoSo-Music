import { SNIPPET_DURATION } from '../context/audioTypes.ts';

export interface SnippetProgressState {
  isSeeking: boolean;
  isFinished: boolean;
  progress: number;
}

export function getSnippetProgressState(
  currentTime: number,
  startTime: number,
  endTime: number,
  duration = SNIPPET_DURATION,
): SnippetProgressState {
  const isSeeking = currentTime < startTime - 1;
  const isFinished = currentTime >= endTime;
  const progress =
    Number.isFinite(currentTime) && Number.isFinite(startTime) && duration > 0
      ? Math.min(1, Math.max(0, currentTime - startTime) / duration)
      : 0;

  return { isSeeking, isFinished, progress };
}
