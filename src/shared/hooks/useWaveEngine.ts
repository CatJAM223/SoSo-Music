import {
  matchesWaveSource,
  normalizeWaveSource,
  readWaveSource,
  saveWaveSource,
} from '../services/waveSource.ts';
import { readTastePolicy, refreshTastePolicy, useTastePolicy } from './useTastePolicy.ts';
import { isTasteEligible } from '../utils/tastePolicy.ts';
import { createWavePreferences } from '../services/wavePreferences.ts';
import { createWaveSessionState } from '../services/waveSession.ts';
import {
  createWaveRefreshPolicy,
  WAVE_REFRESH_PENDING_LIMIT,
} from '../services/waveRefreshPolicy.ts';
import type { WavePlaybackReason } from '../utils/waveFeedback.ts';
import { isYouTubeItemDisabled } from '../services/youtubeAvailability.ts';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { MusicSource, Track, WaveMood } from '../types/index.ts';
import { platformBridge } from '../bridge/platformBridge.ts';
import { emitToast } from '../context/ToastContext.tsx';
import { matchesDislikedWaveTrack } from '../utils/waveQueue.ts';
import { resequenceWaveQueueInWorker, disposeWaveWorker } from '../compute/waveWorkerClient.ts';
import {
  areSameWaveSong,
  buildWaveSongIdentity,
  getWaveArtistKeys,
  getWaveArtistNames,
} from '../utils/waveIdentity.ts';
import { PlaybackLogger } from '../services/playbackLogger.ts';
import { createWaveMemory } from '../services/waveMemory.ts';
import { normalizeWaveSeed, waveFamiliarArtists } from '../utils/waveRecommendations.ts';
import {
  decayWaveArtistFeedback,
  getWavePlaybackFeedback,
  rememberPositiveWaveTrack,
  reconcileWavePositiveFeedback,
} from '../utils/waveFeedback.ts';

export interface UseWaveEngineOptions {
  queueRef: React.MutableRefObject<Track[]>;
  queueIndexRef: React.MutableRefObject<number>;
  setQueue: React.Dispatch<React.SetStateAction<Track[]>>;
  setQueueIndex: React.Dispatch<React.SetStateAction<number>>;
  playTrackRef: React.MutableRefObject<
    ((track: Track, newQueue?: Track[], fromWave?: boolean) => Promise<void> | void) | null
  >;
}

export function useWaveEngine({
  queueRef,
  queueIndexRef,
  setQueue,
  playTrackRef,
}: UseWaveEngineOptions) {
  const policy = useTastePolicy();
  const eligibleTaste = useCallback(
    (track: Track) => isTasteEligible(track, readTastePolicy()),
    [],
  );
  const [isWaveActive, setIsWaveActive] = useState<boolean>(false);
  const [isWaveStarting, setIsWaveStarting] = useState(false);
  const [waveSource, setWaveSourceState] = useState<MusicSource>(readWaveSource);
  const waveSourceRef = useRef<MusicSource>(waveSource);
  const updateWaveSource = useCallback((source: MusicSource) => {
    waveSourceRef.current = source;
    setWaveSourceState(source);
    saveWaveSource(source);
  }, []);
  const [waveMood, setWaveMood] = useState<WaveMood>('default');
  const isWaveActiveRef = useRef<boolean>(false);
  const waveMoodRef = useRef<WaveMood>('default');
  const isFetchingMoreWaveRef = useRef<boolean>(false);
  const waveRequestIdRef = useRef<number>(0);
  const isWaveStartingRef = useRef(false);
  const restorableWaveRef = useRef<{ active: boolean; mood: WaveMood; source: MusicSource }>({
    active: false,
    mood: 'default',
    source: waveSource,
  });
  const waveSessionsRef = useRef<ReturnType<typeof createWaveSessionState> | null>(null);
  if (!waveSessionsRef.current) waveSessionsRef.current = createWaveSessionState();
  const waveSessions = waveSessionsRef.current;
  const waveSession = useCallback(
    (mood: WaveMood = waveMoodRef.current) => waveSessions.forMode(mood),
    [waveSessions],
  );
  const refreshPolicyRef = useRef<ReturnType<typeof createWaveRefreshPolicy> | null>(null);
  if (!refreshPolicyRef.current) refreshPolicyRef.current = createWaveRefreshPolicy();
  const refreshPolicy = refreshPolicyRef.current;
  const tasteTracksRef = useRef<Track[]>([]);
  const familiarArtistsRef = useRef<string[]>([]);
  const memoryRef = useRef<ReturnType<typeof createWaveMemory> | null>(null);
  if (!memoryRef.current) memoryRef.current = createWaveMemory();
  const waveMemory = memoryRef.current;
  const recentPlayedTracksRef = useRef<Track[]>(waveMemory.playedTracks());
  const lastFeedbackTrackRef = useRef<string | null>(null);
  const waveFetchPromiseRef = useRef<Promise<void> | null>(null);
  const waveControllerRef = useRef<AbortController | null>(null);
  const waveRefreshPendingRef = useRef(false);

  const preferencesRef = useRef<ReturnType<typeof createWavePreferences> | null>(null);
  if (!preferencesRef.current) preferencesRef.current = createWavePreferences();
  const preferences = preferencesRef.current;
  const refreshWaveSession = useCallback(() => {
    if (!preferences.touchSession()) return;
    waveSessions.clear();
    refreshPolicy.reset();
    lastFeedbackTrackRef.current = null;
  }, [preferences, waveSessions, refreshPolicy]);
  const musicOptions = useCallback(
    () => ({
      tasteTracks: tasteTracksRef.current.filter(eligibleTaste),
      positiveTracks: waveSession().positiveTracks,
      skippedTracks: waveSession().skippedTracks,
      learnedTracks: preferences.learnedTracks(eligibleTaste),
      discoveryAdjustment: preferences.discoveryAdjustment(waveMoodRef.current),
    }),
    [preferences, waveSession],
  );
  const isNovelTrack = useCallback((track: Track) => {
    const familiar = new Set(
      familiarArtistsRef.current.flatMap((name) => getWaveArtistKeys({ artist: name })),
    );
    return !getWaveArtistKeys(track).some((artist) => familiar.has(artist));
  }, []);

  const reorderVersionRef = useRef(0);
  useEffect(
    () => () => {
      reorderVersionRef.current++;
      disposeWaveWorker();
    },
    [],
  );
  const reorderPending = useCallback(
    async (preserveNext: boolean): Promise<Track[] | null> => {
      const version = ++reorderVersionRef.current;
      const request = waveRequestIdRef.current;
      const mood = waveMoodRef.current;
      // Navigation can change the preserved prefix during computation. Rebase on the latest queue.
      for (let attempt = 0; attempt < 3; attempt++) {
        const original = queueRef.current,
          index = queueIndexRef.current;
        const next = await resequenceWaveQueueInWorker(
          original,
          preserveNext ? Math.min(index + 1, original.length - 1) : index,
          mood,
          [
            ...familiarArtistsRef.current,
            ...waveSession().positiveTracks.flatMap(getWaveArtistNames),
          ],
          waveSession().artistFeedback,
          recentPlayedTracksRef.current,
          [],
          musicOptions(),
        );
        if (
          version !== reorderVersionRef.current ||
          request !== waveRequestIdRef.current ||
          mood !== waveMoodRef.current ||
          !isWaveActiveRef.current ||
          isWaveStartingRef.current
        )
          return null;
        if (queueRef.current !== original || queueIndexRef.current !== index) continue;
        queueRef.current = next;
        setQueue(next);
        return next;
      }
      return null;
    },
    [queueRef, queueIndexRef, setQueue, waveSession, musicOptions],
  );
  const logReorderError = useCallback((error: unknown) => {
    if (!(error instanceof DOMException && error.name === 'AbortError'))
      PlaybackLogger.warn(
        '[Wave:Compute] ' + (error instanceof Error ? error.message : String(error)),
      );
  }, []);

  const observeWavePlayback = useCallback(
    (track: Track, playedSeconds: number) => {
      if (!isWaveActiveRef.current || isWaveStartingRef.current) return;
      if (waveMemory.recordPlayback(track, playedSeconds))
        recentPlayedTracksRef.current = waveMemory.playedTracks();
    },
    [waveMemory],
  );

  const fetchWaveTracks = useCallback(
    async (kind: 'refill' | 'refresh') => {
      if (!isWaveActiveRef.current || isWaveStartingRef.current) return;
      refreshWaveSession();
      if (kind === 'refresh') {
        const pending = queueRef.current.length - queueIndexRef.current - 1;
        PlaybackLogger.info(
          '[Wave:Refresh] mood=' +
            waveMoodRef.current +
            ', trigger=early-skips, pending=' +
            pending +
            ', status=' +
            (pending >= WAVE_REFRESH_PENDING_LIMIT ? 'deferred-at-limit' : 'requested'),
        );
        if (pending >= WAVE_REFRESH_PENDING_LIMIT) return;
      }
      // Every waiter keeps the same operation, including a refresh superseding its HTTP request.
      if (waveFetchPromiseRef.current) {
        if (kind === 'refresh') {
          waveRefreshPendingRef.current = true;
          waveControllerRef.current?.abort();
        }
        return waveFetchPromiseRef.current;
      }
      isFetchingMoreWaveRef.current = true;
      const requestId = waveRequestIdRef.current;
      const mood = waveMoodRef.current;
      const source = waveSourceRef.current;
      const isCurrent = () =>
        isWaveActiveRef.current &&
        !isWaveStartingRef.current &&
        requestId === waveRequestIdRef.current &&
        mood === waveMoodRef.current &&
        source === waveSourceRef.current;
      const request = (async () => {
        let batchKind = kind;
        do {
          if (!isCurrent()) return;
          waveRefreshPendingRef.current = false;
          const controller = new AbortController();
          waveControllerRef.current = controller;
          try {
            recentPlayedTracksRef.current = waveMemory.playedTracks();
            const session = waveSession(mood);
            const adjustment = preferences.discoveryAdjustment(mood);
            const more = await platformBridge.getWaveBatch(
              mood,
              [...session.positiveTracks, ...preferences.learnedTracks(eligibleTaste).slice(0, 6)],
              [
                ...queueRef.current.map((track) => track.id),
                ...recentPlayedTracksRef.current.map((track) => track.id),
              ],
              {
                tasteRevision: readTastePolicy().revision,
                source,
                recentTracks: recentPlayedTracksRef.current,
                offeredTracks: waveMemory.offeredTracks(),
                artistFeedback: Object.fromEntries(session.artistFeedback),
                learnedTracks: preferences.learnedTracks(eligibleTaste),
                discoveryAdjustment: adjustment,
                positiveTracks: session.positiveTracks,
                skippedTracks: session.skippedTracks,
              },
              controller.signal,
            );
            if (controller.signal.aborted || !isCurrent()) {
              batchKind = 'refresh';
              continue;
            }
            let filtered: Track[] = [];
            let acceptedCount = 0;
            // Reuse the fetched batch when feedback or navigation changes during worker calculation.
            for (let rebase = 0; rebase < 4; rebase++) {
              const prev = queueRef.current;
              const existingIds = new Set(prev.map((track) => String(track.id)));
              const knownArtists = [
                ...familiarArtistsRef.current,
                ...prev.flatMap(getWaveArtistNames),
                ...(more || []).flatMap(getWaveArtistNames),
              ];
              const queueSongs = prev.map((track) => buildWaveSongIdentity(track, knownArtists));
              const capacity =
                batchKind === 'refresh'
                  ? Math.max(
                      0,
                      WAVE_REFRESH_PENDING_LIMIT - (prev.length - queueIndexRef.current - 1),
                    )
                  : Infinity;
              filtered = (more || [])
                .filter((track) => {
                  if (
                    !matchesWaveSource(track, source) ||
                    isYouTubeItemDisabled(track) ||
                    existingIds.has(String(track.id))
                  )
                    return false;
                  const song = buildWaveSongIdentity(track, knownArtists);
                  if (queueSongs.some((previous) => areSameWaveSong(previous, song))) return false;
                  existingIds.add(String(track.id));
                  return true;
                })
                .slice(0, capacity);
              if (filtered.length) {
                const rankIndex = queueIndexRef.current;
                const rankVersion = reorderVersionRef.current;
                // Preserve the live current/announced prefix, including navigation during the request.
                const combined = await resequenceWaveQueueInWorker(
                  [...prev, ...filtered],
                  Math.min(queueIndexRef.current + 1, prev.length - 1),
                  mood,
                  [
                    ...familiarArtistsRef.current,
                    ...waveSession(mood).positiveTracks.flatMap(getWaveArtistNames),
                  ],
                  waveSession(mood).artistFeedback,
                  recentPlayedTracksRef.current,
                  [],
                  musicOptions(),
                );
                if (!isCurrent() || controller.signal.aborted) return;
                if (
                  queueRef.current !== prev ||
                  queueIndexRef.current !== rankIndex ||
                  rankVersion !== reorderVersionRef.current
                ) {
                  continue;
                }
                waveMemory.recordOffered(filtered);
                queueRef.current = combined;
                setQueue(combined);
                acceptedCount = filtered.length;
              }
              break;
            }
            const pending = queueRef.current.slice(
              queueIndexRef.current + 1,
              queueIndexRef.current + 26,
            );
            PlaybackLogger.info(
              '[Wave:Batch] mood=' +
                mood +
                ', reason=' +
                batchKind +
                ', fetched=' +
                (more?.length || 0) +
                ', adjustment=' +
                adjustment.toFixed(3) +
                ', accepted=' +
                acceptedCount +
                ', pending=' +
                (queueRef.current.length - queueIndexRef.current - 1) +
                ', artistsNext25=' +
                new Set(pending.flatMap(getWaveArtistNames)).size,
            );
          } catch (error) {
            if (!controller.signal.aborted) {
              PlaybackLogger.warn(
                '[Wave:Batch] mood=' +
                  mood +
                  ', reason=' +
                  batchKind +
                  ', status=failed; queue retained',
              );
              console.error('Error fetching wave tracks:', error);
            }
          } finally {
            if (waveControllerRef.current === controller) waveControllerRef.current = null;
          }
          batchKind = 'refresh';
        } while (isCurrent() && waveRefreshPendingRef.current);
      })();
      waveFetchPromiseRef.current = request;
      try {
        await request;
      } finally {
        if (waveFetchPromiseRef.current === request) {
          waveFetchPromiseRef.current = null;
          waveRefreshPendingRef.current = false;
          isFetchingMoreWaveRef.current = false;
        }
      }
    },
    [
      queueIndexRef,
      queueRef,
      setQueue,
      waveMemory,
      preferences,
      refreshWaveSession,
      musicOptions,
      waveSession,
    ],
  );

  const fetchMoreWaveTracks = useCallback(() => fetchWaveTracks('refill'), [fetchWaveTracks]);

  const recordWavePlayback = useCallback(
    (
      track: Track,
      playedSeconds: number,
      durationSeconds: number,
      reason: WavePlaybackReason = 'skip',
    ) => {
      if (!isWaveActiveRef.current || isWaveStartingRef.current) return;
      if (!Number.isFinite(playedSeconds) || playedSeconds < 0) return;
      if (!eligibleTaste(track)) {
        waveMemory.recordPlayback(track, playedSeconds);
        recentPlayedTracksRef.current = waveMemory.playedTracks();
        return;
      }
      refreshWaveSession();
      const refresh = refreshPolicy.observe(track.id, playedSeconds, durationSeconds, reason);
      if (playedSeconds < 2) {
        if (refresh) void fetchWaveTracks('refresh');
        return;
      }
      waveMemory.recordPlayback(
        track,
        playedSeconds,
        lastFeedbackTrackRef.current !== String(track.id),
      );
      recentPlayedTracksRef.current = waveMemory.playedTracks();
      if (lastFeedbackTrackRef.current === String(track.id)) return;
      lastFeedbackTrackRef.current = String(track.id);
      const artists = getWaveArtistKeys(track, queueRef.current.flatMap(getWaveArtistNames));
      if (!artists.length) {
        if (refresh) void fetchWaveTracks('refresh');
        return;
      }
      const feedback = waveSession().artistFeedback;
      decayWaveArtistFeedback(feedback);
      const reaction = getWavePlaybackFeedback(
        playedSeconds,
        durationSeconds,
        reason,
        waveMoodRef.current,
      );
      preferences.record(track, reaction, isNovelTrack(track), 'listen', waveMoodRef.current);
      if (reaction)
        for (const artist of artists) {
          feedback.set(artist, Math.max(-2, Math.min(2, (feedback.get(artist) || 0) + reaction)));
        }
      if (reaction < 0) {
        waveSession().skippedTracks = rememberPositiveWaveTrack(waveSession().skippedTracks, track);
        waveSession().positiveTracks = waveSession().positiveTracks.filter(
          (candidate) => String(candidate.id) !== String(track.id),
        );
      } else if (reaction > 0) {
        waveSession().positiveTracks = rememberPositiveWaveTrack(
          waveSession().positiveTracks,
          track,
        );
        waveSession().skippedTracks = reconcileWavePositiveFeedback(
          waveSession().skippedTracks,
          track,
        );
      }
      if (reaction) {
        const currentIndex = queueIndexRef.current;
        void reorderPending(true)
          .then((reordered) => {
            if (reaction < 0 && reordered)
              PlaybackLogger.info(
                `[Wave:Skip] ${track.title}: ${playedSeconds.toFixed(1)}s, artists=${artists.join(', ')}, pending=${reordered.length - currentIndex - 1}`,
              );
          })
          .catch(logReorderError);
      }
      if (refresh) void fetchWaveTracks('refresh');
    },
    [
      reorderPending,
      logReorderError,
      queueIndexRef,
      queueRef,
      setQueue,
      waveMemory,
      preferences,
      refreshWaveSession,
      musicOptions,
      isNovelTrack,
      waveSession,
      refreshPolicy,
      fetchWaveTracks,
    ],
  );

  const handleWaveDislike = useCallback(
    (track: Track) => {
      if (!isWaveActiveRef.current || isWaveStartingRef.current) return;
      refreshWaveSession();
      if (!eligibleTaste(track)) {
        const disliked = { id: track.id, title: track.title, artist: track.artist?.name || '' };
        const remaining = queueRef.current.filter(
          (candidate, index) =>
            index <= queueIndexRef.current || !matchesDislikedWaveTrack(candidate, disliked),
        );
        queueRef.current = remaining;
        setQueue(remaining);
        return;
      }
      preferences.record(track, -0.75, isNovelTrack(track), 'dislike', waveMoodRef.current);
      const feedback = waveSession().artistFeedback;
      for (const artist of getWaveArtistKeys(track, queueRef.current.flatMap(getWaveArtistNames))) {
        feedback.set(artist, Math.max(-2, (feedback.get(artist) || 0) - 0.75));
      }
      const disliked = { id: track.id, title: track.title, artist: track.artist?.name || '' };
      waveSession().skippedTracks = rememberPositiveWaveTrack(waveSession().skippedTracks, track);
      waveSession().positiveTracks = waveSession().positiveTracks.filter(
        (candidate) => !matchesDislikedWaveTrack(candidate, disliked),
      );
      if (String(queueRef.current[queueIndexRef.current]?.id) === String(track.id)) {
        // The dislike already supplies feedback; the automatic next must not add another reaction.
        lastFeedbackTrackRef.current = String(track.id);
        // The audio observer records actual listening; clicking dislike alone is not playback.
      }
      const filtered = queueRef.current.filter(
        (candidate, index) =>
          index <= queueIndexRef.current || !matchesDislikedWaveTrack(candidate, disliked),
      );
      queueRef.current = filtered;
      setQueue(filtered);
      void reorderPending(false).catch(logReorderError);
    },
    [
      reorderPending,
      logReorderError,
      queueIndexRef,
      queueRef,
      setQueue,
      preferences,
      refreshWaveSession,
      musicOptions,
      isNovelTrack,
      waveSession,
    ],
  );

  const handleWaveLike = useCallback(
    (track: Track) => {
      if (!isWaveActiveRef.current || isWaveStartingRef.current) return;
      refreshWaveSession();
      if (!eligibleTaste(track)) return;
      preferences.record(track, 1, isNovelTrack(track), 'like', waveMoodRef.current);
      refreshPolicy.accept();
      const feedback = waveSession().artistFeedback;
      for (const artist of getWaveArtistKeys(track, queueRef.current.flatMap(getWaveArtistNames))) {
        feedback.set(artist, Math.min(2, (feedback.get(artist) || 0) + 1));
      }
      waveSession().positiveTracks = rememberPositiveWaveTrack(waveSession().positiveTracks, track);
      waveSession().skippedTracks = reconcileWavePositiveFeedback(
        waveSession().skippedTracks,
        track,
      );
      void reorderPending(false).catch(logReorderError);
    },
    [
      reorderPending,
      logReorderError,
      queueIndexRef,
      queueRef,
      setQueue,
      preferences,
      refreshWaveSession,
      musicOptions,
      isNovelTrack,
      waveSession,
      refreshPolicy,
    ],
  );

  useEffect(
    () => () => {
      waveRequestIdRef.current++;
      waveControllerRef.current?.abort();
      waveControllerRef.current = null;
      waveFetchPromiseRef.current = null;
      waveRefreshPendingRef.current = false;
      refreshPolicy.reset();
      waveSessions.clear();
      isFetchingMoreWaveRef.current = false;
    },
    [refreshPolicy, waveSessions],
  );

  // Start My Wave with specified mood (immediately switches and plays first track)
  const startWave = useCallback(
    async (
      mood: WaveMood = 'default',
      seedTrack?: Track,
      source: MusicSource = waveSourceRef.current,
    ) => {
      // Own the intent and detach old bookkeeping before the asynchronous policy preflight.
      const reqId = ++waveRequestIdRef.current;
      waveControllerRef.current?.abort();
      const controller = new AbortController();
      waveControllerRef.current = controller;
      waveFetchPromiseRef.current = null;
      waveRefreshPendingRef.current = false;
      refreshPolicy.reset();
      isFetchingMoreWaveRef.current = false;
      try {
        await refreshTastePolicy();
      } catch {
        if (reqId === waveRequestIdRef.current && !controller.signal.aborted) {
          waveControllerRef.current = null;
          if (isWaveStartingRef.current) {
            const previous = restorableWaveRef.current;
            isWaveStartingRef.current = false;
            setIsWaveStarting(false);
            isWaveActiveRef.current = previous.active;
            setIsWaveActive(previous.active);
            waveMoodRef.current = previous.mood;
            setWaveMood(previous.mood);
            updateWaveSource(previous.source);
          }
          emitToast('Не удалось загрузить настройки вкуса.', 'warning', 3500);
        }
        return;
      }
      if (reqId !== waveRequestIdRef.current || controller.signal.aborted) return;
      if (seedTrack && !eligibleTaste(seedTrack)) seedTrack = undefined;
      source = normalizeWaveSource(source);
      refreshWaveSession();
      recentPlayedTracksRef.current = waveMemory.playedTracks();
      if (seedTrack)
        waveSession(mood).positiveTracks = rememberPositiveWaveTrack(
          waveSession(mood).positiveTracks,
          seedTrack,
        );
      lastFeedbackTrackRef.current = null;
      if (!isWaveStartingRef.current) {
        restorableWaveRef.current = {
          active: isWaveActiveRef.current,
          mood: waveMoodRef.current,
          source: waveSourceRef.current,
        };
      }
      const {
        active: previousActive,
        mood: previousMood,
        source: previousSource,
      } = restorableWaveRef.current;
      updateWaveSource(source);
      setIsWaveActive(true);
      isWaveActiveRef.current = true;
      setWaveMood(mood);
      waveMoodRef.current = mood;
      setIsWaveStarting(true);
      isWaveStartingRef.current = true;

      try {
        const [fetched, profile] = await Promise.all([
          platformBridge.getWaveBatch(
            mood,
            seedTrack
              ? [seedTrack]
              : [
                  ...waveSession().positiveTracks,
                  ...preferences.learnedTracks(eligibleTaste).slice(0, 6),
                ],
            waveMemory
              .playedTracks()
              .map((track) => track.id)
              .concat(seedTrack ? [seedTrack.id] : []),
            {
              tasteRevision: readTastePolicy().revision,
              source,
              recentTracks: recentPlayedTracksRef.current,
              offeredTracks: waveMemory.offeredTracks(),
              artistFeedback: Object.fromEntries(waveSession().artistFeedback),
              learnedTracks: preferences.learnedTracks(eligibleTaste),
              discoveryAdjustment: preferences.discoveryAdjustment(waveMoodRef.current),
              positiveTracks: waveSession().positiveTracks,
              skippedTracks: waveSession().skippedTracks,
            },
            controller.signal,
          ),
          Promise.allSettled([platformBridge.getTasteProfile()]),
        ]);
        if (reqId !== waveRequestIdRef.current) return;
        const currentProfile = profile[0];
        const data =
          currentProfile.status === 'fulfilled' &&
          currentProfile.value.revision === readTastePolicy().revision
            ? currentProfile.value
            : { likes: [], artists: [] };
        tasteTracksRef.current = data.likes
          .map(normalizeWaveSeed)
          .filter((track): track is Track => Boolean(track && eligibleTaste(track)))
          .slice(0, 48)
          .map((track) => ({ ...track, waveSeedWeight: 2 }));
        familiarArtistsRef.current = waveFamiliarArtists(
          data.likes,
          data.artists,
          preferences.learnedTracks(eligibleTaste),
        );
        const seedSong = seedTrack ? buildWaveSongIdentity(seedTrack) : null;
        const candidates = seedTrack
          ? fetched.filter(
              (track) =>
                String(track.id) !== String(seedTrack.id) &&
                !(
                  seedSong &&
                  areSameWaveSong(
                    seedSong,
                    buildWaveSongIdentity(track, getWaveArtistNames(seedTrack)),
                  )
                ),
            )
          : fetched;
        const batch = await resequenceWaveQueueInWorker(
          candidates.filter(
            (track) => matchesWaveSource(track, source) && !isYouTubeItemDisabled(track),
          ),
          -1,
          mood,
          [
            ...familiarArtistsRef.current,
            ...waveSession().positiveTracks.flatMap(getWaveArtistNames),
          ],
          waveSession().artistFeedback,
          recentPlayedTracksRef.current,
          waveMemory.offeredTracks(),
          musicOptions(),
        );
        if (reqId !== waveRequestIdRef.current) return;
        if (batch && batch.length > 0) {
          waveMemory.recordOffered(batch);
          setIsWaveStarting(false);
          isWaveStartingRef.current = false;
          restorableWaveRef.current = { active: true, mood, source };
          PlaybackLogger.info(
            `[Wave:Start] mood=${mood}, tracks=${batch.length}, artists=${new Set(batch.flatMap(getWaveArtistNames)).size}`,
          );
          playTrackRef.current?.(batch[0], batch, true);
        } else {
          setIsWaveStarting(false);
          isWaveStartingRef.current = false;
          setIsWaveActive(previousActive);
          isWaveActiveRef.current = previousActive;
          setWaveMood(previousMood);
          waveMoodRef.current = previousMood;
          updateWaveSource(previousSource);
          emitToast(
            'Не удалось загрузить треки для Моей волны. Попробуйте еще раз.',
            'error',
            4000,
          );
        }
      } catch (e) {
        if (!controller.signal.aborted) console.error('Error starting wave:', e);
        if (reqId === waveRequestIdRef.current) {
          setIsWaveStarting(false);
          isWaveStartingRef.current = false;
          setIsWaveActive(previousActive);
          isWaveActiveRef.current = previousActive;
          setWaveMood(previousMood);
          waveMoodRef.current = previousMood;
          updateWaveSource(previousSource);
          emitToast(
            'Не удалось запустить Мою волну: ' +
              (e instanceof Error ? e.message : 'ошибка расчёта или загрузки'),
            'error',
            4000,
          );
        }
      } finally {
        if (waveControllerRef.current === controller) waveControllerRef.current = null;
      }
    },
    [
      playTrackRef,
      waveMemory,
      preferences,
      refreshWaveSession,
      musicOptions,
      updateWaveSource,
      waveSession,
      refreshPolicy,
    ],
  );

  const setWaveSource = useCallback(
    (value: MusicSource) => {
      const source = normalizeWaveSource(value);
      if (source === waveSourceRef.current) return;
      if (isWaveActiveRef.current) void startWave(waveMoodRef.current, undefined, source);
      else updateWaveSource(source);
    },
    [startWave, updateWaveSource],
  );

  const stopWave = useCallback(() => {
    waveRequestIdRef.current++;
    waveControllerRef.current?.abort();
    waveControllerRef.current = null;
    waveFetchPromiseRef.current = null;
    waveRefreshPendingRef.current = false;
    refreshPolicy.reset();
    isFetchingMoreWaveRef.current = false;
    restorableWaveRef.current = {
      active: false,
      mood: waveMoodRef.current,
      source: waveSourceRef.current,
    };
    setIsWaveStarting(false);
    isWaveStartingRef.current = false;
    setIsWaveActive(false);
    isWaveActiveRef.current = false;
  }, [refreshPolicy]);

  const previousTasteRevision = useRef(policy.revision);
  useEffect(() => {
    const previous = previousTasteRevision.current;
    previousTasteRevision.current = policy.revision;
    if (previous === policy.revision || previous < 0 || policy.revision < 0) return;
    waveSessions.clear();
    preferences.clearObservations();
    refreshPolicy.reset();
    lastFeedbackTrackRef.current = null;
    tasteTracksRef.current = [];
    familiarArtistsRef.current = [];
    waveRequestIdRef.current++;
    waveControllerRef.current?.abort();
    waveControllerRef.current = null;
    waveFetchPromiseRef.current = null;
    waveRefreshPendingRef.current = false;
    isFetchingMoreWaveRef.current = false;
    if (isWaveStartingRef.current) {
      isWaveStartingRef.current = false;
      setIsWaveStarting(false);
    }
    let disposed = false;
    void platformBridge
      .getTasteProfile()
      .then((data) => {
        if (disposed || data.revision !== readTastePolicy().revision) return;
        tasteTracksRef.current = data.likes
          .map(normalizeWaveSeed)
          .filter((track): track is Track => Boolean(track && eligibleTaste(track)))
          .slice(0, 48)
          .map((track) => ({ ...track, waveSeedWeight: 2 }));
        familiarArtistsRef.current = waveFamiliarArtists(
          data.likes,
          data.artists,
          preferences.learnedTracks(eligibleTaste),
        );
        if (isWaveActiveRef.current) void fetchWaveTracks('refill');
      })
      .catch(() => {});
    return () => {
      disposed = true;
    };
  }, [policy.revision, eligibleTaste, waveSessions, preferences, refreshPolicy, fetchWaveTracks]);

  return {
    isWaveActive,
    isWaveStarting,
    isWaveStartingRef,
    setIsWaveActive,
    isWaveActiveRef,
    waveMood,
    waveSource,
    setWaveSource,
    setWaveMood,
    waveMoodRef,
    isFetchingMoreWaveRef,
    startWave,
    stopWave,
    fetchMoreWaveTracks,
    recordWavePlayback,
    observeWavePlayback,
    handleWaveDislike,
    handleWaveLike,
  };
}
