import type { Track } from '../../../shared/types';
import type { RoomSong } from '../../../shared/types/listeningRoom';
import { readQueueEntryId } from '../../../shared/utils/queueEntry';
import { trackArtworkCandidates } from '../../../shared/utils/trackArtwork';
import { safeRoomArtwork } from './roomArtwork';
export function roomSong(track: Track | null): RoomSong | null {
  if (!track || (track.source !== 'youtube' && track.source !== 'soundcloud')) return null;
  return {
    entryId: readQueueEntryId(track),
    id: String(track.id),
    source: track.source,
    title: track.title,
    artist: track.artist.name,
    album: track.album?.title || '',
    cover: trackArtworkCandidates(track).map(safeRoomArtwork).find(Boolean),
    duration: track.duration || 0,
  };
}
export function roomTrack(song: RoomSong): Track {
  return {
    id: song.id,
    source: song.source,
    title: song.title,
    artist: { name: song.artist },
    album: { title: song.album, cover: safeRoomArtwork(song.cover) },
    duration: song.duration,
    preview: '',
    ...(song.entryId ? { queueEntryId: song.entryId } : {}),
  };
}
