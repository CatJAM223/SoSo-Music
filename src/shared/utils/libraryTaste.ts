import type { LibraryTasteGenre } from '../types/libraryTaste.ts';
import { waveMusicProfile } from './waveMusicProfile.ts';

export interface LibraryTasteTrack {
  id: string;
  title: string;
  artist: string;
  liked: boolean;
}

function normalized(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function lastFmTrackTitle(title: string, artist: string): string {
  const prefix = title.match(/^(.+?)\s+[-–—]\s+(.+)$/u);
  const song = prefix && normalized(prefix[1]) === normalized(artist) ? prefix[2] : title;
  return song
    .replace(
      /\s*[([](?:official(?:\s+(?:music|lyric))?\s+(?:video|audio)|lyrics?|visuali[sz]er|\d+p)[)\]]/giu,
      '',
    )
    .trim();
}

export function libraryTasteKey(track: Pick<LibraryTasteTrack, 'title' | 'artist'>): string {
  return JSON.stringify([
    normalized(track.artist),
    normalized(lastFmTrackTitle(track.title, track.artist)),
  ]);
}

export function libraryArtistKey(artist: string): string {
  return normalized(artist);
}

export function libraryGenreNames(tags: readonly string[]): string[] {
  return [...waveMusicProfile({ tags: [...tags] }).styles];
}

export function summarizeLibraryGenres(
  tracks: readonly LibraryTasteTrack[],
  lookup: (track: LibraryTasteTrack) => readonly string[],
): LibraryTasteGenre[] {
  const artistWeights = new Map<string, number>();
  for (const track of tracks) {
    if (!lookup(track).length) continue;
    const artist = libraryArtistKey(track.artist);
    artistWeights.set(artist, (artistWeights.get(artist) || 0) + (track.liked ? 2 : 0.5));
  }
  const totals = new Map<string, { weight: number; tracks: number }>();
  let totalWeight = 0;
  for (const track of tracks) {
    const genres = [...new Set(lookup(track))];
    if (!genres.length) continue;
    // A large discography must not outweigh every other artist in the library.
    const artistWeight = artistWeights.get(libraryArtistKey(track.artist)) || 1;
    const weight = (track.liked ? 2 : 0.5) * Math.min(1, 6 / artistWeight);
    totalWeight += weight;
    for (const name of genres) {
      const previous = totals.get(name) || { weight: 0, tracks: 0 };
      totals.set(name, { weight: previous.weight + weight, tracks: previous.tracks + 1 });
    }
  }
  return [...totals]
    .map(([name, value]) => ({ name, tracks: value.tracks, share: value.weight / totalWeight }))
    .sort((left, right) => right.share - left.share || left.name.localeCompare(right.name));
}

export const LIBRARY_GENRE_MIN_SCORE = -2;
export const LIBRARY_GENRE_MAX_SCORE = 6;

export function libraryGenreAffinity(
  styles: ReadonlySet<string>,
  genres: readonly LibraryTasteGenre[],
): number {
  const knownGenres = genres.filter((genre) => Number.isFinite(genre.share) && genre.share > 0);
  if (!styles.size || !knownGenres.length) return 0;
  const dominantShare = Math.max(...knownGenres.map((genre) => genre.share));
  const matchedShare = Math.max(
    0,
    ...knownGenres.filter((genre) => styles.has(genre.name)).map((genre) => genre.share),
  );
  return matchedShare
    ? (matchedShare / dominantShare) * LIBRARY_GENRE_MAX_SCORE
    : LIBRARY_GENRE_MIN_SCORE;
}

export function boundedLibraryGenreScore(score: number | undefined): number {
  return Number.isFinite(score)
    ? Math.max(LIBRARY_GENRE_MIN_SCORE, Math.min(LIBRARY_GENRE_MAX_SCORE, score!))
    : 0;
}
