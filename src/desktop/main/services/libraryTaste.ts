import type { Database } from 'sql.js';
import { setTimeout as wait } from 'node:timers/promises';
import type { Track } from '../../../shared/types/index.ts';
import type { LibraryTasteReport } from '../../../shared/types/libraryTaste.ts';
import {
  libraryTasteKey,
  libraryArtistKey,
  lastFmTrackTitle,
  libraryGenreNames,
  summarizeLibraryGenres,
  type LibraryTasteTrack,
} from '../../../shared/utils/libraryTaste.ts';
import { mapConcurrentSettled } from '../../../shared/utils/concurrentTasks.ts';
import { requestSignal } from '../../../shared/utils/requestSignal.ts';
import { LibraryTasteStore, type LibraryTasteSnapshot } from './libraryTasteStore.ts';
import { LastFmService } from './lastfm.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
const ARTIST_PREFIX = 'artist:';

export class LibraryTasteService {
  private store: LibraryTasteStore;
  private tags: (
    artist: string,
    title: string | undefined,
    signal: AbortSignal,
  ) => Promise<string[]>;
  private delayMs: number;
  private available: () => boolean;
  private controller?: AbortController;
  private progress = 0;
  private failed = 0;
  private error?: string;
  private timer?: ReturnType<typeof setInterval>;
  private pendingRefresh = false;
  private retryAfter = 0;
  private pausedKeys = new Set<string>();
  private autoChecked = new WeakSet<LibraryTasteSnapshot>();
  private summaries = new WeakMap<
    LibraryTasteSnapshot,
    {
      known: number;
      matched: number;
      updatedAt: number | null;
      genres: LibraryTasteReport['genres'];
    }
  >();

  constructor(
    database: () => Database | null,
    save: () => void,
    tags = (artist: string, title: string | undefined, signal: AbortSignal) =>
      LastFmService.getTopTags(artist, title, signal),
    delayMs = 350,
    available: () => boolean = () => true,
    revision?: () => number,
  ) {
    this.store = new LibraryTasteStore(database, save, revision);
    this.tags = tags;
    this.delayMs = delayMs;
    this.available = available;
  }

  report(): LibraryTasteReport {
    const snapshot = this.store.snapshot();
    const { tracks, entries } = snapshot;
    let summary = this.summaries.get(snapshot);
    if (!summary) {
      const known = tracks.flatMap((track) => {
        const entry = entries.get(libraryTasteKey(track));
        return entry ? [entry] : [];
      });
      summary = {
        known: known.length,
        matched: known.filter((entry) => entry.genres.length > 0).length,
        updatedAt: known.length
          ? known.reduce((latest, entry) => Math.max(latest, entry.updatedAt), 0)
          : null,
        genres: summarizeLibraryGenres(
          tracks,
          (track) => entries.get(libraryTasteKey(track))?.genres || [],
        ),
      };
      this.summaries.set(snapshot, summary);
    }
    return {
      autoAnalyze: snapshot.autoAnalyze,
      running: Boolean(this.controller),
      totalTracks: tracks.length,
      processedTracks: this.controller ? this.progress : summary.known,
      matchedTracks: summary.matched,
      missingTracks: summary.known - summary.matched,
      failedTracks: this.failed,
      updatedAt: summary.updatedAt,
      genres: summary.genres.map((genre) => ({ ...genre })),
      ...(this.error ? { error: this.error } : {}),
    };
  }

  analyze(onlyNew = false): LibraryTasteReport {
    if (!this.available()) return this.report();
    if (this.controller) {
      this.pendingRefresh ||= onlyNew;
      return this.report();
    }
    if (!onlyNew) {
      this.pausedKeys.clear();
      this.autoChecked = new WeakSet();
    }
    const snapshot = this.store.snapshot();
    if (onlyNew && this.autoChecked.has(snapshot)) return this.report();
    const { tracks, entries } = snapshot;
    const pending = tracks.filter((track) => {
      const key = libraryTasteKey(track);
      if (onlyNew && this.pausedKeys.has(key)) return false;
      const cached = entries.get(key);
      return (
        !cached ||
        (!onlyNew && Date.now() - cached.updatedAt >= (cached.genres.length ? 30 : 7) * DAY_MS)
      );
    });
    this.failed = 0;
    this.error = undefined;
    const pendingKeys = new Set(pending.map(libraryTasteKey));
    this.progress = tracks.filter(
      (track) => entries.has(libraryTasteKey(track)) && !pendingKeys.has(libraryTasteKey(track)),
    ).length;
    if (!pending.length) {
      if (onlyNew) this.autoChecked.add(snapshot);
      return this.report();
    }
    const controller = new AbortController();
    this.controller = controller;
    void this.run(pending, controller)
      .catch((error) => {
        if (!controller.signal.aborted) {
          console.error('[LibraryTaste] Analysis failed:', error);
          this.error = 'Не удалось сохранить анализ. Попробуйте ещё раз.';
        }
      })
      .finally(() => {
        if (this.controller !== controller) return;
        this.controller = undefined;
        if (this.pendingRefresh) {
          this.pendingRefresh = false;
          this.libraryChanged();
        }
      });
    return this.report();
  }

  private async run(tracks: LibraryTasteTrack[], controller: AbortController): Promise<void> {
    const signal = controller.signal;
    const entries = new Map(this.store.snapshot().entries);
    let consecutiveFailures = 0;
    for (const track of tracks) {
      if (signal.aborted) break;
      try {
        const genres = libraryGenreNames(
          await this.tags(track.artist, lastFmTrackTitle(track.title, track.artist), signal),
        );
        const artistKey = ARTIST_PREFIX + libraryArtistKey(track.artist);
        let fallback = entries.get(artistKey);
        if (!genres.length && (!fallback || Date.now() - fallback.updatedAt > 30 * DAY_MS)) {
          await wait(this.delayMs, undefined, { signal });
          const artistGenres = libraryGenreNames(await this.tags(track.artist, undefined, signal));
          this.store.put(artistKey, artistGenres);
          fallback = { genres: artistGenres, updatedAt: Date.now() };
          entries.set(artistKey, fallback);
        }
        signal.throwIfAborted();
        this.store.put(libraryTasteKey(track), genres.length ? genres : fallback?.genres || []);
        consecutiveFailures = 0;
      } catch (error) {
        if (signal.aborted) break;
        this.failed++;
        consecutiveFailures++;
        this.error =
          'Last.fm недоступен для части треков. Сохранённые результаты используются; повторите анализ позже.';
        console.debug('[LibraryTaste] Track tags unavailable:', error);
        // Avoid repeatedly hitting an unavailable API during automatic updates.
        this.retryAfter = Date.now() + 5 * 60 * 1000;
      }
      this.progress++;
      if (consecutiveFailures >= 3) break;
      if (!signal.aborted)
        await wait(this.failed ? Math.max(this.delayMs, 1000) : this.delayMs, undefined, {
          signal,
        }).catch((error) => {
          if (!signal.aborted) throw error;
        });
    }
  }

  setAutoAnalyze(enabled: boolean): LibraryTasteReport {
    this.store.setAutoAnalyze(enabled);
    if (enabled) {
      this.retryAfter = 0;
      this.pausedKeys.clear();
      this.libraryChanged();
    }
    return this.report();
  }

  libraryChanged(): void {
    if (this.store.autoAnalyze && Date.now() >= this.retryAfter) this.analyze(true);
  }

  start(): void {
    if (this.timer) return;
    this.libraryChanged();
    // Also covers imports and library changes outside the ordinary like/playlist handlers.
    this.timer = setInterval(() => this.libraryChanged(), 30000);
    this.timer.unref();
  }

  cancel(): LibraryTasteReport {
    this.pendingRefresh = false;
    this.pausedKeys = new Set(this.store.snapshot().tracks.map(libraryTasteKey));
    this.autoChecked = new WeakSet();
    this.controller?.abort();
    this.controller = undefined;
    return this.report();
  }

  dispose(): void {
    clearInterval(this.timer);
    this.timer = undefined;
    this.cancel();
    this.store.clearCache();
  }

  enrichCached(tracks: readonly Track[]): Track[] {
    const entries = this.store.snapshot().entries;
    return tracks.map((track) => {
      const identity = { title: track.title || '', artist: track.artist?.name || '' };
      const trackGenres = entries.get(libraryTasteKey(identity))?.genres;
      const genres = trackGenres?.length
        ? trackGenres
        : entries.get(ARTIST_PREFIX + libraryArtistKey(identity.artist))?.genres || [];
      return genres.length
        ? { ...track, tags: [...new Set([...genres, ...(track.tags || [])])].slice(0, 16) }
        : track;
    });
  }

  async enrichCandidates(tracks: Track[], signal?: AbortSignal): Promise<Track[]> {
    const cached = this.enrichCached(tracks);
    if (!this.report().genres.length) return cached;
    const artists = [
      ...new Set(
        cached
          .filter((track) => !libraryGenreNames([track.genre || '', ...(track.tags || [])]).length)
          .map((track) => track.artist?.name)
          .filter(Boolean),
      ),
    ].slice(0, 12);
    const replies = await mapConcurrentSettled(
      artists,
      async (artist) => {
        const info = await LastFmService.getArtistInfo(artist, requestSignal(signal, 1500));
        return libraryGenreNames(info?.tags || []);
      },
      3,
    );
    signal?.throwIfAborted();
    const genres = new Map(
      artists.map((artist, index) => {
        const reply = replies[index];
        return [artist, reply.status === 'fulfilled' ? reply.value : []] as const;
      }),
    );
    return cached.map((track) =>
      genres.get(track.artist?.name)?.length
        ? {
            ...track,
            tags: [
              ...new Set([...(genres.get(track.artist.name) || []), ...(track.tags || [])]),
            ].slice(0, 16),
          }
        : track,
    );
  }
}
