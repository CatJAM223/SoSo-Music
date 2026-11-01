import type { Track } from '../../../shared/types/index.ts';
import type { RecordingCatalog } from '../db/recordingCatalog.ts';
let catalog: RecordingCatalog | null = null;
let aliasChanged: (() => void) | undefined;
export function configureRecordingCatalog(value: RecordingCatalog, changed?: () => void): void {
  catalog = value;
  aliasChanged = changed;
}
/** Called only after a provider actually resolved a replacement source. */
export function recordResolvedAlias(original: Track, replacement: Track): void {
  try {
    if (catalog?.link(original, replacement)) aliasChanged?.();
  } catch (error) {
    console.warn('[RecordingCatalog] Could not persist alias', error);
  }
}
export function identifyCatalogTracks<T extends Track>(tracks: T[]): T[] {
  return catalog ? catalog.identify(tracks) : tracks;
}
