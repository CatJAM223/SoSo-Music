import type { RepeatMode, Track } from '../types/index.ts';

export const PLAYBACK_SESSION_KEY = 'soso_playback_session_v1';
export const PLAYBACK_SAVE_INTERVAL_MS = 10000;
const MAX_QUEUE = 500;
const MAX_SESSION_BYTES = 2 * 1024 * 1024;
export interface PlaybackSession {
  version: 1;
  savedAt?: number;
  track: Track;
  position: number;
  queue: Track[];
  queueIndex: number;
  repeatMode: RepeatMode;
  isShuffle: boolean;
}
export type PlaybackSessionInput = Omit<PlaybackSession, 'version'>;
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
function text(value: unknown, limit = 1024): string {
  return typeof value === 'string' ? value.slice(0, limit) : '';
}
function id(value: unknown): string | number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : typeof value === 'string' && value.length > 0 && value.length <= 256
      ? value
      : undefined;
}
// Scoped to one snapshot: nested fields are re-read and revalidated on the next save.
type ArtworkCache = Map<string, string | undefined>;
function cover(value: unknown, cache: ArtworkCache): string | undefined {
  const result = text(value, 4096);
  if (!result) return undefined;
  if (cache.has(result)) return cache.get(result);
  // Blob URLs and signed media addresses expire; retain stable artwork only.
  let stable: string | undefined;
  try {
    const url = new URL(result);
    if (
      ['http:', 'https:', 'media:', 'file:'].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !url.hostname.endsWith('googlevideo.com')
    )
      stable = result;
  } catch {
    /* Invalid artwork is omitted. */
  }
  cache.set(result, stable);
  return stable;
}
function cleanTrack(value: unknown, artworkCache: ArtworkCache): Track | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  const key = id(item.id),
    title = text(item.title);
  if (key === undefined || !title) return null;
  const artist =
    item.artist && typeof item.artist === 'object' ? (item.artist as Record<string, unknown>) : {};
  const album =
    item.album && typeof item.album === 'object' ? (item.album as Record<string, unknown>) : {};
  const source = ['youtube', 'soundcloud', 'deezer'].includes(String(item.source))
    ? (item.source as Track['source'])
    : undefined;
  return {
    id: key,
    title,
    source,
    duration:
      typeof item.duration === 'number' && Number.isFinite(item.duration)
        ? Math.max(0, item.duration)
        : 0,
    preview: '',
    artist: {
      id: id(artist.id),
      name: text(artist.name || item.artist) || 'Исполнитель',
      picture: cover(artist.picture, artworkCache),
      picture_medium: cover(artist.picture_medium, artworkCache),
    },
    album: {
      id: id(album.id),
      title: text(album.title || item.album),
      cover: cover(album.cover, artworkCache),
      cover_small: cover(album.cover_small, artworkCache),
      cover_medium: cover(album.cover_medium, artworkCache),
      cover_big: cover(album.cover_big, artworkCache),
      cover_xl: cover(album.cover_xl, artworkCache),
    },
    cover_url: cover(item.cover_url, artworkCache),
  };
}
export function clampPlaybackPosition(position: unknown, duration: number): number {
  if (typeof position !== 'number' || !Number.isFinite(position)) return 0;
  return Math.max(
    0,
    duration > 0 && Number.isFinite(duration) ? Math.min(position, duration) : position,
  );
}
function normalize(value: unknown): PlaybackSession | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as PlaybackSession;
  if (input.version !== 1) return null;
  const artworkCache: ArtworkCache = new Map();
  const track = cleanTrack(input.track, artworkCache);
  if (!track) return null;
  const sourceQueue = Array.isArray(input.queue) ? input.queue : [];
  const selectedIndex =
    Number.isInteger(input.queueIndex) &&
    input.queueIndex >= 0 &&
    String(sourceQueue[input.queueIndex]?.id) === String(track.id)
      ? input.queueIndex
      : sourceQueue.findIndex((t) => String(t?.id) === String(track.id));
  // Keep the current item and its successors even in a very large queue.
  const start = Math.max(0, selectedIndex - Math.floor(MAX_QUEUE / 2));
  const queue: Track[] = [];
  let queueIndex = -1;
  for (let i = start; i < Math.min(sourceQueue.length, start + MAX_QUEUE); i++) {
    const clean = cleanTrack(sourceQueue[i], artworkCache);
    if (clean) {
      if (i === selectedIndex) queueIndex = queue.length;
      queue.push(clean);
    }
  }
  if (queueIndex < 0) {
    queue.unshift(track);
    if (queue.length > MAX_QUEUE) queue.pop();
    queueIndex = 0;
  }
  queue[queueIndex] = track;
  return {
    version: 1,
    ...(typeof input.savedAt === 'number' && Number.isFinite(input.savedAt) && input.savedAt >= 0
      ? { savedAt: input.savedAt }
      : {}),
    track,
    queue,
    queueIndex,
    position: clampPlaybackPosition(input.position, track.duration),
    repeatMode: ['off', 'all', 'one'].includes(input.repeatMode) ? input.repeatMode : 'off',
    isShuffle: input.isShuffle === true,
  };
}
export function readPlaybackSession(store: Storage | null = storage()): PlaybackSession | null {
  try {
    const raw = store?.getItem(PLAYBACK_SESSION_KEY);
    return raw && raw.length <= MAX_SESSION_BYTES ? normalize(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

/** No timer, no stream credentials; unchanged checkpoints never rewrite storage. */
export class PlaybackSessionWriter {
  private savedAt = -Infinity;
  private serialized = '';
  private store: Storage | null;
  private now: () => number;
  constructor(store: Storage | null = storage(), now: () => number = Date.now) {
    this.store = store;
    this.now = now;
  }
  save(input: PlaybackSessionInput | null, force = false): boolean {
    if (!this.store || !input || (!force && this.now() - this.savedAt < PLAYBACK_SAVE_INTERVAL_MS))
      return false;
    const session = normalize({ ...input, version: 1, savedAt: undefined });
    if (!session) return false;
    const serialized = JSON.stringify(session);
    if (serialized.length > MAX_SESSION_BYTES) return false;
    if (serialized === this.serialized) {
      this.savedAt = this.now();
      return false;
    }
    const stored = JSON.stringify({ ...session, savedAt: this.now() });
    if (stored.length > MAX_SESSION_BYTES) return false;
    try {
      this.store.setItem(PLAYBACK_SESSION_KEY, stored);
      this.serialized = serialized;
      this.savedAt = this.now();
      return true;
    } catch {
      return false;
    }
  }
}
