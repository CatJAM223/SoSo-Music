export type VideoPlaybackError =
  'age-restricted' | 'verification-required' | 'sign-in-required' | 'unavailable';

// IPC preserves Error.message, but not custom properties on an Error.
export const VIDEO_AGE_RESTRICTED = 'YOUTUBE_VIDEO_AGE_RESTRICTED';
export const VIDEO_BOT_CHECK = 'YOUTUBE_VIDEO_BOT_CHECK';
export const VIDEO_LOGIN_REQUIRED = 'YOUTUBE_VIDEO_LOGIN_REQUIRED';

export function isAgeRestrictedVideo(
  status: { status?: string; reason?: string; desktopLegacyAgeGateReason?: number } | undefined,
): boolean {
  return (
    status?.status === 'LOGIN_REQUIRED' &&
    (status.desktopLegacyAgeGateReason === 1 ||
      /confirm your age|age.restricted/i.test(status.reason || ''))
  );
}

export function getVideoPlaybackError(error: unknown): VideoPlaybackError {
  const message = String(error instanceof Error ? error.message : error);
  if (message.includes(VIDEO_AGE_RESTRICTED)) return 'age-restricted';
  if (message.includes(VIDEO_BOT_CHECK)) return 'verification-required';
  if (message.includes(VIDEO_LOGIN_REQUIRED)) return 'sign-in-required';
  return 'unavailable';
}
