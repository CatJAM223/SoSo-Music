type TextKind = 'artist' | 'title';
const MAX_ENTRIES = 2048;
const MAX_TEXT_LENGTH = 1024;
let active: Record<TextKind, Map<string, string>> | null = null;

/** Synchronous scope: no history, user data or cache survives the batch. */
export function withWaveTextCache<T>(work: () => T): T {
  if (active) return work();
  active = { artist: new Map(), title: new Map() };
  try {
    return work();
  } finally {
    active = null;
  }
}

export function cachedWaveText(
  kind: TextKind,
  input: string,
  compute: (input: string) => string,
): string {
  const map = active?.[kind];
  if (!map || input.length > MAX_TEXT_LENGTH) return compute(input);
  const cached = map.get(input);
  if (cached !== undefined) return cached;
  const value = compute(input);
  if (map.size < MAX_ENTRIES && value.length <= MAX_TEXT_LENGTH) map.set(input, value);
  return value;
}
