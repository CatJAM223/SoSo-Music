import type { Track } from './index.ts';

export type ImportSearchSource = 'soundcloud' | 'youtube';
export interface ExternalPlaylistTrack {
  id: string;
  title: string;
  artist: string;
  duration: number;
}
export interface ExternalPlaylist {
  source: 'yandex' | 'vk';
  url: string;
  title: string;
  tracks: ExternalPlaylistTrack[];
  coverUrl?: string;
}
export type PlaylistReadResult =
  | { success: true; data: ExternalPlaylist }
  | { success: false; error: string; code: 'invalid_url' | 'access' | 'network' | 'incomplete' };
export interface ImportMatch {
  original: ExternalPlaylistTrack;
  status: 'matched' | 'review' | 'missing' | 'error';
  track?: Track;
  candidates: Track[];
  error?: string;
}
