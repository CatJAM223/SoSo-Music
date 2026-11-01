import { encodeSongs } from '../compute/songPacket.ts';
import { runRustCompute } from '../compute/rustCore.ts';
type RecordingMetadata = { title?: string; artist?: { name?: string } | string; duration?: number };
function packet(wanted: RecordingMetadata, candidate: RecordingMetadata) {
  // Text preparation only. Equality, duration and version decisions belong to Rust.
  const normalized = (value: string) =>
    value
      .normalize('NFKC')
      .toLocaleLowerCase()
      .replace(/[\[(](?:official (?:audio|video|music video)|audio|lyrics?)[\])]/g, '')
      .replace(/[^\p{L}\p{N}]/gu, '');
  return encodeSongs(
    [wanted, candidate].map((item) => {
      const title = normalized(item.title || '');
      const artist = normalized(
        typeof item.artist === 'string' ? item.artist : item.artist?.name || '',
      );
      return {
        print: {
          tokens: [title, artist + title],
          set: new Set([title, artist + title]),
          variants: new Set<string>(),
          dur: Number.isFinite(item.duration) ? item.duration || 0 : 0,
        },
        artists: artist ? [artist] : [],
      };
    }),
  );
}
function matchFlags(wanted: RecordingMetadata, candidate: RecordingMetadata): number {
  const result = runRustCompute('recording_match', packet(wanted, candidate));
  if (result.length !== 1) throw Error('Invalid recording match result');
  return result[0];
}
/** Provider replacement may tolerate uploader credits and small duration differences. */
export function matchesImportedRecording(
  wanted: RecordingMetadata,
  candidate: RecordingMetadata,
): boolean {
  return (matchFlags(wanted, candidate) & 1) !== 0;
}
/** Persistent aliases require complete, exact credits/version title and a <=2 second duration gap. */
export function matchesCanonicalRecording(
  wanted: RecordingMetadata,
  candidate: RecordingMetadata,
): boolean {
  return (matchFlags(wanted, candidate) & 2) !== 0;
}
