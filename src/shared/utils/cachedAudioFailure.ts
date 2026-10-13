/** A transport failure or timeout does not prove downloaded audio is damaged. */
export function isCachedAudioDecodeError(error: { code?: number; kind?: string } | null): boolean {
  return Boolean(
    error && (!error.kind || error.kind === 'decode') && (error.code === 3 || error.code === 4),
  );
}
