/** Conservative cross-catalog match for imported tracks; durations are seconds. */
export function matchesImportedRecording(
  wanted: { title?: string; artist?: { name?: string } | string; duration?: number },
  candidate: { title?: string; artist?: { name?: string } | string; duration?: number },
): boolean {
  const normalized = (value: string) =>
    value
      .normalize('NFKC')
      .toLocaleLowerCase()
      .replace(/[\[(](?:official (?:audio|video|music video)|audio|lyrics?)[\])]/g, '')
      .replace(/[^\p{L}\p{N}]/gu, '');
  const name = (artist: typeof wanted.artist) =>
    typeof artist === 'string' ? artist : artist?.name || '';
  const song = normalized(wanted.title || ''),
    artist = normalized(name(wanted.artist));
  if (!song || !artist) return false;
  const title = normalized(candidate.title || '');
  if (!(
    (title === song && normalized(name(candidate.artist)) === artist) ||
    title === artist + song
  ))
    return false;
  const duration = wanted.duration || 0,
    actual = candidate.duration || 0;
  return (
    duration <= 0 ||
    actual <= 0 ||
    Math.abs(duration - actual) <= Math.min(15, Math.max(5, duration * 0.07))
  );
}
