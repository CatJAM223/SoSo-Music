import { isSoundCloudUrl } from '../../shared/utils/soundcloudUrl';
import { startAppUpdateMonitor } from './services/appUpdateMonitor';
import { DesktopControls } from './services/desktopControls';
import { createPlayerOverlayWindow } from './services/playerOverlayWindow';
import { registerDesktopControlsHandlers } from './ipc/desktopControlsHandlers';
import { LastFmService } from './services/lastfm';
import { LastFmKeyStore } from './services/lastfmKeyStore';
import { t, setLocale as setUiLocale } from '../../shared/i18n/locale';
import { registerHistoryHandlers } from './ipc/historyHandlers';
import { registerPlaylistHandlers } from './ipc/playlistHandlers';
import { registerLibraryHandlers } from './ipc/libraryHandlers';
import { registerLyricsHandlers } from './ipc/lyricsHandlers';
import { initializeRustCompute } from '../../shared/compute/waveSongMatrix';
import { registerWaveHandlers } from './ipc/waveHandlers';
import { electronFetch } from './services/electronFetch.ts';
import {
  app,
  globalShortcut,
  BrowserWindow,
  ipcMain,
  shell,
  Tray,
  Menu,
  nativeImage,
  session,
  dialog,
  protocol,
  crashReporter,
} from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { MediaFileAccess, MEDIA_SCHEME, createMediaHandler } from './services/mediaFileAccess';
import { DatabaseManager } from './db';
import { WaveEngine } from './services/waveEngine';
import { LibraryTasteService } from './services/libraryTaste';
import { registerLibraryTasteHandlers } from './ipc/libraryTasteHandlers';
import { registerTastePolicyHandlers } from './ipc/tastePolicyHandlers';
import { selectDailyRecommendations } from '../../shared/utils/dailyRecommendations';
import { createDailyDislikePolicy } from '../../shared/utils/dailyDislikes';
import { MusicAggregatorService } from './services/musicAggregator';
import { StreamRequestRegistry } from './services/streamRequestRegistry.ts';
import { sharedStreamResolver } from './services/sharedStreamResolver.ts';
const streamRequestRegistry = new StreamRequestRegistry();
import { LocalListenServer } from './services/localListenServer';
import { configureListenProtocol } from './services/listenProtocol';
import { clearYouTubeSessionCache } from './services/youtubeSessionCache';
import { createAppUpdateChecker } from './services/appUpdates';
import { assertMainWindowSender, registerMainWindowHandlers } from './ipc/mainWindowHandlers';
import { registerYouTubeAccountHandlers } from './ipc/youtubeAccountHandlers';
import { YouTubeAccountService } from './services/youtubeAccount';
import { DiscordRPCService } from './services/discordRpc';
import { YouTubeMusicService } from './services/youtubeMusic';
import { PlaybackLogger } from './services/playbackLogger';
import { startRuntimeDiagnostics, recoverMainRenderer } from './services/runtimeDiagnostics';
import { playbackRouteLog } from './services/playbackRoute';
import { ZapretService } from './services/zapretService';
import { LanImportApproval } from './services/lanImportApproval';
import { LanSyncServer } from './services/lanSyncServer';
import {
  desktopFetch,
  setDesktopFetch,
  setDesktopNetworkRecovery,
  setYouTubeSessionReset,
} from './services/desktopFetch';
import { downloadAudioBytes } from './services/audioDownload';
import { youtubeAccountMediaUserAgent } from './services/youtubeWatchPage';
import { describeYouTubeMediaRequest } from './services/youtubeNetworkDiagnostics';
import {
  loadExternalPlaylist,
  loadVkPlaylistInWindow,
  cancelVkPlaylistRead,
} from './services/playlistImport';
import type { Track } from '../../shared/types';
import { normalizeWaveSeed } from '../../shared/utils/waveRecommendations';

// Enforce single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  process.exit(0);
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
    }
  });
}

// Explicitly set process title and Windows AppUserModelId for clean Task Manager naming
app.setName('SoSo Music');
if (process.platform === 'win32') {
  app.setAppUserModelId('com.sosomusic.app');
}
process.title = 'SoSo Music';
startRuntimeDiagnostics(app, crashReporter);

// Disable autoplay gesture requirement so audio can play immediately on click
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-media-suspend');
app.commandLine.appendSwitch(
  'disable-features',
  'CalculateNativeWinOcclusion,IntensiveWakeUpThrottling,ThrottleDisplayNoneAndVisibilityHiddenCrossOriginIframes',
);
app.commandLine.appendSwitch('disable-quic');
app.commandLine.appendSwitch('disable-http2-grease');

// Ad-blocking DNS over HTTPS (AdGuard DNS) with fallback to eliminate banner ads safely
app.commandLine.appendSwitch('enable-features', 'DnsOverHttps');
app.commandLine.appendSwitch('dns-over-https-mode', 'automatic');
app.commandLine.appendSwitch('dns-over-https-templates', 'https://dns.adguard-dns.com/dns-query');

let mainWindow: BrowserWindow | null = null;
let widgetWindow: BrowserWindow | null = null;
let playerOverlay: ReturnType<typeof createPlayerOverlayWindow> | null = null;
let desktopControls: DesktopControls | null = null;
let overlayPlaybackState: unknown = null;
let stopAppUpdateMonitor: (() => void) | null = null;
let availableAppUpdate: import('../../shared/types').AppUpdateStatus | null = null;
const localListenServer = new LocalListenServer();
let listenRendererReady = false;
let pendingListenTrack: Track | null = null;
function deliverSharedTrack(track: Track): void {
  pendingListenTrack = track;
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  if (listenRendererReady) {
    mainWindow.webContents.send('listen:track', track);
    pendingListenTrack = null;
  }
}
DiscordRPCService.setDirectListenEnabled(configureListenProtocol(app, deliverSharedTrack));
let tray: Tray | null = null;
let isQuitting = false;

const dbManager = new DatabaseManager();
const lastFmKeyStore = new LastFmKeyStore(app.getPath('userData'));
try {
  LastFmService.configureApiKey(lastFmKeyStore.read());
} catch {
  PlaybackLogger.warn('[Last.fm] Could not read local API key configuration');
}
const libraryTaste = new LibraryTasteService(
  () => dbManager.getDb(),
  () => dbManager.save(),
  undefined,
  undefined,
  () => LastFmService.hasApiKey(),
  () => dbManager.getChangeRevision(),
);
WaveEngine.setTasteProvider(libraryTaste);
let databaseReady = false;
dbManager.setPersistenceStatusHandler((status) => {
  if (mainWindow && !mainWindow.isDestroyed())
    mainWindow.webContents.send('library:persistenceStatus', status);
});
const mediaFileAccess = new MediaFileAccess(app.getPath('userData'));
const lanImportApproval = new LanImportApproval(() => mainWindow);
const lanSyncServer = new LanSyncServer(
  dbManager,
  () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('sync:imported');
  },
  (summary, signal) => lanImportApproval.request(summary, signal),
);

// Broadcast animation pause state to renderer (theme canvases & wallpaper video)
let animationsPaused = false;
function setAnimationsPaused(paused: boolean) {
  if (animationsPaused === paused) return;
  animationsPaused = paused;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('ui:animationsPaused', paused);
  }
}

function getAppIconPath(): string {
  const candidates = [
    path.join(__dirname, '../public/icon.png'),
    path.join(__dirname, '../icon/icon.png'),
    path.join(app.getAppPath(), 'icon/icon.png'),
    path.join(app.getAppPath(), 'public/icon.png'),
    path.join(process.cwd(), 'icon/icon.png'),
    path.join(process.cwd(), 'public/icon.png'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  return '';
}

// Create 16x16 tray icon using real icon
function createTrayIcon(): Electron.NativeImage {
  const iconPath = getAppIconPath();
  if (iconPath) {
    const img = nativeImage.createFromPath(iconPath);
    if (!img.isEmpty()) {
      return img.resize({ width: 16, height: 16 });
    }
  }
  const pngBase64 =
    'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAMklEQVR42mNk+M9wngEPYGJgYGB4z8DwnwEN/idBw0YNGA3CkRuGsZlhDByoZ/kP73QAAI/vChM484a0AAAAAElFTkSuQmCC';
  return nativeImage.createFromDataURL(`data:image/png;base64,${pngBase64}`);
}

function updateTrayLanguage() {
  if (!tray) return;
  tray.setToolTip(t('SoSo Music — Аудиоплеер'));
  const contextMenu = Menu.buildFromTemplate([
    {
      label: t('Открыть SoSo Music'),
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    { type: 'separator' },
    {
      label: t('Выход'),
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
}

function createTray() {
  if (tray) return;
  const icon = createTrayIcon();
  tray = new Tray(icon);
  tray.setToolTip(t('SoSo Music — Аудиоплеер'));

  updateTrayLanguage();

  tray.on('double-click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.focus();
      } else {
        mainWindow.show();
      }
    }
  });

  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.focus();
      } else {
        mainWindow.show();
      }
    }
  });
}

async function createWindow() {
  if (!databaseReady) {
    try {
      await dbManager.init();
      databaseReady = true;
      libraryTaste.start();
    } catch (error) {
      // Stop startup: an unreadable existing library must never become a new empty library.
      dialog.showErrorBox(
        t('Не удалось открыть медиатеку'),
        error instanceof Error
          ? error.message
          : t('Проверьте файл медиатеки и доступ к диску. Исходные данные сохранены.'),
      );
      app.exit(1);
      return;
    }
  }

  const iconPath = getAppIconPath();
  const windowIcon = iconPath ? nativeImage.createFromPath(iconPath) : undefined;

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 920,
    minHeight: 620,
    title: 'SoSo Music',
    icon: windowIcon,
    backgroundColor: '#121212',
    frame: false, // Frameless window for unified sleek title bar
    titleBarStyle: 'hidden',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      backgroundThrottling: false,
    },
  });

  recoverMainRenderer(mainWindow, () => isQuitting);

  mainWindow.webContents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace) listenRendererReady = false;
  });

  // Prevent navigation to external sites inside main window
  mainWindow.on('blur', () => desktopControls?.capture(false));
  mainWindow.webContents.once('destroyed', () => desktopControls?.capture(false));
  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    const devServer = process.env.VITE_DEV_SERVER_URL;
    if (devServer && navigationUrl.startsWith(devServer)) {
      return;
    }
    event.preventDefault();
  });

  // Handle closing -> Hide to tray instead of quitting, so music continues playing
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      setAnimationsPaused(true);
      mainWindow?.hide();
      return false;
    }
  });

  // Freeze heavy theme animations while the window is minimized or hidden in tray
  mainWindow.on('minimize', () => setAnimationsPaused(true));
  mainWindow.on('hide', () => setAnimationsPaused(true));
  mainWindow.on('restore', () => setAnimationsPaused(false));
  mainWindow.on('show', () => setAnimationsPaused(false));

  // Handle mouse side buttons (Mouse 4 = Back, Mouse 5 = Forward) from Windows OS
  mainWindow.on('app-command', (_event, cmd) => {
    if (cmd === 'browser-backward') {
      mainWindow?.webContents.send('nav:goBack');
    } else if (cmd === 'browser-forward') {
      mainWindow?.webContents.send('nav:goForward');
    }
  });

  // Open external links in default browser
  mainWindow.webContents.setWindowOpenHandler((details: { url: string }) => {
    if (details.url.startsWith('https:') || details.url.startsWith('http:')) {
      shell.openExternal(details.url).catch((err) => {
        console.warn('[Main] failed to open external URL:', err);
      });
    }
    return { action: 'deny' };
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    // mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

function publishWidgetVisibility(open: boolean) {
  if (mainWindow && !mainWindow.isDestroyed())
    mainWindow.webContents.send('widget:visibilityChanged', open);
}

function createWidgetWindow() {
  if (widgetWindow && !widgetWindow.isDestroyed()) {
    widgetWindow.show();
    widgetWindow.focus();
    return;
  }

  const iconPath = getAppIconPath();
  const windowIcon = iconPath ? nativeImage.createFromPath(iconPath) : undefined;

  widgetWindow = new BrowserWindow({
    width: 270,
    height: 105,
    resizable: false,
    minimizable: false, // Prevent Win+D / Minimize All from minimizing the desktop widget
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: false, // Sit on the desktop layer without covering active browser/app windows
    skipTaskbar: true,
    title: 'SoSo Music Widget',
    icon: windowIcon,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
    },
  });

  // Prevent navigation to external sites inside widget window
  widgetWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    const devServer = process.env.VITE_DEV_SERVER_URL;
    if (devServer && navigationUrl.startsWith(devServer)) {
      return;
    }
    event.preventDefault();
  });

  widgetWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  // Keep widget alive and visible on the desktop when Windows minimizes all windows (Win + D)
  widgetWindow.on('minimize', () => {
    if (widgetWindow && !widgetWindow.isDestroyed()) {
      widgetWindow.restore();
      widgetWindow.show();
    }
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    widgetWindow.loadURL(`${process.env.VITE_DEV_SERVER_URL}#/widget`);
  } else {
    widgetWindow.loadFile(path.join(__dirname, '../dist/index.html'), {
      hash: '/widget',
    });
  }

  const createdWidget = widgetWindow;
  widgetWindow.on('closed', () => {
    if (widgetWindow === createdWidget) {
      widgetWindow = null;
      publishWidgetVisibility(false);
    }
  });
  publishWidgetVisibility(true);
}

// ================= IPC HANDLERS =================

function registerIpcHandlers() {
  registerDesktopControlsHandlers(
    ipcMain,
    () => mainWindow,
    desktopControls!,
    playerOverlay!,
    () => {
      mainWindow?.webContents.send('widget:command', 'requestState');
      return overlayPlaybackState;
    },
  );
  ipcMain.handle('app:setInterfaceLanguage', (_event, language: unknown) => {
    if (language !== 'ru' && language !== 'en')
      throw new TypeError('Unsupported interface language');
    setUiLocale(language);
    updateTrayLanguage();
  });
  registerWaveHandlers(ipcMain, dbManager);
  registerTastePolicyHandlers(
    ipcMain,
    () => mainWindow,
    dbManager,
    () => {
      libraryTaste.cancel();
      libraryTaste.libraryChanged();
    },
  );
  registerLibraryTasteHandlers(ipcMain, () => mainWindow, libraryTaste, {
    status: () => ({ configured: LastFmService.hasApiKey() }),
    save: (value) => {
      const key = lastFmKeyStore.save(value);
      libraryTaste.cancel();
      LastFmService.configureApiKey(key);
      if (key) libraryTaste.start();
      return { configured: Boolean(key) };
    },
  });
  // Desktop Mini-Widget handlers
  ipcMain.handle('widget:toggle', () => {
    if (widgetWindow && !widgetWindow.isDestroyed() && widgetWindow.isVisible()) {
      widgetWindow.close();
      return false;
    } else {
      createWidgetWindow();
      return true;
    }
  });

  ipcMain.handle('widget:isOpen', () => {
    return widgetWindow !== null && !widgetWindow.isDestroyed() && widgetWindow.isVisible();
  });

  ipcMain.on('widget:sendState', (event, state: any) => {
    if (
      !mainWindow ||
      mainWindow.isDestroyed() ||
      event.sender !== mainWindow.webContents ||
      event.senderFrame !== mainWindow.webContents.mainFrame
    )
      return;
    overlayPlaybackState = state;
    playerOverlay?.sendState(state);
    if (widgetWindow && !widgetWindow.isDestroyed()) {
      widgetWindow.webContents.send('widget:stateUpdate', state);
    }
  });

  ipcMain.on('widget:command', (event, payload: unknown) => {
    const fromWidget =
      widgetWindow &&
      !widgetWindow.isDestroyed() &&
      event.sender === widgetWindow.webContents &&
      event.senderFrame === widgetWindow.webContents.mainFrame;
    if (!fromWidget && !playerOverlay?.owns(event)) return;
    if (!payload || typeof payload !== 'object') return;
    const { command, data } = payload as { command: string; data?: unknown };
    if (
      !['requestState', 'togglePlay', 'next', 'prev', 'seek', 'setVolume', 'toggleLike'].includes(
        command,
      )
    )
      return;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('widget:command', command, data);
    }
  });

  registerLyricsHandlers(ipcMain, dbManager);

  // Listening Stats & Smart Playlists
  ipcMain.handle('db:getStats', () => {
    return dbManager.getStatsSummary();
  });

  ipcMain.handle('db:getSmartPlaylist', (_event: any, kind: string) => {
    return dbManager.getSmartPlaylist(kind as any);
  });

  // Window control handlers
  ipcMain.handle('window:minimize', () => {
    mainWindow?.minimize();
  });

  ipcMain.handle('window:maximize', () => {
    if (mainWindow) {
      if (mainWindow.isMaximized()) {
        mainWindow.unmaximize();
        return false;
      } else {
        mainWindow.maximize();
        return true;
      }
    }
    return false;
  });

  ipcMain.handle('window:close', () => {
    // Hide to background / tray
    mainWindow?.hide();
  });

  ipcMain.handle('window:isMaximized', () => {
    return mainWindow?.isMaximized() || false;
  });

  // Multi-Source Music API handlers (SoundCloud + YouTube Music / Source-filtered)
  ipcMain.handle(
    'music:search',
    async (_event: any, query: string, limit?: number, source?: any) => {
      if (!query || typeof query !== 'string' || !query.trim()) return { data: [], total: 0 };
      const safeLimit = typeof limit === 'number' && limit > 0 && limit <= 100 ? limit : 20;
      return await MusicAggregatorService.search(query.trim(), safeLimit, source);
    },
  );

  ipcMain.handle(
    'music:searchArtists',
    async (_event: any, query: string, limit?: number, source?: any) => {
      if (!query || typeof query !== 'string' || !query.trim()) return { data: [] };
      const safeLimit = typeof limit === 'number' && limit > 0 && limit <= 50 ? limit : 10;
      return await MusicAggregatorService.searchArtists(query.trim(), safeLimit, source);
    },
  );

  ipcMain.handle('music:getCharts', async (_event: any, source?: any) => {
    return await MusicAggregatorService.getCharts(source);
  });

  ipcMain.handle('music:getGenres', async () => {
    return await MusicAggregatorService.getGenres();
  });

  ipcMain.handle(
    'music:getGenreTracks',
    async (_event: any, genreId: number | string, source?: any) => {
      return await MusicAggregatorService.getGenreTracks(genreId, source);
    },
  );

  ipcMain.handle('music:getAutocomplete', async (_event: any, query: string) => {
    if (!query || typeof query !== 'string' || !query.trim()) return [];
    return await MusicAggregatorService.getAutocomplete(query.trim());
  });

  ipcMain.handle(
    'music:getOfficialVideoClip',
    async (_event: any, artist: string, title: string, apiKey?: string) => {
      if (!artist || !title) return null;
      return await MusicAggregatorService.getOfficialVideoClip(artist, title, apiKey);
    },
  );

  ipcMain.handle(
    'music:getVideoStream',
    async (_event: any, videoId: string, options?: { forceRefresh?: boolean }) => {
      if (typeof videoId !== 'string' || !/^(?:yt_)?[a-zA-Z0-9_-]{11}$/.test(videoId)) return '';
      return await YouTubeMusicService.resolveDirectVideoStream(
        videoId,
        false,
        options?.forceRefresh === true,
      );
    },
  );

  ipcMain.handle(
    'music:getArtist',
    async (_event: any, idOrName: string | number, artistName?: string, artistSource?: string) => {
      return await MusicAggregatorService.getArtist(idOrName, artistName, artistSource);
    },
  );

  ipcMain.handle(
    'music:getArtistAllTracks',
    async (_event: any, idOrName: string | number, artistName?: string, artistSource?: string) => {
      return await MusicAggregatorService.getArtistAllTracks(idOrName, artistName, artistSource);
    },
  );

  ipcMain.handle(
    'music:getAlbumTracks',
    async (_event: any, albumId?: string | number, albumTitle?: string, artistName?: string) => {
      return await MusicAggregatorService.getAlbumTracks(albumId, albumTitle, artistName);
    },
  );

  ipcMain.handle('music:getRecommendedTracks', async (_event, previousIds: unknown) => {
    const dislikedTracks = dbManager.getDislikedWaveTracks();
    const dailyPolicy = createDailyDislikePolicy(dislikedTracks);
    const dislikedIds = dbManager.getDislikedTrackIds();
    const disliked = new Set(dislikedIds.map(String));
    const normalize = (rows: any[]) =>
      rows
        .map(normalizeWaveSeed)
        .filter((track): track is Track =>
          Boolean(track && !disliked.has(String(track.id)) && dailyPolicy.accepts(track)),
        );
    const allLikes = normalize(dbManager.getLikedTracks());
    const likes = normalize(dbManager.getTasteLikedTracks());
    const seeds = [
      ...new Map(
        [...likes, ...normalize(dbManager.getWaveTasteTracks(30))].map((track) => [
          String(track.id),
          track,
        ]),
      ).values(),
    ];
    const artists = [
      ...dbManager.getFollowedArtists(),
      ...dbManager.getScrobbledTopArtists(15).filter((artist) => artist.score > 0),
    ].filter((artist) => dailyPolicy.acceptsArtist(artist.name));
    if (!seeds.length && !artists.length) return [];
    const recent = normalize(
      dbManager.getListeningHistory(40, true).map((row) => ({ ...row, id: row.track_id })),
    );
    const previous = Array.isArray(previousIds)
      ? previousIds
          .slice(0, 5)
          .filter(
            (id) =>
              (typeof id === 'string' && id.length < 128) ||
              (typeof id === 'number' && Number.isFinite(id)),
          )
      : [];
    const excluded = [
      ...dislikedIds,
      ...allLikes.map((track) => track.id),
      ...recent.map((track) => track.id),
      ...previous,
    ];
    const candidates = await WaveEngine.getWaveBatch(
      'default',
      seeds,
      excluded,
      artists,
      dislikedTracks,
      { recentTracks: recent, artistFeedback: dailyPolicy.artistFeedback },
      false,
    );
    return selectDailyRecommendations(candidates, [...allLikes, ...recent], dislikedTracks);
  });

  ipcMain.handle('music:cancelStreamResolve', (event: any, requestId: unknown) => {
    streamRequestRegistry.cancel(event.sender, requestId);
  });
  ipcMain.handle(
    'music:getFullStreamUrl',
    async (event: any, track: any, options?: any, requestId?: unknown) => {
      if (!track || typeof track !== 'object') return null;
      const request = streamRequestRegistry.begin(event.sender, requestId);
      try {
        const url = await sharedStreamResolver.resolve(
          track,
          options || {},
          request.signal,
          (item, settings) => MusicAggregatorService.getFullStreamUrl(item, settings),
        );
        request.signal.throwIfAborted();
        if (url && (track.source === 'youtube' || String(track.id).startsWith('yt_'))) {
          const gainDb = YouTubeMusicService.getRecordingGain(String(track.id));
          if (gainDb !== undefined && !event.sender.isDestroyed())
            event.sender.send('music:trackLoudness', { trackId: track.id, gainDb });
        }
        return url;
      } finally {
        request.finish();
      }
    },
  );

  ipcMain.handle('playlist:readExternal', (_event, url: string) => loadExternalPlaylist(url));
  ipcMain.handle('playlist:readVkInWindow', (_event, url: string) =>
    loadVkPlaylistInWindow(url, mainWindow),
  );
  ipcMain.handle('playlist:cancelVkRead', () => cancelVkPlaylistRead());

  // Diagnostics & Playback Logger IPC
  ipcMain.on('logger:logPlaybackEvent', (_event: any, payload: any) => {
    if (!payload || !payload.message) return;
    PlaybackLogger.log(payload.level || 'INFO', payload.message, payload.meta);
    const route = playbackRouteLog(payload.meta, (id) => YouTubeMusicService.getStreamRoute(id));
    if (route) PlaybackLogger.info(route);
  });

  ipcMain.handle('logger:getRecentLogs', async (_event: any, limit?: number) => {
    return PlaybackLogger.getRecentLogs(limit);
  });

  ipcMain.handle('app:openLogFile', async () => {
    try {
      const filePath = PlaybackLogger.getLogFilePath();
      if (!filePath) {
        return { success: false, error: t('Путь к файлу логов не определён') };
      }
      if (!fs.existsSync(filePath)) {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(
          filePath,
          `--- SoSo Music Log initialized at ${new Date().toISOString()} ---\n`,
          'utf8',
        );
      }
      const openResult = await shell.openPath(filePath);
      if (openResult) {
        shell.showItemInFolder(filePath);
      }
      return { success: true, filePath };
    } catch (err: any) {
      console.error('[app:openLogFile] Error opening log file:', err);
      return { success: false, error: err?.message || String(err) };
    }
  });

  // Zapret DPI Integration IPC
  ipcMain.handle('app:findZapret', async () => {
    return await ZapretService.findListGeneral();
  });

  ipcMain.handle('app:applyZapret', async () => {
    return await ZapretService.addDomainsToList();
  });

  ipcMain.handle('app:selectZapretFile', async () => {
    return await ZapretService.selectCustomFile();
  });

  ipcMain.handle(
    'music:downloadAudioBuffer',
    async (_event: any, url: string, requestId?: string) => {
      const progressRequestId =
        typeof requestId === 'string' && /^[\w-]{1,80}$/.test(requestId) ? requestId : undefined;
      if (!url || typeof url !== 'string') return null;
      try {
        return await downloadAudioBytes(url, {
          onProgress: progressRequestId
            ? (receivedBytes, totalBytes) => {
                if (!_event.sender.isDestroyed()) {
                  _event.sender.send('music:audioDownloadProgress', {
                    requestId: progressRequestId,
                    receivedBytes,
                    totalBytes,
                  });
                }
              }
            : undefined,
        });
      } catch (error) {
        console.warn('[Main] Audio download failed:', error);
        return null;
      }
    },
  );

  registerLibraryHandlers(ipcMain, dbManager, () => libraryTaste.libraryChanged());

  registerPlaylistHandlers(ipcMain, dbManager, () => libraryTaste.libraryChanged());

  registerHistoryHandlers(ipcMain, dbManager);

  // Discord Rich Presence handlers
  ipcMain.handle('discord:updateActivity', (_event: any, data: any) => {
    DiscordRPCService.updateActivity(data);
  });

  ipcMain.handle('discord:clearActivity', () => {
    DiscordRPCService.clearActivity();
  });

  ipcMain.handle('discord:toggleRpc', (_event: any, enabled: boolean) => {
    DiscordRPCService.setEnabled(enabled);
  });

  // Video / GIF Wallpaper picker (Desktop custom themes)
  ipcMain.handle('wallpaper:selectVideo', async (event) => {
    assertMainWindowSender(event, mainWindow);
    const focusedWindow = BrowserWindow.getFocusedWindow() || mainWindow;
    const result = await dialog.showOpenDialog(focusedWindow as any, {
      title: t('Выберите видео или GIF для фона приложения'),
      filters: [
        {
          name: t('Медиа (MP4 / WebM / GIF)'),
          extensions: ['mp4', 'webm', 'ogv', 'm4v', 'mov', 'gif', 'png', 'jpg', 'jpeg', 'webp'],
        },
        { name: t('Видео (MP4 / WebM)'), extensions: ['mp4', 'webm', 'ogv', 'm4v', 'mov'] },
        { name: t('Изображения (GIF / PNG)'), extensions: ['gif', 'png', 'jpg', 'jpeg', 'webp'] },
      ],
      properties: ['openFile'],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, canceled: true };
    }

    const filePath = result.filePaths[0];
    return {
      success: true,
      filePath: mediaFileAccess.select(filePath),
      fileName: path.basename(filePath),
    };
  });

  // Database Backup & Restore handlers
  lanImportApproval.register(ipcMain);
  registerMainWindowHandlers(ipcMain, () => mainWindow, {
    'sync:start': () => lanSyncServer.start(),
    'sync:stop': () => lanSyncServer.stop(),
    'sync:status': () => lanSyncServer.status(),
  });
  ipcMain.handle('db:exportDatabase', async () => {
    const exportResult = dbManager.exportData();
    if (!exportResult.success) {
      return exportResult;
    }

    const today = new Date().toISOString().split('T')[0];
    const defaultFilename = `soso_music_backup_${today}.json`;

    const focusedWindow = BrowserWindow.getFocusedWindow() || mainWindow;
    const saveDialogResult = await dialog.showSaveDialog(focusedWindow as any, {
      title: t('Экспорт резервной копии SoSo Music'),
      defaultPath: defaultFilename,
      filters: [{ name: 'JSON Backup', extensions: ['json'] }],
    });

    if (saveDialogResult.canceled || !saveDialogResult.filePath) {
      return { success: false, canceled: true };
    }

    try {
      await fs.promises.writeFile(
        saveDialogResult.filePath,
        JSON.stringify(exportResult.payload, null, 2),
        'utf-8',
      );
      return {
        success: true,
        filePath: saveDialogResult.filePath,
        stats: exportResult.stats,
      };
    } catch (e: any) {
      return {
        success: false,
        error: 'FILE_WRITE_ERROR',
        message: e?.message || t('Не удалось сохранить файл на диск.'),
      };
    }
  });

  ipcMain.handle('db:importDatabase', async () => {
    const focusedWindow = BrowserWindow.getFocusedWindow() || mainWindow;
    const openDialogResult = await dialog.showOpenDialog(focusedWindow as any, {
      title: t('Импорт резервной копии SoSo Music'),
      filters: [{ name: 'JSON Backup', extensions: ['json'] }],
      properties: ['openFile'],
    });

    if (openDialogResult.canceled || openDialogResult.filePaths.length === 0) {
      return { success: false, canceled: true };
    }

    try {
      const content = await fs.promises.readFile(openDialogResult.filePaths[0], 'utf-8');
      return dbManager.importData(content);
    } catch (e: any) {
      return {
        success: false,
        error: 'FILE_READ_ERROR',
        message: e?.message || t('Не удалось прочитать файл.'),
      };
    }
  });
}

protocol.registerSchemesAsPrivileged([MEDIA_SCHEME]);

let youtubeAccount: YouTubeAccountService | null = null;
let disposeAccountHandlers: (() => void) | null = null;

app.whenReady().then(async () => {
  playerOverlay = createPlayerOverlayWindow(
    path.join(__dirname, 'preload.js'),
    path.join(__dirname, '../dist/index.html'),
    process.env.VITE_DEV_SERVER_URL,
  );
  desktopControls = new DesktopControls(app.getPath('userData'), globalShortcut, (action) => {
    if (action === 'overlay') {
      PlaybackLogger.debug('[Overlay:Shortcut] Toggle requested');
      playerOverlay?.toggle();
    } else if (mainWindow && !mainWindow.isDestroyed())
      mainWindow.webContents.send('widget:command', action);
  });
  playerOverlay.setEnabled(desktopControls.status().overlayEnabled);
  desktopControls.start();
  void fs.promises
    .readFile(path.join(app.getAppPath(), 'public', 'compute', 'soso-core.wasm'))
    .then((bytes) => initializeRustCompute(bytes))
    .catch(() => PlaybackLogger.warn('[Compute:Rust] Local asset unavailable; using JavaScript'));
  youtubeAccount = new YouTubeAccountService(
    () => mainWindow,
    (invalidate = false) => {
      if (invalidate) YouTubeMusicService.invalidateSessionCaches();
      for (const window of [mainWindow, widgetWindow]) {
        if (invalidate && window && !window.isDestroyed())
          window.webContents.send('music:youtubeSessionReset');
      }
      void youtubeAccount
        ?.status()
        .then((status) => {
          if (mainWindow && !mainWindow.isDestroyed())
            mainWindow.webContents.send('youtube:accountChanged', status);
        })
        .catch(() => {});
    },
    () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
        mainWindow.webContents.send('youtube:accountConnected');
      }
    },
  );
  await youtubeAccount.status();
  YouTubeMusicService.setAccountResolver((videoId, options) =>
    youtubeAccount!.resolve(videoId, options),
  );
  YouTubeMusicService.setAccountVideoResolver((videoId) => youtubeAccount!.resolveVideo(videoId));
  disposeAccountHandlers = registerYouTubeAccountHandlers(
    ipcMain,
    () => mainWindow,
    youtubeAccount,
  );
  setDesktopFetch((url, init) => electronFetch(url, init));
  const checkUpdates = createAppUpdateChecker(app.getVersion(), desktopFetch);
  const publishUpdate = (status: import('../../shared/types').AppUpdateStatus) => {
    const previous = availableAppUpdate?.latestVersion;
    if (status.status !== 'available') {
      availableAppUpdate = null;
      return;
    }
    availableAppUpdate = status;
    if (previous !== status.latestVersion && mainWindow && !mainWindow.isDestroyed())
      mainWindow.webContents.send('app:updateAvailable', status);
  };
  registerMainWindowHandlers(ipcMain, () => mainWindow, {
    'app:checkUpdates': async () => {
      const status = await checkUpdates();
      if (status.status !== 'error') publishUpdate(status);
      return status;
    },
    'app:getAvailableUpdate': () => availableAppUpdate,
  });
  stopAppUpdateMonitor = startAppUpdateMonitor(checkUpdates, publishUpdate);
  setDesktopNetworkRecovery(async () => {
    // Re-read proxy rules without interrupting other media, downloads or prefetches.
    await session.defaultSession.forceReloadProxyConfig();
    PlaybackLogger.debug('[YouTubeMusic:Network] Proxy configuration reloaded for stream retry');
  });
  setYouTubeSessionReset(async () => {
    for (const window of [mainWindow, widgetWindow]) {
      if (window && !window.isDestroyed()) window.webContents.send('music:youtubeSessionReset');
    }
    await clearYouTubeSessionCache(session.defaultSession);
    await youtubeAccount?.resetCache();
  });
  protocol.handle('media', createMediaHandler(mediaFileAccess, process.env.VITE_DEV_SERVER_URL));

  // Network-level Ad Blocker for Songsterr tabs and YouTube background streaming
  try {
    session.defaultSession.webRequest.onBeforeRequest(
      {
        urls: [
          // Google & DoubleClick ads
          '*://*.doubleclick.net/*',
          '*://*.googleadservices.com/*',
          '*://*.googlesyndication.com/*',
          '*://*.adservice.google.com/*',
          '*://*.adservice.google.ru/*',
          '*://*.pagead2.googlesyndication.com/*',
          '*://*.youtube.com/api/stats/ads*',
          '*://*.youtube.com/pagead/*',
          '*://*.youtube.com/ptracking*',
          '*://*.youtube.com/get_midroll_info*',
          // Yandex Direct & Russian ad networks (used on Songsterr)
          '*://*.an.yandex.ru/*',
          '*://*.yabs.yandex.ru/*',
          '*://*.adfox.ru/*',
          '*://*.adfox.yandex.ru/*',
          '*://*.yandex.ru/ads/*',
          '*://*.yandex.ru/ad/*',
          '*://*.an.yandex.net/*',
          '*://*.yabs.yandex.net/*',
          '*://*.direct.yandex.ru/*',
          // Global ad syndication networks commonly loaded by Songsterr
          '*://*.criteo.com/*',
          '*://*.criteo.net/*',
          '*://*.adnxs.com/*',
          '*://*.pubmatic.com/*',
          '*://*.rubiconproject.com/*',
          '*://*.taboola.com/*',
          '*://*.outbrain.com/*',
          '*://*.casalemedia.com/*',
          '*://*.openx.net/*',
          '*://*.smartadserver.com/*',
          '*://*.adpushup.com/*',
          '*://*.media.net/*',
          '*://*.bidswitch.net/*',
        ],
      },
      (_details, callback) => {
        callback({ cancel: true });
      },
    );
  } catch (err) {
    console.warn('[Main] webRequest.onBeforeRequest ad-blocker initialization failed:', err);
  }

  // Automatically inject Referer / Origin headers for all direct external audio streams and YouTube embeds
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    if (details.url.startsWith('http://127.0.0.1') || details.url.startsWith('http://localhost')) {
      return callback({ requestHeaders: details.requestHeaders });
    }
    const headers = { ...details.requestHeaders };
    if (isSoundCloudUrl(details.url)) {
      headers['Referer'] = 'https://soundcloud.com/';
      headers['Origin'] = 'https://soundcloud.com';
    }
    if (details.url.includes('bandcamp.com') || details.url.includes('bcbits.com')) {
      headers['Referer'] = 'https://bandcamp.com/';
      headers['Origin'] = 'https://bandcamp.com';
    }
    if (details.url.includes('youtube.com') || details.url.includes('youtube-nocookie.com')) {
      // Required so YouTube embedded player doesn't fail with player configuration / 150 error
      headers['Referer'] = 'https://www.youtube.com/';
      headers['Origin'] = 'https://www.youtube.com';
    }
    if (details.url.includes('googlevideo.com')) {
      delete headers['Referer'];
      delete headers['Origin'];
      const userAgent = youtubeAccountMediaUserAgent(details.url);
      if (userAgent) headers['User-Agent'] = userAgent;
    }
    callback({ requestHeaders: headers });
  });

  // Ensure CORS compliance for renderer requests (streams, covers, HLS, APIs) with webSecurity enabled
  const CORS_ALLOWED_DOMAINS = [
    'soundcloud.com',
    'soundcloud.cloud',
    'sndcdn.com',
    'bandcamp.com',
    'bcbits.com',
    'youtube.com',
    'youtube-nocookie.com',
    'googlevideo.com',
    'ytimg.com',
    'googleusercontent.com',
    'lrclib.net',
    'songsterr.com',
    'kugou.com',
    'unsplash.com',
    'audioscrobbler.com',
    'lrcmux.dev',
    'ultimate-guitar.com',
    'amdm.ru',
    'localhost',
    '127.0.0.1',
  ];

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const mediaRequest = describeYouTubeMediaRequest(details.url);
    if (mediaRequest) {
      const contentTypeHeader =
        Object.entries(details.responseHeaders || {}).find(
          ([name]) => name.toLowerCase() === 'content-type',
        )?.[1]?.[0] || 'unknown';
      const mime = contentTypeHeader
        .split(';')[0]
        .trim()
        .replace(/[^a-zA-Z0-9/+.\-]/g, '')
        .slice(0, 80);
      const message = `[YouTubeMusic:CDN] HTTP ${details.statusCode}, mime=${mime}, src=${mediaRequest}`;
      if (details.statusCode >= 400) PlaybackLogger.warn(message);
      else PlaybackLogger.debug(message);
    }
    let shouldAllowCors = false;
    try {
      const urlObj = new URL(details.url);
      const host = urlObj.hostname.toLowerCase();
      shouldAllowCors = CORS_ALLOWED_DOMAINS.some(
        (domain) => host === domain || host.endsWith('.' + domain),
      );
    } catch {
      shouldAllowCors = false;
    }

    if (shouldAllowCors) {
      const responseHeaders = { ...details.responseHeaders };
      responseHeaders['access-control-allow-origin'] = ['*'];
      responseHeaders['access-control-allow-headers'] = ['*'];
      responseHeaders['access-control-allow-methods'] = ['GET, POST, OPTIONS, HEAD'];

      // Allow embedding Songsterr tabs and YouTube video clips in in-app iframes
      if (
        details.url.includes('songsterr.com') ||
        details.url.includes('youtube.com') ||
        details.url.includes('youtube-nocookie.com')
      ) {
        delete responseHeaders['x-frame-options'];
        delete responseHeaders['X-Frame-Options'];
        if (responseHeaders['content-security-policy']) {
          responseHeaders['content-security-policy'] = responseHeaders[
            'content-security-policy'
          ].map((csp) => csp.replace(/frame-ancestors[^;]+;?/gi, ''));
        }
        if (responseHeaders['Content-Security-Policy']) {
          responseHeaders['Content-Security-Policy'] = responseHeaders[
            'Content-Security-Policy'
          ].map((csp) => csp.replace(/frame-ancestors[^;]+;?/gi, ''));
        }
      }

      callback({ responseHeaders });
    } else {
      callback({ responseHeaders: details.responseHeaders });
    }
  });

  session.defaultSession.webRequest.onErrorOccurred(
    { urls: ['https://*.googlevideo.com/*'] },
    (details) => {
      const mediaRequest = describeYouTubeMediaRequest(details.url);
      if (mediaRequest) {
        const message = `[YouTubeMusic:CDN] ${details.error}, src=${mediaRequest}`;
        if (details.error === 'net::ERR_ABORTED') PlaybackLogger.debug(message);
        else PlaybackLogger.warn(message);
      }
    },
  );

  ipcMain.handle('library:persistenceStatus', () => dbManager.getPersistenceStatus());
  registerIpcHandlers();
  ipcMain.handle('listen:ready', (event) => {
    if (event.sender !== mainWindow?.webContents) return;
    listenRendererReady = true;
    if (pendingListenTrack) deliverSharedTrack(pendingListenTrack);
  });
  const listenOrigin = await localListenServer.start(deliverSharedTrack);
  DiscordRPCService.setListenOrigin(listenOrigin);
  if (!listenOrigin)
    PlaybackLogger.warn('[Discord] Local listen port is occupied; listen button unavailable.');
  DiscordRPCService.init();
  await createWindow();
  playerOverlay.start();
  createTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else {
      mainWindow?.show();
    }
  });
});

app.on('before-quit', (event) => {
  // Ask before disposing services: the user can return and export/retry after a disk error.
  if (databaseReady) {
    try {
      dbManager.saveSync();
    } catch (error) {
      PlaybackLogger.error('[Library:Save] Exit save failed', error);
      const choice = dialog.showMessageBoxSync({
        type: 'error',
        title: t('Медиатека не сохранена'),
        message: t('Не удалось сохранить последние изменения.'),
        detail: t(
          'Проверьте свободное место и доступ к диску. Можно вернуться в плеер и экспортировать медиатеку. Предыдущий сохранённый файл не заменён пустой базой.',
        ),
        buttons: [t('Вернуться в плеер'), t('Закрыть без сохранения')],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      if (choice !== 1) {
        event.preventDefault();
        isQuitting = false;
        mainWindow?.show();
        return;
      }
    }
  }
  stopAppUpdateMonitor?.();
  desktopControls?.dispose();
  playerOverlay?.dispose();
  libraryTaste.dispose();
  disposeAccountHandlers?.();
  youtubeAccount?.dispose();
  lanSyncServer.stop();
  localListenServer.stop();
  isQuitting = true;
  DiscordRPCService.clearActivity();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && isQuitting) {
    app.quit();
  }
});
