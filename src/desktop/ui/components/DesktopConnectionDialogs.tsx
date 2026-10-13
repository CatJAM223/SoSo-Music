import { useLocale } from '../../../shared/i18n/useLocale';
import { t } from '../../../shared/i18n/locale';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Smartphone, X } from 'lucide-react';
import type { LanImportRequest } from '../../../shared/types';
import './DesktopConnectionDialogs.css';

export function DesktopConnectionDialogs() {
  useLocale();
  const [request, setRequest] = useState<LanImportRequest | null>(null);
  const [connected, setConnected] = useState(0);
  useEffect(() => {
    const api = window.electronAPI;
    let active = true,
      received = false;
    const offRequest = api?.onLanImportRequest?.((value) => {
      received = true;
      setRequest(value);
    });
    const offConnected = api?.onYouTubeAccountConnected?.(() => setConnected((value) => value + 1));
    void api
      ?.getLanImportRequest?.()
      .then((value) => {
        if (active && !received) setRequest(value);
      })
      .catch(() => {});
    return () => {
      active = false;
      offRequest?.();
      offConnected?.();
    };
  }, []);
  if (!request && !connected) return null;
  return (
    <ConnectionDialog
      key={request?.id || 'connected-' + connected}
      request={request}
      onRespond={async (accepted) => {
        if (!request) return;
        const handled = await window.electronAPI?.respondLanImport?.(request.id, accepted);
        if (handled) setRequest((current) => (current?.id === request.id ? null : current));
        else throw new Error(t('Запрос уже завершён. Отправьте медиатеку снова.'));
      }}
      onCloseSuccess={() => setConnected(0)}
    />
  );
}

type Props = {
  request: LanImportRequest | null;
  onRespond: (accepted: boolean) => Promise<void>;
  onCloseSuccess: () => void;
};

function ConnectionDialog({ request, onRespond, onCloseSuccess }: Props) {
  useLocale();
  const panel = useRef<HTMLDivElement>(null);
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const respond = async (accepted: boolean) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      await onRespond(accepted);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : t('Не удалось ответить. Попробуйте снова.'),
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const closeRef = useRef(() => {});
  closeRef.current = () => {
    if (!busyRef.current) {
      if (request) void respond(false);
      else onCloseSuccess();
    }
  };
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLButtonElement>('[data-initial-focus]')?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeRef.current();
      }
      if (event.key === 'Tab') {
        const buttons = Array.from(
          panel.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || [],
        );
        const first = buttons[0],
          last = buttons[buttons.length - 1];
        if (!first) {
          event.preventDefault();
          return;
        }
        if (
          event.shiftKey &&
          (document.activeElement === first || !panel.current?.contains(document.activeElement))
        ) {
          event.preventDefault();
          last.focus();
        } else if (
          !event.shiftKey &&
          (document.activeElement === last || !panel.current?.contains(document.activeElement))
        ) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', keydown, true);
    return () => {
      window.removeEventListener('keydown', keydown, true);
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return createPortal(
    <div className="soso-connection-backdrop" onClick={() => closeRef.current()}>
      <div
        ref={panel}
        className="soso-connection-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="soso-connection-title"
        aria-describedby="soso-connection-description"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="soso-connection-close"
          aria-label={t('Закрыть')}
          disabled={busy}
          onClick={() => closeRef.current()}
        >
          <X size={19} />
        </button>
        <span className="soso-connection-brand">SoSo Music</span>
        {request ? (
          <div className="soso-connection-icon">
            <Smartphone size={30} strokeWidth={1.6} />
          </div>
        ) : (
          <svg className="soso-connection-check" viewBox="0 0 64 64" aria-hidden="true">
            <path d="M 15 33 C 18 36 22 40 25 43 C 27 45 27 45 29 42 C 34 36 39 29 44 23 C 46 21 48 19 50 17" />
          </svg>
        )}
        <h2 id="soso-connection-title">
          {request ? t('Принять медиатеку?') : t('Аккаунт подключён')}
        </h2>
        <p id="soso-connection-description">
          {request
            ? t('Телефон отправляет свою музыку на этот ПК.')
            : t('Сессия YouTube сохранена. Можно возвращаться к музыке.')}
        </p>
        {request && (
          <>
            <div className="soso-connection-counts">
              {[
                [t('Любимые треки'), request.tracks],
                [t('Плейлисты'), request.playlists],
                [t('Альбомы'), request.albums],
                [t('Исполнители'), request.artists],
              ].map(([label, count]) => (
                <div key={label}>
                  <span>{label}</span>
                  <strong>{count}</strong>
                </div>
              ))}
            </div>
            <p className="soso-connection-note">
              {t('Музыка добавится в медиатеку ПК. Совпадающие записи могут обновиться.')}
            </p>
            <span className="soso-connection-device">
              {t('Устройство: ')}
              {request.address}
            </span>
          </>
        )}
        {error && (
          <p className="soso-connection-error" role="alert">
            {error}
          </p>
        )}
        <div className="soso-connection-actions">
          {request ? (
            <>
              <button
                type="button"
                data-initial-focus
                disabled={busy}
                onClick={() => void respond(false)}
              >
                {t('Отмена')}
              </button>
              <button
                type="button"
                className="soso-connection-primary"
                disabled={busy}
                onClick={() => void respond(true)}
              >
                {busy ? t('Подождите…') : t('Принять')}
              </button>
            </>
          ) : (
            <button
              type="button"
              data-initial-focus
              className="soso-connection-primary"
              onClick={onCloseSuccess}
            >
              {t('Готово')}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
