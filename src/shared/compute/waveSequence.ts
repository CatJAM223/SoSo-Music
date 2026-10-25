import type { Track, WaveMood } from '../types/index.ts';
import type { WaveQueueOptions } from '../utils/waveQueue.ts';
import {
  getWaveArtistKeys,
  getWaveArtistNames,
  normalizeWaveArtist,
  buildWaveSongIdentity,
  isWaveNonMusic,
} from '../utils/waveIdentity.ts';
import {
  isWaveMoodMismatch,
  waveVersionFlags,
  isWaveRankingNonSong,
} from '../utils/waveTrackMetadata.ts';
import { waveMusicProfile } from '../utils/waveMusicProfile.ts';
import { withWaveTextCache } from './waveTextCache.ts';
import { encodeSongs, encodeNumbers, numericNames } from './songPacket.ts';
import { MAX_COMPUTE_INPUT, runRustCompute, waveMoodId } from './rustCore.ts';
/** This layer encodes metadata and maps Rust indices. It contains no alternative scorer. */
export function sequenceWaveIndices(
  tracks: Track[],
  mood: WaveMood,
  familiarArtists: string[],
  limit = 25,
  options: WaveQueueOptions = {},
): number[] {
  return withWaveTextCache(() => {
    if (tracks.length > 4096) throw Error('Очередь превышает лимит 4096 кандидатов');
    const groups = [
      tracks,
      options.recentTracks || [],
      options.offeredTracks || [],
      options.tasteTracks || [],
      options.positiveTracks || [],
      options.skippedTracks || [],
      options.learnedTracks || [],
    ];
    if (groups.some((g) => g.length > 4096)) throw Error('Wave context exceeds compute limit');
    const all = groups.flat();
    const known = [
      ...new Set([
        ...familiarArtists,
        ...tracks.flatMap(getWaveArtistNames),
        ...(options.recentTracks || []).flatMap(getWaveArtistNames),
      ]),
    ];
    const artists = numericNames(),
      styles = numericNames(),
      ids = numericNames(),
      sources = numericNames();
    const familiar = familiarArtists
      .flatMap(getWaveArtistNames)
      .map(normalizeWaveArtist)
      .map(artists.id);
    const feedback = [...(options.artistFeedback || [])].map(([name, value]) => [
      artists.id(name),
      value,
    ]);
    const recentArtists = (options.recentArtists || [])
      .slice(-40)
      .map((name) => getWaveArtistKeys({ artist: name }).map(artists.id));
    const genres = (options.libraryGenres || []).map((g) => [styles.id(g.name), g.share]);
    const aux: number[] = [];
    for (const track of all) {
      const keys = getWaveArtistKeys(track, known).map(artists.id),
        profile = waveMusicProfile(track);
      aux.push(
        keys.length,
        ...keys,
        profile.energy,
        profile.styles.size,
        ...[...profile.styles].map(styles.id),
        ids.id(String(track.id)),
        Number(track.waveSeedWeight === 2),
      );
    }
    const songs = encodeSongs(
      all.map((t) => buildWaveSongIdentity(t, known)),
      [],
      [],
      artists,
    );
    const numeric = [
      0x46574f53,
      3,
      waveMoodId(mood),
      Number.isNaN(limit) ? 0 : Math.max(0, Math.min(tracks.length, Math.ceil(limit))),
      Number.isFinite(options.sequenceOffset)
        ? Math.max(0, Math.floor(options.sequenceOffset!))
        : 0,
      options.discoveryAdjustment ?? 0,
      ...groups.map((g) => g.length),
      Number(options.libraryGenres !== undefined),
      familiar.length,
      ...familiar,
      feedback.length,
    ];
    for (const pair of feedback) numeric.push(...pair);
    numeric.push(recentArtists.length);
    for (const group of recentArtists) numeric.push(group.length, ...group);
    numeric.push(genres.length);
    for (const genre of genres) numeric.push(...genre);
    const features: number[] = [];
    for (const track of tracks) {
      features.push(
        Number(
          !track.playbackUnavailable && !isWaveNonMusic(track) && !isWaveMoodMismatch(track, mood),
        ),
        waveVersionFlags(track),
        track.source ? sources.id(track.source) + 1 : 0,
        track.duration,
        Number(Number.isFinite(track.waveRadioScore)),
        Number.isFinite(track.waveRadioScore) ? track.waveRadioScore! : 0,
        track.waveGenreScore ?? NaN,
        Number(Boolean(track.album?.title && track.album.title !== 'Single')),
        Number(isWaveRankingNonSong(track)),
      );
    }
    const values = encodeNumbers([...numeric, ...aux, ...features]);
    const packet = new Uint8Array(4 + songs.length + values.length);
    if (packet.length > MAX_COMPUTE_INPUT) throw Error('Wave packet exceeds compute limit');
    new DataView(packet.buffer).setUint32(0, songs.length, true);
    packet.set(songs, 4);
    packet.set(values, 4 + songs.length);
    const result = runRustCompute('sequence_wave', packet);
    if (
      result.length % 4 ||
      result.length > Math.min(tracks.length, Math.max(0, Math.ceil(limit))) * 4
    )
      throw Error('Invalid Rust queue result');
    const view = new DataView(result.buffer, result.byteOffset, result.byteLength);
    const order = Array.from({ length: result.length / 4 }, (_, i) => view.getUint32(i * 4, true));
    if (order.some((i) => i >= tracks.length) || new Set(order).size !== order.length)
      throw Error('Invalid Rust queue indices');
    return order;
  });
}
