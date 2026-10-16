import type { LikedTrack, Track } from '../types';
import { detectTrackSource } from './formatters';
export function mapLikedTracks(likedList: LikedTrack[]): Track[] {
  return (likedList || []).map((item) => {
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
