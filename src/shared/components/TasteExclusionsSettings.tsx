import { useState } from 'react';
import './TasteExclusionsSettings.css';
import { useLocale } from '../i18n/useLocale';
import { t } from '../i18n/locale';
import { useTastePolicy, setTasteExcluded, refreshTastePolicy } from '../hooks/useTastePolicy';
export function TasteExclusionsSettings() {
  useLocale();
  const policy = useTastePolicy(),
    [busy, setBusy] = useState(''),
    [error, setError] = useState('');
  return (
    <div className="taste-exclusions">
      <strong className="taste-exclusions-title">{t('Исключения из профиля вкуса')}</strong>
      <p className="taste-exclusions-description">
        {t('Исключённая музыка остаётся в медиатеке и доступна для воспроизведения.')}
      </p>
      {policy.revision < 0 ? (
        <button
          type="button"
          className="settings-action taste-exclusions-action"
          onClick={() =>
            void refreshTastePolicy().catch(() =>
              setError(t('Не удалось загрузить настройки вкуса.')),
            )
          }
        >
          {t('Повторить')}
        </button>
      ) : policy.exclusions.length === 0 ? (
        <p className="taste-exclusions-empty">{t('Исключений пока нет')}</p>
      ) : (
        <ul className="taste-exclusions-list">
          {policy.exclusions.map((rule) => {
            const key = rule.scope + ':' + rule.id;
            return (
              <li key={key} className="taste-exclusions-item">
                <span className="taste-exclusions-label">
                  {rule.scope === 'track' ? t('Трек') : t('Плейлист')}: {rule.label || rule.id}
                </span>
                <button
                  type="button"
                  disabled={!!busy}
                  className="settings-action taste-exclusions-action"
                  onClick={async () => {
                    setBusy(key);
                    setError('');
                    try {
                      await setTasteExcluded({ ...rule, excluded: false });
                    } catch {
                      setError(t('Не удалось изменить настройку вкуса.'));
                    } finally {
                      setBusy('');
                    }
                  }}
                >
                  {t('Снова учитывать во вкусе')}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {error && (
        <p role="alert" className="taste-exclusions-error">
          {error}
        </p>
      )}
    </div>
  );
}
