/**
 * Pure guard and state check functions for player UI components
 */

export function shouldRenderTrackRow(track: any): boolean {
  return !(!track || !track.id);
}

export function isPlayButtonDisabled(
  currentTrack: any,
  isSnippetPlaying: boolean,
  queue?: any[],
): boolean {
  return !currentTrack && !isSnippetPlaying && (!queue || queue.length === 0);
}
