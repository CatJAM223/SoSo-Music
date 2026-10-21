/** Bound allocation while reading, including chunked responses without Content-Length. */
export async function readBoundedAudioBlob(
  response: Response,
  limit: number,
  signal: AbortSignal,
): Promise<Blob | null> {
  const advertised = Number(response.headers.get('content-length'));
  if (advertised > limit) {
    await response.body?.cancel();
    return null;
  }
  if (!response.body || signal.aborted) {
    await response.body?.cancel();
    return null;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  try {
    for (;;) {
      if (signal.aborted) {
        await reader.cancel();
        return null;
      }
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > limit || signal.aborted) {
        await reader.cancel();
        return null;
      }
      chunks.push(part.value.slice());
    }
    return new Blob(chunks, { type: response.headers.get('content-type') || 'audio/mpeg' });
  } finally {
    reader.releaseLock();
  }
}

import type { Track } from '../types/index.ts';
import { platformBridge } from '../bridge/platformBridge.ts';
import { detectTrackSource } from '../utils/formatters.ts';

export interface CachedAudioItem {
  blobUrl: string;
  size: number;
  timestamp: number;
}

const DEFAULT_MAX_ITEMS = 4;
const DEFAULT_MAX_BYTES = 16 * 1024 * 1024;
const DEFAULT_CONCURRENT_FETCHES = 2;
const IDLE_RELEASE_MS = 60000;
const BLOB_DOWNLOAD_TIMEOUT_MS = 25000;
const MIN_AUDIO_BLOB_BYTES = 15000;

export class AudioCacheService {
  private cache = new Map<string, CachedAudioItem>();
  private activeFetches = new Map<string, Promise<string>>();
  private pendingPrefetches = new Map<string, Promise<void>>();
  public readonly MAX_CACHE_ITEMS: number;
  public readonly MAX_CACHE_BYTES: number;
  public readonly MAX_CONCURRENT_FETCHES: number;
  private pinnedUrl: string | null = null;
  private fetchControllers = new Map<string, AbortController>();
  private cacheGeneration = 0;
  private prefetchControllers = new Map<string, AbortController>();
  private playbackBuffering = false;
  private idleReleaseTimer: ReturnType<typeof setTimeout> | null = null;
  private lastTimestamp: number = 0;

  constructor(
    limits: { maxItems?: number; maxBytes?: number; maxConcurrentFetches?: number } = {},
  ) {
    this.MAX_CONCURRENT_FETCHES = limits.maxConcurrentFetches ?? DEFAULT_CONCURRENT_FETCHES;
    this.MAX_CACHE_ITEMS = limits.maxItems ?? DEFAULT_MAX_ITEMS;
    this.MAX_CACHE_BYTES = limits.maxBytes ?? DEFAULT_MAX_BYTES;
  }

  private nextTimestamp(): number {
    const now = Date.now();
    this.lastTimestamp = now > this.lastTimestamp ? now : this.lastTimestamp + 1;
    return this.lastTimestamp;
  }

  /**
   * Marks the blob URL currently assigned to the <audio> element so LRU
   * eviction never revokes it mid-playback.
   */
  public setPinnedUrl(url: string | null) {
    this.pinnedUrl = url;
  }

  /** The audible stream gets priority over bulk downloads during startup/stalls. */
  public setPlaybackBuffering(
    buffering: boolean,
    playback?: { trackId: string | number; signal: AbortSignal },
  ): void {
    this.playbackBuffering = buffering;
    if (!buffering) return;
    // Keep the selected resolution alive until playback acquires its own IPC lease.
    // Bulk downloads still stop, including downloads for the selected recording.
    const selectedId = playback && !playback.signal.aborted ? String(playback.trackId) : undefined;
    this.abortFetches(selectedId);
    if (selectedId === undefined || !playback) return;
    const controller = this.prefetchControllers.get(selectedId);
    const pending = this.pendingPrefetches.get(selectedId);
    if (!controller || !pending) return;
    const abort = () => {
      controller.abort();
      if (this.prefetchControllers.get(selectedId) === controller) {
        this.prefetchControllers.delete(selectedId);
        this.pendingPrefetches.delete(selectedId);
      }
    };
    playback.signal.addEventListener('abort', abort, { once: true });
    const cleanup = () => playback.signal.removeEventListener('abort', abort);
    void pending.then(cleanup, cleanup);
    if (playback.signal.aborted) abort();
  }

  public setPlaybackActive(active: boolean): void {
    if (this.idleReleaseTimer) clearTimeout(this.idleReleaseTimer);
    this.idleReleaseTimer = active
      ? null
      : setTimeout(() => {
          this.idleReleaseTimer = null;
          this.releaseUnused();
        }, IDLE_RELEASE_MS);
    this.idleReleaseTimer?.unref?.();
  }

  /** Keep the current blob valid for resume; release speculative downloads and other recordings. */
  public releaseUnused(): void {
    this.abortFetches();
    for (const [id, item] of this.cache) {
      if (item.blobUrl === this.pinnedUrl) continue;
      URL.revokeObjectURL(item.blobUrl);
      this.cache.delete(id);
    }
  }

  private abortFetches(preserveTrackId?: string): void {
    this.cacheGeneration++;
    for (const [id, controller] of this.prefetchControllers) {
      if (id === preserveTrackId) continue;
      controller.abort();
      this.prefetchControllers.delete(id);
    }
    for (const id of this.pendingPrefetches.keys()) {
      if (id !== preserveTrackId) this.pendingPrefetches.delete(id);
    }
    for (const controller of this.fetchControllers.values()) controller.abort();
    this.fetchControllers.clear();
    this.activeFetches.clear();
  }

  public isCached(trackId: string | number): boolean {
    return this.cache.has(String(trackId));
  }

  public getCachedBlobUrl(trackId: string | number): string | null {
    const item = this.cache.get(String(trackId));
    if (item) {
      item.timestamp = this.nextTimestamp();
      return item.blobUrl;
    }
    return null;
  }

  /**
   * Fetches the entire audio stream into an in-memory Blob and returns a local blob: URL.
   * Avoids repeat downloads while the item is retained; playback lifecycle is managed separately.
   */
  public async getOrFetchBlobUrl(trackId: string | number, streamUrl: string): Promise<string> {
    if (!streamUrl || typeof streamUrl !== 'string' || !streamUrl.startsWith('http'))
      return streamUrl;
    const id = String(trackId),
      existing = this.getCachedBlobUrl(id);
    if (existing) return existing;
    if (this.playbackBuffering || !AudioCacheService.canDownload(streamUrl)) return streamUrl;
    const pending = this.activeFetches.get(id);
    if (pending) return pending;
    if (this.activeFetches.size >= this.MAX_CONCURRENT_FETCHES) return streamUrl;
    const controller = new AbortController(),
      generation = this.cacheGeneration;
    this.fetchControllers.set(id, controller);
    const download = this.downloadBlob(id, streamUrl, controller, generation);
    this.activeFetches.set(id, download);
    return download;
  }

  private async downloadBlob(
    id: string,
    url: string,
    controller: AbortController,
    generation: number,
  ): Promise<string> {
    const timeout = setTimeout(() => controller.abort(), BLOB_DOWNLOAD_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        headers: { Accept: 'audio/*, */*' },
        signal: controller.signal,
      });
      if (!response.ok) return url;
      const blob = await readBoundedAudioBlob(response, this.MAX_CACHE_BYTES, controller.signal);
      if (generation !== this.cacheGeneration || controller.signal.aborted) return url;
      return this.storeDownloadedBlob(id, blob) || url;
    } catch (error) {
      if (!controller.signal.aborted)
        console.warn('[AudioCacheService] Blob download notice (playing directly):', error);
      return url;
    } finally {
      clearTimeout(timeout);
      if (generation === this.cacheGeneration) {
        this.activeFetches.delete(id);
        this.fetchControllers.delete(id);
      }
    }
  }

  private storeDownloadedBlob(id: string, blob: Blob | null): string | null {
    if (!blob || blob.size <= MIN_AUDIO_BLOB_BYTES || blob.size > this.MAX_CACHE_BYTES) return null;
    const url = URL.createObjectURL(blob);
    if (this.setCache(id, url, blob.size)) return url;
    URL.revokeObjectURL(url);
    return null;
  }

  private static canDownload(url: string): boolean {
    return (
      url.startsWith('http') && !AudioCacheService.isHlsUrl(url) && !url.includes('googlevideo.com')
    );
  }

  /**
   * Resolves upcoming tracks and caches eligible audio within the download budget.
   *
   * @param track         - The track to prefetch.
   * @param preResolvedUrl - Optional: a fresh stream URL already resolved by AudioContext's
   *                         resolvedStreamCache. When provided, the costly getFullStreamUrl
   *                         IPC call is skipped entirely, halving the prefetch network overhead.
   */
  public prefetchTrack(track: Track, preResolvedUrl?: string): Promise<void> {
    if (!track || !track.id || this.playbackBuffering) return Promise.resolve();
    const id = String(track.id);
    const existing = this.pendingPrefetches.get(id);
    if (existing) return existing;
    if (this.pendingPrefetches.size >= this.MAX_CONCURRENT_FETCHES) return Promise.resolve();
    const pending = this.performPrefetch(track, preResolvedUrl).finally(() => {
      if (this.pendingPrefetches.get(id) === pending) this.pendingPrefetches.delete(id);
    });
    this.pendingPrefetches.set(id, pending);
    return pending;
  }

  private async performPrefetch(track: Track, preResolvedUrl?: string): Promise<void> {
    const generation = this.cacheGeneration;
    const idStr = String(track.id);

    if (this.isCached(idStr)) return;
    const controller = new AbortController();
    this.prefetchControllers.set(idStr, controller);

    try {
      let streamUrl = preResolvedUrl;

      if (!streamUrl) {
        const effectiveSource = detectTrackSource(track);
        const artistName =
          track.artist?.name || (typeof track.artist === 'string' ? track.artist : '') || '';

        streamUrl = await platformBridge.getFullStreamUrl(
          {
            ...track,
            title: track.title,
            artist:
              typeof track.artist === 'object' && track.artist
                ? track.artist
                : { name: artistName },
            id: track.id,
            preview: track.preview,
            duration: track.duration,
            source: effectiveSource,
          },
          undefined,
          controller.signal,
        );
      }

      if (generation !== this.cacheGeneration || this.playbackBuffering) return;
      if (streamUrl && AudioCacheService.canDownload(streamUrl)) {
        await this.getOrFetchBlobUrl(idStr, streamUrl);
      }
    } catch (e) {
      if (!controller.signal.aborted)
        console.warn('[AudioCacheService] Prefetch notice for:', track.title, e);
    } finally {
      if (this.prefetchControllers.get(idStr) === controller)
        this.prefetchControllers.delete(idStr);
    }
  }

  /**
   * Purges a dead blob URL from the cache and revokes it. Must be called when
   * playback on this URL fails — otherwise the Map keeps handing out the dead
   * URL on every retry and the player stays broken until the app restarts.
   */
  public discardByUrl(url: string): void {
    if (!url || !url.startsWith('blob:')) return;
    if (this.pinnedUrl === url) this.pinnedUrl = null;
    for (const [k, v] of this.cache.entries()) {
      if (v.blobUrl === url) {
        this.cache.delete(k);
        break;
      }
    }
    try {
      URL.revokeObjectURL(url);
    } catch {}
  }

  public static isHlsUrl(url: string): boolean {
    if (!url || typeof url !== 'string') return false;
    const lower = url.toLowerCase();
    if (
      lower.includes('.m3u8') ||
      lower.includes('audio/mpegurl') ||
      lower.includes('application/x-mpegurl')
    ) {
      return true;
    }
    return /\/hls(\/|\?|$)/i.test(lower) || lower.includes('-hls-') || lower.includes('/hls/');
  }

  public getCacheSize(): number {
    return this.cache.size;
  }

  public getCacheBytes(): number {
    let size = 0;
    for (const item of this.cache.values()) size += item.size;
    return size;
  }

  public setCache(trackId: string, blobUrl: string, size: number = 0): boolean {
    if (size > this.MAX_CACHE_BYTES) return false;
    const previous = this.cache.get(trackId);
    if (previous?.blobUrl === this.pinnedUrl && previous.blobUrl !== blobUrl) return false;
    if (previous) {
      if (previous.blobUrl !== blobUrl && previous.blobUrl !== this.pinnedUrl)
        URL.revokeObjectURL(previous.blobUrl);
      this.cache.delete(trackId);
    }
    while (
      this.cache.size >= this.MAX_CACHE_ITEMS ||
      this.getCacheBytes() + size > this.MAX_CACHE_BYTES
    ) {
      // Evict oldest cached track (never the one currently playing)
      let oldestKey: string | null = null;
      let oldestTime = Infinity;
      for (const [k, v] of this.cache.entries()) {
        if (v.blobUrl === this.pinnedUrl) continue;
        if (v.timestamp < oldestTime) {
          oldestTime = v.timestamp;
          oldestKey = k;
        }
      }
      if (oldestKey) {
        const old = this.cache.get(oldestKey);
        if (old?.blobUrl?.startsWith('blob:')) {
          try {
            URL.revokeObjectURL(old.blobUrl);
          } catch (e) {}
        }
        this.cache.delete(oldestKey);
      } else return false;
    }
    this.cache.set(trackId, { blobUrl, size, timestamp: this.nextTimestamp() });
    return true;
  }

  public clear() {
    if (this.idleReleaseTimer) clearTimeout(this.idleReleaseTimer);
    this.idleReleaseTimer = null;
    this.abortFetches();
    for (const v of this.cache.values()) {
      if (v.blobUrl?.startsWith('blob:')) {
        try {
          URL.revokeObjectURL(v.blobUrl);
        } catch (e) {}
      }
    }
    this.cache.clear();
    this.activeFetches.clear();
    this.pinnedUrl = null;
  }
}

export const audioCacheService = new AudioCacheService(undefined);
