import { matchesWaveSource } from '../../../shared/services/waveSource.ts';
import { isSoundCloudPreviewUrl } from '../../../shared/utils/soundcloudPlayback.ts';
import { resolveTrackCover } from '../../../shared/utils/formatters.ts';
import type { MusicSource, Track, WaveMood } from '../../../shared/types/index.ts';
import { buildTrackPrintFromTrack } from '../../../shared/utils/trackFingerprint.ts';
import {
  areSameWaveSong,
  buildWaveSongIdentity,
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

const MIN_RECORDING_SECONDS = 30;
const MAX_RECORDING_SECONDS = 480;
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
  private excluded: Set<string>;
  private playedSongs: WaveSongIdentity[];
  private options: CandidateOptions;
  constructor(options: CandidateOptions) {
    this.options = options;
    this.excluded = new Set(options.excluded.map(String));
    this.playedSongs = options.heard.map((track) =>
      buildWaveSongIdentity(track, options.familiarArtists),
    );
  }
  get size(): number {
    return this.tracks.size;
  }
  values(): Track[] {
    return [...this.tracks.values()];
  }

  add(track: Track): boolean {
    if (!this.accepts(track)) return false;
    this.tracks.set(String(track.id), withFallbackArtwork(track));
    return true;
  }

  private accepts(track: Track): boolean {
    if (
      !track ||
      !track.id ||
      track.playbackUnavailable ||
      isWaveMoodMismatch(track, this.options.mood)
    )
      return false;
    if (!matchesWaveSource(track, this.options.source) || isSoundCloudPreviewUrl(track.preview))
      return false;
    if (this.excluded.has(String(track.id)) || this.tracks.has(String(track.id))) return false;
    if (this.options.disliked.some((disliked) => matchesDislikedWaveTrack(track, disliked)))
      return false;
    if (!buildTrackPrintFromTrack(track).tokens.length) return false;
    const song = buildWaveSongIdentity(track, this.options.familiarArtists);
    if (this.playedSongs.some((played) => areSameWaveSong(played, song))) return false;
    const duration = Number(track.duration) || 0;
    if (duration > 0 && (duration < MIN_RECORDING_SECONDS || duration > MAX_RECORDING_SECONDS))
      return false;
    return !isWaveMixOrPodcast(track) && !isWaveGarbageRemix(track) && !isWaveNonMusic(track);
  }

  addRanked(tracks: readonly Track[], limit: number, expectedArtist?: string): void {
    const accepted: WaveSongIdentity[] = [];
    for (const track of tracks) {
      if (expectedArtist && !matchesWaveArtist(track, expectedArtist)) continue;
      const song = buildWaveSongIdentity(track, this.options.familiarArtists);
      const alreadyAccepted = accepted.some((previous) => areSameWaveSong(previous, song));
      if (!alreadyAccepted && accepted.length >= limit) continue;
      if (this.add(track) && !alreadyAccepted) accepted.push(song);
    }
  }
}
