import { emitToast } from '../../../shared/context/ToastContext';
import { useEffect, useRef } from 'react';
import { useAudioControls, useAudioState } from '../../../shared/context/AudioContext';
import type { RoomSong, RoomSyncDecision } from '../../../shared/types/listeningRoom';
import { requestRoom, roomError, useRoomConnection } from '../services/listeningRoomClient';
import type { AudioStateContextType } from '../../../shared/context/audioTypes';
import { roomSong as song, roomTrack as track } from '../services/roomTracks';

function upcoming(audio: AudioStateContextType): RoomSong[] {
  const items = audio.isShuffle
    ? audio.shuffledUpcomingIndices.map((index) => audio.queue[index])
    : audio.queue.slice(audio.queueIndex + 1);
  return items
    .slice(0, 20)
    .map(song)
    .filter((item): item is RoomSong => item !== null);
}

/** Renderer adapter only: Rust decides whether to load, seek, pause or resume. */
export function useListeningRoomPlayback() {
  const connection = useRoomConnection();
  const role = connection?.startsWith('host:') ? 'host' : connection ? 'guest' : undefined;
  const audio = useAudioState();
  const controls = useAudioControls();
  const latest = useRef({ audio, controls });
  useEffect(() => {
    latest.current = { audio, controls };
  }, [audio, controls]);
  useEffect(() => {
    if (!role) return;
    latest.current.controls.pausePlayback();
    latest.current.controls.stopWave();
    latest.current.controls.stopSnippet();
    latest.current.controls.setRoomFollower(true);
    latest.current.controls.setRoomControlHandler((action, position) => {
      if (role !== 'host' || action === 'previous') return;
      void requestRoom({
        op: 'command',
        payload: { action, position } as Extract<
          import('../../../shared/types/listeningRoom').RoomRequest,
          { op: 'command' }
        >['payload'],
      }).catch((error) => emitToast(roomError(error), 'error'));
    });
    let active = true;
    let busy = false;
    let appliedSeekRevision = 0;
    const tick = async () => {
      if (!active || busy) return;
      busy = true;
      try {
        const { audio, controls } = latest.current;
        const entryId = audio.currentTrack ? song(audio.currentTrack)?.entryId : undefined;
        const identity = {
          entryId,
          id: audio.currentTrack ? String(audio.currentTrack.id) : undefined,
          source: audio.currentTrack?.source,
          ready: controls.isPlaybackReady(),
          ended: entryId !== undefined && controls.getEndedPlaybackEntryId() === entryId,
          seekRevision: appliedSeekRevision,
        };
        await requestRoom({ op: 'pulse', payload: identity });
        {
          const decision = await requestRoom<RoomSyncDecision>({
            op: 'synchronize',
            payload: {
              ...identity,
              position: controls.getPlaybackTime(),
              playing: audio.isPlaying,
              loading: audio.isLoadingTrack,
              blocked:
                audio.playbackPhase === 'waiting-network' || audio.playbackPhase === 'failed',
              queue: upcoming(audio),
            },
          });
          if (!active) return;
          const player = latest.current.controls;
          const playback = decision.playback;
          if (!playback) return;
          if (
            decision.replaceQueue &&
            decision.action !== 'load' &&
            decision.action !== 'buffer' &&
            decision.action !== 'prepare'
          ) {
            if (latest.current.audio.isShuffle) player.toggleShuffle();
            player.replaceUpcomingQueue(playback.queue.map(track));
          }
          switch (decision.action) {
            case 'load':
            case 'prepare':
            case 'buffer':
              if (playback.track) {
                player.stopWave();
                player.stopSnippet();
                const current = track(playback.track);
                if (decision.action === 'buffer')
                  player.preparePlayback(
                    current,
                    [current, ...playback.queue.map(track)],
                    playback.position,
                  );
                else if (decision.action === 'prepare')
                  player.selectPausedTrack(
                    current,
                    [current, ...playback.queue.map(track)],
                    playback.position,
                  );
                else
                  player.playTrack(
                    current,
                    [current, ...playback.queue.map(track)],
                    false,
                    playback.position,
                  );
                appliedSeekRevision = decision.seekRevision ?? 0;
              }
              break;
            case 'seek':
              player.seekPlayback(playback.position);
              appliedSeekRevision = decision.seekRevision ?? 0;
              break;
            case 'play':
              player.seekPlayback(playback.position);
              await player.resumePlayback();
              break;
            case 'pause':
              player.pausePlayback();
              break;
          }
        }
      } catch {
        /* Session events surface connection errors; avoid repeated playback toasts. */
      } finally {
        busy = false;
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), 500);
    return () => {
      active = false;
      clearInterval(timer);
      {
        latest.current.controls.setRoomControlHandler(null);
        latest.current.controls.setRoomFollower(false);
        latest.current.controls.pausePlayback();
      }
    };
  }, [role, connection]);
}
