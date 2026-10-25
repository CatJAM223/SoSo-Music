import { useLocale } from '../../i18n/useLocale';
import { t, setLocale } from '../../i18n/locale';
import { Check } from 'lucide-react';
import {
  ACCENT_COLOR_OPTIONS,
  EASTER_EGG_THEME_OPTION,
  THEME_OPTIONS,
  useTheme,
} from '../../context/ThemeContext';

type Props = {
  onSelectWallpaper: () => void;
  onRestartTour?: () => void;
  layout?: 'desktop' | 'mobile';
  wallpaperLabel?: string;
  onRemoveWallpaper?: () => void;
  wallpaperBusy?: boolean;
};

export function SettingsAppearance({
  onSelectWallpaper,
  onRestartTour,
  layout = 'desktop',
  wallpaperLabel,
  onRemoveWallpaper,
  wallpaperBusy = false,
}: Props) {
  const locale = useLocale();
  const {
    themePreset,
    setThemePreset,
    themeMode,
    setThemeMode,
    weatherMode,
    setWeatherMode,
    accentColor,
    setAccentColor,
    cursorGlow,
    toggleCursorGlow,
    wallpaperPath,
    wallpaperDim,
    wallpaperBlur,
    setWallpaperPath,
    setWallpaperDim,
    setWallpaperBlur,
    sceneIntensity,
    setSceneIntensity,
  } = useTheme();
  const themes = [...THEME_OPTIONS, EASTER_EGG_THEME_OPTION];
  const showMode = themePreset === 'default' || themePreset === 'wallpaper';

  return (
    <div className="settings-page settings-appearance">
      <section className="settings-section settings-language" aria-label={t('Язык интерфейса')}>
        <div className="settings-row">
          <div className="settings-row-copy">
            <strong>{t('Язык интерфейса')}</strong>
            <span>Русский / English</span>
          </div>
          <div className="settings-segmented" role="group" aria-label={t('Язык интерфейса')}>
            <button
              type="button"
              lang="ru"
              aria-pressed={locale === 'ru'}
              className={locale === 'ru' ? 'selected' : ''}
              onClick={() => setLocale('ru')}
            >
              RU
            </button>
            <button
              type="button"
              lang="en"
              aria-pressed={locale === 'en'}
              className={locale === 'en' ? 'selected' : ''}
              onClick={() => setLocale('en')}
            >
              EN
            </button>
          </div>
        </div>
      </section>

      <section className="settings-section">
        <h4>{t('Тема оформления')}</h4>
        <div className="settings-theme-list">
          {themes.map((theme) => (
            <button
              key={theme.id}
              type="button"
              className={`settings-theme-option ${themePreset === theme.id ? 'selected' : ''}`}
              onClick={() => setThemePreset(theme.id)}
              aria-pressed={themePreset === theme.id}
            >
              <span className={`settings-theme-swatch bg-linear-to-br ${theme.previewGradient}`} />
              <span>{t(theme.name)}</span>
              {themePreset === theme.id && <Check size={18} aria-hidden="true" />}
            </button>
          ))}
        </div>
      </section>

      {(themePreset === 'nighttrain' || themePreset === 'cassette') && (
        <section className="settings-section">
          <h4>{t('Эффекты фона')}</h4>
          <div className="settings-row">
            <div className="settings-row-copy">
              <strong>{t('Интенсивность')}</strong>
              <span>{t('На паузе движение фона замедляется')}</span>
            </div>
            <div
              className="settings-segmented"
              role="group"
              aria-label={t('Интенсивность эффектов фона')}
            >
              <button
                type="button"
                aria-pressed={sceneIntensity === 'quiet'}
                className={sceneIntensity === 'quiet' ? 'selected' : ''}
                onClick={() => setSceneIntensity('quiet')}
              >
                {t('Спокойно')}
              </button>
              <button
                type="button"
                aria-pressed={sceneIntensity === 'full'}
                className={sceneIntensity === 'full' ? 'selected' : ''}
                onClick={() => setSceneIntensity('full')}
              >
                {t('Насыщенно')}
              </button>
              <button
                type="button"
                aria-pressed={sceneIntensity === 'still'}
                className={sceneIntensity === 'still' ? 'selected' : ''}
                onClick={() => setSceneIntensity('still')}
              >
                {t('Без движения')}
              </button>
            </div>
          </div>
        </section>
      )}

      {showMode && (
        <section className="settings-section">
          <h4>{t('Отображение')}</h4>
          <div className="settings-row">
            <div className="settings-row-copy">
              <strong>{t('Режим')}</strong>
            </div>
            <div className="settings-segmented" role="group" aria-label={t('Режим оформления')}>
              <button
                type="button"
                className={themeMode === 'light' ? 'selected' : ''}
                onClick={() => setThemeMode('light')}
              >
                {t('Светлый')}
              </button>
              <button
                type="button"
                className={themeMode === 'dark' ? 'selected' : ''}
                onClick={() => setThemeMode('dark')}
              >
                {t('Тёмный')}
              </button>
            </div>
          </div>
          <div className="settings-row">
            <div className="settings-row-copy">
              <strong>{t('Цветовой акцент')}</strong>
            </div>
            <div className="settings-color-options" role="group" aria-label={t('Цветовой акцент')}>
              {ACCENT_COLOR_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={accentColor === option.id ? 'selected' : ''}
                  style={{ backgroundColor: option.color }}
                  onClick={() => setAccentColor(option.id)}
                  aria-label={t(option.name)}
                  aria-pressed={accentColor === option.id}
                >
                  {accentColor === option.id && <Check size={14} />}
                </button>
              ))}
            </div>
          </div>
        </section>
      )}

      {themePreset === 'weather' && (
        <section className="settings-section">
          <h4>{t('Погода')}</h4>
          <div className="settings-row">
            <div className="settings-row-copy">
              <strong>{t('Атмосфера')}</strong>
            </div>
            <div className="settings-segmented" role="group" aria-label={t('Погода')}>
              <button
                type="button"
                className={weatherMode === 'clear' ? 'selected' : ''}
                onClick={() => setWeatherMode('clear')}
              >
                {t('Ясно')}
              </button>
              <button
                type="button"
                className={weatherMode === 'rain' ? 'selected' : ''}
                onClick={() => setWeatherMode('rain')}
              >
                {t('Дождь')}
              </button>
            </div>
          </div>
        </section>
      )}

      {themePreset === 'wallpaper' && (
        <section className="settings-section">
          <h4>{t('Видеообои')}</h4>
          <div className="settings-row">
            <div className="settings-row-copy">
              <strong>{t('Файл фона')}</strong>
              <span>
                {wallpaperLabel ||
                  (wallpaperPath
                    ? wallpaperPath.split(/[\\/]/).pop()
                    : t('Видео или GIF не выбрано'))}
              </span>
            </div>
            <div className="settings-inline-actions">
              {wallpaperPath && (
                <button
                  type="button"
                  className="settings-text-action"
                  disabled={wallpaperBusy}
                  onClick={() => (onRemoveWallpaper ? onRemoveWallpaper() : setWallpaperPath(null))}
                >
                  {t('Убрать')}
                </button>
              )}
              <button
                type="button"
                className="settings-action"
                disabled={wallpaperBusy}
                onClick={onSelectWallpaper}
              >
                {wallpaperBusy ? t('Сохраняем…') : t('Выбрать файл')}
              </button>
            </div>
          </div>
          <div className="settings-row">
            <div className="settings-row-copy">
              <strong>{t('Затемнение')}</strong>
            </div>
            <div className="settings-range-control">
              <input
                type="range"
                min="0"
                max="90"
                step="5"
                value={wallpaperDim}
                onChange={(event) => setWallpaperDim(Number(event.target.value))}
                aria-label={t('Затемнение фона')}
              />
              <span>{wallpaperDim}%</span>
            </div>
          </div>
          <div className="settings-row">
            <div className="settings-row-copy">
              <strong>{t('Размытие')}</strong>
            </div>
            <div className="settings-range-control">
              <input
                type="range"
                min="0"
                max="30"
                step="2"
                value={wallpaperBlur}
                onChange={(event) => setWallpaperBlur(Number(event.target.value))}
                aria-label={t('Размытие фона')}
              />
              <span>{wallpaperBlur}px</span>
            </div>
          </div>
        </section>
      )}

      {layout === 'desktop' && (
        <section className="settings-section">
          <h4>{t('Интерфейс')}</h4>
          <div className="settings-row">
            <div className="settings-row-copy">
              <strong>{t('Сияние курсора')}</strong>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={cursorGlow}
              aria-label={t('Сияние курсора')}
              className={`settings-switch ${cursorGlow ? 'enabled' : ''}`}
              onClick={toggleCursorGlow}
            >
              <span />
            </button>
          </div>
          <div className="settings-row">
            <div className="settings-row-copy">
              <strong>{t('Обучение')}</strong>
            </div>
            <button type="button" className="settings-action" onClick={onRestartTour}>
              {t('Пройти заново')}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
