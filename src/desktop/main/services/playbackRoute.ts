type YouTubeRoute = { via: 'account' | 'anonymous'; client: 'WEB' | 'VISIONOS' };

/** Logs the route only after the renderer's real playing event, never from prefetch. */
export function playbackRouteLog(
  meta: unknown,
  youtubeRoute: (id: string) => YouTubeRoute | undefined,
): string | undefined {
  if (!meta || typeof meta !== 'object') return;
  const event = meta as Record<string, unknown>;
  if (
    event.event !== 'playback-start' ||
    !['hls', 'progressive', 'local-cache'].includes(String(event.delivery))
  )
    return;
  const id = String(event.trackId ?? '');
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return;
  const source = ['youtube', 'soundcloud', 'deezer'].includes(String(event.source))
    ? String(event.source)
    : 'unknown';
  const via =
    event.delivery === 'local-cache'
      ? 'local-cache'
      : source === 'youtube'
        ? (youtubeRoute(id)?.via ?? 'unknown')
        : 'direct';
  return (
    '[AudioPlayer:Route] track=' +
    id +
    ' source=' +
    source +
    ' via=' +
    via +
    ' delivery=' +
    event.delivery
  );
}
