import type { Track } from '../types/index.ts';
import { buildWaveSongIdentity, getWaveArtistNames, isWaveNonMusic } from './waveIdentity.ts';
import { createSongDeduplicator } from '../compute/waveSongMatrix.ts';
import { withWaveTextCache } from '../compute/waveTextCache.ts';
import { isWaveMixOrPodcast, isWaveTempoEdit } from './waveQueue.ts';

/** Automated song lists require a measured duration; ordinary search stays unrestricted. */
export function isDiscoverySong(track: Track): boolean {
  const duration = Number(track.duration);
  const artist = typeof track.artist === 'string' ? track.artist : track.artist?.name;
  return (
    !!track.id &&
    !!track.title?.trim() &&
    !!artist?.trim() &&
    !/^unknown(?: artist)?$/i.test(artist.trim()) &&
    !track.playbackUnavailable &&
    Number.isFinite(duration) &&
    duration >= 40 &&
    duration <= 900 &&
    !isWaveNonMusic(track) &&
    !isWaveMixOrPodcast(track) &&
    !isWaveTempoEdit(track) &&
    !/\b(?:cover|fan[\s-]*made|fan[\s-]*remake|playlist|full concert|mix\s*tape)\b|кавер|полный концерт|\b\d+\s*(?:hours?|hrs?|час(?:а|ов)?|ч\.)\b|24\s*\/\s*7/i.test(
      track.title,
    )
  );
}

/** Keep provider ranking and the first version of a song, including cross-service reuploads. */
export function cleanDiscoveryTracks(tracks: Track[], limit = tracks.length): Track[] {
  if (limit <= 0) return [];
  return withWaveTextCache(() => {
    const result: Track[] = [];
    const seen = new Set<string>();
    // Keep the original artist scope, including credits outside the eventual result.
    const artists = [...new Set(tracks.flatMap((track) => getWaveArtistNames(track)))];
    const candidates = tracks.filter(isDiscoverySong);
    const songs = createSongDeduplicator(candidates, (track) =>
      buildWaveSongIdentity(track, artists),
    );
    for (let index = 0; index < candidates.length; index++) {
      const track = candidates[index];
      const key = `${track.source}:${track.id}`;
      if (seen.has(key) || songs.hasDuplicate(index)) continue;
      seen.add(key);
      songs.accept(index);
      result.push(track);
      if (result.length >= limit) break;
    }
    return result;
  });
}
