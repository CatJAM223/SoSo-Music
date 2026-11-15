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
  private options: CandidateOptions;
  private identify: ReturnType<typeof createWaveSongIdentifier>;
  constructor(options: CandidateOptions) {
    this.options = options;
    this.excluded = new Set(options.excluded.map(String));
    this.identify = createWaveSongIdentifier(options.familiarArtists);
    this.playedSongs = options.heard.map(this.identify);
  }
  get size(): number {
    return this.uniqueSongs.length;
  }
  values(): Track[] {
    return [...this.tracks.values()].map((track) => {
      const paths = this.uniqueSongs[this.trackGroups.get(String(track.id))!].paths;
      return paths.length ? { ...track, waveProvenance: paths } : track;
    });
  }

  add(track: Track, method?: WaveMethod, anchor?: string, identity?: WaveSongIdentity): boolean {
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
    const song = this.acceptedIdentity(track, identity);
    if (!song) return false;
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

  private acceptedIdentity(track: Track, identity?: WaveSongIdentity): WaveSongIdentity | undefined {
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
    if (this.options.disliked.some((disliked) => matchesDislikedWaveTrack(track, disliked)))
      return;
    if (!buildTrackPrintFromTrack(track).tokens.length) return;
    const song = identity ?? this.identify(track);
    if (this.playedSongs.some((played) => areSameWaveSong(played, song))) return;
    const duration = Number(track.duration) || 0;
    if (!requireRustCompute().wave_duration_allowed(duration)) return;
    if (!isWaveMixOrPodcast(track) && !isWaveGarbageRemix(track) && !isWaveNonMusic(track)) return song;
  }

  addRanked(
    tracks: readonly Track[],
    limit: number,
    expectedArtist?: string,
    method?: WaveMethod,
  ): void {
    const accepted: WaveSongIdentity[] = [];
    for (const track of tracks) {
      if (expectedArtist && !matchesWaveArtist(track, expectedArtist)) continue;
      const song = this.identify(track);
      const alreadyAccepted = accepted.some((previous) => areSameWaveSong(previous, song));
      if (!alreadyAccepted && accepted.length >= limit) continue;
      if (this.add(track, method, expectedArtist, song) && !alreadyAccepted) accepted.push(song);
    }
  }
}
