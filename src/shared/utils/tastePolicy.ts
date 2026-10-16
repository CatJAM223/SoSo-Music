import type { PlaybackOrigin, TastePolicySnapshot } from '../types/tastePolicy.ts';
/** Existing dz_ alias only; metadata similarity is not an exclusion identity. */
export function tasteTrackId(value: unknown): string {
  if (typeof value === 'number' && !Number.isFinite(value)) return '';
  if (typeof value !== 'number' && typeof value !== 'string') return '';
  const id = String(value).trim();
  if (!id || id.length > 256 || /[\u0000-\u001f]/.test(id)) return '';
  return id.replace(/^dz_/, '');
}
export function tasteContextId(value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  if (typeof value === 'number' && !Number.isFinite(value)) return '';
  const id = String(value).trim();
  return id && id.length <= 256 && !/[\u0000-\u001f]/.test(id) ? id : '';
}
export function normalizePlaybackOrigin(value: unknown): PlaybackOrigin | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const { kind, id } = value as Record<string, unknown>;
  if (
    !['playlist', 'album', 'artist', 'library', 'search', 'wave', 'manual'].includes(String(kind))
  )
    return undefined;
  const cleanId = tasteContextId(id);
  if (['playlist', 'album', 'artist'].includes(String(kind)) && !cleanId) return undefined;
  return { kind: kind as PlaybackOrigin['kind'], ...(cleanId ? { id: cleanId } : {}) };
}
type TasteTrack = {
  id?: unknown;
  deezer_id?: unknown;
  track_deezer_id?: unknown;
  queueOrigin?: unknown;
};
/** Evidence only: never use as a playback or recommendation candidate guard. */
export function isTasteEligible(track: TasteTrack, policy: TastePolicySnapshot): boolean {
  if (!track || typeof track !== 'object' || policy.revision < 0) return false;
  const id = tasteTrackId(track.track_deezer_id ?? track.deezer_id ?? track.id);
  if (!id) return false;
  const origin = normalizePlaybackOrigin(track.queueOrigin);
  return !policy.exclusions.some((rule) =>
    rule.scope === 'track' ? rule.id === id : origin?.kind === 'playlist' && rule.id === origin.id,
  );
}
export function withPlaybackOrigin<T extends object>(
  track: T,
  origin?: PlaybackOrigin,
): T & { queueOrigin: PlaybackOrigin } {
  return { ...track, queueOrigin: normalizePlaybackOrigin(origin) || { kind: 'manual' } };
}
export function tasteEvidenceKey(track: TasteTrack): string {
  const origin = normalizePlaybackOrigin(track.queueOrigin);
  return JSON.stringify([tasteTrackId(track.id), origin?.kind || '', origin?.id || '']);
}
export function filterTasteContext<
  T extends {
    tasteRevision?: number;
    positiveTracks?: TasteTrack[];
    skippedTracks?: TasteTrack[];
    learnedTracks?: TasteTrack[];
    artistFeedback?: Record<string, number>;
    discoveryAdjustment?: number;
  },
>(context: T, policy: TastePolicySnapshot): T {
  const fresh = context.tasteRevision === policy.revision;
  return {
    ...context,
    positiveTracks: (Array.isArray(context.positiveTracks) ? context.positiveTracks : []).filter(
      (track) => isTasteEligible(track, policy),
    ),
    skippedTracks: (Array.isArray(context.skippedTracks) ? context.skippedTracks : []).filter(
      (track) => isTasteEligible(track, policy),
    ),
    learnedTracks: (Array.isArray(context.learnedTracks) ? context.learnedTracks : []).filter(
      (track) => isTasteEligible(track, policy),
    ),
    artistFeedback: fresh ? context.artistFeedback : {},
    discoveryAdjustment: fresh ? context.discoveryAdjustment : 0,
  };
}
