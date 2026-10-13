import type { LikedTrack, Track } from '../types/index.ts';
import { detectTrackSource } from './formatters.ts';
import { cleanAlbumTitle } from './albumMetadata.ts';

export function likedTrackToTrack(item: LikedTrack): Track {
  const source = detectTrackSource(item);
  let cover = item.cover_url || '';
  if (cover.includes('sndcdn.com')) cover = cover.replace('-large.', '-t500x500.');
  if (cover.includes('unsplash.com')) cover = '';
  return {
    id: item.deezer_id,
    title: item.title,
    artist: {
      id: `${source === 'youtube' ? 'yt' : 'sc'}_art_${item.artist.toLowerCase().replace(/\s+/g, '_')}`,
      name: item.artist,
      picture: cover,
      source,
    },
    album: {
      id: item.album_id || undefined,
      title: cleanAlbumTitle(item.album),
      cover,
      cover_small: cover,
      cover_medium: cover,
      cover_big: cover,
      cover_xl: cover,
    },
    duration: item.duration || 180,
    preview: item.preview_url,
    source,
  };
}
