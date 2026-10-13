import type { AutocompleteSuggestion } from '../types/index.ts';

/**
 * Builds the search query from an autocomplete suggestion.
 * Ensures the artist name is not dropped when searching for a track,
 * and handles artist-only searches and type-specific rules.
 */
export const getSuggestionSearchQuery = (
  item: AutocompleteSuggestion,
  onlyArtist = false,
): string => {
  if (onlyArtist && item.artist && item.artist !== 'SoundCloud' && item.artist !== 'Поиск') {
    return item.artist.trim();
  }
  if (item.type === 'artist') {
    return item.title.trim();
  }
  const cleanArtist = item.artist?.trim();
  const cleanTitle = item.title?.trim() || '';

  if (
    !cleanArtist ||
    cleanArtist.toLowerCase() === 'soundcloud' ||
    cleanArtist.toLowerCase() === 'поиск'
  ) {
    return cleanTitle;
  }

  if (cleanTitle.toLowerCase().includes(cleanArtist.toLowerCase())) {
    return cleanTitle;
  }

  return `${cleanArtist} - ${cleanTitle}`;
};
