/** SQL aliases are fixed by callers; artwork stays tied to the provider track ID. */
export function statisticsArtworkSql(trackId: 'h.track_id' | 's.track_id'): string {
  const usable = (column: string) => `${column} IS NOT NULL AND TRIM(${column}) <> ''
    AND LOWER(${column}) NOT LIKE '%unsplash.com%'
    AND (${column} LIKE 'https://%' OR ${column} LIKE 'http://%')`;
  return `COALESCE(
    (SELECT l.cover_url FROM liked_tracks l WHERE l.deezer_id = ${trackId}
     AND ${usable('l.cover_url')} LIMIT 1),
    (SELECT recent.cover_url FROM listening_history recent WHERE recent.track_id = ${trackId}
     AND ${usable('recent.cover_url')} ORDER BY recent.played_at DESC, recent.id DESC LIMIT 1),
    '')`;
}
