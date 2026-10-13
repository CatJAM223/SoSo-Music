import { isYouTubeItemDisabled } from '../services/youtubeAvailability.ts';
import { useCallback } from 'react';
import type { Track } from '../types';
import { platformBridge } from '../bridge/platformBridge';
import { detectTrackSource } from '../utils/formatters';
import { offlineCacheService } from '../services/offlineCacheService';
import {
  getOfflineDownloadProgress,
  setOfflineDownloadProgress,
} from '../services/offlineDownloadProgress';
import { emitToast } from '../context/ToastContext';
import { useLibraryCaches } from './useLibraryCaches';

interface UseLibraryManagerParams {
  currentTrackRef?: React.MutableRefObject<Track | null>;
  nextTrack?: () => void;
  onDislike?: (track: Track) => void;
  onLike?: (track: Track) => void;
}

export function useLibraryManager({
  currentTrackRef,
  nextTrack,
  onDislike,
  onLike,
}: UseLibraryManagerParams = {}) {
  const {
    likedTrackIds,
    dislikedTrackIds,
    savedAlbumIds,
    followedArtistIds,
    cachedTrackIds,
    setLikedTrackIds,
    setDislikedTrackIds,
    setSavedAlbumIds,
    setFollowedArtistIds,
    setCachedTrackIds,
    refreshLikedTracks,
    refreshDislikedTracks,
    refreshSavedAlbums,
    refreshFollowedArtists,
    refreshCachedTracks,
  } = useLibraryCaches();

  // Toggle Like
  const toggleLike = useCallback(
    async (track: Track): Promise<boolean> => {
      try {
        const deezerId = String(track.id);
        const cleanId = deezerId.replace(/^dz_/, '');
        const isCurrentlyLiked =
          likedTrackIds.has(deezerId) ||
          likedTrackIds.has(cleanId) ||
          likedTrackIds.has(`dz_${cleanId}`);

        let cover =
          track.album?.cover_xl ||
          track.album?.cover_big ||
          track.album?.cover_medium ||
          track.album?.cover ||
          track.album?.cover_small ||
          (typeof track.artist === 'object'
            ? (track.artist as any)?.picture_xl ||
              (track.artist as any)?.picture_big ||
              (track.artist as any)?.picture_medium ||
              (track.artist as any)?.picture
            : '') ||
          track.cover_url ||
          (track as any).cover ||
          '';

        if (cover.includes('sndcdn.com') && cover.includes('-large.')) {
          cover = cover.replace('-large.', '-t500x500.');
        }

        const res: any = await platformBridge.toggleLikeTrack({
          ...track,
          deezer_id: deezerId,
          title: track.title,
          artist:
            typeof track.artist === 'object'
              ? track.artist?.name || 'Unknown Artist'
              : String(track.artist || 'Unknown Artist'),
          album:
            typeof track.album === 'object' ? track.album?.title || '' : String(track.album || ''),
          album_id:
            typeof track.album === 'object' && track.album?.id ? String(track.album.id) : undefined,
          cover_url: cover,
          preview_url: track.preview || '',
          duration: track.duration || 180,
          source: detectTrackSource(track),
        } as any);

        const isNowLiked =
          typeof res === 'boolean'
            ? res
            : typeof res?.liked === 'boolean'
              ? res.liked
              : !isCurrentlyLiked;

        setLikedTrackIds((prev) => {
          const next = new Set(prev);
          if (isNowLiked) {
            next.add(deezerId);
            next.add(cleanId);
          } else {
            next.delete(deezerId);
            next.delete(cleanId);
            next.delete(`dz_${cleanId}`);
          }
          return next;
        });

        if (isNowLiked) {
          onLike?.(track);
          // Mutual exclusivity: if track is now liked, remove it from disliked
          setDislikedTrackIds((prev) => {
            const next = new Set(prev);
            next.delete(deezerId);
            next.delete(cleanId);
            next.delete(`dz_${cleanId}`);
            return next;
          });
          if (platformBridge?.undislikeTrack) {
            platformBridge.undislikeTrack(track.id).catch(() => {});
          }
        }

        return isNowLiked;
      } catch (e) {
        console.error('Error toggling like:', e);
        return false;
      }
    },
    [likedTrackIds, onLike, setLikedTrackIds, setDislikedTrackIds],
  );

  // Toggle Save Album
  const toggleSaveAlbum = useCallback(
    async (album: any): Promise<boolean> => {
      try {
        const albumId = String(album.id || album.album_id);
        const isCurrentlySaved = savedAlbumIds.has(albumId);

        const res: any = await platformBridge.toggleSaveAlbum({
          id: albumId,
          title: album.title || '',
          artist_name:
            album.artist_name ||
            (typeof album.artist === 'object' ? album.artist?.name : album.artist) ||
            '',
          artist: album.artist,
          cover_url:
            album.cover_url ||
            album.cover_xl ||
            album.cover_big ||
            album.cover_medium ||
            album.cover ||
            '',
          release_date: album.release_date,
          record_type: album.record_type,
          track_count: album.track_count,
        });

        const isNowSaved =
          typeof res === 'boolean'
            ? res
            : typeof res?.saved === 'boolean'
              ? res.saved
              : !isCurrentlySaved;

        setSavedAlbumIds((prev) => {
          const next = new Set(prev);
          if (isNowSaved) {
            next.add(albumId);
          } else {
            next.delete(albumId);
          }
          return next;
        });

        return isNowSaved;
      } catch (e) {
        console.error('Error toggling save album:', e);
        return false;
      }
    },
    [savedAlbumIds, setSavedAlbumIds],
  );

  const isAlbumSaved = useCallback(
    (albumId: string | number): boolean => {
      return savedAlbumIds.has(String(albumId));
    },
    [savedAlbumIds],
  );

  // Toggle Follow Artist
  const toggleFollowArtist = useCallback(
    async (artist: any): Promise<boolean> => {
      try {
        const artistId = String(artist.id || artist.artist_id || artist.name);
        const artistNameLower = artist.name ? String(artist.name).toLowerCase() : '';
        const isCurrentlyFollowed =
          followedArtistIds.has(artistId) ||
          (artistNameLower ? followedArtistIds.has(artistNameLower) : false);

        const res: any = await platformBridge.toggleFollowArtist({
          id: artist.id || artist.artist_id,
          name: artist.name,
          picture_url:
            artist.picture_url ||
            artist.picture_big ||
            artist.picture_medium ||
            artist.picture ||
            '',
        });

        const isNowFollowed =
          typeof res === 'boolean'
            ? res
            : typeof res?.followed === 'boolean'
              ? res.followed
              : !isCurrentlyFollowed;

        setFollowedArtistIds((prev) => {
          const next = new Set(prev);
          if (isNowFollowed) {
            next.add(artistId);
            if (artistNameLower) next.add(artistNameLower);
          } else {
            next.delete(artistId);
            if (artistNameLower) next.delete(artistNameLower);
          }
          return next;
        });

        return isNowFollowed;
      } catch (e) {
        console.error('Error toggling follow artist:', e);
        return false;
      }
    },
    [followedArtistIds, setFollowedArtistIds],
  );

  const isArtistFollowed = useCallback(
    (artistIdOrName: string | number): boolean => {
      const query = String(artistIdOrName);
      return followedArtistIds.has(query) || followedArtistIds.has(query.toLowerCase());
    },
    [followedArtistIds],
  );

  // Dislike Track
  const dislikeTrack = useCallback(
    async (track: Track): Promise<boolean> => {
      try {
        const idStr = String(track.id || (track as any).deezer_id || '');
        const cleanId = idStr.replace(/^dz_/, '');

        if (platformBridge?.dislikeTrack) {
          const committed = await platformBridge.dislikeTrack({
            id: track.id,
            deezer_id: (track as any).deezer_id,
            title: track.title,
            artist: track.artist,
          });
          if (committed === false) return false;
        }

        setDislikedTrackIds((prev) => {
          const next = new Set(prev);
          next.add(idStr);
          next.add(cleanId);
          next.add(`dz_${cleanId}`);
          return next;
        });

        // Storage already removed the favorite; update membership without toggling it.
        setLikedTrackIds((prev) => {
          const next = new Set(prev);
          next.delete(idStr);
          next.delete(cleanId);
          next.delete(`dz_${cleanId}`);
          return next;
        });

        onDislike?.(track);

        // If this track is currently playing, immediately skip to next track
        if (currentTrackRef?.current && String(currentTrackRef.current.id) === idStr) {
          nextTrack?.();
        }

        return true;
      } catch (e) {
        console.error('Error disliking track:', e);
        return false;
      }
    },
    [nextTrack, onDislike, currentTrackRef, setDislikedTrackIds, setLikedTrackIds],
  );

  const undislikeTrack = useCallback(
    async (trackId: string | number): Promise<boolean> => {
      try {
        const idStr = String(trackId);
        const cleanId = idStr.replace(/^dz_/, '');

        if (platformBridge?.undislikeTrack) {
          const committed = await platformBridge.undislikeTrack(trackId);
          if (committed === false) return false;
        }

        setDislikedTrackIds((prev) => {
          const next = new Set(prev);
          next.delete(idStr);
          next.delete(cleanId);
          next.delete(`dz_${cleanId}`);
          return next;
        });

        return true;
      } catch (e) {
        console.error('Error undisliking track:', e);
        return false;
      }
    },
    [setDislikedTrackIds],
  );

  const isTrackDisliked = useCallback(
    (trackId: string | number): boolean => {
      const idStr = String(trackId);
      const cleanId = idStr.replace(/^dz_/, '');
      return (
        dislikedTrackIds.has(idStr) ||
        dislikedTrackIds.has(cleanId) ||
        dislikedTrackIds.has(`dz_${cleanId}`)
      );
    },
    [dislikedTrackIds],
  );

  // Offline caching actions
  const cacheTrackForOffline = useCallback(
    async (track: Track): Promise<boolean> => {
      if (isYouTubeItemDisabled(track)) return false;
      if (getOfflineDownloadProgress(track.id) !== null) return false;
      setOfflineDownloadProgress(track.id, 0.03);
      try {
        emitToast(`Загрузка трека для офлайн доступа: ${track.title}`, 'info', 3000);
        const artistName =
          typeof track.artist === 'object' ? track.artist?.name || '' : String(track.artist || '');
        const source = detectTrackSource(track);
        const downloadTrack = {
          ...track,
          title: track.title,
          artist: { name: artistName },
          id: track.id,
          preview: track.preview,
          duration: track.duration,
          source,
        } as Track;
        // Use a fresh cached URL first. A routine download must not reset active playback connections.
        const streamUrl = await platformBridge.getFullStreamUrl(downloadTrack);

        if (!streamUrl || !streamUrl.startsWith('http')) {
          emitToast('Не удалось получить поток для загрузки', 'error', 3500);
          return false;
        }

        setOfflineDownloadProgress(track.id, 0.12);
        let success = await offlineCacheService.cacheTrack(track, streamUrl, (progress) => {
          setOfflineDownloadProgress(track.id, progress);
        });
        if (!success && source === 'youtube') {
          const rejectedItag = Number(new URL(streamUrl).searchParams.get('itag')) || undefined;
          setOfflineDownloadProgress(track.id, 0.08);
          const alternateUrl = await platformBridge.getFullStreamUrl(downloadTrack, {
            forceRefresh: true,
            preferAlternateFormat: true,
            excludeItag: rejectedItag,
          });
          if (alternateUrl && alternateUrl !== streamUrl) {
            success = await offlineCacheService.cacheTrack(track, alternateUrl, (progress) => {
              setOfflineDownloadProgress(track.id, progress);
            });
          }
        }
        if (success) {
          await refreshCachedTracks();
          emitToast(`Трек «${track.title}» сохранён офлайн!`, 'success', 3500);
          return true;
        } else {
          emitToast(`Ошибка сохранения трека «${track.title}»`, 'error', 3500);
          return false;
        }
      } catch (e) {
        console.error('Error caching track for offline:', e);
        emitToast(`Ошибка загрузки: ${(e as any)?.message || e}`, 'error', 3500);
        return false;
      } finally {
        setOfflineDownloadProgress(track.id, null);
      }
    },
    [refreshCachedTracks],
  );

  const removeOfflineCachedTrack = useCallback(
    async (trackId: string | number): Promise<boolean> => {
      try {
        const res = await offlineCacheService.removeCachedTrack(trackId);
        if (res) {
          await refreshCachedTracks();
          emitToast('Трек удалён из офлайн кэша', 'info', 2500);
        }
        return res;
      } catch (e) {
        console.error('Error removing cached track:', e);
        return false;
      }
    },
    [refreshCachedTracks],
  );

  const isOfflineCached = useCallback(
    (trackId: string | number): boolean => {
      const idStr = String(trackId);
      const cleanId = idStr.replace(/^(dz_|sc_|yt_|ym_|ya_)/i, '');
      return (
        cachedTrackIds.has(idStr) ||
        cachedTrackIds.has(cleanId) ||
        cachedTrackIds.has(`dz_${cleanId}`) ||
        cachedTrackIds.has(`sc_${cleanId}`) ||
        cachedTrackIds.has(`yt_${cleanId}`)
      );
    },
    [cachedTrackIds],
  );

  return {
    // Cache sets
    likedTrackIds,
    dislikedTrackIds,
    savedAlbumIds,
    followedArtistIds,
    cachedTrackIds,
    // Setters
    setLikedTrackIds,
    setDislikedTrackIds,
    setSavedAlbumIds,
    setFollowedArtistIds,
    setCachedTrackIds,
    // Refreshers
    refreshLikedTracks,
    refreshDislikedTracks,
    refreshSavedAlbums,
    refreshFollowedArtists,
    refreshCachedTracks,
    // Likes
    toggleLike,
    // Saved Albums
    toggleSaveAlbum,
    isAlbumSaved,
    // Followed Artists
    toggleFollowArtist,
    isArtistFollowed,
    // Dislikes
    dislikeTrack,
    undislikeTrack,
    isTrackDisliked,
    // Offline Cache
    cacheTrackForOffline,
    removeOfflineCachedTrack,
    isOfflineCached,
  };
}
