import type { YouTubeAudioAccessError } from './youtubeAudioAccessError';

export const YOUTUBE_ACCESS_ISSUE_EVENT = 'soso:youtube-access-issue';
export type YouTubeAccessIssue = {
  reason: YouTubeAudioAccessError;
  source: 'track' | 'clip';
  trackId: string | number;
};
const reasons = ['age-restricted', 'verification-required', 'sign-in-required'];
const preferenceKey = (reason: YouTubeAudioAccessError) =>
  'soso_youtube_access_hint_hidden_' + reason;

export function isYouTubeAccessIssue(value: unknown): value is YouTubeAccessIssue {
  if (!value || typeof value !== 'object') return false;
  const issue = value as YouTubeAccessIssue;
  return (
    reasons.includes(issue.reason) &&
    ['track', 'clip'].includes(issue.source) &&
    (typeof issue.trackId === 'string' || typeof issue.trackId === 'number')
  );
}
export function isYouTubeAccessHintHidden(reason: YouTubeAudioAccessError): boolean {
  try {
    return localStorage.getItem(preferenceKey(reason)) === 'true';
  } catch {
    return false;
  }
}
export function setYouTubeAccessHintHidden(reason: YouTubeAudioAccessError, hidden: boolean): void {
  try {
    if (hidden) localStorage.setItem(preferenceKey(reason), 'true');
    else localStorage.removeItem(preferenceKey(reason));
  } catch {}
}
/** Only the desktop app currently supports connecting a YouTube account. */
export function emitYouTubeAccessIssue(issue: YouTubeAccessIssue): boolean {
  if (
    typeof window === 'undefined' ||
    !window.electronAPI?.getYouTubeAccountStatus ||
    !window.electronAPI?.connectYouTubeAccount
  )
    return false;
  if (isYouTubeAccessHintHidden(issue.reason)) return true;
  window.dispatchEvent(new CustomEvent(YOUTUBE_ACCESS_ISSUE_EVENT, { detail: issue }));
  return true;
}
export function youtubeAccessHintCopy(issue: YouTubeAccessIssue) {
  const clip = issue.source === 'clip';
  if (issue.reason === 'age-restricted')
    return {
      title: clip ? 'Клип с ограничением 18+' : 'Трек с ограничением 18+',
      description:
        'Подключите аккаунт YouTube с подтверждённым возрастом в настройках, затем попробуйте ' +
        (clip ? 'открыть клип' : 'запустить трек') +
        ' снова.',
    };
  if (issue.reason === 'verification-required')
    return {
      title: 'YouTube просит пройти проверку',
      description:
        'Вход в аккаунт YouTube может помочь подтвердить, что вы не бот. Подключите его в настройках и попробуйте снова.',
    };
  return {
    title: 'Войдите в YouTube',
    description:
      (clip ? 'Для просмотра этого клипа' : 'Для прослушивания этого трека') +
      ' нужен аккаунт YouTube. Подключите его в настройках и попробуйте снова.',
  };
}
