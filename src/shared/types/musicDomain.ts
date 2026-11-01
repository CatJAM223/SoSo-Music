import type { Track } from '../types/index.ts';
import { detectTrackSource } from '../utils/formatters.ts';
import { readQueueEntryId } from '../utils/queueEntry.ts';

export type Provider = 'youtube' | 'soundcloud' | 'deezer';
export interface ProviderTrackRef {
  provider: Provider;
  providerId: string;
}
export interface Recording {
  id: string;
  title: string;
  artist: string;
  duration: number;
}
export interface PlayableSource {
  recordingId: string;
  providerTrack: ProviderTrackRef;
  url: string;
  resolvedAt: number;
  expiresAt?: number;
}
export interface QueueEntry {
  id: string;
  recording: Recording;
  providerTrack: ProviderTrackRef;
}
export type CatalogTrack = { id: string | number; source?: Provider; recordingId?: string };
export function providerTrackRef(track: CatalogTrack): ProviderTrackRef {
  const provider = detectTrackSource(track);
  const providerId = String(track.id).replace(
    provider === 'youtube' ? /^yt_/ : provider === 'soundcloud' ? /^sc_/ : /^dz_/,
    '',
  );
  return { provider, providerId };
}
/** No title hash: unmatched provider uploads stay distinct until a verified alias is stored. */
export function recordingKey(track: CatalogTrack): string {
  return track.recordingId || providerRecordingKey(providerTrackRef(track));
}
export function providerRecordingKey(ref: ProviderTrackRef): string {
  return 'rec:' + ref.provider + ':' + encodeURIComponent(ref.providerId);
}
export function recordingFromTrack(track: Track): Recording {
  return {
    id: recordingKey(track),
    title: track.title,
    artist: track.artist?.name || '',
    duration: track.duration,
  };
}
export function queueEntryFromTrack(track: Track): QueueEntry {
  const id = readQueueEntryId(track);
  if (!id) throw Error('Queue occurrence has no ID');
  return { id, recording: recordingFromTrack(track), providerTrack: providerTrackRef(track) };
}
