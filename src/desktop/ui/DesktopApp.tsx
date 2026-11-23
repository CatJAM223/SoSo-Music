import { useAppUpdateNotice } from './hooks/useAppUpdateNotice';
import { useListeningRoomPlayback } from './hooks/useListeningRoomPlayback';
import { AppUpdateNotice } from './components/AppUpdateNotice';
import { useLocale } from '../../shared/i18n/useLocale';
import { t } from '../../shared/i18n/locale';
import React, {
  useState,
  useEffect,
  useLayoutEffect,
  useReducer,
  useCallback,
  useRef,
  lazy,
  Suspense,
} from 'react';
import { YouTubeAccessDialog } from './components/YouTubeAccessDialog';
import { DesktopConnectionDialogs } from './components/DesktopConnectionDialogs';
import { TitleBar } from './components/TitleBar';
import { Sidebar } from './components/Sidebar';
import { PlayerBar } from './components/PlayerBar';
import { QueueDrawer } from './components/QueueDrawer';
import { CreatePlaylistModal } from './components/modals/CreatePlaylistModal';
import { AddToPlaylistModal } from './components/modals/AddToPlaylistModal';
import { SnippetModal } from './components/SnippetModal';
import { OnboardingTour } from './components/OnboardingTour';
import { DiscoverView } from './pages/DiscoverView';
import { Track } from '../../shared/types';
import type { ArtistDestination, NavigateToArtist } from '../../shared/types/artistNavigation';
import { useAudioState } from '../../shared/context/AudioContext';
import { isYouTubePlaybackDisabled } from '../../shared/services/youtubeAvailability';
import { parseMultiArtists } from '../../shared/utils/artistParser';
import { MultiArtistModal } from './components/modals/MultiArtistModal';
import { CursorGlow } from './components/CursorGlow';
import { ErrorBoundary } from '../../shared/components/ErrorBoundary';
import { useTheme } from '../../shared/context/ThemeContext';
import {
  initialNavigationHistory,
  navigationHistoryReducer,
  type HistoryEntry,
  type SearchPageState,
  type MyMusicPageState,
} from './navigationHistory';

import { CatLoader } from './components/CatLoader';

const SakuraFallingPetals = lazy(() =>
  import('./components/SakuraFallingPetals').then((module) => ({
    default: module.SakuraFallingPetals,
  })),
);
const WeatherEffects = lazy(() =>
  import('./components/WeatherEffects').then((module) => ({ default: module.WeatherEffects })),
);
const BlackHoleBackground = lazy(() =>
  import('./components/BlackHoleBackground').then((module) => ({
    default: module.BlackHoleBackground,
  })),
);
const WallpaperBackground = lazy(() =>
  import('./components/WallpaperBackground').then((module) => ({
    default: module.WallpaperBackground,
  })),
);
const ListeningSceneBackground = lazy(() =>
  import('./components/ListeningSceneBackground').then((module) => ({
    default: module.ListeningSceneBackground,
  })),
);

const SettingsModal = lazy(() =>
  import('./components/modals/SettingsModal').then((module) => ({ default: module.SettingsModal })),
);
const LyricsModal = lazy(() =>
  import('./components/LyricsModal').then((module) => ({ default: module.LyricsModal })),
);
const ChartsView = lazy(() =>
  import('./pages/ChartsView').then((module) => ({ default: module.ChartsView })),
);
const SearchView = lazy(() =>
  import('./pages/SearchView').then((module) => ({ default: module.SearchView })),
);
const MyMusicView = lazy(() =>
  import('./pages/MyMusicView').then((module) => ({ default: module.MyMusicView })),
);
const PlaylistView = lazy(() =>
  import('./pages/PlaylistView').then((module) => ({ default: module.PlaylistView })),
);
const GenresView = lazy(() =>
  import('./pages/GenresView').then((module) => ({ default: module.GenresView })),
);
const ListeningRoomView = lazy(() =>
  import('./pages/ListeningRoomView').then((module) => ({ default: module.ListeningRoomView })),
);
const ArtistView = lazy(() =>
  import('./pages/ArtistView').then((module) => ({ default: module.ArtistView })),
);
const AlbumView = lazy(() =>
  import('./pages/AlbumView').then((module) => ({ default: module.AlbumView })),
);

export const DesktopApp: React.FC = () => {
  useListeningRoomPlayback();
  useLocale();
  const { themePreset } = useTheme();
  const { currentTrack, isPlaying } = useAudioState();
  const { update: availableUpdate, dismiss: dismissUpdate } = useAppUpdateNotice();

  useEffect(() => {
    const warmup = requestIdleCallback(
      () => {
        if (navigator.onLine && !isYouTubePlaybackDisabled()) {
          void window.electronAPI?.warmYouTubePlayback?.().catch(() => {});
        }
      },
      { timeout: 750 },
    );
    return () => cancelIdleCallback(warmup);
  }, []);

  // Navigation History Stack
  const [navigation, dispatchNavigation] = useReducer(
    navigationHistoryReducer,
    initialNavigationHistory,
  );
  const history = navigation.entries;
  const historyIndex = navigation.index;
  const currentEntry = history[historyIndex];
  const mainRef = useRef<HTMLElement | null>(null);
  const pageContentRef = useRef<HTMLDivElement | null>(null);
  const currentView = currentEntry.view;
  const currentPlaylist = currentEntry.playlist || null;
  const selectedArtist = currentEntry.artist || null;
  const selectedAlbum = currentEntry.album || null;
  const searchQuery = currentEntry.searchQuery || '';
  const saveScroll = useCallback(() => {
    dispatchNavigation({
      type: 'snapshot',
      id: currentEntry.id,
      page: { scrollTop: mainRef.current?.scrollTop || 0 },
    });
  }, [currentEntry.id]);
  const saveSearchState = useCallback(
    (search: SearchPageState) => {
      dispatchNavigation({ type: 'snapshot', id: currentEntry.id, page: { search } });
    },
    [currentEntry.id],
  );
  const saveMusicState = useCallback(
    (music: MyMusicPageState) => {
      dispatchNavigation({ type: 'snapshot', id: currentEntry.id, page: { music } });
    },
    [currentEntry.id],
  );
  const savePlaylistQuery = useCallback(
    (playlistQuery: string) => {
      dispatchNavigation({ type: 'snapshot', id: currentEntry.id, page: { playlistQuery } });
    },
    [currentEntry.id],
  );

  const scrollTarget = currentEntry.page?.scrollTop || 0;
  useLayoutEffect(() => {
    const main = mainRef.current;
    const content = pageContentRef.current;
    if (!main || !content) return;
    let observer: ResizeObserver | undefined;
    const stop = () => {
      observer?.disconnect();
      for (const event of ['wheel', 'touchstart', 'pointerdown', 'keydown'])
        main.removeEventListener(event, stop, true);
    };
    const restore = () => {
      main.scrollTop = scrollTarget;
      if (main.scrollHeight - main.clientHeight >= scrollTarget) stop();
    };
    observer = new ResizeObserver(restore);
    observer.observe(content);
    for (const event of ['wheel', 'touchstart', 'pointerdown', 'keydown'])
      main.addEventListener(event, stop, { capture: true, passive: true });
    restore();
    return stop;
  }, [currentEntry.id, scrollTarget]);

  // Modals & Drawers
  const [isCreatePlaylistOpen, setIsCreatePlaylistOpen] = useState<boolean>(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<'general' | 'integrations'>(
    'general',
  );
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [isLyricsOpen, setIsLyricsOpen] = useState<boolean>(false);
  const [trackForPlaylist, setTrackForPlaylist] = useState<Track | null>(null);
  const [isQueueOpen, setIsQueueOpen] = useState<boolean>(false);
  const [refreshPlaylistsTrigger, setRefreshPlaylistsTrigger] = useState<number>(0);

  // First-time Onboarding & Interactive Tour
  const [isOnboardingOpen, setIsOnboardingOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem('soso_onboarding_completed') !== 'true';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    const handleRestartTour = () => setIsOnboardingOpen(true);
    window.addEventListener('soso:restart-tour', handleRestartTour);
    return () => window.removeEventListener('soso:restart-tour', handleRestartTour);
  }, []);

  const handleNavigate = (view: string, artistData?: any, albumData?: any, playlistData?: any) => {
    const newEntry: Omit<HistoryEntry, 'id'> = { view };
    if (view === 'artist') {
      newEntry.artist = artistData;
    } else if (view === 'album') {
      newEntry.album = albumData || artistData;
    } else if (view.startsWith('playlist_')) {
      const plId = view.replace('playlist_', '');
      newEntry.playlist = playlistData || artistData || { id: plId, name: t('Плейлист') };
    } else if (view === 'search') {
      newEntry.searchQuery =
        artistData?.query || (typeof artistData === 'string' ? artistData : '');
    } else if (view === 'liked' || view === 'my-music') {
      if (artistData?.tab) {
        newEntry.initialTab = artistData.tab;
      }
    }

    saveScroll();
    dispatchNavigation({ type: 'navigate', entry: newEntry });
  };

  const goBack = useCallback(() => {
    saveScroll();
    dispatchNavigation({ type: 'back' });
  }, [saveScroll]);

  const goForward = useCallback(() => {
    saveScroll();
    dispatchNavigation({ type: 'forward' });
  }, [saveScroll]);

  const goBackRef = useRef(goBack);
  goBackRef.current = goBack;
  const goForwardRef = useRef(goForward);
  goForwardRef.current = goForward;

  const lastNavTimeRef = useRef<number>(0);
  const triggerBack = useCallback(() => {
    const now = Date.now();
    if (now - lastNavTimeRef.current < 250) return;
    lastNavTimeRef.current = now;
    goBackRef.current();
  }, []);

  const triggerForward = useCallback(() => {
    const now = Date.now();
    if (now - lastNavTimeRef.current < 250) return;
    lastNavTimeRef.current = now;
    goForwardRef.current();
  }, []);

  // Global Mouse Side Buttons (Mouse 4 = Back, Mouse 5 = Forward) & Keyboard Shortcuts
  useEffect(() => {
    // 1. Electron Native OS AppCommand listener (Windows MM mouse events)
    const unbindBack = window.electronAPI?.onNavBack?.(() => {
      triggerBack();
    });
    const unbindForward = window.electronAPI?.onNavForward?.(() => {
      triggerForward();
    });

    // 2. DOM Mouseup listener for mouse buttons 3 (Back) and 4 (Forward)
    const handleMouseNav = (e: MouseEvent) => {
      if (e.button === 3) {
        // Mouse button 4 / Back (e.button is 3 in 0-indexed DOM standard)
        e.preventDefault();
        e.stopPropagation();
        triggerBack();
      } else if (e.button === 4) {
        // Mouse button 5 / Forward (e.button is 4 in 0-indexed DOM standard)
        e.preventDefault();
        e.stopPropagation();
        triggerForward();
      }
    };

    // 3. Keyboard shortcuts: Alt+Left / Alt+Right / BrowserBack / BrowserForward
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.altKey && e.key === 'ArrowLeft') || e.key === 'BrowserBack') {
        e.preventDefault();
        triggerBack();
      } else if ((e.altKey && e.key === 'ArrowRight') || e.key === 'BrowserForward') {
        e.preventDefault();
        triggerForward();
      }
    };

    window.addEventListener('mouseup', handleMouseNav);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      if (typeof unbindBack === 'function') unbindBack();
      if (typeof unbindForward === 'function') unbindForward();
      window.removeEventListener('mouseup', handleMouseNav);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [triggerBack, triggerForward]);

  const [artistPicker, setArtistPicker] = useState<{
    artists: ArtistDestination[];
    beforeNavigation?: () => void;
  } | null>(null);

  const handleOpenAddToPlaylist = (track: Track) => {
    setTrackForPlaylist(track);
  };

  const handleNavigateToArtist: NavigateToArtist = (artist, choices, beforeNavigation) => {
    const parsed = choices ?? parseMultiArtists(artist.name).map((name) => ({ name }));

    if (parsed.length > 1) {
      setArtistPicker({ artists: parsed, beforeNavigation });
    } else {
      beforeNavigation?.();
      handleNavigate('artist', artist);
    }
  };

  const handleNavigateToAlbum = (album: any) => {
    handleNavigate('album', null, album);
  };

  const handlePlaylistCreated = () => {
    setRefreshPlaylistsTrigger((prev) => prev + 1);
  };

  return (
    <div
      className={`flex flex-col h-screen w-screen ${
        ['wallpaper', 'blackhole', 'nighttrain', 'cassette'].includes(themePreset)
          ? 'bg-transparent'
          : 'bg-[#f8fafc] dark:bg-[#121212]'
      } text-slate-900 dark:text-slate-100 select-none overflow-hidden font-sans`}
    >
      {/* Interactive Cursor Spotlight Glow */}
      <ErrorBoundary mode="silent" name="CursorGlow">
        <CursorGlow />
      </ErrorBoundary>

      <ErrorBoundary key={themePreset} mode="silent" name="ThemeBackground">
        <Suspense fallback={null}>
          {themePreset === 'sakura' && <SakuraFallingPetals />}
          {themePreset === 'weather' && <WeatherEffects />}
          {themePreset === 'blackhole' && <BlackHoleBackground />}
          {themePreset === 'wallpaper' && <WallpaperBackground />}
          {(themePreset === 'nighttrain' || themePreset === 'cassette') && (
            <ListeningSceneBackground />
          )}
        </Suspense>
      </ErrorBoundary>
      <div className="flex flex-1 min-h-0 relative overflow-hidden z-10">
        <Sidebar
          currentView={currentView}
          onNavigate={handleNavigate}
          onOpenCreatePlaylist={() => setIsCreatePlaylistOpen(true)}
          onOpenSettings={() => {
            setSettingsInitialTab('general');
            setIsSettingsOpen(true);
          }}
          refreshPlaylistsTrigger={refreshPlaylistsTrigger}
        />

        <div className="flex-1 flex flex-col min-w-0 bg-[#ffffff] dark:bg-[#18181b] overflow-hidden">
          {/* Frameless Desktop Window Title Bar (Header of main workspace) */}
          <TitleBar
            canGoBack={historyIndex > 0}
            canGoForward={historyIndex < history.length - 1}
            onGoBack={goBack}
            onGoForward={goForward}
            currentView={currentView}
            currentPageLabel={
              currentView.startsWith('playlist_') && currentPlaylist?.name
                ? currentPlaylist.name
                : currentView === 'artist' && selectedArtist?.name
                  ? selectedArtist.name
                  : currentView === 'album' && selectedAlbum?.title
                    ? selectedAlbum.title
                    : undefined
            }
          />

          <main
            ref={mainRef}
            className="flex-1 overflow-y-auto overflow-x-hidden relative px-6 md:px-8 py-6"
          >
            <div ref={pageContentRef} key={currentEntry.id} className="soso-view-enter">
              <ErrorBoundary key={currentEntry.id} name="MainContent" mode="inline">
                <Suspense fallback={<CatLoader size="sm" message={t('Загрузка…')} />}>
                  {currentView === 'discover' && (
                    <DiscoverView
                      onNavigate={handleNavigate}
                      onNavigateToArtist={handleNavigateToArtist}
                      onNavigateToAlbum={handleNavigateToAlbum}
                    />
                  )}

                  {currentView === 'charts' && (
                    <ChartsView
                      onOpenAddToPlaylist={handleOpenAddToPlaylist}
                      onNavigateToArtist={handleNavigateToArtist}
                      onNavigateToAlbum={handleNavigateToAlbum}
                    />
                  )}

                  {currentView === 'search' && (
                    <SearchView
                      initialQuery={searchQuery}
                      initialState={currentEntry.page?.search}
                      onStateChange={saveSearchState}
                      onOpenAddToPlaylist={handleOpenAddToPlaylist}
                      onNavigateToArtist={handleNavigateToArtist}
                      onNavigateToAlbum={handleNavigateToAlbum}
                    />
                  )}

                  {currentView === 'genres' && (
                    <GenresView
                      onOpenAddToPlaylist={handleOpenAddToPlaylist}
                      onNavigateToArtist={handleNavigateToArtist}
                      onNavigateToAlbum={handleNavigateToAlbum}
                    />
                  )}

                  {currentView === 'listening-room' && (
                    <ListeningRoomView onNavigate={handleNavigate} />
                  )}

                  {(currentView === 'my-music' || currentView === 'liked') && (
                    <MyMusicView
                      initialTab={currentEntry.initialTab || 'tracks'}
                      initialState={currentEntry.page?.music}
                      onStateChange={saveMusicState}
                      onOpenAddToPlaylist={handleOpenAddToPlaylist}
                      onNavigateToArtist={handleNavigateToArtist}
                      onNavigateToAlbum={handleNavigateToAlbum}
                      onNavigate={handleNavigate}
                      onOpenCreatePlaylist={() => setIsCreatePlaylistOpen(true)}
                      onOpenSettings={() => {
                        setSettingsInitialTab('general');
                        setIsSettingsOpen(true);
                      }}
                      refreshPlaylistsTrigger={refreshPlaylistsTrigger}
                    />
                  )}

                  {currentView === 'artist' && selectedArtist && (
                    <ArtistView
                      artistQuery={selectedArtist.id || selectedArtist.name || ''}
                      artistName={selectedArtist.name}
                      artistSource={
                        selectedArtist.source ||
                        (String(selectedArtist.id || '').startsWith('yt_') ? 'youtube' : undefined)
                      }
                      onOpenAddToPlaylist={handleOpenAddToPlaylist}
                      onNavigateToArtist={handleNavigateToArtist}
                      onNavigateToAlbum={handleNavigateToAlbum}
                    />
                  )}

                  {currentView === 'album' && selectedAlbum && (
                    <AlbumView
                      album={selectedAlbum}
                      onOpenAddToPlaylist={handleOpenAddToPlaylist}
                      onNavigateToArtist={handleNavigateToArtist}
                      onNavigateToAlbum={handleNavigateToAlbum}
                    />
                  )}

                  {currentView.startsWith('playlist_') && (
                    <PlaylistView
                      playlist={
                        currentPlaylist || {
                          id: currentView.replace('playlist_', ''),
                          name: t('Плейлист'),
                        }
                      }
                      initialQuery={currentEntry.page?.playlistQuery}
                      onQueryChange={savePlaylistQuery}
                      onOpenAddToPlaylist={handleOpenAddToPlaylist}
                      onNavigateToArtist={handleNavigateToArtist}
                      onNavigateToAlbum={handleNavigateToAlbum}
                      onNavigateToSearch={(q) => handleNavigate('search', q || '')}
                      onPlaylistDeleted={() => {
                        setRefreshPlaylistsTrigger((prev) => prev + 1);
                        handleNavigate('discover');
                      }}
                    />
                  )}
                </Suspense>
              </ErrorBoundary>
            </div>
          </main>
        </div>

        {/* Desktop Queue Drawer */}
        <QueueDrawer isOpen={isQueueOpen} onClose={() => setIsQueueOpen(false)} />
      </div>

      {/* Bottom Desktop Player Bar — always visible so new users see controls and the "pick a track" hint */}
      <div className="app-update-anchor">
        <PlayerBar
          isQueueOpen={isQueueOpen}
          onToggleQueue={() => setIsQueueOpen((prev) => !prev)}
          isLyricsOpen={isLyricsOpen}
          onToggleLyrics={() => setIsLyricsOpen((prev) => !prev)}
          onNavigateToArtist={handleNavigateToArtist}
          onOpenAddToPlaylist={handleOpenAddToPlaylist}
        />
        {availableUpdate && (
          <AppUpdateNotice
            key={availableUpdate.latestVersion}
            update={availableUpdate}
            onDismiss={dismissUpdate}
          />
        )}
      </div>
      <DesktopConnectionDialogs />
      <YouTubeAccessDialog
        currentTrackId={currentTrack?.id}
        isPlaying={isPlaying}
        onOpenAccountSettings={() => {
          setIsLyricsOpen(false);
          setSettingsInitialTab('integrations');
          setIsSettingsOpen(true);
        }}
      />

      {/* Desktop Modals */}
      <CreatePlaylistModal
        isOpen={isCreatePlaylistOpen}
        onClose={() => setIsCreatePlaylistOpen(false)}
        onPlaylistCreated={handlePlaylistCreated}
      />

      <AddToPlaylistModal
        isOpen={trackForPlaylist !== null}
        track={trackForPlaylist}
        onClose={() => setTrackForPlaylist(null)}
        onOpenCreatePlaylist={() => {
          setTrackForPlaylist(null);
          setIsCreatePlaylistOpen(true);
        }}
      />

      {/* Snippet Preview Modal */}
      <SnippetModal onNavigateToArtist={handleNavigateToArtist} />

      {/* Karaoke Lyrics Modal */}
      <ErrorBoundary name="LyricsModal">
        <Suspense fallback={null}>
          {isLyricsOpen && (
            <LyricsModal isOpen={isLyricsOpen} onClose={() => setIsLyricsOpen(false)} />
          )}
        </Suspense>
      </ErrorBoundary>

      {/* Settings Modal */}
      <Suspense fallback={null}>
        {isSettingsOpen && (
          <SettingsModal
            key={settingsInitialTab}
            initialTab={settingsInitialTab}
            isOpen={isSettingsOpen}
            onClose={() => {
              setIsSettingsOpen(false);
              if (settingsInitialTab !== 'integrations') return;
              requestAnimationFrame(() => {
                if (
                  document.activeElement === document.body &&
                  !document.querySelector('dialog:modal')
                ) {
                  document.querySelector<HTMLButtonElement>('[data-tour="settings-nav"]')?.focus();
                }
              });
            }}
          />
        )}
      </Suspense>

      {/* Multi-Artist Selection Modal */}
      {artistPicker && (
        <MultiArtistModal
          artists={artistPicker.artists}
          onClose={() => setArtistPicker(null)}
          onSelectArtist={(selected) => {
            artistPicker.beforeNavigation?.();
            handleNavigate('artist', selected);
          }}
        />
      )}

      {/* First-time Onboarding & Feature Spotlight Tour */}
      <OnboardingTour isOpen={isOnboardingOpen} onClose={() => setIsOnboardingOpen(false)} />
    </div>
  );
};
