import type { LikedTrack, Track } from '../types';
import type { LibraryPlaybackRow } from '../types/libraryPage';
import { detectTrackSource } from './formatters';
export function mapLikedTracks(likedList: readonly (LikedTrack | LibraryPlaybackRow)[]): Track[] {
  return (likedList || []).map((row) => {
    const item = Array.isArray(row)
      ? {
          deezer_id: row[0],
          title: row[1],
          artist: row[2],
          album: row[3],
          album_id: row[4],
          cover_url: row[5],
          preview_url: row[6] ?? '',
          duration: row[7],
          recordingId: row[8],
        }
      : row;
    let cover = item.cover_url || '';
    if (cover.includes('sndcdn.com') && cover.includes('-large.')) {
      cover = cover.replace('-large.', '-t500x500.');
    }
    if (cover.includes('unsplash.com')) {
      cover = '';
    }
    const detectedSource = detectTrackSource(item);
    const rawId = String(item.deezer_id || '');
    let artistId: string | undefined;
    if (rawId.startsWith('sc_') || detectedSource === 'soundcloud') {
      artistId = `sc_art_${item.artist.toLowerCase().replace(/\s+/g, '_')}`;
    } else if (rawId.startsWith('yt_') || detectedSource === 'youtube') {
      artistId = `yt_art_${item.artist.toLowerCase().replace(/\s+/g, '_')}`;
    }
    return {
      id: item.deezer_id,
      ...(item.recordingId ? { recordingId: item.recordingId } : {}),
      title: item.title,
      artist: {
        id: artistId,
        name: item.artist,
        picture: cover,
        source: detectedSource,
      },
      album: {
        id: item.album_id || undefined,
        title: item.album || '',
        cover_medium: cover,
        cover: cover,
        cover_big: cover,
        cover_xl: cover,
        cover_small: cover,
      },
      duration: item.duration || 180,
      preview: item.preview_url,
      source: detectedSource,
    };
  });
}
