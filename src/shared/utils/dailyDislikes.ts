import { requireRustCompute } from '../compute/rustCore.ts';
import { dailyDecision } from '../compute/dailySelection.ts';
import { compareWaveSongBatch, createWaveSongMatrix } from '../compute/waveSongMatrix.ts';
import type { Track } from '../types/index.ts';
import { recordingKey } from '../types/musicDomain.ts';
import { tasteTrackId } from './tastePolicy.ts';
import {
  createWaveSongIdentifier,
  getWaveArtistNames,
  normalizeWaveArtist,
  type WaveSongIdentity,
} from './waveIdentity.ts';

export interface DailyDislikedTrack {
  id: string | number;
  recordingId?: string;
  title: string;
  artist: string;
}

/** Persisted track dislikes are the source of truth; undo needs no separate artist ban. */
export function createDailyDislikePolicy(disliked: readonly DailyDislikedTrack[]) {
  const knownArtists = disliked.flatMap((track) => getWaveArtistNames(track.artist));
  const knownArtistKeys = new Set(knownArtists.map(normalizeWaveArtist));
  const identifyDisliked = createWaveSongIdentifier(knownArtists);
  // Negative feedback needs exact credits: a musician's name can be part of
  // another musician's longer name. Infer uploader credits only across a separator.
  const artistKeys = (track: { title?: string; artist?: Track['artist'] | string }) => {
    const keys = new Set(getWaveArtistNames(track).map(normalizeWaveArtist));
    if (!/\bcover\b|кавер/i.test(track.title || '')) {
      const parts = (track.title || '').split(/\s+[-–—|]\s+/);
      if (parts.length > 1) {
        for (const part of parts) {
          for (const name of getWaveArtistNames(part)) {
            const key = normalizeWaveArtist(name);
            if (knownArtistKeys.has(key)) keys.add(key);
          }
        }
      }
    }
    return [...keys];
  };
  const identityOf = (track: {
    title?: string;
    artist?: Track['artist'] | string;
  }): WaveSongIdentity => ({
    ...identifyDisliked(track),
    artists: artistKeys(track),
  });
  const rejected = disliked.map((track) => ({
    id: tasteTrackId(track.id),
    song: identityOf(track),
  }));
  const packet = (track: { id?: unknown; title?: string; artist?: Track['artist'] | string }) => ({
    id: tasteTrackId(track.id),
    song: identityOf(track),
  });
  const largeDislikeSet = rejected.length > 4096;
  const rejectedRecordings = new Set(disliked.map(recordingKey));
  const recordingRejected = (track: Track) => rejectedRecordings.has(recordingKey(track));
  const byArtist = new Map<string, (typeof rejected)[number][]>();
  for (const item of rejected) {
    for (const artist of item.song.artists) {
      const representatives = byArtist.get(artist);
      if (!representatives) byArtist.set(artist, [item]);
      else if (
        representatives.length === 1 &&
        item.id !== representatives[0].id &&
        !(compareWaveSongBatch([representatives[0].song], item.song)[0] & 1)
      ) {
        representatives.push(item);
      }
    }
  }
  const countArtists = (artists: string[]) =>
    artists.reduce((highest, artist) => Math.max(highest, byArtist.get(artist)?.length ?? 0), 0);
  const rejectionCount = (track: Pick<Track, 'title' | 'artist'>) =>
    countArtists(artistKeys(track));
  const acceptsPacket = (item: ReturnType<typeof packet>) => {
    if (!rejected.length) return true;
    const candidate = [item];
    for (let start = 0; start < rejected.length; start += 512)
      if (!dailyDecision('daily_accepts', candidate, [], rejected.slice(start, start + 512)).length)
        return false;
    return true;
  };
  const accepts = (track: Track) =>
    !recordingRejected(track) && (!rejected.length || acceptsPacket(packet(track)));
  const knownIndexes = new WeakMap<
    Track[],
    {
      identify: ReturnType<typeof createWaveSongIdentifier>;
      ids: Set<string>;
      heard: WeakSet<Track>;
      fresh: WeakSet<Track>;
    }
  >();
  function* select(
    candidates: Track[],
    known: Track[],
    preserve: number,
    reuseImmutableKnown = false,
  ): Generator<void, Track[]> {
    if (rejectedRecordings.size) {
      const retained = candidates.slice(0, preserve).filter((track) => !recordingRejected(track));
      candidates = [
        ...retained,
        ...candidates.slice(preserve).filter((track) => !recordingRejected(track)),
      ];
      preserve = retained.length;
    }
    if (!candidates.length) return [];
    const blocked = largeDislikeSet ? [] : rejected;
    const large = known.length > 4096;
    let context = reuseImmutableKnown ? knownIndexes.get(known) : undefined;
    if (!context) {
      const names = new Set(knownArtists);
      const ids = new Set<string>();
      for (let index = 0; index < known.length; index++) {
        const track = known[index];
        for (const name of getWaveArtistNames(track)) names.add(name);
        if (large) {
          ids.add(tasteTrackId(track.id));
          if (index % 512 === 511) yield;
        }
      }
      context = {
        identify: createWaveSongIdentifier([...names]),
        ids,
        heard: new WeakSet(),
        fresh: new WeakSet(),
      };
      if (reuseImmutableKnown) knownIndexes.set(known, context);
    }
    const { identify, ids: knownIds, heard, fresh } = context;
    const encode = (track: Track) => ({
      id: tasteTrackId(track.id),
      song: identify(track),
      unavailable: track.playbackUnavailable,
    });
    if (largeDislikeSet) {
      // The WASM input is bounded. Carry the same rejection weights in stable
      // candidate order after excluding exact and alternate disliked versions.
      const ranked = candidates
        .map((track, index) => ({ track, retained: index < preserve, payload: encode(track) }))
        .filter(({ payload }) => acceptsPacket(payload))
        .map((item) => ({ ...item, count: countArtists(item.payload.song.artists) }));
      ranked.sort(
        (a, b) =>
          Number(b.retained) - Number(a.retained) ||
          (a.retained && b.retained ? 0 : a.count - b.count),
      );
      candidates = ranked.map(({ track }) => track);
      preserve = ranked.filter(({ retained }) => retained).length;
      if (!candidates.length) return [];
    }
    if (!large) {
      return dailyDecision(
        'daily_select',
        candidates.map(encode),
        known.map(encode),
        blocked,
        preserve,
      ).map((index) => candidates[index]);
    }
    let remaining = candidates.flatMap((track, index) =>
      track.playbackUnavailable || heard.has(track) || knownIds.has(tasteTrackId(track.id))
        ? []
        : [{ track, payload: encode(track), retained: index < preserve }],
    );
    // Keep every library song eligible for matching while bounding each packet.
    let unchecked = remaining.filter(({ track }) => !fresh.has(track));
    for (let offset = 0; unchecked.length && offset < known.length; offset += 512) {
      const songs = known.slice(offset, offset + 512).map(identify);
      const matrix = createWaveSongMatrix(
        unchecked.map(({ payload }) => payload.song),
        songs,
        [],
      );
      unchecked = unchecked.filter(({ payload, track }, index) => {
        if (matrix) {
          if (!matrix.wasHeard(index)) return true;
          heard.add(track);
          return false;
        }
        for (let at = 0; at < songs.length; at += 64) {
          if (compareWaveSongBatch(songs.slice(at, at + 64), payload.song).some((v) => v & 1)) {
            heard.add(track);
            return false;
          }
        }
        return true;
      });
      yield;
    }
    for (const { track } of unchecked) fresh.add(track);
    remaining = remaining.filter(({ track }) => !heard.has(track));
    return dailyDecision(
      'daily_select',
      remaining.map(({ payload }) => payload),
      [],
      blocked,
      remaining.filter(({ retained }) => retained).length,
    ).map((index) => remaining[index].track);
  }
  return {
    artistFeedback: Object.fromEntries(
      [...knownArtistKeys].map((artist) => [
        artist,
        requireRustCompute().daily_artist_feedback(
          rejectionCount({ title: '', artist: { name: artist } }),
        ),
      ]),
    ),
    rejectionCount,
    needsMore(count: number, attempt: number, added: number) {
      return !!requireRustCompute().daily_refill(count, attempt, added);
    },
    acceptsArtist(_name: string): boolean {
      return true;
    },
    accepts,
    select(candidates: Track[], known: Track[], preserve = 0): Track[] {
      const job = select(candidates, known, preserve);
      let step = job.next();
      while (!step.done) step = job.next();
      return step.value;
    },
    async selectAsync(
      candidates: Track[],
      known: Track[],
      preserve: number,
      yieldTurn: () => Promise<void>,
      reuseImmutableKnown = false,
    ): Promise<Track[]> {
      const job = select(candidates, known, preserve, reuseImmutableKnown);
      let step = job.next();
      while (!step.done) {
        await yieldTurn();
        step = job.next();
      }
      return step.value;
    },
  };
}

/** Collapse existing ID aliases and include a policy version to invalidate older daily caches. */
export function dailyDislikeKey(ids: Iterable<string>): string {
  return 'v3:' + JSON.stringify([...new Set([...ids].map(tasteTrackId).filter(Boolean))].sort());
}
