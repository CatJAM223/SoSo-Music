import type { Track, WaveBatchContext } from '../types/index.ts';
import { selectWaveRelatedSeeds } from '../utils/waveRecommendations.ts';
import {
  areSameWaveSong,
  buildWaveSongIdentity,
  getWaveArtistKeys,
  normalizeWaveArtist,
} from '../utils/waveIdentity.ts';
import { isWaveTempoEdit } from '../utils/waveQueue.ts';

interface DiscoveryOptions {
  related: (seed: Track) => Promise<Track[]>;
  accept: (track: Track) => boolean;
  familiarArtists: readonly string[];
  recentAnchorIds?: readonly string[];
  allowExpansion?: boolean;
  perRadio?: number;
  maxRadioPosition?: number;
}

/** At most three taste radios plus two nearby radios when the first pool is narrow. */
export async function gatherWaveDiscovery(
  seeds: readonly Track[],
  context: WaveBatchContext,
  options: DiscoveryOptions,
) {
  const anchors = selectWaveRelatedSeeds(seeds, context, 3, Math.random, options.recentAnchorIds);
  const familiar = new Set(options.familiarArtists.map(normalizeWaveArtist));
  const offeredSongs = (context.offeredTracks || []).map((track) =>
    buildWaveSongIdentity(track, options.familiarArtists),
  );
  const tracks: Track[] = [];
  const counts = new Map<string, number>();
  const usedAnchors: string[] = [];
  const collect = async (selected: Track[], perRadio: number) => {
    const replies = await Promise.allSettled(
      selected.map((seed) =>
        Promise.resolve()
          .then(() => options.related(seed))
          .then((tracks) => (Array.isArray(tracks) ? tracks : [])),
      ),
    );
    const radioArtists = replies.map(() => new Set<string>());
    const accepted = replies.map(() => 0);
    replies.forEach((reply, i) => {
      if (reply.status === 'fulfilled' && reply.value.length)
        usedAnchors.push(String(selected[i].id));
    });
    const maxLength = Math.min(
      options.maxRadioPosition ?? 20,
      Math.max(
        0,
        ...replies.map((reply) => (reply.status === 'fulfilled' ? reply.value.length : 0)),
      ),
    );
    const offered = new Set(
      replies.flatMap((reply) =>
        reply.status === 'fulfilled'
          ? reply.value.slice(0, maxLength).filter((track) => {
              if (!track) return false;
              const song = buildWaveSongIdentity(track, options.familiarArtists);
              return offeredSongs.some((previous) => areSameWaveSong(previous, song));
            })
          : [],
      ),
    );
    // Keep radio order within each pass; reserve quotas for fresh songs before reusing proposals.
    for (const offeredPass of offered.size ? [false, true] : [false]) {
      // Interleave provider ranking so the first anchor cannot consume all discovery slots.
      for (let position = 0; position < maxLength && tracks.length < 18; position++) {
        for (let i = 0; i < replies.length && tracks.length < 18; i++) {
          const reply = replies[i];
          if (reply.status !== 'fulfilled' || accepted[i] >= perRadio) continue;
          const track = reply.value[position];
          if (!track || track.playbackUnavailable || offered.has(track) !== offeredPass) continue;
          const artists = getWaveArtistKeys(track, options.familiarArtists);
          if (
            !artists.length ||
            artists.some(
              (key) => familiar.has(key) || radioArtists[i].has(key) || (counts.get(key) || 0) >= 2,
            )
          )
            continue;
          // Preserve each radio's ranking across subsequent renderer resequencing.
          // Expansion from an unconfirmed discovery is weaker than a direct taste anchor.
          const rankedTrack = {
            ...track,
            waveRadioScore:
              ((selected[i].waveSeedWeight === 0.25 ? 0.5 : 1) / (1 + position * 0.15)) *
              (expanded ? 0.5 : 1),
          };
          if (!options.accept(rankedTrack)) continue;
          tracks.push(rankedTrack);
          accepted[i]++;
          for (const key of artists) {
            radioArtists[i].add(key);
            counts.set(key, (counts.get(key) || 0) + 1);
          }
        }
      }
    }
  };
  let expanded = false;
  await collect(anchors, options.perRadio ?? 6);
  if (options.allowExpansion !== false && counts.size < 8 && tracks.length > 0) {
    const originalIds = new Set(anchors.map((track) => String(track.id)));
    const nearby = tracks.filter(
      (track) =>
        !originalIds.has(String(track.id)) &&
        !isWaveTempoEdit(track) &&
        getWaveArtistKeys(track, options.familiarArtists).every(
          (key) => (context.artistFeedback?.[key] || 0) > -0.8,
        ),
    );
    const exploration = selectWaveRelatedSeeds(nearby, context, 2);
    if (exploration.length) {
      expanded = true;
      await collect(exploration, 6);
    }
  }
  return { tracks, usedAnchors, expanded };
}
