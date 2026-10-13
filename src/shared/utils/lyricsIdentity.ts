// Keep recording-specific timings separate, including versions with identical durations.
// The namespace also prevents reuse of lyrics cached before strict title matching.
export function createLyricsCacheKey(title: string, artist: string, duration?: number): string {
  const durationSeconds =
    Number.isFinite(duration) && Number(duration) > 0 ? Math.round(Number(duration)) : null;
  return JSON.stringify([
    'lyrics-v2',
    artist.trim().toLowerCase(),
    title.trim().toLowerCase(),
    durationSeconds,
  ]);
}

export function getLyricsTitleMatchScore(candidateTitle: string, targetTitle: string): number {
  const normalize = (title: string) => title.toLowerCase().replace(/[^a-z0-9а-яё]/gi, '');
  const candidate = normalize(candidateTitle);
  const target = normalize(targetTitle);
  if (!candidate || !target) return 0;
  if (candidate === target) return 500;
  // Short names must match exactly: an artist/duration match cannot identify the song.
  if (
    candidate.length >= 4 &&
    target.length >= 4 &&
    (candidate.includes(target) || target.includes(candidate))
  )
    return 250;
  return 0;
}
