import { useCallback, useEffect, useRef, useState } from 'react';
import { MoreHorizontal, Move, RotateCcw, X } from 'lucide-react';
import './SettingsShortcuts.css';
import {
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
    [error, setError] = useState(''),
    [menu, setMenu] = useState<ShortcutAction | null>(null);
  const alive = useRef(true),
    saving = useRef(false),
    generation = useRef(0),
    captureAttempt = useRef(0);
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
    const cancelPendingCapture = () => {
      captureAttempt.current++;
      if (!saving.current) {
        setBusy(false);
        setRecording(null);
      }
      void window.electronAPI?.captureDesktopShortcut?.(false).catch(() => {});
    };
    window.addEventListener('blur', cancelPendingCapture);
    return () => {
      window.removeEventListener('blur', cancelPendingCapture);
      captureAttempt.current++;
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
    setMenu(null);
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
      event.stopImmediatePropagation();
      if (event.repeat) return;
      if (event.code === 'Escape') {
        stop();
        return;
      }
      const key = shortcutFromKey(event);
      if (key) void save(recording, key);
      else if (!/^(Control|Alt|Shift|Meta)(Left|Right)$/.test(event.code))
        setError(t('Клавиша не поддерживается. Попробуйте F8 или Ctrl+Space.'));
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
    const attempt = ++captureAttempt.current;
    setBusy(true);
    setMenu(null);
    setError('');
    try {
      await window.electronAPI?.captureDesktopShortcut?.(true);
      if (alive.current && captureAttempt.current === attempt) setRecording(action);
    } catch {
      if (alive.current && captureAttempt.current === attempt)
        setError(t('Не удалось назначить горячую клавишу.'));
    } finally {
      if (alive.current && captureAttempt.current === attempt) setBusy(false);
    }
  }
  useEffect(() => {
    if (!menu) return;
    const outside = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('.shortcut-menu-wrap'))
        setMenu(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenu(null);
    };
    window.addEventListener('pointerdown', outside);
    window.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('pointerdown', outside);
      window.removeEventListener('keydown', escape);
    };
  }, [menu]);
  async function editOverlay() {
    setError('');
    try {
      await window.electronAPI?.editPlayerOverlay?.();
    } catch {
      if (alive.current) setError(t('Не удалось открыть настройку оверлея.'));
    }
  }
  function row(action: ShortcutAction) {
    const names: Record<string, string> = {
      Control: 'Ctrl',
      Super: 'Win',
      Space: t('Пробел'),
      Left: '←',
      Right: '→',
      Up: '↑',
      Down: '↓',
      PageUp: 'PgUp',
      PageDown: 'PgDn',
    };
    const shortcut = status?.shortcuts[action];
    return (
      <div className="shortcut-row" key={action}>
        <div className="shortcut-copy">
          <span>{t(labels[action])}</span>
          {status?.unavailable.includes(action) && (
            <small role="status">{t('Сочетание занято другим приложением.')}</small>
          )}
        </div>
        <div className="shortcut-binding">
          <button
            className={'shortcut-keys' + (recording === action ? ' is-recording' : '')}
            data-shortcut-action={action}
            disabled={
              !status || busy || !!recording || (action === 'overlay' && !status.overlayEnabled)
            }
            onClick={() => void begin(action)}
            aria-label={t(labels[action])}
            title={t('Изменить сочетание')}
          >
            {recording === action ? (
              <span className="shortcut-recording">{t('Нажмите сочетание…')}</span>
            ) : shortcut ? (
              shortcut.split('+').map((key) => <kbd key={key}>{names[key] || key}</kbd>)
            ) : (
              <span className="shortcut-unassigned">{t('Не назначено')}</span>
            )}
          </button>
          <div className="shortcut-menu-wrap">
            <button
              className="shortcut-more"
              aria-label={t('Действия с сочетанием')}
              aria-expanded={menu === action}
              disabled={!status || busy || !!recording}
              onClick={() => setMenu(menu === action ? null : action)}
            >
              <MoreHorizontal size={17} />
            </button>
            {menu === action && (
              <div className="shortcut-menu">
                <button onClick={() => void save(action, DEFAULT_SHORTCUTS[action])}>
                  <RotateCcw size={14} />
                  {t('Сбросить')}
                </button>
                <button disabled={!shortcut} onClick={() => void save(action, '')}>
                  <X size={14} />
                  {t('Отключить')}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="settings-page settings-shortcuts">
      <section className="shortcuts-section">
        <h4>{t('Воспроизведение')}</h4>
        <p className="shortcuts-description">{t('Работают, даже когда плеер свёрнут.')}</p>
        <div className="shortcuts-group">
          {(['togglePlay', 'next', 'prev'] as ShortcutAction[]).map(row)}
        </div>
        <p className="shortcuts-hint">
          {t(
            'Одна клавиша или сочетание, например F8, Shift+F8 или Ctrl+Space. Нажмите для изменения; Esc — отмена.',
          )}
        </p>
      </section>
      <section className="shortcuts-section">
        <h4>{t('Оверлей плеера')}</h4>
        <p className="shortcuts-description">
          {t('Обложка и название трека поверх других окон. Клики проходят насквозь.')}
        </p>
        <div className="shortcuts-group">{row('overlay')}</div>
        {status && !status.overlayEnabled && (
          <p className="shortcuts-hint">
            {t('Оверлей отключён. Включить его можно в Настройки → Интеграции.')}
          </p>
        )}
        <div className="shortcuts-position">
          <div>
            <strong>{t('Положение на экране')}</strong>
            <p>{t('Переместите карточку в удобное место. Положение сохранится.')}</p>
          </div>
          <button
            className="shortcut-position-button"
            disabled={!status?.overlayEnabled}
            onClick={() => void editOverlay()}
          >
            <Move size={15} />
            {t('Настроить положение')}
          </button>
        </div>
        <p className="shortcuts-hint">
          {t('В играх используйте оконный режим или окно без рамок.')}
        </p>
      </section>
      {error && (
        <p className="shortcuts-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
