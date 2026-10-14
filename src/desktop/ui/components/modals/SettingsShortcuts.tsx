import { useCallback, useEffect, useRef, useState } from 'react';
import {
  SHORTCUT_ACTIONS,
  DEFAULT_SHORTCUTS,
  shortcutFromKey,
  type ShortcutAction,
  type DesktopControlsStatus,
} from '../../../../shared/utils/desktopControls';
import { t } from '../../../../shared/i18n/locale';
import { useLocale } from '../../../../shared/i18n/useLocale';
const labels: Record<ShortcutAction, string> = {
  overlay: 'Показать / скрыть оверлей',
  next: 'Следующий трек',
  prev: 'Предыдущий трек',
  togglePlay: 'Пауза / продолжить',
};
export function SettingsShortcuts() {
  useLocale();
  const [status, setStatus] = useState<DesktopControlsStatus | null>(null),
    [recording, setRecording] = useState<ShortcutAction | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const alive = useRef(true),
    saving = useRef(false),
    generation = useRef(0);
  useEffect(() => {
    alive.current = true;
    const ticket = ++generation.current;
    void window.electronAPI
      ?.getDesktopControls?.()
      .then((value) => {
        if (alive.current && ticket === generation.current) setStatus(value);
      })
      .catch(() => {
        if (alive.current && ticket === generation.current)
          setError(t('Не удалось загрузить горячие клавиши.'));
      });
    return () => {
      alive.current = false;
      generation.current++;
      void window.electronAPI?.captureDesktopShortcut?.(false).catch(() => {});
    };
  }, []);
  const save = useCallback(async (action: ShortcutAction, key: string) => {
    if (saving.current) return;
    saving.current = true;
    generation.current++;
    setBusy(true);
    setError('');
    try {
      const value = await window.electronAPI?.setDesktopShortcut?.(action, key);
      if (alive.current && value) setStatus(value);
    } catch {
      if (alive.current) setError(t('Сочетание занято или не поддерживается. Выберите другое.'));
    } finally {
      saving.current = false;
      if (alive.current) {
        setBusy(false);
        setRecording(null);
      }
      void window.electronAPI?.captureDesktopShortcut?.(false).catch(() => {});
    }
  }, []);
  useEffect(() => {
    if (!recording) return;
    const stop = () => setRecording(null);
    const keydown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.repeat) return;
      if (event.code === 'Escape') {
        stop();
        return;
      }
      const key = shortcutFromKey(event);
      if (key) void save(recording, key);
    };
    window.addEventListener('keydown', keydown, true);
    window.addEventListener('blur', stop);
    return () => {
      window.removeEventListener('keydown', keydown, true);
      window.removeEventListener('blur', stop);
      void window.electronAPI?.captureDesktopShortcut?.(false).catch(() => {});
    };
  }, [recording, save]);
  async function begin(action: ShortcutAction) {
    if (busy || recording) return;
    setBusy(true);
    setError('');
    try {
      await window.electronAPI?.captureDesktopShortcut?.(true);
      if (alive.current) setRecording(action);
    } catch {
      if (alive.current) setError(t('Не удалось назначить горячую клавишу.'));
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <div className="settings-page settings-shortcuts">
      <section className="settings-section">
        <h4>{t('Горячие клавиши')}</h4>
        <p className="settings-description">
          {t(
            'Работают, пока плеер запущен, даже если его окно свёрнуто. Нажмите сочетание для изменения; Esc отменяет ввод.',
          )}
        </p>
        {SHORTCUT_ACTIONS.map((action) => (
          <div className="settings-row" key={action}>
            <div className="settings-row-copy">
              <strong>{t(labels[action])}</strong>
              {status?.unavailable.includes(action) && (
                <span role="status">{t('Сочетание занято другим приложением.')}</span>
              )}
            </div>
            <div className="settings-shortcut-actions">
              <button
                className="settings-action"
                disabled={!status || busy || !!recording}
                onClick={() => void begin(action)}
                aria-label={t(labels[action])}
              >
                {recording === action
                  ? t('Нажмите сочетание…')
                  : status?.shortcuts[action] || t('Не назначено')}
              </button>
              <button
                className="settings-action"
                disabled={!status || busy}
                title={t('Сбросить')}
                onClick={() => void save(action, DEFAULT_SHORTCUTS[action])}
              >
                ↺
              </button>
              <button
                className="settings-action"
                disabled={!status || busy || !!recording || !status.shortcuts[action]}
                title={t('Отключить')}
                onClick={() => void save(action, '')}
              >
                ×
              </button>
            </div>
          </div>
        ))}
        {error && <p role="alert">{error}</p>}
      </section>
      <section className="settings-section">
        <h4>{t('Оверлей плеера')}</h4>
        <p className="settings-description">
          {t(
            'Перетащите обложку с названием и панель управления за верхние ручки. Положение сохраняется. Пустая область пропускает клики в игру.',
          )}
        </p>
        <p className="settings-description">
          {t(
            'Для игр используйте оконный режим или окно без рамок. Эксклюзивный полноэкранный режим может скрывать оверлей.',
          )}
        </p>
        <button
          className="settings-action settings-action-primary"
          onClick={() => void window.electronAPI?.togglePlayerOverlay?.()}
        >
          {t('Показать / скрыть оверлей')}
        </button>
      </section>
    </div>
  );
}
