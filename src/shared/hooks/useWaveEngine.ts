import {
  matchesWaveSource,
  normalizeWaveSource,
  readWaveSource,
  saveWaveSource,
} from '../services/waveSource.ts';
import { createWavePreferences } from '../services/wavePreferences.ts';
import type { WavePlaybackReason } from '../utils/waveFeedback.ts';
import { isYouTubeItemDisabled } from '../services/youtubeAvailability.ts';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { MusicSource, Track, WaveMood } from '../types/index.ts';
import { platformBridge } from '../bridge/platformBridge.ts';
import { emitToast } from '../context/ToastContext.tsx';
import { matchesDislikedWaveTrack, resequenceWaveQueue } from '../utils/waveQueue.ts';
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
  const artistFeedbackRef = useRef<Map<string, number>>(new Map());
  const recentPositiveTracksRef = useRef<Track[]>([]);
  const recentSkippedTracksRef = useRef<Track[]>([]);
  const tasteTracksRef = useRef<Track[]>([]);
  const familiarArtistsRef = useRef<string[]>([]);
  const memoryRef = useRef<ReturnType<typeof createWaveMemory> | null>(null);
  if (!memoryRef.current) memoryRef.current = createWaveMemory();
  const waveMemory = memoryRef.current;
  const recentPlayedTracksRef = useRef<Track[]>(waveMemory.playedTracks());
  const lastFeedbackTrackRef = useRef<string | null>(null);
  const waveFetchPromiseRef = useRef<Promise<void> | null>(null);
  const waveControllerRef = useRef<AbortController | null>(null);

  const preferencesRef = useRef<ReturnType<typeof createWavePreferences> | null>(null);
  if (!preferencesRef.current) preferencesRef.current = createWavePreferences();
  const preferences = preferencesRef.current;
  const refreshWaveSession = useCallback(() => {
    if (!preferences.touchSession()) return;
    artistFeedbackRef.current.clear();
    recentPositiveTracksRef.current = [];
    recentSkippedTracksRef.current = [];
    lastFeedbackTrackRef.current = null;
  }, [preferences]);
  const musicOptions = useCallback(
    () => ({
      tasteTracks: tasteTracksRef.current,
      positiveTracks: recentPositiveTracksRef.current,
      skippedTracks: recentSkippedTracksRef.current,
      learnedTracks: preferences.learnedTracks(),
      discoveryAdjustment: preferences.discoveryAdjustment(),
    }),
    [preferences],
  );
  const isNovelTrack = useCallback((track: Track) => {
    const familiar = new Set(
      familiarArtistsRef.current.flatMap((name) => getWaveArtistKeys({ artist: name })),
    );
    return !getWaveArtistKeys(track).some((artist) => familiar.has(artist));
  }, []);

  const observeWavePlayback = useCallback(
    (track: Track, playedSeconds: number) => {
      if (!isWaveActiveRef.current || isWaveStartingRef.current) return;
      if (waveMemory.recordPlayback(track, playedSeconds))
        recentPlayedTracksRef.current = waveMemory.playedTracks();
    },
    [waveMemory],
  );

  const recordWavePlayback = useCallback(
    (
      track: Track,
      playedSeconds: number,
      durationSeconds: number,
      reason: WavePlaybackReason = 'skip',
    ) => {
      if (!isWaveActiveRef.current) return;
      if (!Number.isFinite(playedSeconds) || playedSeconds < 2) return;
      refreshWaveSession();
      waveMemory.recordPlayback(
        track,
        playedSeconds,
        lastFeedbackTrackRef.current !== String(track.id),
      );
      recentPlayedTracksRef.current = waveMemory.playedTracks();
      if (lastFeedbackTrackRef.current === String(track.id)) return;
      lastFeedbackTrackRef.current = String(track.id);
      const artists = getWaveArtistKeys(track, queueRef.current.flatMap(getWaveArtistNames));
      if (!artists.length) return;
      const feedback = artistFeedbackRef.current;
      decayWaveArtistFeedback(feedback);
      const reaction = getWavePlaybackFeedback(playedSeconds, durationSeconds, reason);
      preferences.record(track, reaction, isNovelTrack(track));
      if (reaction)
        for (const artist of artists) {
          feedback.set(artist, Math.max(-2, Math.min(2, (feedback.get(artist) || 0) + reaction)));
        }
      if (reaction < 0) {
        recentSkippedTracksRef.current = rememberPositiveWaveTrack(
          recentSkippedTracksRef.current,
          track,
        );
        recentPositiveTracksRef.current = recentPositiveTracksRef.current.filter(
          (candidate) => String(candidate.id) !== String(track.id),
        );
      } else if (reaction > 0) {
        recentPositiveTracksRef.current = rememberPositiveWaveTrack(
          recentPositiveTracksRef.current,
          track,
        );
        recentSkippedTracksRef.current = reconcileWavePositiveFeedback(
          recentSkippedTracksRef.current,
          track,
        );
      }
      if (reaction) {
        const currentIndex = queueIndexRef.current;
        const reordered = resequenceWaveQueue(
          queueRef.current,
          Math.min(currentIndex + 1, queueRef.current.length - 1),
          waveMoodRef.current,
          [
            ...familiarArtistsRef.current,
            ...recentPositiveTracksRef.current.flatMap(getWaveArtistNames),
          ],
          feedback,
          recentPlayedTracksRef.current,
          [],
          musicOptions(),
        );
        queueRef.current = reordered;
        setQueue(reordered);
        if (reaction < 0)
          PlaybackLogger.info(
            `[Wave:Skip] ${track.title}: ${playedSeconds.toFixed(1)}s, artists=${artists.join(', ')}, pending=${reordered.length - currentIndex - 1}`,
          );
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
      isNovelTrack,
    ],
  );

  const handleWaveDislike = useCallback(
    (track: Track) => {
      if (!isWaveActiveRef.current) return;
      refreshWaveSession();
      preferences.record(track, -0.75, isNovelTrack(track), 'dislike');
      const feedback = artistFeedbackRef.current;
      for (const artist of getWaveArtistKeys(track, queueRef.current.flatMap(getWaveArtistNames))) {
        feedback.set(artist, Math.max(-2, (feedback.get(artist) || 0) - 0.75));
      }
      const disliked = { id: track.id, title: track.title, artist: track.artist?.name || '' };
      recentSkippedTracksRef.current = rememberPositiveWaveTrack(
        recentSkippedTracksRef.current,
        track,
      );
      recentPositiveTracksRef.current = recentPositiveTracksRef.current.filter(
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
      const next = resequenceWaveQueue(
        filtered,
        queueIndexRef.current,
        waveMoodRef.current,
        [
          ...familiarArtistsRef.current,
          ...recentPositiveTracksRef.current.flatMap(getWaveArtistNames),
        ],
        feedback,
        recentPlayedTracksRef.current,
        [],
        musicOptions(),
      );
      queueRef.current = next;
      setQueue(next);
    },
    [
      queueIndexRef,
      queueRef,
      setQueue,
      preferences,
      refreshWaveSession,
      musicOptions,
      isNovelTrack,
    ],
  );

  const handleWaveLike = useCallback(
    (track: Track) => {
      if (!isWaveActiveRef.current) return;
      refreshWaveSession();
      preferences.record(track, 1, isNovelTrack(track), 'like');
      const feedback = artistFeedbackRef.current;
      for (const artist of getWaveArtistKeys(track, queueRef.current.flatMap(getWaveArtistNames))) {
        feedback.set(artist, Math.min(2, (feedback.get(artist) || 0) + 1));
      }
      recentPositiveTracksRef.current = rememberPositiveWaveTrack(
        recentPositiveTracksRef.current,
        track,
      );
      recentSkippedTracksRef.current = reconcileWavePositiveFeedback(
        recentSkippedTracksRef.current,
        track,
      );
      const next = resequenceWaveQueue(
        queueRef.current,
        queueIndexRef.current,
        waveMoodRef.current,
        [
          ...familiarArtistsRef.current,
          ...recentPositiveTracksRef.current.flatMap(getWaveArtistNames),
        ],
        feedback,
        recentPlayedTracksRef.current,
        [],
        musicOptions(),
      );
      queueRef.current = next;
      setQueue(next);
    },
    [
      queueIndexRef,
      queueRef,
      setQueue,
      preferences,
      refreshWaveSession,
      musicOptions,
      isNovelTrack,
    ],
  );

  useEffect(
    () => () => {
      waveRequestIdRef.current++;
      waveControllerRef.current?.abort();
      waveControllerRef.current = null;
      waveFetchPromiseRef.current = null;
      isFetchingMoreWaveRef.current = false;
    },
    [],
  );

  // Fetch more tracks for My Wave in background
  const fetchMoreWaveTracks = useCallback(async () => {
    // End-of-queue navigation waits for the same fetch already running in background.
    if (!isWaveActiveRef.current || isWaveStartingRef.current) return;
    refreshWaveSession();
    if (waveFetchPromiseRef.current) return waveFetchPromiseRef.current;
    isFetchingMoreWaveRef.current = true;
    const requestId = waveRequestIdRef.current;
    const mood = waveMoodRef.current;
    const controller = new AbortController();
    waveControllerRef.current = controller;
    const request = (async () => {
      try {
        recentPlayedTracksRef.current = waveMemory.playedTracks();
        const excludeIds = [
          ...queueRef.current.map((track) => track.id),
          ...waveMemory.playedTracks().map((track) => track.id),
        ];
        const more = await platformBridge.getWaveBatch(
          mood,
          [...recentPositiveTracksRef.current, ...preferences.learnedTracks().slice(0, 6)],
          excludeIds,
          {
            source: waveSourceRef.current,
            recentTracks: recentPlayedTracksRef.current,
            offeredTracks: waveMemory.offeredTracks(),
            artistFeedback: Object.fromEntries(artistFeedbackRef.current),
            learnedTracks: preferences.learnedTracks(),
            discoveryAdjustment: preferences.discoveryAdjustment(),
            positiveTracks: recentPositiveTracksRef.current,
            skippedTracks: recentSkippedTracksRef.current,
          },
          controller.signal,
        );
        if (
          more &&
          more.length > 0 &&
          isWaveActiveRef.current &&
          requestId === waveRequestIdRef.current
        ) {
          const prev = queueRef.current;
          const existingIds = new Set(prev.map((t) => String(t.id)));
          const knownArtists = [
            ...familiarArtistsRef.current,
            ...prev.flatMap(getWaveArtistNames),
            ...more.flatMap(getWaveArtistNames),
          ];
          const queueSongs = prev.map((track) => buildWaveSongIdentity(track, knownArtists));
          const filtered = more.filter((t) => {
            if (
              !matchesWaveSource(t, waveSourceRef.current) ||
              isYouTubeItemDisabled(t) ||
              existingIds.has(String(t.id))
            )
              return false;
            const song = buildWaveSongIdentity(t, knownArtists);
            return !queueSongs.some((previous) => areSameWaveSong(previous, song));
          });
          waveMemory.recordOffered(filtered);
          const combined = resequenceWaveQueue(
            [...prev, ...filtered],
            Math.min(queueIndexRef.current + 1, prev.length - 1),
            mood,
            [
              ...familiarArtistsRef.current,
              ...recentPositiveTracksRef.current.flatMap(getWaveArtistNames),
            ],
            artistFeedbackRef.current,
            recentPlayedTracksRef.current,
            [],
            musicOptions(),
          );
          queueRef.current = combined;
          setQueue(combined);
          const pending = combined.slice(queueIndexRef.current + 1, queueIndexRef.current + 26);
          PlaybackLogger.info(
            `[Wave:Batch] mood=${mood}, fetched=${more.length}, pending=${combined.length - queueIndexRef.current - 1}, artistsNext25=${new Set(pending.flatMap(getWaveArtistNames)).size}`,
          );
        }
      } catch (e) {
        if (!controller.signal.aborted) console.error('Error fetching more wave tracks:', e);
      }
    })();
    waveFetchPromiseRef.current = request;
    try {
      await request;
    } finally {
      if (waveControllerRef.current === controller) waveControllerRef.current = null;
      if (waveFetchPromiseRef.current === request) {
        waveFetchPromiseRef.current = null;
        isFetchingMoreWaveRef.current = false;
      }
    }
  }, [
    queueIndexRef,
    queueRef,
    setQueue,
    waveMemory,
    preferences,
    refreshWaveSession,
    musicOptions,
    isNovelTrack,
  ]);

  // Start My Wave with specified mood (immediately switches and plays first track)
  const startWave = useCallback(
    async (
      mood: WaveMood = 'default',
      seedTrack?: Track,
      source: MusicSource = waveSourceRef.current,
    ) => {
      source = normalizeWaveSource(source);
      refreshWaveSession();
      const reqId = ++waveRequestIdRef.current;
      waveControllerRef.current?.abort();
      const controller = new AbortController();
      waveControllerRef.current = controller;
      waveFetchPromiseRef.current = null;
      isFetchingMoreWaveRef.current = false;
      recentPlayedTracksRef.current = waveMemory.playedTracks();
      if (seedTrack)
        recentPositiveTracksRef.current = rememberPositiveWaveTrack(
          recentPositiveTracksRef.current,
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
              : [...recentPositiveTracksRef.current, ...preferences.learnedTracks().slice(0, 6)],
            waveMemory
              .playedTracks()
              .map((track) => track.id)
              .concat(seedTrack ? [seedTrack.id] : []),
            {
              source,
              recentTracks: recentPlayedTracksRef.current,
              offeredTracks: waveMemory.offeredTracks(),
              artistFeedback: Object.fromEntries(artistFeedbackRef.current),
              learnedTracks: preferences.learnedTracks(),
              discoveryAdjustment: preferences.discoveryAdjustment(),
              positiveTracks: recentPositiveTracksRef.current,
              skippedTracks: recentSkippedTracksRef.current,
            },
            controller.signal,
          ),
          Promise.allSettled([
            platformBridge.getLikedTracks(),
            platformBridge.getFollowedArtists(),
            platformBridge.getTopScrobbledArtists(30),
          ]),
        ]);
        if (reqId !== waveRequestIdRef.current) return;
        const [likes, followed, scrobbled] = profile;
        tasteTracksRef.current = (likes.status === 'fulfilled' ? likes.value : [])
          .map(normalizeWaveSeed)
          .filter((track): track is Track => Boolean(track))
          .slice(0, 48)
          .map((track) => ({ ...track, waveSeedWeight: 2 }));
        familiarArtistsRef.current = waveFamiliarArtists(
          likes.status === 'fulfilled' ? likes.value : [],
          [
            ...(followed.status === 'fulfilled' ? followed.value : []),
            ...(scrobbled.status === 'fulfilled'
              ? scrobbled.value.filter((artist) => artist.score > 0)
              : []),
          ],
          preferences.learnedTracks(),
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
        const batch = resequenceWaveQueue(
          candidates.filter(
            (track) => matchesWaveSource(track, source) && !isYouTubeItemDisabled(track),
          ),
          -1,
          mood,
          [
            ...familiarArtistsRef.current,
            ...recentPositiveTracksRef.current.flatMap(getWaveArtistNames),
          ],
          artistFeedbackRef.current,
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
          emitToast('Ошибка запуска Моей волны. Проверьте интернет.', 'error', 4000);
        }
      } finally {
        if (waveControllerRef.current === controller) waveControllerRef.current = null;
      }
    },
    [playTrackRef, waveMemory, preferences, refreshWaveSession, musicOptions, updateWaveSource],
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
  }, []);

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
