// Stable messages survive Electron IPC serialization of Error objects.
export const YOUTUBE_AUDIO_BOT_CHECK = 'YOUTUBE_AUDIO_BOT_CHECK';
export const YOUTUBE_AUDIO_LOGIN_REQUIRED = 'YOUTUBE_AUDIO_LOGIN_REQUIRED';
export const YOUTUBE_AUDIO_AGE_RESTRICTED = 'YOUTUBE_AUDIO_AGE_RESTRICTED';

export type YouTubeAudioAccessError =
  'verification-required' | 'sign-in-required' | 'age-restricted';

export function classifyYouTubeAudioAccessError(
  status:
    | {
        status?: string;
        reason?: string;
        desktopLegacyAgeGateReason?: number;
      }
    | undefined,
): string | null {
  if (status?.status !== 'LOGIN_REQUIRED') return null;
  const reason = status.reason || '';
  if (status.desktopLegacyAgeGateReason === 1 || /confirm your age|age.restricted/i.test(reason)) {
    return YOUTUBE_AUDIO_AGE_RESTRICTED;
  }
  return /not a bot|automated|не робот|не бот/i.test(reason)
    ? YOUTUBE_AUDIO_BOT_CHECK
    : YOUTUBE_AUDIO_LOGIN_REQUIRED;
}

export function getYouTubeAudioAccessError(error: unknown): YouTubeAudioAccessError | null {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes(YOUTUBE_AUDIO_BOT_CHECK)) return 'verification-required';
  if (message.includes(YOUTUBE_AUDIO_AGE_RESTRICTED)) return 'age-restricted';
  if (message.includes(YOUTUBE_AUDIO_LOGIN_REQUIRED)) return 'sign-in-required';
  return null;
}

export function youtubeAudioAccessMessage(
  error: YouTubeAudioAccessError,
  canConnectAccount = false,
): string {
  if (canConnectAccount && error !== 'age-restricted') {
    return 'YouTube требует входа. Подключите аккаунт в Настройках → Интеграции → YouTube Music.';
  }
  if (error === 'verification-required') {
    return 'YouTube требует подтвердить, что вы не бот. Проверьте подключение через прокси или VPN.';
  }
  if (error === 'age-restricted')
    return 'YouTube требует входа и подтверждения возраста для этого трека.';
  return 'YouTube требует входа для воспроизведения этого трека.';
}
