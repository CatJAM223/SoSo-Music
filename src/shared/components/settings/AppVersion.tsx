import { useLocale } from '../../i18n/useLocale';
import { t } from '../../i18n/locale';
import packageInfo from '../../../../package.json';

export function AppVersion() {
  useLocale();
  return (
    <div className="settings-app-version">
      <span>SoSo Music · {packageInfo.author}</span>
      <span>
        {t('Версия ')}
        {packageInfo.version}
      </span>
    </div>
  );
}
