import { SettingsEqualizer } from './SettingsEqualizer';
import { SettingsShortcuts } from './SettingsShortcuts';
import { useOverlaySettings } from '../../hooks/useOverlaySettings';
import { useLastFmKeySettings } from '../../hooks/useLastFmKeySettings';
import { useLocale } from '../../../../shared/i18n/useLocale';
import { t } from '../../../../shared/i18n/locale';
import { useYouTubeAccountSettings } from '../../hooks/useYouTubeAccountSettings';
import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, CircleHelp, Move } from 'lucide-react';
import discordSymbol from '../../assets/discord-symbol.svg';
import soundcloudSymbol from '../../assets/soundcloud-symbol.webp';
import { useTheme } from '../../../../shared/context/ThemeContext';
import { useAudioControls, useAudioState } from '../../../../shared/context/AudioContext';
import {
  offlineCacheService,
  subscribeOfflineCacheChanges,
} from '../../../../shared/services/offlineCacheService';
import { platformBridge } from '../../../../shared/bridge/platformBridge';
import type {
  LanSyncSession,
  ListeningHistoryItem,
  ListeningStats,
  ZapretCheckResult,
} from '../../../../shared/types';
import { createLanPairingPayload } from '../../../../shared/utils/lanSyncPairing';
import { SettingsAbout } from './SettingsAbout';
import { SettingsOverview } from './SettingsOverview';
import { SettingsAppearance } from './SettingsAppearance';
import { SettingsStats } from './SettingsStats';
import { ConfirmDeleteModal } from '../../../../shared/components/modals/ConfirmDeleteModal';
import { SettingsLibraryTaste } from '../../../../shared/components/settings/SettingsLibraryTaste';
import './SettingsModal.css';

interface SettingsModalProps {
  initialTab?: SettingsTab;
  isOpen: boolean;
  onClose: () => void;
}

interface StatusFeedback {
  type: 'success' | 'error';
  title: string;
  details?: string;
}

type SettingsTab =
  | 'general'
  | 'shortcuts'
  | 'appearance'
  | 'audio'
  | 'stats'
  | 'integrations'
  | 'api'
  | 'data'
  | 'about';

const SETTINGS_TABS: { id: SettingsTab; label: string }[] = [
  { id: 'general', label: 'Обзор' },
  { id: 'appearance', label: 'Внешний вид' },
  { id: 'shortcuts', label: 'Горячие клавиши' },
  { id: 'audio', label: 'Воспроизведение' },
  { id: 'stats', label: 'Статистика' },
  { id: 'integrations', label: 'Интеграции' },
  { id: 'api', label: 'API' },
  { id: 'data', label: 'Данные' },
  { id: 'about', label: 'О приложении' },
];

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  initialTab = 'general',
}) => {
  useLocale();
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);
  const lastFm = useLastFmKeySettings(isOpen && activeTab === 'api');
  const overlay = useOverlaySettings(isOpen && activeTab === 'integrations');
  const [showApiHelp, setShowApiHelp] = useState(false);
  const [showYouTubeSessionHelp, setShowYouTubeSessionHelp] = useState(false);
  const { youtubeAccount, youtubeAccountBusy, youtubeAccountFeedback, handleYouTubeAccount } =
    useYouTubeAccountSettings(isOpen);

  const { themeMode, setWallpaperPath } = useTheme();
  const {
    refreshLikedTracks,
    refreshSavedAlbums,
    refreshFollowedArtists,
    setCrossfadeDuration,
    toggleVolumeNormalization,
  } = useAudioControls();
  const { crossfadeDuration, isVolumeNormalizationEnabled } = useAudioState();

  const [isDiscordEnabled, setIsDiscordEnabled] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('soso_discord_rpc');
      return saved !== 'false';
    } catch {
      return true;
    }
  });

  const [isKaraokeChordsEnabled, setIsKaraokeChordsEnabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem('soso_karaoke_chords') === 'true';
    } catch {
      return false;
    }
  });

  const toggleKaraokeChords = () => {
    setIsKaraokeChordsEnabled((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('soso_karaoke_chords', String(next));
        window.dispatchEvent(
          new CustomEvent('soso:settings-changed', {
            detail: { key: 'soso_karaoke_chords', value: next },
          }),
        );
      } catch {}
      return next;
    });
  };

  const [guitarMode, setGuitarMode] = useState<'chords' | 'tabs'>(() => {
    try {
      return (localStorage.getItem('soso_guitar_mode') as 'chords' | 'tabs') || 'chords';
    } catch {
      return 'chords';
    }
  });

  const handleSetGuitarMode = (mode: 'chords' | 'tabs') => {
    setGuitarMode(mode);
    try {
      localStorage.setItem('soso_guitar_mode', mode);
      window.dispatchEvent(
        new CustomEvent('soso:settings-changed', {
          detail: { key: 'soso_guitar_mode', value: mode },
        }),
      );
    } catch {}
  };

  const [isFindClipsEnabled, setIsFindClipsEnabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem('soso_find_clips') !== 'false';
    } catch {
      return true;
    }
  });

  const toggleFindClips = () => {
    setIsFindClipsEnabled((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('soso_find_clips', String(next));
        window.dispatchEvent(
          new CustomEvent('soso:settings-changed', {
            detail: { key: 'soso_find_clips', value: next },
          }),
        );
      } catch {}
      return next;
    });
  };

  const [youtubeApiKey, setYoutubeApiKey] = useState<string>(() => {
    try {
      return localStorage.getItem('soso_youtube_api_key') || '';
    } catch {
      return '';
    }
  });

  const handleYoutubeApiKeyChange = (val: string) => {
    setYoutubeApiKey(val);
    try {
      if (val.trim()) {
        localStorage.setItem('soso_youtube_api_key', val.trim());
      } else {
        localStorage.removeItem('soso_youtube_api_key');
      }
      window.dispatchEvent(
        new CustomEvent('soso:settings-changed', {
          detail: { key: 'soso_youtube_api_key', value: val.trim() },
        }),
      );
    } catch {}
  };

  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [isImporting, setIsImporting] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<StatusFeedback | null>(null);
  const [lanSession, setLanSession] = useState<LanSyncSession>({ active: false, addresses: [] });
  const [lanError, setLanError] = useState('');
  const [qrAddress, setQrAddress] = useState('');
  const [qrImage, setQrImage] = useState('');
  const [qrExpanded, setQrExpanded] = useState(false);
  const showExpandedQr = qrExpanded && isOpen && lanSession.active && Boolean(qrImage);
  useEffect(() => {
    if (!showExpandedQr) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        setQrExpanded(false);
      }
    };
    window.addEventListener('keydown', close, true);
    return () => window.removeEventListener('keydown', close, true);
  }, [showExpandedQr]);
  const selectedQrAddress = lanSession.addresses.includes(qrAddress)
    ? qrAddress
    : lanSession.addresses[0] || '';

  useEffect(() => {
    if (!lanSession.active || !selectedQrAddress || !lanSession.code) {
      setQrImage('');
      return;
    }
    let canceled = false;
    setQrImage('');
    let payload: string;
    try {
      payload = createLanPairingPayload(selectedQrAddress, lanSession.code);
    } catch {
      setLanError(t('Для QR-кода нужен адрес локальной сети. Выберите Wi-Fi адрес в списке.'));
      return;
    }
    void import('qrcode')
      .then(({ default: QRCode }) =>
        QRCode.toDataURL(payload, {
          width: 1000,
          margin: 4,
          errorCorrectionLevel: 'H',
        }),
      )
      .then((image) => {
        if (!canceled) setQrImage(image);
      })
      .catch(() => {
        if (!canceled)
          setLanError(t('Не удалось создать QR-код. Адрес и код можно ввести вручную.'));
      });
    return () => {
      canceled = true;
    };
  }, [lanSession.active, lanSession.code, selectedQrAddress]);

  useEffect(() => {
    if (!isOpen) return;
    void platformBridge.getLanSyncStatus().then(setLanSession);
    const timer = window.setInterval(() => {
      void platformBridge.getLanSyncStatus().then(setLanSession);
    }, 10000);
    return () => window.clearInterval(timer);
  }, [isOpen]);

  useEffect(
    () =>
      platformBridge.onLanSyncImported(() => {
        void Promise.all([refreshLikedTracks(), refreshSavedAlbums(), refreshFollowedArtists()]);
        window.dispatchEvent(new CustomEvent('soso:playlists-updated'));
        setStatusMessage({ type: 'success', title: t('Медиатека получена с телефона.') });
      }),
    [refreshLikedTracks, refreshSavedAlbums, refreshFollowedArtists],
  );

  const handleLanSession = async () => {
    try {
      setLanError('');
      setLanSession(
        lanSession.active
          ? await platformBridge.stopLanSync()
          : await platformBridge.startLanSync(),
      );
    } catch (error) {
      setLanError(
        error instanceof Error ? error.message : t('Не удалось открыть локальный сеанс.'),
      );
    }
  };

  // Auto-dismiss statusMessage after 4 seconds
  useEffect(() => {
    if (!statusMessage) return;
    const timer = setTimeout(() => {
      setStatusMessage(null);
    }, 4000);
    return () => clearTimeout(timer);
  }, [statusMessage]);

  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  // Offline Cache stats state
  const [cacheStats, setCacheStats] = useState<{ count: number; formattedSize: string }>({
    count: 0,
    formattedSize: '0 MB',
  });
  const [isClearingCache, setIsClearingCache] = useState(false);
  const [confirmCacheClear, setConfirmCacheClear] = useState(false);

  const loadCacheStats = React.useCallback(async () => {
    try {
      const stats = await offlineCacheService.getCacheStats();
      setCacheStats({
        count: stats.count,
        formattedSize: stats.formattedSize,
      });
    } catch (e) {
      console.error('Error loading cache stats:', e);
    }
  }, []);
  useEffect(() => {
    if (!isOpen) return;
    return subscribeOfflineCacheChanges(() => {
      void loadCacheStats();
    });
  }, [isOpen, loadCacheStats]);

  const [listeningStats, setListeningStats] = useState<ListeningStats | null>(null);
  const [lastListenedTrack, setLastListenedTrack] = useState<ListeningHistoryItem | null>(null);
  const [isLoadingStats, setIsLoadingStats] = useState(false);

  const loadListeningStats = React.useCallback(async (silent = false) => {
    try {
      if (!silent) setIsLoadingStats(true);
      const s = await platformBridge.getStats();
      setListeningStats(s || null);
    } catch (e) {
      console.error('Error loading listening stats:', e);
    } finally {
      if (!silent) setIsLoadingStats(false);
    }
  }, []);

  const loadLastListenedTrack = React.useCallback(async () => {
    try {
      const history = await platformBridge.getListeningHistory(1);
      setLastListenedTrack(history[0] || null);
    } catch (error) {
      console.error('Error loading last listened track:', error);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      loadCacheStats();
      loadLastListenedTrack();
    }
  }, [isOpen, loadCacheStats, loadLastListenedTrack]);

  useEffect(() => {
    if (!isOpen || (activeTab !== 'stats' && activeTab !== 'general')) return;
    void loadListeningStats();
    const refresh = () => {
      void loadListeningStats(true);
      if (activeTab === 'general') void loadLastListenedTrack();
    };
    window.addEventListener('soso:stats-updated', refresh);
    return () => window.removeEventListener('soso:stats-updated', refresh);
  }, [isOpen, activeTab, loadListeningStats, loadLastListenedTrack]);

  const handleToggleDiscord = () => {
    setIsDiscordEnabled((prev) => {
      const next = !prev;
      localStorage.setItem('soso_discord_rpc', String(next));
      platformBridge.toggleDiscordRpc(next);
      return next;
    });
  };

  // Zapret DPI Integration State & Handlers
  const [zapretStatus, setZapretStatus] = useState<ZapretCheckResult | null>(null);
  const [isZapretScanning, setIsZapretScanning] = useState(false);
  const [isZapretApplying, setIsZapretApplying] = useState(false);
  const [zapretFeedback, setZapretFeedback] = useState<string | null>(null);
  const [zapretFeedbackType, setZapretFeedbackType] = useState<'success' | 'error' | null>(null);
  const handleScanZapret = async () => {
    if (!window.electronAPI?.findZapretConfig) return;
    setIsZapretScanning(true);
    setZapretFeedback(null);
    setZapretFeedbackType(null);
    try {
      const res = await window.electronAPI.findZapretConfig();
      setZapretStatus(res);
    } catch (e: any) {
      setZapretFeedback(t('Ошибка поиска: {0}', e?.message || 'Не удалось выполнить поиск'));
      setZapretFeedbackType('error');
    } finally {
      setIsZapretScanning(false);
    }
  };

  const handleApplyZapret = async () => {
    if (!window.electronAPI?.applyZapretDomains) return;
    setIsZapretApplying(true);
    setZapretFeedback(null);
    setZapretFeedbackType(null);
    try {
      const res = await window.electronAPI.applyZapretDomains();
      setZapretFeedback(res.message);
      setZapretFeedbackType(res.success ? 'success' : 'error');
      if (res.success && zapretStatus) {
        setZapretStatus({
          ...zapretStatus,
          hasSoundcloud: true,
          hasSndcdn: true,
          hasSoundcloudCloud: true,
        });
      }
    } catch (e: any) {
      setZapretFeedback(t('Ошибка записи: {0}', e?.message || 'Сбой доступа'));
      setZapretFeedbackType('error');
    } finally {
      setIsZapretApplying(false);
    }
  };

  const handleSelectZapretFile = async () => {
    if (!window.electronAPI?.selectZapretFile) return;
    try {
      const res = await window.electronAPI.selectZapretFile();
      if (!res.canceled && res.checkResult) {
        setZapretStatus(res.checkResult);
        setZapretFeedback(t('Выбран файл: {0}', res.filePath));
        setZapretFeedbackType(null);
      }
    } catch (e: any) {
      setZapretFeedback(t('Ошибка: {0}', e?.message));
      setZapretFeedbackType('error');
    }
  };

  const handleRestartTour = () => {
    try {
      localStorage.removeItem('soso_onboarding_completed');
    } catch {}
    onClose();
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('soso:restart-tour'));
    }, 200);
  };

  useEffect(() => {
    if (isOpen && activeTab === 'integrations' && !zapretStatus && !isZapretScanning) {
      handleScanZapret();
    }
  }, [isOpen, activeTab]);

  const handleSelectWallpaper = async () => {
    if (!window.electronAPI?.selectWallpaperVideo) return;
    try {
      const selected = await window.electronAPI.selectWallpaperVideo();
      if (selected && selected.success && selected.filePath) {
        setWallpaperPath(selected.filePath);
      }
    } catch (e) {
      console.error('Failed to select wallpaper:', e);
    }
  };

  // 1. Export JSON
  const handleExportBackup = async () => {
    setIsExporting(true);
    setStatusMessage(null);
    try {
      const res = await platformBridge.exportDatabase();
      if (res.success) {
        setStatusMessage({
          type: 'success',
          title: t('Резервная копия сохранена'),
          details: res.filePath
            ? t('Файл: {0}', res.filePath)
            : t('База данных успешно выгружена.'),
        });
      } else if (!res.canceled) {
        setStatusMessage({
          type: 'error',
          title: t('Ошибка экспорта'),
          details: res.error || res.message || t('Не удалось сохранить резервную копию.'),
        });
      }
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        title: t('Ошибка экспорта'),
        details: err.message || String(err),
      });
    } finally {
      setIsExporting(false);
    }
  };

  // 2. Import Process Logic
  const processImportData = async (jsonString: string) => {
    setIsImporting(true);
    setStatusMessage(null);
    try {
      const res = await platformBridge.importDatabase(jsonString);
      if (res.success) {
        await Promise.all([
          refreshLikedTracks(),
          refreshSavedAlbums(),
          refreshFollowedArtists(),
          loadListeningStats(),
        ]);

        const stats = res.stats;
        const details = stats
          ? t(
              'Добавлено любимых треков: {0}, альбомов: {1}, плейлистов: {2}',
              stats.tracks,
              stats.albums,
              stats.playlists,
            )
          : t('Медиатека успешно восстановлена.');

        setStatusMessage({
          type: 'success',
          title: t('Медиатека успешно восстановлена!'),
          details,
        });
      } else if (!res.canceled) {
        setStatusMessage({
          type: 'error',
          title: t('Ошибка импорта базы данных'),
          details: res.error || res.message || t('Не удалось применить резервную копию.'),
        });
      }
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        title: t('Сбой импорта'),
        details: err.message || String(err),
      });
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // 3. Import File Handler
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content) {
        processImportData(content);
      }
    };
    reader.onerror = () => {
      setStatusMessage({
        type: 'error',
        title: t('Ошибка чтения файла'),
        details: t('Не удалось прочитать выбранный файл.'),
      });
    };
    reader.readAsText(file);
  };

  const handleClearCache = async () => {
    setIsClearingCache(true);
    try {
      if (!(await offlineCacheService.clearCache()))
        throw new Error(t('Не удалось удалить скачанные треки. Попробуйте ещё раз.'));
      await loadCacheStats();
      setStatusMessage({
        type: 'success',
        title: t('Офлайн кэш очищен'),
        details: t('Скачанные треки удалены с диска.'),
      });
    } catch (error) {
      setStatusMessage({
        type: 'error',
        title: t('Ошибка очистки кэша'),
        details: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsClearingCache(false);
    }
  };

  const handleOpenLogs = async () => {
    try {
      const result = await platformBridge.openLogFile();
      if (!result.success)
        setStatusMessage({
          type: 'error',
          title: t('Не удалось открыть логи'),
          details: result.error || t('Файл логов недоступен.'),
        });
    } catch (error) {
      setStatusMessage({
        type: 'error',
        title: t('Не удалось открыть логи'),
        details: error instanceof Error ? error.message : String(error),
      });
    }
  };

  if (!isOpen) return null;

  return (
    <div className="settings-backdrop fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in select-none">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="desktop-settings-title"
        className="settings-modal relative overflow-hidden flex flex-col"
      >
        <div className="settings-modal-header flex items-center justify-between shrink-0">
          <h2 id="desktop-settings-title">{t('Настройки')}</h2>
          <button onClick={onClose} aria-label={t('Закрыть настройки')} className="settings-close">
            <X className="w-6 h-6" />
          </button>
        </div>
        <div role="tablist" aria-label={t('Категории настроек')} className="settings-tabs">
          {SETTINGS_TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                role="tab"
                aria-selected={isActive}
                onClick={() => setActiveTab(tab.id)}
                className={isActive ? 'active' : ''}
              >
                {t(tab.label)}
              </button>
            );
          })}
        </div>

        <div
          key={activeTab}
          role="tabpanel"
          className="settings-modal-content overflow-y-auto flex-1 min-h-0"
        >
          {activeTab === 'general' && (
            <>
              <SettingsOverview
                stats={listeningStats}
                themeLabel={themeMode === 'dark' ? t('Тёмная') : t('Светлая')}
                cacheLabel={cacheStats.formattedSize}
                crossfadeLabel={
                  crossfadeDuration === 0 ? t('Выключен') : crossfadeDuration + t(' сек')
                }
                integrationsLabel={isDiscordEnabled ? t('Включён') : t('Выключен')}
              />
            </>
          )}
          {activeTab === 'shortcuts' && <SettingsShortcuts />}
          {activeTab === 'about' && <SettingsAbout />}
          {activeTab === 'appearance' && (
            <SettingsAppearance
              onSelectWallpaper={handleSelectWallpaper}
              onRestartTour={handleRestartTour}
            />
          )}
          {/* ===================== TAB 2: AUDIO & PLAYBACK ===================== */}
          {activeTab === 'audio' && (
            <div className="settings-detail animate-fade-in">
              <section className="settings-detail-section">
                <h3>{t('Звук')}</h3>
                <div className="settings-row">
                  <div className="settings-row-copy">
                    <strong>{t('Одинаковая громкость')}</strong>
                    <span>
                      {t('Новые записи без данных выравниваются со следующего прослушивания')}
                    </span>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={isVolumeNormalizationEnabled}
                    aria-label={t('Одинаковая громкость')}
                    className={'settings-switch ' + (isVolumeNormalizationEnabled ? 'enabled' : '')}
                    onClick={toggleVolumeNormalization}
                  >
                    <span />
                  </button>
                </div>
                <div className="settings-row">
                  <div className="settings-row-copy">
                    <strong>{t('Плавный переход')}</strong>
                  </div>
                  <div className="settings-row-control settings-range-control">
                    <input
                      type="range"
                      min="0"
                      max="12"
                      step="1"
                      value={crossfadeDuration}
                      onChange={(event) => setCrossfadeDuration(Number(event.target.value))}
                      aria-label={t('Длительность плавного перехода')}
                    />
                    <span>
                      {crossfadeDuration === 0 ? t('Выкл') : t('{0} сек', crossfadeDuration)}
                    </span>
                  </div>
                </div>
              </section>

              <SettingsEqualizer />

              <section className="settings-detail-section">
                <h3>{t('Караоке')}</h3>
                <div className="settings-row">
                  <div className="settings-row-copy">
                    <strong>{t('Аккорды в караоке')}</strong>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={isKaraokeChordsEnabled}
                    aria-label={t('Аккорды в караоке')}
                    className={`settings-switch ${isKaraokeChordsEnabled ? 'enabled' : ''}`}
                    onClick={toggleKaraokeChords}
                  >
                    <span />
                  </button>
                </div>
                <div className="settings-row">
                  <div className="settings-row-copy">
                    <strong>{t('Режим для гитары')}</strong>
                  </div>
                  <div
                    className="settings-segmented"
                    role="group"
                    aria-label={t('Режим для гитары')}
                  >
                    <button
                      type="button"
                      className={guitarMode === 'chords' ? 'selected' : ''}
                      onClick={() => handleSetGuitarMode('chords')}
                    >
                      {t('Аккорды')}
                    </button>
                    <button
                      type="button"
                      className={guitarMode === 'tabs' ? 'selected' : ''}
                      onClick={() => handleSetGuitarMode('tabs')}
                    >
                      {t('Табы')}
                    </button>
                  </div>
                </div>
                <div className="settings-row">
                  <div className="settings-row-copy">
                    <strong>{t('Искать клип')}</strong>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={isFindClipsEnabled}
                    aria-label={t('Искать клип')}
                    className={`settings-switch ${isFindClipsEnabled ? 'enabled' : ''}`}
                    onClick={toggleFindClips}
                  >
                    <span />
                  </button>
                </div>
              </section>
            </div>
          )}
          {/* ===================== TAB 3: STATS ===================== */}
          {activeTab === 'stats' && (
            <>
              <SettingsStats
                stats={listeningStats}
                isLoading={isLoadingStats}
                lastTrack={lastListenedTrack}
              />
              <SettingsLibraryTaste active={isOpen} />
            </>
          )}
          {activeTab === 'api' && (
            <div className="settings-page">
              <section className="settings-section youtube-api-settings">
                <h4>YouTube</h4>
                <div className="settings-row settings-api-row">
                  <div className="settings-row-copy">
                    <strong className="inline-flex items-center gap-2">
                      YouTube Data API v3
                      <button
                        type="button"
                        aria-label={t('Что такое ключ YouTube API')}
                        aria-expanded={showApiHelp}
                        aria-controls="youtube-api-help"
                        onClick={() => setShowApiHelp((value) => !value)}
                        className="text-zinc-400 hover:text-soso-brand"
                      >
                        <CircleHelp size={17} />
                      </button>
                    </strong>
                  </div>
                  <input
                    type="password"
                    value={youtubeApiKey}
                    onChange={(event) => handleYoutubeApiKeyChange(event.target.value)}
                    placeholder={t('Ключ API')}
                    aria-label={t('Ключ YouTube Data API')}
                  />
                </div>
                {showApiHelp && (
                  <p id="youtube-api-help" className="settings-row-note" role="note">
                    {t(
                      'Необязательный ключ Google для поиска официальных видеоклипов в караоке. Для поиска музыки и прослушивания он не нужен. Создайте проект в Google Cloud, включите YouTube Data API v3 и получите API key в разделе Credentials. Google ограничивает число запросов дневной квотой. Ключ хранится локально в приложении; не публикуйте его.',
                    )}
                  </p>
                )}
              </section>
              <section className="settings-section lastfm-key-settings" aria-label="Last.fm">
                <h4>Last.fm</h4>
                <div className="settings-row settings-api-row">
                  <div className="settings-row-copy">
                    <strong>{t('Ключ API Last.fm')}</strong>
                    <span>
                      {lastFm.configured === null
                        ? t('Проверяем…')
                        : lastFm.configured
                          ? t('Ключ сохранён')
                          : t('Ключ не добавлен')}
                    </span>
                  </div>
                  <input
                    type="password"
                    autoComplete="off"
                    value={lastFm.key}
                    onChange={(event) => lastFm.setKey(event.target.value)}
                    maxLength={32}
                    placeholder={t('Вставьте API key')}
                    aria-label={t('Ключ API Last.fm')}
                    disabled={lastFm.busy}
                  />
                </div>
                <p className="settings-row-note">
                  {t(
                    'Ключ нужен для жанрового анализа и рекомендаций Last.fm. Сохраняется только на этом компьютере и не входит в экспорт медиатеки. Укажите API key, а не Shared secret.',
                  )}
                </p>
                <div className="settings-inline-actions">
                  <a
                    className="settings-action"
                    href="https://www.last.fm/api/account/create"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {t('Получить ключ Last.fm')}
                  </a>
                  <button
                    type="button"
                    className="settings-action settings-action-primary"
                    disabled={!lastFm.valid || lastFm.busy}
                    onClick={() => void lastFm.save()}
                  >
                    {lastFm.busy ? t('Сохраняем…') : t('Сохранить ключ')}
                  </button>
                  {lastFm.configured && (
                    <button
                      type="button"
                      className="settings-text-action"
                      disabled={lastFm.busy}
                      onClick={() => void lastFm.save('')}
                    >
                      {t('Удалить ключ')}
                    </button>
                  )}
                </div>
                {lastFm.feedback && (
                  <p role="status" className="settings-feedback">
                    {lastFm.feedback}
                  </p>
                )}
              </section>
            </div>
          )}
          {activeTab === 'integrations' && (
            <div className="settings-page">
              <section className="settings-section overlay-integration-settings">
                <h4>{t('Оверлей плеера')}</h4>
                <div className="settings-row">
                  <div className="settings-row-copy">
                    <strong>{t('Включить оверлей')}</strong>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-label={t('Включить оверлей')}
                    aria-checked={overlay.enabled === true}
                    className={'settings-switch' + (overlay.enabled ? ' enabled' : '')}
                    disabled={
                      overlay.enabled === null ||
                      overlay.busy ||
                      !window.electronAPI?.setPlayerOverlayEnabled
                    }
                    onClick={() => void overlay.save(!overlay.enabled)}
                  >
                    <span />
                  </button>
                </div>
                <p className="settings-row-note">
                  {t('В играх используйте оконный режим или окно без рамок.')}
                </p>
                <div className="settings-row overlay-position-row">
                  <div className="settings-row-copy">
                    <strong>{t('Положение на экране')}</strong>
                  </div>
                  <button
                    type="button"
                    className="settings-action"
                    disabled={
                      overlay.enabled !== true ||
                      overlay.busy ||
                      !window.electronAPI?.editPlayerOverlay
                    }
                    onClick={() => void overlay.edit()}
                  >
                    <Move size={15} />
                    {t('Настроить положение')}
                  </button>
                </div>
                {overlay.error && (
                  <p role="alert" className="settings-feedback error">
                    {overlay.error}
                  </p>
                )}
              </section>

              <section className="settings-section">
                <h4>YouTube Music</h4>
                <div className="settings-row">
                  <div className="settings-row-copy">
                    <strong>{t('Аккаунт YouTube')}</strong>
                    <span>
                      {youtubeAccount.connected
                        ? t('Сессия подключена')
                        : youtubeAccount.loginOpen
                          ? t('Завершите вход в окне YouTube')
                          : t('Вход помогает, когда YouTube требует проверку на бота')}
                    </span>
                  </div>
                  <div className="settings-inline-actions">
                    {youtubeAccount.connected && (
                      <button
                        type="button"
                        className="settings-action"
                        disabled={youtubeAccountBusy || !window.electronAPI?.refreshYouTubeSession}
                        onClick={() => void handleYouTubeAccount('refresh')}
                      >
                        {youtubeAccountBusy ? t('Подождите…') : t('Обновить сессию')}
                      </button>
                    )}
                    <button
                      type="button"
                      className="settings-action"
                      disabled={youtubeAccountBusy}
                      onClick={() => void handleYouTubeAccount('connect')}
                    >
                      {youtubeAccount.loginOpen
                        ? t('Открыть окно')
                        : youtubeAccount.connected
                          ? t('Открыть YouTube')
                          : t('Войти')}
                    </button>
                    {youtubeAccount.connected && (
                      <button
                        type="button"
                        className="settings-action"
                        disabled={youtubeAccountBusy}
                        onClick={() => void handleYouTubeAccount('disconnect')}
                      >
                        {t('Отключить')}
                      </button>
                    )}
                  </div>
                </div>
                <div className="settings-row">
                  <div className="settings-row-copy">
                    <strong>
                      {t('Сессия из браузера')}{' '}
                      <button
                        type="button"
                        aria-label={t('Как подключить сессию YouTube')}
                        aria-expanded={showYouTubeSessionHelp}
                        aria-controls="youtube-session-help"
                        className="text-zinc-400 hover:text-soso-brand"
                        onClick={() => setShowYouTubeSessionHelp((value) => !value)}
                      >
                        <CircleHelp size={17} />
                      </button>
                    </strong>
                    <span>{t('Если Google не разрешает войти в окне приложения')}</span>
                  </div>
                  <button
                    type="button"
                    className="settings-action"
                    disabled={youtubeAccountBusy}
                    onClick={() => void handleYouTubeAccount('import')}
                  >
                    {youtubeAccountBusy ? t('Подождите…') : t('Импорт сессии')}
                  </button>
                </div>
                {showYouTubeSessionHelp && (
                  <div id="youtube-session-help" className="settings-info-block" role="note">
                    <p>
                      {t(
                        'Войдите в YouTube в приватном окне браузера и экспортируйте cookies только для youtube.com в файл Netscape (.txt) или JSON. Закройте приватное окно и выберите файл через «Импорт сессии».',
                      )}
                    </p>
                    <p>
                      {t(
                        'Файл даёт доступ к вашей сессии: храните его у себя и никому не отправляйте. Приложение сохраняет подключение локально, отдельно от медиатеки. Если сессия истечёт, её потребуется подключить заново.',
                      )}
                    </p>
                  </div>
                )}
                {(youtubeAccountFeedback || youtubeAccount.error) && (
                  <p
                    className={
                      'settings-feedback' +
                      (youtubeAccount.error ||
                      !youtubeAccountFeedback.startsWith(t('Кэш сессии обновлён'))
                        ? ' error'
                        : '')
                    }
                    role={youtubeAccount.error ? 'alert' : 'status'}
                  >
                    {youtubeAccount.error || youtubeAccountFeedback}
                  </p>
                )}
              </section>
              <section className="settings-section">
                <h4>{t('Подключения')}</h4>
                <div className="settings-row">
                  <div className="settings-row-copy settings-integration-label">
                    <span className="settings-integration-badge discord" aria-hidden="true">
                      <img src={discordSymbol} alt="" />
                    </span>
                    <strong>Discord Rich Presence</strong>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={isDiscordEnabled}
                    aria-label="Discord Rich Presence"
                    className={'settings-switch' + (isDiscordEnabled ? ' enabled' : '')}
                    onClick={handleToggleDiscord}
                  >
                    <span />
                  </button>
                </div>
              </section>
              <section className="settings-section">
                <h4 className="settings-integration-heading">
                  <span className="settings-integration-badge soundcloud" aria-hidden="true">
                    <img src={soundcloudSymbol} alt="" />
                  </span>
                  {t('Доступ к SoundCloud')}
                </h4>
                <div className="settings-row">
                  <div className="settings-row-copy">
                    <strong>{t('Список Zapret')}</strong>
                  </div>
                  <button
                    type="button"
                    className="settings-action"
                    onClick={handleScanZapret}
                    disabled={isZapretScanning}
                  >
                    {isZapretScanning ? t('Проверяем…') : t('Проверить')}
                  </button>
                </div>
                <div className="settings-info-block">
                  {zapretStatus?.found && (
                    <p>
                      {t('Найден файл: ')}
                      <code>{zapretStatus.path}</code>
                    </p>
                  )}
                  {isZapretScanning ? (
                    <p className="settings-zapret-status checking" role="status">
                      {t('Проверяем домены…')}
                    </p>
                  ) : zapretStatus ? (
                    <p
                      className={`settings-zapret-status ${zapretStatus.found && zapretStatus.hasSoundcloud && zapretStatus.hasSndcdn && zapretStatus.hasSoundcloudCloud ? 'success' : 'error'}`}
                      role="status"
                    >
                      {zapretStatus.found
                        ? zapretStatus.hasSoundcloud &&
                          zapretStatus.hasSndcdn &&
                          zapretStatus.hasSoundcloudCloud
                          ? t('SoundCloud: домены добавлены')
                          : t(
                              'Не добавлены: {0}',
                              [
                                !zapretStatus.hasSoundcloud && 'soundcloud.com',
                                !zapretStatus.hasSndcdn && 'sndcdn.com',
                                !zapretStatus.hasSoundcloudCloud && 'soundcloud.cloud',
                              ]
                                .filter(Boolean)
                                .join(', '),
                            )
                        : zapretStatus.error || t('Список Zapret не найден')}
                    </p>
                  ) : (
                    <p className="settings-zapret-status checking">{t('Проверка не выполнена')}</p>
                  )}
                  {!(
                    zapretStatus?.hasSoundcloud &&
                    zapretStatus?.hasSndcdn &&
                    zapretStatus?.hasSoundcloudCloud
                  ) && (
                    <div className="settings-inline-actions">
                      {zapretStatus?.found && (
                        <button
                          type="button"
                          className="settings-action settings-action-primary"
                          onClick={handleApplyZapret}
                          disabled={isZapretApplying}
                        >
                          {isZapretApplying ? t('Добавляем…') : t('Добавить домены')}
                        </button>
                      )}
                      <button
                        type="button"
                        className="settings-action"
                        onClick={handleSelectZapretFile}
                      >
                        {t('Выбрать файл')}
                      </button>
                    </div>
                  )}
                  {zapretFeedback && (
                    <p className={`settings-feedback ${zapretFeedbackType || ''}`}>
                      {zapretFeedback}
                    </p>
                  )}
                </div>
              </section>
            </div>
          )}
          {activeTab === 'data' && (
            <div className="settings-page">
              <section className="settings-section">
                <h4>{t('Синхронизация')}</h4>
                <div className="settings-row">
                  <div className="settings-row-copy">
                    <strong>{t('Телефон по Wi-Fi')}</strong>
                  </div>
                  <button
                    type="button"
                    className="settings-action"
                    onClick={() => void handleLanSession()}
                  >
                    {lanSession.active ? t('Закрыть сеанс') : t('Открыть сеанс')}
                  </button>
                </div>
                {lanSession.active && (
                  <div className="settings-info-block">
                    {lanSession.addresses.length > 1 && (
                      <select
                        value={selectedQrAddress}
                        onChange={(event) => setQrAddress(event.target.value)}
                        aria-label={t('Адрес сети для QR-кода')}
                        className="settings-action"
                      >
                        {lanSession.addresses.map((address) => (
                          <option key={address} value={address}>
                            {address}
                          </option>
                        ))}
                      </select>
                    )}
                    {qrImage && (
                      <button
                        type="button"
                        className="settings-qr"
                        onClick={() => setQrExpanded(true)}
                        aria-label={t('Увеличить QR-код')}
                        title={t('Увеличить QR-код')}
                      >
                        <img src={qrImage} alt={t('QR-код сопряжения с телефоном')} />
                      </button>
                    )}
                    {lanSession.addresses.length ? (
                      lanSession.addresses.map((address) => (
                        <p key={address}>
                          {t('Адрес: ')}
                          <code>{address}</code>
                        </p>
                      ))
                    ) : (
                      <p>{t('Адрес локальной сети не найден.')}</p>
                    )}
                    <p>
                      {t('Код: ')}
                      <code>{lanSession.code}</code>
                    </p>
                  </div>
                )}
                {lanError && (
                  <p role="alert" className="settings-feedback error">
                    {lanError}
                  </p>
                )}
              </section>
              <section className="settings-section">
                <h4>{t('Резервная копия')}</h4>
                <div className="settings-row">
                  <div className="settings-row-copy">
                    <strong>{t('Медиатека')}</strong>
                  </div>
                  <div className="settings-inline-actions">
                    <button
                      type="button"
                      className="settings-action"
                      onClick={handleExportBackup}
                      disabled={isExporting || isImporting}
                    >
                      {isExporting ? t('Сохраняем…') : t('Экспорт JSON')}
                    </button>
                    <label className="settings-action settings-file-action">
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".json,application/json"
                        onChange={handleFileChange}
                        disabled={isExporting || isImporting}
                        aria-label={t('Загрузить файл базы')}
                      />
                      {isImporting ? t('Загружаем…') : t('Импорт JSON')}
                    </label>
                  </div>
                </div>
              </section>
              <section className="settings-section">
                <h4>{t('Хранилище')}</h4>
                <div className="settings-row">
                  <div className="settings-row-copy">
                    <strong>{t('Офлайн треки')}</strong>
                    <span>
                      {cacheStats.count} {t(' сохранено · ')}
                      {cacheStats.formattedSize} {t(' занято')}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="settings-action"
                    disabled={cacheStats.count === 0 || isClearingCache}
                    onClick={() => setConfirmCacheClear(true)}
                  >
                    {isClearingCache ? t('Очищаем…') : t('Очистить кэш')}
                  </button>
                </div>
                <div className="settings-row">
                  <div className="settings-row-copy">
                    <strong>{t('Журнал приложения')}</strong>
                  </div>
                  <button type="button" className="settings-action" onClick={handleOpenLogs}>
                    {t('Открыть логи')}
                  </button>
                </div>
              </section>
              {statusMessage && (
                <div role="status" className={'settings-feedback ' + statusMessage.type}>
                  <strong>{statusMessage.title}</strong>
                  {statusMessage.details && <p>{statusMessage.details}</p>}
                </div>
              )}
            </div>
          )}{' '}
        </div>
      </div>
      <ConfirmDeleteModal
        isOpen={confirmCacheClear}
        title={t('Удалить скачанные треки?')}
        confirmText={t('Очистить кэш')}
        description={t(
          'Будут удалены все скачанные треки: {0} · {1}. Для прослушивания офлайн их потребуется скачать заново. Любимые треки и плейлисты останутся в медиатеке.',
          cacheStats.count,
          cacheStats.formattedSize,
        )}
        onConfirm={handleClearCache}
        onClose={() => setConfirmCacheClear(false)}
      />
      {showExpandedQr &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t('QR-код для подключения телефона')}
            className="fixed inset-0 z-[200] bg-zinc-950 flex flex-col items-center justify-center gap-5 p-6 text-white"
            onClick={() => setQrExpanded(false)}
          >
            <button
              type="button"
              autoFocus
              aria-label={t('Закрыть QR-код')}
              onClick={() => setQrExpanded(false)}
              className="absolute top-5 right-5 w-11 h-11 rounded-full bg-white/10 flex items-center justify-center"
            >
              <X />
            </button>
            <h2 className="text-xl font-bold">{t('Подключение телефона')}</h2>
            <img
              src={qrImage}
              alt={t('QR-код сопряжения с телефоном')}
              className="rounded-xl object-contain bg-white"
              style={{ width: 'min(72vw, 65vh, 720px)', height: 'min(72vw, 65vh, 720px)' }}
            />
            <p className="text-sm text-zinc-300">
              {t('Откройте сканер QR-кода в приложении на телефоне')}
            </p>
            <p className="text-sm">
              {t('Код: ')}
              <strong className="font-mono">{lanSession.code}</strong>
            </p>
          </div>,
          document.body,
        )}
    </div>
  );
};
