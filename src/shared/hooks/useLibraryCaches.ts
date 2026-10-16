import { useCallback, useEffect, useState } from 'react';
import { platformBridge } from '../bridge/platformBridge';
import { offlineCacheService, subscribeOfflineCacheChanges } from '../services/offlineCacheService';

interface LibraryCachesState {
  likedTrackIds: Set<string>;
  dislikedTrackIds: Set<string>;
  savedAlbumIds: Set<string>;
  followedArtistIds: Set<string>;
  cachedTrackIds: Set<string>;
}

let globalState: LibraryCachesState = {
  likedTrackIds: new Set(),
  dislikedTrackIds: new Set(),
  savedAlbumIds: new Set(),
  followedArtistIds: new Set(),
  cachedTrackIds: new Set(),
};

const listeners = new Set<() => void>();

function notifyListeners() {
  listeners.forEach((listener) => {
    try {
      listener();
    } catch {}
  });
}

let isInitialLoadingStarted = false;
type MembershipUpdate = Set<string> | ((previous: Set<string>) => Set<string>);

/** Each collection rejects snapshots taken before its latest committed mutation. */
function membershipCache(key: keyof LibraryCachesState, read: () => Promise<Set<string>>) {
  let version = 0;
  let inFlight = 0;
  const refresh = async () => {
    const request = ++version;
    inFlight++;
    try {
      const ids = await read();
      if (request !== version) return;
      globalState[key] = ids;
      notifyListeners();
    } catch (error) {
      console.error('Error refreshing library membership (' + key + '):', error);
    } finally {
      inFlight--;
    }
  };
  const set = (value: MembershipUpdate) => {
    version++;
    globalState[key] = typeof value === 'function' ? value(globalState[key]) : value;
    notifyListeners();
    // Recover unchanged members too if the initial snapshot was invalidated.
    if (inFlight > 0) void refresh();
  };
  return { refresh, set };
}

function trackIds(values: (string | number)[]): Set<string> {
  const ids = new Set<string>();
  for (const value of values) {
    const raw = String(value),
      clean = raw.replace(/^dz_/, '');
    [raw, clean, 'dz_' + clean].forEach((id) => ids.add(id));
  }
  return ids;
}
const liked = membershipCache('likedTrackIds', async () =>
  trackIds((await platformBridge.getLikedTrackIds()) || []),
);
const disliked = membershipCache('dislikedTrackIds', async () =>
  trackIds((await platformBridge.getDislikedTrackIds()) || []),
);
const saved = membershipCache('savedAlbumIds', async () => {
  const ids = new Set<string>();
  for (const albumId of (await platformBridge.getSavedAlbumIds()) || []) ids.add(String(albumId));
  return ids;
});
const followed = membershipCache('followedArtistIds', async () => {
  const ids = new Set<string>();
  for (const artist of (await platformBridge.getArtistMembership()) || []) {
    if (artist.id) ids.add(String(artist.id));
    if (artist.name) ids.add(String(artist.name).toLowerCase());
  }
  return ids;
});
const cached = membershipCache('cachedTrackIds', async () => {
  const ids = new Set<string>();
  for (const item of (await offlineCacheService.getAllCachedTracks()) || []) {
    const raw = String(item.trackId),
      clean = raw.replace(/^(dz_|sc_|yt_|ym_|ya_)/i, '');
    [raw, clean, 'dz_' + clean, 'sc_' + clean, 'yt_' + clean].forEach((id) => ids.add(id));
  }
  return ids;
});
const refreshLikedTracksGlobal = liked.refresh;
const refreshDislikedTracksGlobal = disliked.refresh;
const refreshSavedAlbumsGlobal = saved.refresh;
const refreshFollowedArtistsGlobal = followed.refresh;
const refreshCachedTracksGlobal = cached.refresh;
let unsubscribeOfflineChanges: (() => void) | undefined;

export function useLibraryCaches() {
  const [state, setState] = useState<LibraryCachesState>(globalState);

  useEffect(() => {
    const listener = () => setState({ ...globalState });
    listeners.add(listener);
    listener();
    if (listeners.size === 1)
      unsubscribeOfflineChanges = subscribeOfflineCacheChanges(() => {
        void refreshCachedTracksGlobal();
      });

    if (!isInitialLoadingStarted) {
      isInitialLoadingStarted = true;
      refreshLikedTracksGlobal();
      refreshDislikedTracksGlobal();
      refreshSavedAlbumsGlobal();
      refreshFollowedArtistsGlobal();
      refreshCachedTracksGlobal();
    }

    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        unsubscribeOfflineChanges?.();
        unsubscribeOfflineChanges = undefined;
      }
    };
  }, []);

  const setLikedTrackIds = useCallback(liked.set, []);
  const setDislikedTrackIds = useCallback(disliked.set, []);
  const setSavedAlbumIds = useCallback(saved.set, []);
  const setFollowedArtistIds = useCallback(followed.set, []);
  const setCachedTrackIds = useCallback(cached.set, []);

  return {
    likedTrackIds: state.likedTrackIds,
    dislikedTrackIds: state.dislikedTrackIds,
    savedAlbumIds: state.savedAlbumIds,
    followedArtistIds: state.followedArtistIds,
    cachedTrackIds: state.cachedTrackIds,
    setLikedTrackIds,
    setDislikedTrackIds,
    setSavedAlbumIds,
    setFollowedArtistIds,
    setCachedTrackIds,
    refreshLikedTracks: refreshLikedTracksGlobal,
    refreshDislikedTracks: refreshDislikedTracksGlobal,
    refreshSavedAlbums: refreshSavedAlbumsGlobal,
    refreshFollowedArtists: refreshFollowedArtistsGlobal,
    refreshCachedTracks: refreshCachedTracksGlobal,
  };
}
