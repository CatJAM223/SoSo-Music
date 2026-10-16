import { contextBridge, ipcRenderer } from 'electron';
import { ElectronAPI } from '../../shared/types';

const api: ElectronAPI = {
  getAvailableAppUpdate: () => ipcRenderer.invoke('app:getAvailableUpdate'),
  onAppUpdateAvailable: (callback) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      status: import('../../shared/types').AppUpdateStatus,
    ) => callback(status);
    ipcRenderer.on('app:updateAvailable', handler);
    return () => ipcRenderer.removeListener('app:updateAvailable', handler);
  },
  getDesktopControls: () => ipcRenderer.invoke('desktopControls:get'),
  setDesktopShortcut: (action, key) =>
    ipcRenderer.invoke('desktopControls:setShortcut', action, key),
  captureDesktopShortcut: (enabled) => ipcRenderer.invoke('desktopControls:capture', enabled),
  togglePlayerOverlay: () => ipcRenderer.invoke('overlay:toggle'),
  setPlayerOverlayEnabled: (enabled) => ipcRenderer.invoke('overlay:setEnabled', enabled),
  getOverlayState: () => ipcRenderer.invoke('overlay:getState'),
  getOverlayLayout: () => ipcRenderer.invoke('overlay:getLayout'),
  saveOverlayLayout: (layout) => ipcRenderer.invoke('overlay:saveLayout', layout),
  editPlayerOverlay: () => ipcRenderer.invoke('overlay:edit'),
  getOverlayEditing: () => ipcRenderer.invoke('overlay:isEditing'),
  finishOverlayEditing: () => ipcRenderer.invoke('overlay:finishEditing'),
  onOverlayEditingChanged: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, editing: boolean) => callback(editing);
    ipcRenderer.on('overlay:editingChanged', handler);
    return () => ipcRenderer.removeListener('overlay:editingChanged', handler);
  },
  getLastFmApiKeyStatus: () => ipcRenderer.invoke('lastfm:keyStatus'),
  saveLastFmApiKey: (key) => ipcRenderer.invoke('lastfm:saveKey', key),
  setInterfaceLanguage: (language) => ipcRenderer.invoke('app:setInterfaceLanguage', language),
  getTastePolicy: () => ipcRenderer.invoke('tastePolicy:get'),
  setTasteExcluded: (value) => ipcRenderer.invoke('tastePolicy:setExcluded', value),
  getTasteProfile: () => ipcRenderer.invoke('tastePolicy:profile'),
  onTastePolicyChanged: (callback) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      value: import('../../shared/types/tastePolicy').TastePolicySnapshot,
    ) => callback(value);
    ipcRenderer.on('tastePolicy:changed', handler);
    return () => ipcRenderer.removeListener('tastePolicy:changed', handler);
  },
  getLibraryTaste: () => ipcRenderer.invoke('libraryTaste:status'),
  analyzeLibraryTaste: () => ipcRenderer.invoke('libraryTaste:analyze'),
  cancelLibraryTaste: () => ipcRenderer.invoke('libraryTaste:cancel'),
  setLibraryTasteAutoAnalyze: (enabled) =>
    ipcRenderer.invoke('libraryTaste:setAutoAnalyze', enabled),
  getLibraryPersistenceStatus: () => ipcRenderer.invoke('library:persistenceStatus'),
  onLibraryPersistenceStatus: (callback) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      status: import('../../shared/types').LibraryPersistenceStatus,
    ) => callback(status);
    ipcRenderer.on('library:persistenceStatus', handler);
    return () => ipcRenderer.removeListener('library:persistenceStatus', handler);
  },
  checkAppUpdates: () => ipcRenderer.invoke('app:checkUpdates'),
  getYouTubeAccountStatus: () => ipcRenderer.invoke('youtube:accountStatus'),
  connectYouTubeAccount: () => ipcRenderer.invoke('youtube:connectAccount'),
  refreshYouTubeSession: () => ipcRenderer.invoke('youtube:refreshSession'),
  importYouTubeSession: () => ipcRenderer.invoke('youtube:importSession'),
  disconnectYouTubeAccount: () => ipcRenderer.invoke('youtube:disconnectAccount'),
  onYouTubeAccountConnected: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('youtube:accountConnected', handler);
    return () => ipcRenderer.removeListener('youtube:accountConnected', handler);
  },
  onYouTubeAccountChanged: (callback) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      status: import('../../shared/types').YouTubeAccountStatus,
    ) => callback(status);
    ipcRenderer.on('youtube:accountChanged', handler);
    return () => ipcRenderer.removeListener('youtube:accountChanged', handler);
  },
  readExternalPlaylist: (url) => ipcRenderer.invoke('playlist:readExternal', url),
  readVkPlaylistInWindow: (url) => ipcRenderer.invoke('playlist:readVkInWindow', url),
  cancelVkPlaylistRead: () => ipcRenderer.invoke('playlist:cancelVkRead'),
  // Window controls
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  maximizeWindow: () => ipcRenderer.invoke('window:maximize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  isWindowMaximized: () => ipcRenderer.invoke('window:isMaximized'),

  // Navigation (Mouse buttons & OS shortcuts)
  onNavBack: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('nav:goBack', handler);
    return () => {
      ipcRenderer.removeListener('nav:goBack', handler);
    };
  },
  onNavForward: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('nav:goForward', handler);
    return () => {
      ipcRenderer.removeListener('nav:goForward', handler);
    };
  },

  // Theme animation freeze (window minimized / hidden to tray)
  onAnimationsPaused: (callback: (paused: boolean) => void) => {
    const handler = (_event: any, paused: boolean) => callback(paused);
    ipcRenderer.on('ui:animationsPaused', handler);
    return () => {
      ipcRenderer.removeListener('ui:animationsPaused', handler);
    };
  },

  // Music API & Stream
  search: (query: string, limit?: number, source?: any) =>
    ipcRenderer.invoke('music:search', query, limit, source),
  searchArtists: (query: string, limit?: number, source?: any) =>
    ipcRenderer.invoke('music:searchArtists', query, limit, source),
  getCharts: (source?: any) => ipcRenderer.invoke('music:getCharts', source),
  getGenres: () => ipcRenderer.invoke('music:getGenres'),
  getGenreTracks: (genreId: number | string, source?: any) =>
    ipcRenderer.invoke('music:getGenreTracks', genreId, source),
  getAutocomplete: (query: string) => ipcRenderer.invoke('music:getAutocomplete', query),
  getArtist: (idOrName: string | number, artistName?: string, artistSource?: string) =>
    ipcRenderer.invoke('music:getArtist', idOrName, artistName, artistSource),
  getArtistAllTracks: (idOrName: string | number, artistName?: string, artistSource?: string) =>
    ipcRenderer.invoke('music:getArtistAllTracks', idOrName, artistName, artistSource),
  getAlbumTracks: (albumId?: string | number, albumTitle?: string, artistName?: string) =>
    ipcRenderer.invoke('music:getAlbumTracks', albumId, albumTitle, artistName),
  getWaveBatch: (mood, seedTracks, excludeIds, context, requestId) =>
    ipcRenderer.invoke('music:getWaveBatch', mood, seedTracks, excludeIds, context, requestId),
  cancelWaveBatch: (requestId) => ipcRenderer.invoke('music:cancelWaveBatch', requestId),
  getRecommendedTracks: (previousIds) =>
    ipcRenderer.invoke('music:getRecommendedTracks', previousIds),
  getFullStreamUrl: (track, options, requestId) =>
    ipcRenderer.invoke('music:getFullStreamUrl', track, options, requestId),
  cancelStreamResolve: (requestId) => ipcRenderer.invoke('music:cancelStreamResolve', requestId),
  downloadAudioBuffer: (url: string, requestId?: string) =>
    ipcRenderer.invoke('music:downloadAudioBuffer', url, requestId),
  onAudioDownloadProgress: (callback) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      progress: { requestId: string; receivedBytes: number; totalBytes: number },
    ) => callback(progress);
    ipcRenderer.on('music:audioDownloadProgress', listener);
    return () => ipcRenderer.removeListener('music:audioDownloadProgress', listener);
  },

  // Diagnostics & Playback Logger
  logPlaybackEvent: (level: string, message: string, meta?: any) =>
    ipcRenderer.send('logger:logPlaybackEvent', { level, message, meta }),
  getRecentPlaybackLogs: (limit?: number) => ipcRenderer.invoke('logger:getRecentLogs', limit),
  openLogFile: () => ipcRenderer.invoke('app:openLogFile'),

  // Lyrics, Chords & Songsterr Tabs API
  getLyrics: (title: string, artist: string, duration?: number) =>
    ipcRenderer.invoke('music:getLyrics', { title, artist, duration }),
  getChords: (payload: { title: string; artist: string }) =>
    ipcRenderer.invoke('music:getChords', payload),
  getSongsterrTab: (payload: { title: string; artist: string }) =>
    ipcRenderer.invoke('music:getSongsterrTab', payload),
  getOfficialVideoClip: (artist: string, title: string, apiKey?: string) =>
    ipcRenderer.invoke('music:getOfficialVideoClip', artist, title, apiKey),
  getVideoStream: (videoId, options) =>
    ipcRenderer.invoke('music:getVideoStream', videoId, options),

  // Desktop Mini-Widget
  toggleWidget: () => ipcRenderer.invoke('widget:toggle'),
  isWidgetOpen: () => ipcRenderer.invoke('widget:isOpen'),
  onWidgetVisibilityChanged: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, open: boolean) => callback(open);
    ipcRenderer.on('widget:visibilityChanged', handler);
    return () => ipcRenderer.removeListener('widget:visibilityChanged', handler);
  },
  sendWidgetState: (state: any) => ipcRenderer.send('widget:sendState', state),
  sendWidgetCommand: (command: string, data?: any) =>
    ipcRenderer.send('widget:command', { command, data }),
  onWidgetCommand: (callback: (command: string, data?: any) => void) => {
    const handler = (_event: any, command: string, data?: any) => callback(command, data);
    ipcRenderer.on('widget:command', handler);
    return () => ipcRenderer.removeListener('widget:command', handler);
  },
  onWidgetStateUpdate: (callback: (state: any) => void) => {
    const handler = (_event: any, state: any) => callback(state);
    ipcRenderer.on('widget:stateUpdate', handler);
    return () => ipcRenderer.removeListener('widget:stateUpdate', handler);
  },

  getLibraryPage: (request) => ipcRenderer.invoke('db:getLibraryPage', request),
  getLibraryStats: () => ipcRenderer.invoke('db:getLibraryStats'),
  getLibraryPlaybackTracks: (request) => ipcRenderer.invoke('db:getLibraryPlaybackTracks', request),
  getSavedAlbumIds: () => ipcRenderer.invoke('db:getSavedAlbumIds'),
  getArtistMembership: () => ipcRenderer.invoke('db:getArtistMembership'),

  // SQLite - Liked Tracks
  getLikedTrackIds: () => ipcRenderer.invoke('db:getLikedTrackIds'),
  getLikedTracks: () => ipcRenderer.invoke('db:getLikedTracks'),
  isTrackLiked: (deezerId: string | number) => ipcRenderer.invoke('db:isTrackLiked', deezerId),
  toggleLikeTrack: (track) => ipcRenderer.invoke('db:toggleLikeTrack', track),

  // SQLite - Saved Albums
  getSavedAlbums: () => ipcRenderer.invoke('db:getSavedAlbums'),
  isAlbumSaved: (albumId: string | number) => ipcRenderer.invoke('db:isAlbumSaved', albumId),
  toggleSaveAlbum: (album) => ipcRenderer.invoke('db:toggleSaveAlbum', album),

  // SQLite - Followed Artists
  getFollowedArtists: () => ipcRenderer.invoke('db:getFollowedArtists'),
  isArtistFollowed: (artistId: string | number) =>
    ipcRenderer.invoke('db:isArtistFollowed', artistId),
  toggleFollowArtist: (artist) => ipcRenderer.invoke('db:toggleFollowArtist', artist),

  // SQLite - Playlists
  getPlaylists: () => ipcRenderer.invoke('db:getPlaylists'),
  getTrackPlaylistIds: (trackId: string | number) =>
    ipcRenderer.invoke('db:getTrackPlaylistIds', trackId),
  createPlaylist: (name: string, description?: string) =>
    ipcRenderer.invoke('db:createPlaylist', name, description),
  setPlaylistCover: (playlistId: string, coverUrl: string) =>
    ipcRenderer.invoke('db:setPlaylistCover', playlistId, coverUrl),
  deletePlaylist: (playlistId: string) => ipcRenderer.invoke('db:deletePlaylist', playlistId),
  getPlaylistTracks: (playlistId: string) => ipcRenderer.invoke('db:getPlaylistTracks', playlistId),
  addTrackToPlaylist: (playlistId: string, track) =>
    ipcRenderer.invoke('db:addTrackToPlaylist', playlistId, track),
  removeTrackFromPlaylist: (playlistId: string, trackDeezerId: string | number) =>
    ipcRenderer.invoke('db:removeTrackFromPlaylist', playlistId, trackDeezerId),

  // SQLite - Search History
  getSearchHistory: (limit?: number) => ipcRenderer.invoke('db:getSearchHistory', limit),
  addSearchHistory: (query: string) => ipcRenderer.invoke('db:addSearchHistory', query),
  clearSearchHistory: () => ipcRenderer.invoke('db:clearSearchHistory'),
  removeSearchHistoryItem: (id: number) => ipcRenderer.invoke('db:removeSearchHistoryItem', id),

  // SQLite - Local Scrobbling & Dislikes
  recordScrobble: (data: any) => ipcRenderer.invoke('db:recordScrobble', data),
  recordPlaybackSession: (data: any) => ipcRenderer.invoke('db:recordPlaybackSession', data),
  dislikeTrack: (track: any) => ipcRenderer.invoke('db:dislikeTrack', track),
  undislikeTrack: (trackId: any) => ipcRenderer.invoke('db:undislikeTrack', trackId),
  getDislikedTrackIds: () => ipcRenderer.invoke('db:getDislikedTrackIds'),

  // SQLite - Listening History
  addListeningHistory: (track: any) => ipcRenderer.invoke('db:addListeningHistory', track),
  getListeningHistory: (limit?: number, uniqueTracks?: boolean) =>
    ipcRenderer.invoke('db:getListeningHistory', limit, uniqueTracks),
  clearListeningHistory: () => ipcRenderer.invoke('db:clearListeningHistory'),

  onTrackLoudness: (callback) => {
    const handler = (_event: unknown, data: { trackId: string | number; gainDb: number }) =>
      callback(data);
    ipcRenderer.on('music:trackLoudness', handler);
    return () => ipcRenderer.removeListener('music:trackLoudness', handler);
  },
  onYouTubeSessionReset: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('music:youtubeSessionReset', handler);
    return () => ipcRenderer.removeListener('music:youtubeSessionReset', handler);
  },
  onSharedListenTrack: (callback) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      track: import('../../shared/types').Track,
    ) => callback(track);
    ipcRenderer.on('listen:track', handler);
    void ipcRenderer.invoke('listen:ready');
    return () => ipcRenderer.removeListener('listen:track', handler);
  },

  // Discord Rich Presence
  updateDiscordRpc: (data: any) => ipcRenderer.invoke('discord:updateActivity', data),
  clearDiscordRpc: () => ipcRenderer.invoke('discord:clearActivity'),
  toggleDiscordRpc: (enabled: boolean) => ipcRenderer.invoke('discord:toggleRpc', enabled),

  // SQLite - Backup & Restore
  exportDatabase: () => ipcRenderer.invoke('db:exportDatabase'),
  startLanSync: () => ipcRenderer.invoke('sync:start'),
  stopLanSync: () => ipcRenderer.invoke('sync:stop'),
  getLanSyncStatus: () => ipcRenderer.invoke('sync:status'),
  getLanImportRequest: () => ipcRenderer.invoke('sync:pendingImport'),
  respondLanImport: (id, accepted) => ipcRenderer.invoke('sync:respondImport', id, accepted),
  onLanImportRequest: (callback) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      request: import('../../shared/types').LanImportRequest | null,
    ) => callback(request);
    ipcRenderer.on('sync:importRequest', handler);
    return () => ipcRenderer.removeListener('sync:importRequest', handler);
  },
  onLanSyncImported: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('sync:imported', handler);
    return () => ipcRenderer.removeListener('sync:imported', handler);
  },
  importDatabase: () => ipcRenderer.invoke('db:importDatabase'),

  // Video Wallpaper (Desktop custom themes)
  selectWallpaperVideo: () => ipcRenderer.invoke('wallpaper:selectVideo'),

  // Listening Stats & Smart Playlists
  getStats: () => ipcRenderer.invoke('db:getStats'),
  getSmartPlaylist: (kind: string) => ipcRenderer.invoke('db:getSmartPlaylist', kind),

  // Zapret DPI Integration (Flowseal/zapret-discord-youtube)
  findZapretConfig: () => ipcRenderer.invoke('app:findZapret'),
  applyZapretDomains: () => ipcRenderer.invoke('app:applyZapret'),
  selectZapretFile: () => ipcRenderer.invoke('app:selectZapretFile'),
};

contextBridge.exposeInMainWorld('electronAPI', api);
