type QueueItem = { id: string | number; queueEntryId?: string };
let serial = 0;

export function readQueueEntryId(item: object | undefined): string | undefined {
  const value = (item as { queueEntryId?: unknown } | undefined)?.queueEntryId;
  return typeof value === 'string' && value.length > 0 && value.length <= 384 ? value : undefined;
}

/** Recording IDs belong to providers/cache; entry IDs belong to one queue occurrence. */
export function queueEntryKey(item: QueueItem | undefined): string | undefined {
  return item ? (readQueueEntryId(item) ?? String(item.id)) : undefined;
}

export function createQueueEntry<T extends QueueItem>(track: T): T & { queueEntryId: string } {
  const uuid = globalThis.crypto?.randomUUID?.();
  const queueEntryId = uuid
    ? 'qe:' + uuid
    : 'qe:' +
      Date.now().toString(36) +
      ':' +
      (++serial).toString(36) +
      ':' +
      Math.random().toString(36).slice(2);
  return { ...track, queueEntryId };
}

/** Preserve existing occurrences across metadata updates; every insertion still gets its own ID. */
export function ensureQueueEntries<T extends QueueItem>(
  queue: readonly T[],
  previous: readonly QueueItem[] = [],
): T[] {
  const used = new Set<string>();
  const reserved = new Set(queue.map(readQueueEntryId).filter((key): key is string => !!key));
  const prior = new Map<string, { keys: string[]; cursor: number }>();
  for (const item of previous) {
    const entryId = readQueueEntryId(item);
    if (!entryId || reserved.has(entryId)) continue;
    const bucket = prior.get(String(item.id)) ?? { keys: [], cursor: 0 };
    bucket.keys.push(entryId);
    prior.set(String(item.id), bucket);
  }
  let changed = false;
  const result = queue.map((item) => {
    const explicit = readQueueEntryId(item);
    if (explicit && !used.has(explicit)) {
      used.add(explicit);
      return item;
    }
    const bucket = explicit ? undefined : prior.get(String(item.id));
    while (bucket && bucket.cursor < bucket.keys.length && used.has(bucket.keys[bucket.cursor]))
      bucket.cursor++;
    const reusable = bucket ? bucket.keys[bucket.cursor++] : undefined;
    let entry = reusable ? { ...item, queueEntryId: reusable } : createQueueEntry(item);
    while (used.has(entry.queueEntryId)) entry = createQueueEntry(item);
    used.add(entry.queueEntryId);
    changed = true;
    return entry;
  });
  return changed ? result : (queue as T[]);
}
