import { useLocale } from '../../../shared/i18n/useLocale';
import { t } from '../../../shared/i18n/locale';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useDialogFocus } from '../../../shared/hooks/useDialogFocus';
import {
  isYouTubeAccessHintHidden,
  isYouTubeAccessIssue,
  setYouTubeAccessHintHidden,
  youtubeAccessHintCopy,
  YOUTUBE_ACCESS_ISSUE_EVENT,
  type YouTubeAccessIssue,
} from '../../../shared/utils/youtubeAccessHint';
import { setYouTubePlaybackDisabled } from '../../../shared/services/youtubeAvailability';
import './YouTubeAccessDialog.css';

type Props = {
  currentTrackId?: string | number;
  isPlaying: boolean;
  onOpenAccountSettings: () => void;
};
export function YouTubeAccessDialog({ currentTrackId, isPlaying, onOpenAccountSettings }: Props) {
  useLocale();
  const [issue, setIssue] = useState<YouTubeAccessIssue | null>(null);
  const trackRef = useRef(currentTrackId);
  trackRef.current = currentTrackId;
  const sequence = useRef(0);
  const [connected, setConnected] = useState<boolean | null>(null);
  useEffect(() => {
    sequence.current++;
    setIssue((value) => (value && value.trackId !== currentTrackId ? null : value));
  }, [currentTrackId]);
  useLayoutEffect(() => {
    if (isPlaying) {
      sequence.current++;
      setIssue(null);
    }
  }, [isPlaying]);
  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.getYouTubeAccountStatus || !api.connectYouTubeAccount) return;
    let active = true;
    const handleIssue = async (event: Event) => {
      const value: unknown = (event as CustomEvent).detail;
      if (
        !isYouTubeAccessIssue(value) ||
        value.source !== 'track' ||
        isYouTubeAccessHintHidden(value.reason) ||
        value.trackId !== trackRef.current
      )
        return;
      const request = ++sequence.current;
      try {
        const status = await api.getYouTubeAccountStatus!();
        if (
          !active ||
          request !== sequence.current ||
          value.trackId !== trackRef.current ||
          isYouTubeAccessHintHidden(value.reason)
        )
          return;
        setConnected(status.connected);
        setIssue((previous) =>
          previous?.trackId === value.trackId &&
          previous.reason === value.reason &&
          previous.source === value.source
            ? previous
            : value,
        );
      } catch {
        if (active && request === sequence.current && value.trackId === trackRef.current) {
          setConnected(null);
          setIssue(value);
        }
      }
    };
    const off = api.onYouTubeAccountChanged?.((status) => {
      if (status.connected && !status.error) {
        sequence.current++;
        setIssue(null);
      }
    });
    const offConnected = api.onYouTubeAccountConnected?.(() => {
      setYouTubePlaybackDisabled(false);
      sequence.current++;
      setIssue(null);
    });
    window.addEventListener(YOUTUBE_ACCESS_ISSUE_EVENT, handleIssue);
    return () => {
      active = false;
      sequence.current++;
      off?.();
      offConnected?.();
      window.removeEventListener(YOUTUBE_ACCESS_ISSUE_EVENT, handleIssue);
    };
  }, []);
  if (!issue || issue.trackId !== currentTrackId || isPlaying) return null;
  const dismiss = () => {
    sequence.current++;
    setIssue(null);
  };
  return (
    <AccessPanel
      key={issue.reason + ':' + issue.trackId}
      issue={issue}
      connected={connected}
      onClose={dismiss}
      onDisableYouTube={() => {
        setYouTubePlaybackDisabled(true);
        dismiss();
      }}
      onOpenSettings={() => {
        dismiss();
        onOpenAccountSettings();
      }}
    />
  );
}

type PanelProps = {
  issue: YouTubeAccessIssue;
  connected: boolean | null;
  onClose: () => void;
  onDisableYouTube: () => void;
  onOpenSettings: () => void;
};
function AccessPanel({ issue, connected, onClose, onDisableYouTube, onOpenSettings }: PanelProps) {
  useLocale();
  const panel = useRef<HTMLDivElement>(null);
  const [hidden, setHidden] = useState(false);
  const copy = youtubeAccessHintCopy(issue);
  const ageRestricted = issue.reason === 'age-restricted';
  const statusUnknown = connected === null && !ageRestricted;
  const description = statusUnknown
    ? 'Не удалось проверить сессию YouTube. Проверьте соединение и состояние аккаунта в настройках.'
    : connected && !ageRestricted
      ? 'Откройте YouTube из настроек и выполните его запрос. Затем нажмите «Обновить сессию» и попробуйте запустить трек снова.'
      : copy.description;
  useDialogFocus(panel, onClose);
  return createPortal(
    <div className="youtube-access-backdrop" onClick={onClose}>
      <div
        ref={panel}
        className="settings-modal youtube-access-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="youtube-access-title"
        aria-describedby="youtube-access-description"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="youtube-access-content">
          <div className="youtube-access-header">
            <h2 id="youtube-access-title">
              {t(statusUnknown ? 'Проверьте подключение к YouTube' : copy.title)}
            </h2>
            <button
              type="button"
              className="settings-close"
              aria-label={t('Закрыть')}
              data-initial-focus
              onClick={onClose}
            >
              <X size={19} />
            </button>
          </div>
          <p id="youtube-access-description">{t(description)}</p>
          <p className="youtube-access-choice-note">
            {t('Если продолжить без YouTube, его треки будут недоступны до подключения аккаунта.')}
          </p>
          <label className="youtube-access-preference">
            <input
              type="checkbox"
              checked={hidden}
              onChange={(event) => {
                setHidden(event.target.checked);
                setYouTubeAccessHintHidden(issue.reason, event.target.checked);
              }}
            />
            {t('Не показывать снова')}
          </label>
          <footer className="youtube-access-actions">
            <button type="button" className="settings-action" onClick={onDisableYouTube}>
              {t('Без YouTube')}
            </button>
            <button
              type="button"
              className="settings-action settings-action-primary"
              onClick={onOpenSettings}
            >
              {t('Открыть настройки')}
            </button>
          </footer>
        </div>
      </div>
    </div>,
    document.body,
  );
}
