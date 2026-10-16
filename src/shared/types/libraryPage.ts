import type { FollowedArtist, LikedTrack, Playlist, SavedAlbum } from './index';
export type LibraryKind = 'tracks' | 'playlists' | 'albums' | 'artists';
export type LibrarySort = 'recent' | 'oldest' | 'title';
export interface LibraryItems {
  tracks: LikedTrack;
  playlists: Playlist;
  albums: SavedAlbum;
  artists: FollowedArtist;
}
export interface LibraryPageRequest<K extends LibraryKind = LibraryKind> {
  kind: K;
  query?: string;
  sort?: LibrarySort;
  offset?: number;
  limit?: number;
}
export interface LibraryPage<K extends LibraryKind = LibraryKind> {
  kind: K;
  items: LibraryItems[K][];
  total: number;
  offset: number;
  nextOffset: number | null;
}
export interface LibraryStats {
  tracks: number;
  playlists: number;
  albums: number;
  artists: number;
  durationSeconds: number;
}
export type LibraryPlaybackRequest = Pick<LibraryPageRequest<'tracks'>, 'query' | 'sort'>;
export interface ArtistMembership {
  id: string;
  name: string;
}
