import { readBoundedAudioBlob } from './audioCacheService.ts';
import { RustTsDemuxer } from '../compute/audioCore.ts';
/**
 * Offline Audio Cache Service
 * Provides IndexedDB-backed audio caching for offline playback and instantaneous loading.
 */

const DB_NAME = 'soso_offline_cache';
const DB_VERSION = 2;
const STORE_NAME = 'cached_tracks';
// Lightweight metadata store (no audio blobs) so listings/stats never need to
// load multi-megabyte blobs via getAll() — which silently fails once the cache grows.
const META_STORE = 'cached_meta';

// Object URLs created from IndexedDB blobs, so playback-error handling can tell
// offline-cache blobs apart from transient in-memory (audioCacheService) blobs.
const offlineBlobUrls = new Set<string>();

export interface CachedTrackRecord {
  trackId: string;
  title: string;
  artist: string;
  album: string;
  coverUrl: string;
  duration: number;
  source: string;
  blob: Blob;
  nativeStored?: boolean;
  nativeFileId?: string;
  coverBlob?: Blob;
  sizeBytes: number;
  cachedAt: string;
}

export type CachedTrackMeta = Omit<CachedTrackRecord, 'blob' | 'coverBlob'>;

export function toMetaRecord(record: Partial<CachedTrackRecord>): CachedTrackMeta {
  return {
    ...(record.nativeStored ? { nativeStored: true, nativeFileId: record.nativeFileId } : {}),
    trackId: String(record.trackId || ''),
    title: record.title || 'Untitled',
    artist: record.artist || 'Artist',
    album: record.album || '',
    coverUrl: record.coverUrl || '',
    duration: Number(record.duration) || 180,
    source: record.source || 'soundcloud',
    sizeBytes: Number(record.sizeBytes) || 0,
    cachedAt: record.cachedAt || new Date().toISOString(),
  };
}

let dbInstance: IDBDatabase | null = null;
const trackObjectUrls = new Map<string, string>();
const pendingTrackUrls = new Map<string, Promise<string | null>>();
const coverObjectUrls = new Map<string, string>();
const changeListeners = new Set<() => void>();
let cacheGeneration = 0;
const downloads = new Map<string, AbortController>();
const operations = new Map<string, AbortController>();
const MAX_OFFLINE_BYTES = 100 * 1024 * 1024;

export function subscribeOfflineCacheChanges(listener: () => void): () => void {
  changeListeners.add(listener);
  return () => {
    changeListeners.delete(listener);
  };
}
function notifyCacheChanged(): void {
  changeListeners.forEach((listener) => {
    try {
      listener();
    } catch {}
  });
}

async function getDB(): Promise<IDBDatabase> {
  if (dbInstance) return dbInstance;

  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      return reject(new Error('IndexedDB is not supported'));
    }

    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (event) => {
      const request = event.target as IDBOpenDBRequest;
      const db = request.result;
      const tx = request.transaction!;

      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'trackId' });
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: 'trackId' });
      }

      // v1 -> v2 migration: rebuild lightweight metadata from existing blob records
      if (event.oldVersion < 2) {
        try {
          const src = tx.objectStore(STORE_NAME);
          const metaStore = tx.objectStore(META_STORE);
          const cursorReq = src.openCursor();
          cursorReq.onsuccess = () => {
            const cursor = cursorReq.result;
            if (cursor) {
              try {
                metaStore.put(toMetaRecord(cursor.value));
              } catch {}
              cursor.continue();
            }
          };
        } catch (e) {
          console.warn('[OfflineCache] Metadata migration warning:', e);
        }
      }
    };

    req.onsuccess = () => {
      dbInstance = req.result;
      // Close the connection gracefully if another context upgrades the DB,
      // so the next call to getDB() re-opens a fresh connection.
      dbInstance.onversionchange = () => {
        dbInstance?.close();
        dbInstance = null;
        console.info(
          '[OfflineCache] DB connection closed — version change detected. Will re-open on next access.',
        );
      };
      resolve(dbInstance);
    };

    req.onerror = () => {
      dbInstance = null; // ensure next call to getDB() retries opening instead of using a null ref
      reject(req.error);
    };
  });
}

/**
 * Sniffs the first bytes of a downloaded blob. Returns the real audio MIME type,
 * or null when the payload is obviously not audio (HTML/JSON/XML error pages
 * from expired or protected CDN URLs). Unknown binary data is given the benefit
 * of the doubt (WebM/Opus, exotic containers) — the playability probe on first
 * playback still catches truly broken blobs.
 */
async function sniffAudioMime(blob: Blob): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const bytes = new Uint8Array(reader.result as ArrayBuffer);
          if (bytes.length < 12) return resolve(null);
          const ascii = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));
          // MP3 with ID3 tag
          if (ascii(0, 3) === 'ID3') return resolve('audio/mpeg');
          // ADTS AAC frame: sync 11111111 1111xxxx with layer bits 00
          if (bytes[0] === 0xff && (bytes[1] & 0xf6) === 0xf0) return resolve('audio/aac');
          // Raw MP3 frame sync
          if (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return resolve('audio/mpeg');
          // MP4 / M4A / fMP4 (CMAF) container
          const tag48 = ascii(4, 8);
          if (
            tag48 === 'ftyp' ||
            tag48 === 'styp' ||
            tag48 === 'moov' ||
            tag48 === 'moof' ||
            tag48 === 'sidx'
          ) {
            return resolve('audio/mp4');
          }
          // OGG / FLAC / WAV
          if (ascii(0, 4) === 'OggS') return resolve('audio/ogg');
          if (ascii(0, 4) === 'fLaC') return resolve('audio/flac');
          if (ascii(0, 4) === 'RIFF') return resolve('audio/wav');
          // WebM / Matroska (EBML)
          if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3)
            return resolve('audio/webm');

          // Known garbage: HTML / XML / JSON / plain-text error responses
          const head = ascii(0, Math.min(bytes.length, 48)).toLowerCase();
          if (
            head.startsWith('<!doctype') ||
            head.startsWith('<html') ||
            head.startsWith('<?xml') ||
            head.startsWith('{') ||
            head.startsWith('[') ||
            head.includes('<br') ||
            head.includes('error')
          ) {
            return resolve(null);
          }

          // Mostly-printable text is also not audio
          let printable = 0;
          const sample = bytes.slice(0, Math.min(bytes.length, 32));
          for (const b of sample) {
            if (b >= 0x20 && b <= 0x7e) printable++;
          }
          resolve(printable / sample.length < 0.85 ? 'application/octet-stream' : null);
        } catch {
          resolve(null);
        }
      };
      reader.onerror = () => resolve(null);
      reader.readAsArrayBuffer(blob.slice(0, 64));
    } catch {
      resolve(null);
    }
  });
}

export function parseHlsSegments(manifestText: string, streamUrl: string): string[] {
  const lines = manifestText.split('\n');
  const segmentUrls: string[] = [];
  const baseUrl = streamUrl.substring(0, streamUrl.lastIndexOf('/') + 1);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('#EXT-X-MAP')) continue;
    const m = trimmed.match(/URI="([^"]+)"/);
    if (m) {
      segmentUrls.push(m[1].startsWith('http') ? m[1] : new URL(m[1], baseUrl).href);
    }
    break;
  }

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const fullUrl = trimmed.startsWith('http') ? trimmed : new URL(trimmed, baseUrl).href;
    segmentUrls.push(fullUrl);
  }

  return segmentUrls;
}

/**
 * Downloads complete audio stream:
 * - If progressive direct audio (MP3/AAC): downloads full binary Blob.
 * - If HLS stream (.m3u8): fetches playlist, downloads all audio chunks (.ts),
 *   and concatenates them into a single monolithic binary Blob.
 */

function blobFromChunks(chunks: Uint8Array[], type: string): Blob {
  return new Blob(
    chunks.map((chunk) => Uint8Array.from(chunk).buffer),
    { type },
  );
}

export async function fetchCompleteAudioBlob(
  streamUrl: string,
  onProgress?: (progress: number) => void,
  signal?: AbortSignal,
): Promise<Blob> {
  signal?.throwIfAborted();
  const isHls = streamUrl.includes('.m3u8') || streamUrl.includes('audio/mpegurl');
  onProgress?.(0.18);

  // 1. Desktop native Electron download (zero CORS, full bypass, direct binary)
  if (!isHls && typeof window !== 'undefined' && (window as any).electronAPI?.downloadAudioBuffer) {
    try {
      const api = window.electronAPI;
      const requestId = crypto.randomUUID();
      const unsubscribe = api?.onAudioDownloadProgress?.((event) => {
        if (
          event.requestId === requestId &&
          Number.isFinite(event.totalBytes) &&
          event.totalBytes > 0 &&
          Number.isFinite(event.receivedBytes)
        ) {
          onProgress?.(
            0.18 + Math.min(0.62, Math.max(0, event.receivedBytes / event.totalBytes) * 0.62),
          );
        }
      });
      const cancel = () => {
        void api?.cancelAudioDownload?.(requestId);
      };
      signal?.addEventListener('abort', cancel, { once: true });
      let buffer: Uint8Array | ArrayBuffer | null;
      try {
        signal?.throwIfAborted();
        buffer = await api!.downloadAudioBuffer!(streamUrl, requestId);
        signal?.throwIfAborted();
      } finally {
        unsubscribe?.();
        signal?.removeEventListener('abort', cancel);
      }
      if (buffer && (buffer.byteLength > 15000 || (buffer as any).length > 15000)) {
        const bytes = buffer instanceof ArrayBuffer ? buffer : new Uint8Array(buffer).buffer;
        const blob = new Blob([bytes], { type: 'audio/mpeg' });
        // Validate immediately: a 200 HTML/JSON error page would otherwise be
        // accepted here and only die later — fall through to other transports.
        const mime = await sniffAudioMime(blob);
        if (mime && mime !== 'application/octet-stream') {
          onProgress?.(0.82);
          return mime !== blob.type ? new Blob([blob], { type: mime }) : blob;
        }
        console.warn(
          '[OfflineCache] Electron download returned non-audio payload, trying next transport',
        );
      }
    } catch (e) {
      signal?.throwIfAborted();
      console.warn('[OfflineCache] Electron native download notice:', e);
    }
  }

  if (!isHls) {
    const res = await fetch(streamUrl, { signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    const blob = await readBoundedAudioBlob(
      res,
      MAX_OFFLINE_BYTES,
      signal ?? new AbortController().signal,
    );
    if (!blob) throw new Error('Incomplete, invalid or oversized offline audio');
    if (blob.size < 15000) {
      throw new Error(`Downloaded audio blob is too small (${blob.size} bytes)`);
    }
    onProgress?.(0.82);
    return blob;
  }

  // HLS stream: fetch playlist and all chunks
  const manifestRes = await fetch(streamUrl, { signal });
  if (!manifestRes.ok) throw new Error(`Failed to fetch HLS manifest: ${manifestRes.status}`);
  let manifestText = await manifestRes.text();

  // If master playlist, pick sub-playlist
  if (manifestText.includes('#EXT-X-STREAM-INF')) {
    const lines = manifestText.split('\n');
    let subPlaylistUrl = '';
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith('#EXT-X-STREAM-INF') && i + 1 < lines.length) {
        const nextLine = lines[i + 1].trim();
        if (nextLine && !nextLine.startsWith('#')) {
          subPlaylistUrl = nextLine.startsWith('http')
            ? nextLine
            : new URL(nextLine, streamUrl).href;
          break;
        }
      }
    }
    if (subPlaylistUrl) {
      const subRes = await fetch(subPlaylistUrl, { signal });
      if (subRes.ok) {
        manifestText = await subRes.text();
        streamUrl = subPlaylistUrl;
      }
    }
  }

  if (/^#EXT-X-KEY:.*METHOD=(?!NONE(?:,|$))/m.test(manifestText))
    throw Error('Зашифрованный HLS поток не поддерживает офлайн скачивание');
  if (manifestText.includes('#EXT-X-BYTERANGE'))
    throw Error('HLS с диапазонами байтов не поддерживает офлайн скачивание');
  const discontinuities = new Set<number>();
  let segmentIndex = /^#EXT-X-MAP:/m.test(manifestText) ? 1 : 0;
  let discontinuity = false;
  for (const line of manifestText.split('\n').map((line) => line.trim())) {
    if (line === '#EXT-X-DISCONTINUITY') discontinuity = true;
    if (line && !line.startsWith('#')) {
      if (discontinuity) discontinuities.add(segmentIndex);
      discontinuity = false;
      segmentIndex++;
    }
  }
  // Extract all segment URLs
  const segmentUrls = parseHlsSegments(manifestText, streamUrl);

  if (segmentUrls.length === 0) {
    throw new Error('No audio segments found in HLS manifest');
  }

  // Bound each segment by the remaining whole-file budget.
  const audioChunks: Uint8Array[] = [];
  let downloadedBytes = 0;
  let directMime: string | null = null;
  let demuxer: RustTsDemuxer | null = null;
  let initialized = false;
  const BATCH_SIZE = 1;
  for (let i = 0; i < segmentUrls.length; i += BATCH_SIZE) {
    const batch = segmentUrls.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (url) => {
        // Desktop native download
        if (typeof window !== 'undefined' && (window as any).electronAPI?.downloadAudioBuffer) {
          try {
            const requestId = crypto.randomUUID();
            const cancel = () => {
              void window.electronAPI?.cancelAudioDownload?.(requestId);
            };
            signal?.throwIfAborted();
            signal?.addEventListener('abort', cancel, { once: true });
            let buf;
            try {
              buf = await window.electronAPI!.downloadAudioBuffer!(
                url,
                requestId,
                MAX_OFFLINE_BYTES - downloadedBytes,
              );
              signal?.throwIfAborted();
            } finally {
              signal?.removeEventListener('abort', cancel);
            }
            if (buf && (buf.byteLength > 1000 || (buf as any).length > 1000)) {
              return buf instanceof ArrayBuffer ? buf : new Uint8Array(buf).buffer;
            }
          } catch (e) {
            signal?.throwIfAborted();
          }
        }

        const segRes = await fetch(url, { signal });
        if (!segRes.ok) throw new Error(`Failed to download audio chunk: ${segRes.status}`);
        const part = await readBoundedAudioBlob(
          segRes,
          MAX_OFFLINE_BYTES - downloadedBytes,
          signal ?? new AbortController().signal,
        );
        if (!part) throw new Error('Invalid or oversized HLS segment');
        return await part.arrayBuffer();
      }),
    );
    for (let j = 0; j < results.length; j++) {
      const buffer = results[j];
      downloadedBytes += buffer.byteLength;
      if (downloadedBytes > MAX_OFFLINE_BYTES) throw new Error('Offline audio exceeds size limit');
      const bytes = new Uint8Array(buffer);
      if (!initialized) {
        const head = bytes.subarray(0, 16);
        const boxTag = String.fromCharCode(...head.subarray(4, 8));
        directMime = ['styp', 'ftyp', 'moov', 'sidx'].includes(boxTag)
          ? 'audio/mp4'
          : head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3
            ? 'audio/webm'
            : head[0] === 0xff && (head[1] & 0xf6) === 0xf0
              ? 'audio/aac'
              : head[0] === 0xff && (head[1] & 0xe0) === 0xe0
                ? 'audio/mpeg'
                : null;
        if (!directMime) demuxer = new RustTsDemuxer();
        initialized = true;
      }
      if (demuxer) {
        if (i + j > 0 && discontinuities.has(i + j)) demuxer.boundary();
        audioChunks.push(...demuxer.push(bytes));
      } else audioChunks.push(bytes);
    }
    onProgress?.(
      0.18 + (Math.min(segmentUrls.length, i + batch.length) / segmentUrls.length) * 0.64,
    );
  }

  const mime = demuxer ? demuxer.finish() : directMime;
  if (!mime) throw Error('Empty HLS audio stream');
  const blob = blobFromChunks(audioChunks, mime);
  if (blob.size < 20000) throw Error(`Combined audio size is too small (${blob.size} bytes)`);
  return blob;
}

export function getPossibleKeyVariants(trackId: string | number): string[] {
  const idStr = String(trackId);
  const cleanId = idStr.replace(/^(dz_|sc_|yt_|ym_|ya_)/i, '');
  return Array.from(new Set([idStr, cleanId, `dz_${cleanId}`, `sc_${cleanId}`, `yt_${cleanId}`]));
}

export const offlineCacheService = {
  /**
   * Check if a track is cached locally
   */
  async isTrackCached(trackId: string | number): Promise<boolean> {
    try {
      const db = await getDB();
      const keys = getPossibleKeyVariants(trackId);

      return new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        let index = 0;

        const checkNext = () => {
          if (index >= keys.length) {
            resolve(false);
            return;
          }
          const req = store.get(keys[index++]);
          req.onsuccess = () => {
            if (
              req.result &&
              (req.result.nativeStored || (req.result.blob && req.result.blob.size >= 20000))
            ) {
              resolve(true);
            } else {
              checkNext();
            }
          };
          req.onerror = () => checkNext();
        };

        checkNext();
      });
    } catch {
      return false;
    }
  },

  /**
   * Fetch audio stream and optional cover art, caching them in IndexedDB
   */
  beginDownload(trackId: string | number): { signal: AbortSignal; finish: () => void } {
    const id = String(trackId);
    operations.get(id)?.abort();
    const controller = new AbortController();
    operations.set(id, controller);
    return {
      signal: controller.signal,
      finish: () => {
        if (operations.get(id) === controller) operations.delete(id);
      },
    };
  },
  async cacheTrack(
    track: any,
    streamUrl: string,
    onProgress?: (progress: number) => void,
    signal?: AbortSignal,
  ): Promise<boolean> {
    if (!track || !streamUrl || signal?.aborted) return false;
    const generation = cacheGeneration;
    const trackId = String(track.id || track.track_id || track.deezer_id);
    if (downloads.has(trackId)) return false;
    const controller = new AbortController();
    signal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    downloads.set(trackId, controller);

    let native: { id: string; size: number } | undefined;
    let committed = false;
    try {
      const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
      if (api?.downloadAudioFile && !/m3u8|mpegurl|\/hls(?:\/|\?)/i.test(streamUrl)) {
        const requestId = crypto.randomUUID();
        const cancel = () => {
          void api.cancelAudioDownload?.(requestId);
        };
        const unsubscribe = api.onAudioDownloadProgress?.((event) => {
          if (event.requestId === requestId && event.totalBytes > 0)
            onProgress?.(0.18 + Math.min(0.62, (event.receivedBytes / event.totalBytes) * 0.62));
        });
        signal.throwIfAborted();
        signal.addEventListener('abort', cancel, { once: true });
        try {
          native = await api.downloadAudioFile(streamUrl, requestId);
        } finally {
          signal.removeEventListener('abort', cancel);
          unsubscribe?.();
        }
        signal.throwIfAborted();
      }
      let blob = native
        ? new Blob([])
        : await fetchCompleteAudioBlob(streamUrl, onProgress, signal);

      // Reject HTML/JSON error pages masquerading as audio — otherwise the
      // track shows up in the offline list and silently vanishes on first play
      // when the playability check purges the garbage blob.
      const sniffedMime = native ? 'application/octet-stream' : await sniffAudioMime(blob);
      if (!sniffedMime) {
        console.error(
          `[OfflineCache] Downloaded file for track ${trackId} is not audio (expired/protected CDN URL?) — discarding`,
        );
        throw new Error('Downloaded file is not valid audio');
      }

      // Store with the real container MIME — a WebM/Opus file labeled audio/mpeg
      // fails <audio> decoding and gets purged as "corrupted" on first playback.
      // Unknown binary (octet-stream) is kept as-is: the playability probe is the
      // final gate for exotic containers.
      if (sniffedMime !== 'application/octet-stream' && blob.type !== sniffedMime) {
        blob = new Blob([blob], { type: sniffedMime });
      }
      onProgress?.(0.88);

      const db = await getDB();

      const artistName =
        typeof track.artist === 'object'
          ? track.artist?.name || 'Artist'
          : String(track.artist || 'Artist');
      const albumTitle =
        typeof track.album === 'object' ? track.album?.title || '' : String(track.album || '');
      const coverUrl =
        track.cover_url ||
        track.album?.cover_medium ||
        track.album?.cover_xl ||
        track.album?.cover ||
        '';

      // Download cover image Blob if available
      let coverBlob: Blob | undefined;
      if (coverUrl && /^https?:\/\//i.test(coverUrl)) {
        try {
          const coverSignal = AbortSignal.any([signal, AbortSignal.timeout(5000)]);
          const coverRes = await fetch(coverUrl, { cache: 'force-cache', signal: coverSignal });
          if (coverRes.ok) {
            coverBlob =
              (await readBoundedAudioBlob(coverRes, 5 * 1024 * 1024, coverSignal)) ?? undefined;
          }
        } catch {
          // Gracefully continue if cover image fetch fails
        }
      }
      onProgress?.(0.94);

      const record: CachedTrackRecord = {
        trackId,
        title: track.title || 'Untitled',
        artist: artistName,
        album: albumTitle,
        coverUrl,
        duration: track.duration || 180,
        source: track.source || 'soundcloud',
        blob,
        coverBlob,
        ...(native ? { nativeStored: true, nativeFileId: native.id } : {}),
        sizeBytes: (native?.size ?? blob.size) + (coverBlob ? coverBlob.size : 0),
        cachedAt: new Date().toISOString(),
      };

      if (generation !== cacheGeneration || signal?.aborted) return false;

      const keys = getPossibleKeyVariants(trackId);
      const metaRecord = toMetaRecord(record);
      // A download started before clearing must not silently restore deleted audio.
      if (generation !== cacheGeneration || signal?.aborted) return false;

      return await new Promise<boolean>((resolve, reject) => {
        const tx = db.transaction([STORE_NAME, META_STORE], 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const metaStore = tx.objectStore(META_STORE);
        // Full audio blob written ONCE under the canonical key — writing it
        // under every alias key multiplied storage ×5 and blew the quota.
        store.put(record);
        // Lightweight metadata is cheap — index it under all alias keys so
        // listings/lookups by any id variant still work.
        keys.forEach((k) => {
          metaStore.put({ ...metaRecord, trackId: k });
        });
        tx.oncomplete = () => {
          committed = true;
          onProgress?.(1);
          notifyCacheChanged();
          resolve(true);
        };
        tx.onerror = () => reject(tx.error);
      });
    } catch (e) {
      console.error(`[OfflineCache] Failed to cache track ${trackId}:`, e);
      return false;
    } finally {
      if (native && !committed) {
        try {
          await window.electronAPI?.removeOfflineAudio?.(native.id);
        } catch {}
      }
      if (downloads.get(trackId) === controller) downloads.delete(trackId);
    }
  },

  /**
   * Retrieve cached Audio Blob as an Object URL
   */
  async getCachedTrackUrl(trackId: string | number): Promise<string | null> {
    const keys = getPossibleKeyVariants(trackId);
    for (const key of keys) if (trackObjectUrls.has(key)) return trackObjectUrls.get(key)!;
    const key = keys[0];
    const existing = pendingTrackUrls.get(key);
    if (existing) return existing;
    const generation = cacheGeneration;
    const pending = this.readCachedTrackUrl(trackId).then((url) => {
      if (url && generation !== cacheGeneration) {
        this.forgetBlobUrl(url);
        return null;
      }
      return url;
    });
    pendingTrackUrls.set(key, pending);
    try {
      return await pending;
    } finally {
      if (pendingTrackUrls.get(key) === pending) pendingTrackUrls.delete(key);
    }
  },

  /** Release only RAM handles. Downloaded files and their metadata remain in IndexedDB. */
  releaseUnusedTrackUrls(activeUrls: readonly (string | undefined | null)[]): void {
    const active = new Set(activeUrls.filter(Boolean));
    for (const url of [...offlineBlobUrls]) if (!active.has(url)) this.forgetBlobUrl(url);
  },

  async readCachedTrackUrl(trackId: string | number): Promise<string | null> {
    const keys = getPossibleKeyVariants(trackId);
    for (const k of keys) {
      if (trackObjectUrls.has(k)) {
        return trackObjectUrls.get(k)!;
      }
    }

    try {
      const db = await getDB();

      return new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        let index = 0;

        const checkNext = () => {
          if (index >= keys.length) {
            resolve(null);
            return;
          }
          const key = keys[index++];
          const req = store.get(key);
          req.onsuccess = () => {
            if (req.result?.nativeFileId) {
              const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
              Promise.resolve(api?.getOfflineAudioUrl?.(req.result.nativeFileId)).then(
                (url) => resolve(url ?? null),
                () => resolve(null),
              );
            } else if (req.result && req.result.blob) {
              // Sanity check: If blob is too small (< 20 KB), it's a corrupted/legacy text manifest -> clean it up!
              if (req.result.blob.size < 20000) {
                store.delete(key);
                checkNext();
              } else {
                const objectUrl = URL.createObjectURL(req.result.blob);
                offlineBlobUrls.add(objectUrl);
                keys.forEach((k) => trackObjectUrls.set(k, objectUrl));
                resolve(objectUrl);
              }
            } else {
              checkNext();
            }
          };
          req.onerror = () => checkNext();
        };

        checkNext();
      });
    } catch {
      return null;
    }
  },

  /**
   * True when the given blob: URL was created by this service (offline cache),
   * as opposed to a transient in-memory playback cache URL.
   */
  ownsBlobUrl(url: string): boolean {
    return (
      offlineBlobUrls.has(url) ||
      /^media:\/\/offline\/[a-f0-9-]{36}\.(?:mp4|mp3|webm|ogg|aac)$/.test(url)
    );
  },

  /**
   * Revoke and stop tracking an Object URL previously handed out by this service.
   */
  forgetBlobUrl(url: string): void {
    if (offlineBlobUrls.delete(url)) {
      try {
        URL.revokeObjectURL(url);
      } catch {}
      for (const [k, v] of trackObjectUrls.entries()) {
        if (v === url) trackObjectUrls.delete(k);
      }
    }
  },

  /**
   * Retrieve cached Cover Art as an Object URL
   */
  async getCachedCoverUrl(trackId: string | number): Promise<string | null> {
    const keys = getPossibleKeyVariants(trackId);
    for (const k of keys) {
      if (coverObjectUrls.has(k)) {
        return coverObjectUrls.get(k)!;
      }
    }

    try {
      const db = await getDB();
      return new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        let index = 0;

        const checkNext = () => {
          if (index >= keys.length) {
            resolve(null);
            return;
          }
          const key = keys[index++];
          const req = store.get(key);
          req.onsuccess = () => {
            if (req.result && req.result.coverBlob && req.result.coverBlob.size > 500) {
              const objUrl = URL.createObjectURL(req.result.coverBlob);
              coverObjectUrls.set(key, objUrl);
              resolve(objUrl);
            } else {
              checkNext();
            }
          };
          req.onerror = () => checkNext();
        };

        checkNext();
      });
    } catch {
      return null;
    }
  },

  /**
   * Get all cached track records (metadata only, no blobs)
   */
  async getAllCachedTracks(): Promise<CachedTrackMeta[]> {
    try {
      const db = await getDB();
      return new Promise((resolve) => {
        const tx = db.transaction(META_STORE, 'readonly');
        const store = tx.objectStore(META_STORE);
        const req = store.getAll();
        req.onsuccess = () => {
          const rawList = req.result || [];
          const seen = new Set<string>();
          const list: CachedTrackMeta[] = [];

          for (const r of rawList) {
            const cleanId = String(r.trackId).replace(/^(dz_|sc_|yt_|ym_|ya_)/i, '');
            const dedupKey = `${cleanId}_${(r.title || '').toLowerCase()}_${(r.artist || '').toLowerCase()}`;
            if (!seen.has(dedupKey)) {
              seen.add(dedupKey);
              list.push({
                ...(r.nativeStored ? { nativeStored: true, nativeFileId: r.nativeFileId } : {}),
                trackId: r.trackId,
                title: r.title,
                artist: r.artist,
                album: r.album,
                coverUrl: r.coverUrl,
                duration: r.duration,
                source: r.source,
                sizeBytes: r.sizeBytes,
                cachedAt: r.cachedAt,
              });
            }
          }
          resolve(list);
        };
        req.onerror = () => {
          console.error('[OfflineCache] Failed to list cached tracks:', req.error);
          resolve([]);
        };
      });
    } catch (e) {
      console.error('[OfflineCache] getAllCachedTracks error:', e);
      return [];
    }
  },

  /**
   * Delete a single track from the offline cache
   */
  async removeCachedTrack(trackId: string | number): Promise<boolean> {
    for (const key of getPossibleKeyVariants(trackId)) {
      downloads.get(key)?.abort();
      operations.get(key)?.abort();
    }
    const keys = getPossibleKeyVariants(trackId);
    keys.forEach((k) => {
      if (trackObjectUrls.has(k)) {
        const url = trackObjectUrls.get(k)!;
        try {
          URL.revokeObjectURL(url);
        } catch {}
        offlineBlobUrls.delete(url);
        trackObjectUrls.delete(k);
      }
      if (coverObjectUrls.has(k)) {
        try {
          URL.revokeObjectURL(coverObjectUrls.get(k)!);
        } catch {}
        coverObjectUrls.delete(k);
      }
    });

    try {
      const nativeIds = (await this.getAllCachedTracks())
        .filter((record) => keys.includes(record.trackId))
        .map((record) => record.nativeFileId)
        .filter(Boolean) as string[];
      const db = await getDB();
      return new Promise((resolve) => {
        const tx = db.transaction([STORE_NAME, META_STORE], 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const metaStore = tx.objectStore(META_STORE);
        keys.forEach((k) => {
          store.delete(k);
          metaStore.delete(k);
        });
        tx.oncomplete = () => {
          for (const id of nativeIds)
            void window.electronAPI?.removeOfflineAudio?.(id).catch(() => {});
          notifyCacheChanged();
          resolve(true);
        };
        tx.onerror = () => resolve(false);
      });
    } catch {
      return false;
    }
  },

  /**
   * Get total cache stats (deduplicated per track)
   */
  async getCacheStats(): Promise<{ count: number; totalBytes: number; formattedSize: string }> {
    try {
      const list = await this.getAllCachedTracks();
      const totalBytes = list.reduce((acc, it) => acc + (it.sizeBytes || 0), 0);
      const mb = (totalBytes / (1024 * 1024)).toFixed(1);
      return {
        count: list.length,
        totalBytes,
        formattedSize: `${mb} MB`,
      };
    } catch (e) {
      console.error('[OfflineCache] getCacheStats error:', e);
      return { count: 0, totalBytes: 0, formattedSize: '0 MB' };
    }
  },

  /**
   * Clear all offline cached tracks
   */
  async clearCache(): Promise<boolean> {
    for (const controller of operations.values()) controller.abort();
    operations.clear();
    for (const controller of downloads.values()) controller.abort();
    downloads.clear();
    cacheGeneration++;

    trackObjectUrls.forEach((url) => {
      try {
        URL.revokeObjectURL(url);
      } catch {}
      offlineBlobUrls.delete(url);
    });
    trackObjectUrls.clear();

    coverObjectUrls.forEach((url) => {
      try {
        URL.revokeObjectURL(url);
      } catch {}
    });
    coverObjectUrls.clear();

    try {
      const nativeIds = (await this.getAllCachedTracks())
        .map((record) => record.nativeFileId)
        .filter(Boolean) as string[];
      const db = await getDB();
      return new Promise((resolve) => {
        const tx = db.transaction([STORE_NAME, META_STORE], 'readwrite');
        tx.objectStore(STORE_NAME).clear();
        tx.objectStore(META_STORE).clear();
        tx.oncomplete = () => {
          for (const id of nativeIds)
            void window.electronAPI?.removeOfflineAudio?.(id).catch(() => {});
          notifyCacheChanged();
          resolve(true);
        };
        tx.onerror = () => resolve(false);
      });
    } catch {
      return false;
    }
  },
};
