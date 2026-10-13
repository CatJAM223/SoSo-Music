/** Bounded transient metadata; persistent library/statistics never belong here. */
export class BoundedMap<K, V> extends Map<K, V> {
  private capacity: number;
  private expiresAt?: (value: V) => number;
  private now: () => number;
  constructor(capacity: number, expiresAt?: (value: V) => number, now: () => number = Date.now) {
    super();
    if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError('Invalid cache capacity');
    this.capacity = capacity;
    this.expiresAt = expiresAt;
    this.now = now;
  }
  override get(key: K): V | undefined {
    const value = super.get(key);
    if (value === undefined) return undefined;
    if (this.expiresAt && this.expiresAt(value) <= this.now()) {
      super.delete(key);
      return undefined;
    }
    super.delete(key);
    super.set(key, value);
    return value;
  }
  override set(key: K, value: V): this {
    if (this.expiresAt) {
      const now = this.now();
      for (const [oldKey, item] of this) if (this.expiresAt(item) <= now) super.delete(oldKey);
    }
    super.delete(key);
    super.set(key, value);
    while (this.size > this.capacity) super.delete(this.keys().next().value!);
    return this;
  }
}
export class BoundedSet<T> extends Set<T> {
  private capacity: number;
  constructor(capacity: number) {
    super();
    if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError('Invalid cache capacity');
    this.capacity = capacity;
  }
  override add(value: T): this {
    super.delete(value);
    super.add(value);
    while (this.size > this.capacity) super.delete(this.values().next().value!);
    return this;
  }
}

export function setBoundedCacheEntry<Key, Value>(
  cache: Map<Key, Value>,
  key: Key,
  value: Value,
  maxSize: number,
): void {
  if (cache.size >= maxSize) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) cache.delete(oldestKey);
  }
  cache.set(key, value);
}
