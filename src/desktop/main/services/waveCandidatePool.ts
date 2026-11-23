import { requireRustCompute } from '../../../shared/compute/rustCore.ts';
import { matchesWaveSource } from '../../../shared/services/waveSource.ts';
import { isSoundCloudPreviewUrl } from '../../../shared/utils/soundcloudPlayback.ts';
import { resolveTrackCover } from '../../../shared/utils/formatters.ts';
import type { MusicSource, Track, WaveMood } from '../../../shared/types/index.ts';
import {
  mergeWaveProvenance,
  readWaveProvenance,
  type WaveMethod,
  type WaveProvenance,
} from '../../../shared/types/wavePolicy.ts';
import { buildTrackPrintFromTrack } from '../../../shared/utils/trackFingerprint.ts';
import {
  areSameWaveSong,
  createWaveSongIdentifier,
  createWaveShowMatcher,
  isWaveNonMusic,
  matchesWaveArtist,
  type WaveSongIdentity,
} from '../../../shared/utils/waveIdentity.ts';
import {
  isWaveMoodMismatch,
  isWaveMixOrPodcast,
  isWaveGarbageRemix,
  matchesDislikedWaveTrack,
  type DislikedWaveTrack,
} from '../../../shared/utils/waveQueue.ts';

interface CandidateOptions {
  source?: MusicSource;
  mood: WaveMood;
  excluded: readonly (string | number)[];
  disliked: readonly DislikedWaveTrack[];
  familiarArtists: string[];
  heard: readonly Track[];
  offered?: readonly Track[];
  oldestOffersFirst?: boolean;
}

function withFallbackArtwork(track: Track): Track {
  const album = track.album || { id: track.id, title: 'Single' };
  const cover = resolveTrackCover(track, '');
  if (!cover || album.cover_medium === cover) return track;
  return { ...track, album: { ...album, cover_medium: cover } };
}

/** Candidate validation is shared by likes, artist searches, radios and empty-profile fallback. */
export class WaveCandidatePool {
  private tracks = new Map<string, Track>();
  private uniqueSongs: { identity: WaveSongIdentity; paths: WaveProvenance[] }[] = [];
  private recordingGroups = new Map<string, number>();
  private trackGroups = new Map<string, number>();
  private excluded: Set<string>;
  private playedSongs: WaveSongIdentity[];
  private lastShow: ReturnType<typeof createWaveShowMatcher>;
  private options: CandidateOptions;
  private identify: ReturnType<typeof createWaveSongIdentifier>;
  constructor(options: CandidateOptions) {
    this.options = options;
    this.excluded = new Set(options.excluded.map(String));
    this.identify = createWaveSongIdentifier(options.familiarArtists);
    this.playedSongs = options.heard.map(this.identify);
    this.lastShow = createWaveShowMatcher(options.offered || [], options.familiarArtists);
  }
  get size(): number {
    return this.uniqueSongs.length;
  }
  count(predicate: (track: Track) => boolean): number {
    return new Set(
      [...this.tracks]
        .filter(([, track]) => predicate(track))
        .map(([id]) => this.trackGroups.get(id)),
    ).size;
  }
  values(): Track[] {
    return [...this.tracks.values()].map((track) => {
      const paths = this.uniqueSongs[this.trackGroups.get(String(track.id))!].paths;
      return paths.length ? { ...track, waveProvenance: paths } : track;
    });
  }

  add(track: Track, method?: WaveMethod, anchor?: string, identity?: WaveSongIdentity): boolean {
    const song = this.acceptedIdentity(track, identity);
    return song ? this.addAccepted(track, song, method, anchor) : false;
  }

  private addAccepted(
    track: Track,
    song: WaveSongIdentity,
    method?: WaveMethod,
    anchor?: string,
  ): boolean {
    const path =
      method &&
      readWaveProvenance({ method, provider: track?.source, anchor: anchor?.slice(0, 128) });
    const id = String(track?.id);
    const existing = this.trackGroups.get(id);
    if (existing !== undefined) {
      if (path) {
        const group = this.uniqueSongs[existing];
        group.paths = mergeWaveProvenance(group.paths, [path]);
      }
      return false;
    }
    let index =
      this.recordingGroups.get(track.recordingId || '') ??
      this.uniqueSongs.findIndex((previous) => areSameWaveSong(previous.identity, song));
    if (index < 0) {
      index = this.uniqueSongs.length;
      this.uniqueSongs.push({ identity: song, paths: [] });
    }
    if (path) {
      const group = this.uniqueSongs[index];
      group.paths = mergeWaveProvenance(group.paths, [path]);
    }
    if (track.recordingId) this.recordingGroups.set(track.recordingId, index);
    this.trackGroups.set(id, index);
    this.tracks.set(id, withFallbackArtwork(track));
    return true;
  }

  private acceptedIdentity(
    track: Track,
    identity?: WaveSongIdentity,
  ): WaveSongIdentity | undefined {
    if (
      !track ||
      !track.id ||
      track.playbackUnavailable ||
      isWaveMoodMismatch(track, this.options.mood)
    )
      return;
    if (!matchesWaveSource(track, this.options.source) || isSoundCloudPreviewUrl(track.preview))
      return;
    if (this.excluded.has(String(track.id))) return;
    if (this.options.disliked.some((disliked) => matchesDislikedWaveTrack(track, disliked))) return;
    if (!buildTrackPrintFromTrack(track).tokens.length) return;
    const song = identity ?? this.identify(track);
    if (this.playedSongs.some((played) => areSameWaveSong(played, song))) return;
    const duration = Number(track.duration) || 0;
    if (!requireRustCompute().wave_duration_allowed(duration)) return;
    if (!isWaveMixOrPodcast(track) && !isWaveGarbageRemix(track) && !isWaveNonMusic(track))
      return song;
  }

  addRanked(
    tracks: readonly Track[],
    limit: number,
    expectedArtist?: string,
    method?: WaveMethod,
    priority?: (track: Track) => number,
  ): number {
    const accepted: WaveSongIdentity[] = [];
    const sourceRanks = new Map<string, number>();
    const ranked = tracks
      .filter((track) => !expectedArtist || matchesWaveArtist(track, expectedArtist))
      .flatMap((track) => {
        const song = this.acceptedIdentity(track);
        if (!song) return [];
        const last = this.lastShow(track, song, !this.options.oldestOffersFirst);
        const exposure = this.options.oldestOffersFirst ? last : Number(last >= 0);
        const score = priority?.(track) ?? 0;
        const group = JSON.stringify([score, exposure, track.source]);
        const rank = sourceRanks.get(group) ?? 0;
        sourceRanks.set(group, rank + 1);
        return [{ track, song, exposure, score, rank }];
      })
      .sort(
        (a, b) => b.score - a.score || a.exposure - b.exposure || (priority ? a.rank - b.rank : 0),
      );
    for (const { track, song } of ranked) {
      const alreadyAccepted = accepted.some((previous) => areSameWaveSong(previous, song));
      if (!alreadyAccepted && accepted.length >= limit) continue;
      if (this.addAccepted(track, song, method, expectedArtist) && !alreadyAccepted)
        accepted.push(song);
    }
    return ranked.length;
  }
}
