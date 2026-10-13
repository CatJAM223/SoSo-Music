import type { Track, WaveMood } from '../../../shared/types/index.ts';
import type { LibraryTasteGenre } from '../../../shared/types/libraryTaste.ts';
import { libraryTasteKey } from '../../../shared/utils/libraryTaste.ts';
import { waveMusicProfile } from '../../../shared/utils/waveMusicProfile.ts';
import {
  areSameWaveSong,
  buildWaveSongIdentity,
  matchesWaveArtist,
  normalizeWaveArtist,
} from '../../../shared/utils/waveIdentity.ts';
import { mapConcurrentSettled, shuffled } from '../../../shared/utils/concurrentTasks.ts';
import type { WaveMoodCandidates } from './waveMoodCandidates.ts';
import type { LastFmGenreTrack } from './lastfm.ts';

type GenreDiscovery = { song: LastFmGenreTrack; genre: string };

export function selectWaveLibraryGenres(
  genres: readonly LibraryTasteGenre[],
  mood: WaveMood,
  random = Math.random,
): LibraryTasteGenre[] {
  if (mood === 'favorites') return [];
  const available = genres
    .filter((genre) => {
      if (!Number.isFinite(genre.share) || genre.share <= 0) return false;
      const energy = waveMusicProfile({ tags: [genre.name] }).energy;
      return mood === 'energy' ? energy >= 0 : mood === 'chill' ? energy <= 0 : true;
    })
    .sort((left, right) => right.share - left.share)
    .slice(0, 8);
  const selected: LibraryTasteGenre[] = [];
  while (available.length && selected.length < 2) {
    let threshold = random() * available.reduce((sum, genre) => sum + genre.share, 0);
    let index = 0;
    while (index < available.length - 1 && threshold >= available[index].share) {
      threshold -= available[index++].share;
    }
    selected.push(...available.splice(index, 1));
  }
  return selected;
}

function genreDiscoveryTargets(
  replies: readonly PromiseSettledResult<LastFmGenreTrack[]>[],
  selected: readonly LibraryTasteGenre[],
  options: WaveMoodCandidates,
  recent: readonly Track[],
): GenreDiscovery[] {
  const identities = recent.map((track) => buildWaveSongIdentity(track, options.artists));
  const seen = new Set<string>();
  const artists = new Set<string>();
  const targets: GenreDiscovery[] = [];
  replies.forEach((reply, index) => {
    if (reply.status !== 'fulfilled') return;
    let count = 0;
    for (const song of shuffled(reply.value)) {
      const key = libraryTasteKey(song);
      const artist = normalizeWaveArtist(song.artist);
      const identity = buildWaveSongIdentity(
        { title: song.title, artist: { name: song.artist } },
        options.artists,
      );
      if (
        seen.has(key) ||
        artists.has(artist) ||
        identities.some((heard) => areSameWaveSong(heard, identity))
      )
        continue;
      if (
        options.mood === 'discover' &&
        options.artists.some((known) => normalizeWaveArtist(known) === artist)
      )
        continue;
      seen.add(key);
      artists.add(artist);
      targets.push({ song, genre: selected[index].name });
      if (++count >= 3) break;
    }
  });
  return targets;
}

async function resolveGenreDiscovery(
  options: WaveMoodCandidates,
  { song, genre }: GenreDiscovery,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  const reply = await options.catalog.both(song.artist + ' ' + song.title, 5);
  signal?.throwIfAborted();
  const expected = buildWaveSongIdentity(
    { title: song.title, artist: { name: song.artist } },
    options.artists,
  );
  const addedSources = new Set<Track['source']>();
  for (const track of reply.data || []) {
    if (addedSources.has(track.source) || !matchesWaveArtist(track, song.artist)) continue;
    if (!areSameWaveSong(expected, buildWaveSongIdentity(track, options.artists))) continue;
    if (
      options.pool.add({
        ...track,
        tags: [...new Set([genre, ...(track.tags || [])])].slice(0, 16),
      })
    )
      addedSources.add(track.source);
  }
}

/** Last.fm supplies actual songs; provider searches must resolve that same artist and recording. */
export async function includeWaveGenreDiscovery(
  options: WaveMoodCandidates,
  genres: readonly LibraryTasteGenre[],
  recent: readonly Track[] = [],
  signal?: AbortSignal,
): Promise<void> {
  const selected = selectWaveLibraryGenres(genres, options.mood);
  if (!selected.length) return;
  const replies = await mapConcurrentSettled(
    selected,
    (genre) => options.catalog.genreTracks(genre.name),
    2,
  );
  signal?.throwIfAborted();
  const targets = genreDiscoveryTargets(replies, selected, options, recent);
  await mapConcurrentSettled(
    targets,
    (target) => resolveGenreDiscovery(options, target, signal),
    3,
  );
  signal?.throwIfAborted();
}
