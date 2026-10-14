import { useOverlaySettings } from '../hooks/useOverlaySettings';
import { useLocale } from '../../../shared/i18n/useLocale';
import { t } from '../../../shared/i18n/locale';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import type { ZapretCheckResult } from '../../../shared/types';
import { useDialogFocus } from '../../../shared/hooks/useDialogFocus';
import './OnboardingTour.css';

type Props = { isOpen: boolean; onClose: () => void };
type TourStep =
  | 'welcome'
  | 'spotlight-sidebar'
  | 'spotlight-search'
  | 'spotlight-player'
  | 'spotlight-lyrics'
  | 'spotlight-settings'
  | 'pref-guitar'
  | 'pref-clips'
  | 'pref-overlay'
  | 'pref-lastfm'
  | 'pref-zapret'
  | 'finish';
const sequence: TourStep[] = [
  'welcome',
  'spotlight-sidebar',
  'spotlight-search',
  'spotlight-player',
  'spotlight-lyrics',
  'spotlight-settings',
  'pref-guitar',
  'pref-clips',
  'pref-overlay',
  'pref-lastfm',
  'pref-zapret',
  'finish',
];
const targets: Partial<
  Record<
    TourStep,
    { selector: string; title: string; description: string; position: 'right' | 'top' }
  >
> = {
  'spotlight-sidebar': {
    selector: '[data-tour="sidebar-nav"]',
    title: 'Разделы и медиатека',
    position: 'right',
    description: 'Здесь находятся главная страница, чарты, жанры, ваша музыка и плейлисты.',
  },
  'spotlight-search': {
    selector: '[data-tour="search-nav"]',
    title: 'Поиск музыки',
    position: 'right',
    description: 'Ищите треки, альбомы и исполнителей в SoundCloud и YouTube Music.',
  },
  'spotlight-player': {
    selector: '[data-tour="player-bar"]',
    title: 'Управление воспроизведением',
    position: 'top',
    description:
      'Переключайте треки, перематывайте запись, меняйте громкость и открывайте очередь.',
  },
  'spotlight-lyrics': {
    selector: '[data-tour="lyrics-guitar"]',
    title: 'Караоке и гитара',
    position: 'top',
    description:
      'Откройте текст текущей песни, аккорды или табы. Если найден официальный клип, его можно включить здесь же.',
  },
  'spotlight-settings': {
    selector: '[data-tour="settings-nav"]',
    title: 'Настройки',
    position: 'right',
    description:
      'Меняйте темы и звук, подключайте аккаунт YouTube и переносите медиатеку между телефоном и ПК.',
  },
};
const readPreference = (key: string, fallback: string) => {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
};
export function OnboardingTour({ isOpen, onClose }: Props) {
  useLocale();
  return isOpen ? <TourSession onClose={onClose} /> : null;
}
function TourSession({ onClose }: { onClose: () => void }) {
  const locale = useLocale();
  const [step, setStep] = useState<TourStep>('welcome');
  const [guitar, setGuitar] = useState<'chords' | 'tabs' | 'none'>(() =>
    readPreference('soso_guitar_player', 'true') === 'false'
      ? 'none'
      : readPreference('soso_guitar_mode', 'chords') === 'tabs'
        ? 'tabs'
        : 'chords',
  );
  const [clips, setClips] = useState(() => readPreference('soso_find_clips', 'true') !== 'false');
  const overlay = useOverlaySettings(true);
  const [overlayChoice, setOverlayChoice] = useState<boolean | null>(null);
  const overlayEnabled = overlayChoice ?? overlay.enabled ?? true;
  const [zapret, setZapret] = useState<ZapretCheckResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [applying, setApplying] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [feedbackError, setFeedbackError] = useState(false);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const [placement, setPlacement] = useState<{ left: number; top: number } | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const index = sequence.indexOf(step),
    target = targets[step];
  const markCompleted = () => {
    try {
      localStorage.setItem('soso_onboarding_completed', 'true');
    } catch {}
    onClose();
  };
  useDialogFocus(panel, () => {
    if (!applying) markCompleted();
  });
  useLayoutEffect(() => {
    const measure = () => {
      const rect = target
        ? document.querySelector(target.selector)?.getBoundingClientRect()
        : undefined;
      setTargetRect(rect || null);
      if (!rect || !panel.current || !target) {
        setPlacement(null);
        return;
      }
      const { width, height } = panel.current.getBoundingClientRect(),
        gap = 16,
        edge = 16;
      const left =
        target.position === 'right' ? rect.right + gap : rect.left + rect.width / 2 - width / 2;
      const top =
        target.position === 'right'
          ? rect.top + rect.height / 2 - height / 2
          : rect.top - height - gap;
      setPlacement({
        left: Math.max(edge, Math.min(window.innerWidth - width - edge, left)),
        top: Math.max(edge, Math.min(window.innerHeight - height - edge, top)),
      });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [target, locale]);
  useEffect(() => {
    if (step !== 'pref-zapret' || zapret) return;
    let active = true;
    setScanning(true);
    setFeedback('');
    const scan = window.electronAPI?.findZapretConfig;
    if (!scan) {
      setScanning(false);
      return;
    }
    void scan()
      .then((result) => {
        if (active) {
          setZapret(result);
          setScanning(false);
        }
      })
      .catch(() => {
        if (active) {
          setScanning(false);
          setFeedbackError(true);
          setFeedback(t('Не удалось проверить список. Можно выбрать файл вручную или продолжить.'));
        }
      });
    return () => {
      active = false;
    };
  }, [step, zapret]);
  const selectFile = async () => {
    if (applying) return;
    try {
      const result = await window.electronAPI?.selectZapretFile?.();
      if (result && !result.canceled && result.checkResult) {
        setZapret(result.checkResult);
        setFeedback('');
      }
    } catch {
      setFeedbackError(true);
      setFeedback(t('Не удалось открыть выбранный файл.'));
    }
  };
  const applyDomains = async () => {
    if (applying || !window.electronAPI?.applyZapretDomains) return;
    setApplying(true);
    setFeedback('');
    try {
      const result = await window.electronAPI.applyZapretDomains();
      setFeedback(result.message);
      setFeedbackError(!result.success);
      if (result.success)
        setZapret((value) => (value ? { ...value, hasSoundcloud: true, hasSndcdn: true } : value));
    } catch {
      setFeedbackError(true);
      setFeedback(t('Не удалось изменить список. Попробуйте ещё раз.'));
    } finally {
      setApplying(false);
    }
  };
  const complete = async () => {
    if (applying || overlay.busy) return;
    if (overlayChoice !== null && !(await overlay.save(overlayChoice))) return;
    try {
      const preferences = { soso_guitar_player: guitar !== 'none', soso_find_clips: clips };
      for (const [key, value] of Object.entries(preferences)) {
        localStorage.setItem(key, String(value));
        window.dispatchEvent(new CustomEvent('soso:settings-changed', { detail: { key, value } }));
      }
      if (guitar !== 'none') {
        localStorage.setItem('soso_guitar_mode', guitar);
        window.dispatchEvent(
          new CustomEvent('soso:settings-changed', {
            detail: { key: 'soso_guitar_mode', value: guitar },
          }),
        );
      }
    } catch {}
    markCompleted();
  };
  return createPortal(
    <div className="onboarding-layer">
      {targetRect ? (
        <div
          aria-hidden="true"
          className="onboarding-spotlight"
          style={{
            top: targetRect.top - 5,
            left: targetRect.left - 5,
            width: targetRect.width + 10,
            height: targetRect.height + 10,
          }}
        />
      ) : (
        <div className="onboarding-shade" />
      )}
      <div
        ref={panel}
        className={'settings-modal onboarding-panel' + (placement ? ' onboarding-floating' : '')}
        style={placement || undefined}
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
        aria-describedby="onboarding-description"
      >
        <header>
          <span>{t('Знакомство с SoSo Music')}</span>
          <div>
            <span>
              {index + 1} / {sequence.length}
            </span>
            <button
              type="button"
              className="settings-close"
              aria-label={t('Закрыть обучение')}
              disabled={applying || overlay.busy}
              onClick={markCompleted}
            >
              <X size={19} />
            </button>
          </div>
        </header>
        <div
          className="onboarding-progress"
          role="progressbar"
          aria-label={t('Ход знакомства')}
          aria-valuemin={1}
          aria-valuemax={sequence.length}
          aria-valuenow={index + 1}
        >
          {sequence.map((item, position) => (
            <span key={item} data-complete={position <= index} />
          ))}
        </div>
        <div className="onboarding-section-label">
          {index < 6 ? t('Основы') : step === 'finish' ? t('Всё готово') : t('Ваши предпочтения')}
        </div>
        <h2 id="onboarding-title">
          {(target ? t(target.title) : undefined) ||
            (
              {
                welcome: t('Добро пожаловать'),
                'pref-guitar': t('Режим гитары'),
                'pref-clips': t('Клипы'),
                'pref-overlay': t('Оверлей плеера'),
                'pref-lastfm': 'Last.fm',
                'pref-zapret': t('Подключение SoundCloud'),
                finish: t('Можно начинать'),
              } as Partial<Record<TourStep, string>>
            )[step]}
        </h2>
        <p id="onboarding-description">
          {(target ? t(target.description) : undefined) ||
            (
              {
                welcome: t(
                  'Коротко покажем основные разделы и поможем выбрать несколько настроек. Всё можно изменить позже.',
                ),
                'pref-guitar': t('Выберите, что показывать рядом с караоке.'),
                'pref-clips': t('Плеер может искать официальные клипы к текущему треку.'),
                'pref-overlay': t(
                  'Показывать обложку и название трека поверх других окон? Управляйте музыкой горячими клавишами, клики проходят насквозь.',
                ),
                'pref-lastfm': t(
                  'Last.fm помогает находить жанры любимой музыки. Получите API key и добавьте его в Настройки → Интеграции. Этот шаг можно пропустить.',
                ),
                'pref-zapret': t(
                  'Если вы используете Zapret, проверьте домены SoundCloud в его списке. Этот шаг можно пропустить.',
                ),
                finish: t('Выбранные параметры применятся после нажатия «Начать слушать».'),
              } as Partial<Record<TourStep, string>>
            )[step]}
        </p>
        {step === 'pref-guitar' && (
          <fieldset className="onboarding-options">
            <legend className="sr-only">{t('Режим гитары')}</legend>
            {(
              [
                ['chords', t('Аккорды'), t('Текст песни и схемы аккордов.')],
                ['tabs', t('Табы Songsterr'), t('Дорожки инструментов и табулатуры.')],
                ['none', t('Только караоке'), t('Текст песни без режима гитары.')],
              ] as const
            ).map(([value, title, description]) => (
              <label
                key={value}
                className={'settings-row onboarding-choice' + (guitar === value ? ' selected' : '')}
              >
                <span className="settings-row-copy">
                  <strong>{title}</strong>
                  <span>{description}</span>
                </span>
                <input
                  type="radio"
                  name="onboarding-guitar"
                  value={value}
                  checked={guitar === value}
                  onChange={() => setGuitar(value)}
                />
              </label>
            ))}
          </fieldset>
        )}
        {step === 'pref-clips' && (
          <div className="settings-row">
            <div className="settings-row-copy">
              <strong>{t('Поиск клипов')}</strong>
              <span>{t('Включайте видео в экране караоке.')}</span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={clips}
              aria-label={t('Поиск клипов')}
              className={'settings-switch' + (clips ? ' enabled' : '')}
              onClick={() => setClips((value) => !value)}
            >
              <span />
            </button>
          </div>
        )}
        {step === 'pref-overlay' && (
          <div className="onboarding-overlay">
            <div className="settings-row">
              <div className="settings-row-copy">
                <strong>{t('Включить оверлей')}</strong>
                <span>{t('Позже можно изменить в Настройки → Интеграции.')}</span>
              </div>
              <button
                type="button"
                role="switch"
                aria-label={t('Включить оверлей')}
                aria-checked={overlayEnabled}
                className={'settings-switch' + (overlayEnabled ? ' enabled' : '')}
                disabled={overlay.enabled === null || overlay.busy}
                onClick={() => setOverlayChoice(!overlayEnabled)}
              >
                <span />
              </button>
            </div>
          </div>
        )}
        {step === 'pref-lastfm' && (
          <section className="onboarding-lastfm">
            <div className="settings-row">
              <div className="settings-row-copy">
                <strong>{t('Ключ API Last.fm')}</strong>
                <span>
                  {t(
                    'Войдите в Last.fm, создайте API-приложение и скопируйте API key. Shared secret плееру не нужен.',
                  )}
                </span>
              </div>
            </div>
            <a
              className="settings-action"
              href="https://www.last.fm/api/account/create"
              target="_blank"
              rel="noopener noreferrer"
            >
              {t('Получить ключ Last.fm')}
            </a>
            <p className="settings-row-note">
              {t('Ключ можно добавить позже в настройках. Музыку можно слушать и без Last.fm.')}
            </p>
          </section>
        )}
        {step === 'pref-zapret' && (
          <section className="onboarding-network">
            {scanning ? (
              <p className="settings-feedback" role="status">
                {t('Проверяем список доменов…')}
              </p>
            ) : (
              <>
                <div className="settings-row">
                  <div className="settings-row-copy">
                    <strong>{t('Список доменов')}</strong>
                    <span className="onboarding-file" title={zapret?.path}>
                      {zapret?.found ? zapret.path : t('Не найден автоматически')}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="settings-action"
                    disabled={applying}
                    onClick={() => void selectFile()}
                  >
                    {t('Выбрать файл')}
                  </button>
                </div>
                {zapret?.found && (
                  <div className="settings-row">
                    <div className="settings-row-copy">
                      <strong>SoundCloud</strong>
                      <span>
                        {zapret.hasSoundcloud && zapret.hasSndcdn
                          ? t('Оба домена уже добавлены.')
                          : t('Нужны soundcloud.com и sndcdn.com.')}
                      </span>
                    </div>
                    {!(zapret.hasSoundcloud && zapret.hasSndcdn) && (
                      <button
                        type="button"
                        className="settings-action"
                        disabled={applying}
                        onClick={() => void applyDomains()}
                      >
                        {applying ? t('Добавляем…') : t('Добавить домены')}
                      </button>
                    )}
                  </div>
                )}
              </>
            )}
            {feedback && (
              <p
                className={'settings-feedback' + (feedbackError ? ' error' : ' success')}
                role="status"
              >
                {t(feedback)}
              </p>
            )}
          </section>
        )}
        {step === 'finish' && (
          <div className="onboarding-summary">
            <div className="settings-row">
              <span>{t('Режим гитары')}</span>
              <span>
                {guitar === 'chords'
                  ? t('Аккорды')
                  : guitar === 'tabs'
                    ? t('Табы Songsterr')
                    : t('Только караоке')}
              </span>
            </div>
            <div className="settings-row">
              <span>{t('Поиск клипов')}</span>
              <span>{clips ? t('Включён') : t('Выключен')}</span>
            </div>
            <div className="settings-row">
              <span>{t('Оверлей плеера')}</span>
              <span>{overlayEnabled ? t('Включён') : t('Выключен')}</span>
            </div>
            <div className="settings-row">
              <span>{t('Домены SoundCloud')}</span>
              <span>
                {zapret?.hasSoundcloud && zapret.hasSndcdn ? t('Добавлены') : t('Без изменений')}
              </span>
            </div>
          </div>
        )}
        {overlay.error && (
          <p role="alert" className="settings-feedback error">
            {overlay.error}
          </p>
        )}
        <footer>
          <div>
            {index > 0 && (
              <button
                type="button"
                className="settings-action"
                disabled={applying}
                onClick={() => setStep(sequence[index - 1])}
              >
                {t('Назад')}
              </button>
            )}
          </div>
          <div>
            {step !== 'finish' && (
              <button
                type="button"
                className="settings-text-action"
                disabled={applying}
                onClick={markCompleted}
              >
                {t('Пропустить')}
              </button>
            )}
            <button
              type="button"
              className="settings-action settings-action-primary"
              data-initial-focus
              disabled={applying}
              onClick={() => {
                if (step === 'finish') void complete();
                else setStep(sequence[index + 1]);
              }}
            >
              {step === 'finish'
                ? t('Начать слушать')
                : step === 'welcome'
                  ? t('Далее')
                  : t('Продолжить')}
            </button>
          </div>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
