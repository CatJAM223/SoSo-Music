import type { Database } from 'sql.js';
import { libraryTasteKey, type LibraryTasteTrack } from '../../../shared/utils/libraryTaste.ts';

export interface LibraryTagEntry {
  genres: string[];
  updatedAt: number;
}

export function createLibraryTasteSchema(db: Database): void {
  db.run(
    'CREATE TABLE IF NOT EXISTS library_genre_tags (cache_key TEXT PRIMARY KEY, genres TEXT NOT NULL, updated_at INTEGER NOT NULL)',
  );
  db.run(
    'CREATE TABLE IF NOT EXISTS library_taste_preferences (id INTEGER PRIMARY KEY CHECK (id = 1), auto_analyze INTEGER NOT NULL)',
  );
}

export class LibraryTasteStore {
  private database: () => Database | null;
  private save: () => void;
  constructor(database: () => Database | null, save: () => void) {
    this.database = database;
    this.save = save;
  }

  tracks(): LibraryTasteTrack[] {
    const db = this.database();
    if (!db) return [];
    const statement = db.prepare(
      'SELECT deezer_id AS id, title, artist, 1 AS liked FROM liked_tracks UNION ALL SELECT track_deezer_id AS id, title, artist, 0 AS liked FROM playlist_tracks',
    );
    const disliked = new Set(
      (db.exec('SELECT track_id FROM disliked_tracks')[0]?.values || []).map((row) =>
        String(row[0]),
      ),
    );
    const unique = new Map<string, LibraryTasteTrack>();
    try {
      while (statement.step()) {
        const row = statement.getAsObject();
        const track = {
          id: String(row.id),
          title: String(row.title),
          artist: String(row.artist),
          liked: row.liked === 1,
        };
        if (disliked.has(track.id) || !track.title.trim() || !track.artist.trim()) continue;
        const key = libraryTasteKey(track);
        const existing = unique.get(key);
        if (!existing || track.liked) unique.set(key, track);
      }
    } finally {
      statement.free();
    }
    return [...unique.values()];
  }

  entries(): Map<string, LibraryTagEntry> {
    const entries = new Map<string, LibraryTagEntry>();
    const statement = this.database()?.prepare(
      'SELECT cache_key, genres, updated_at FROM library_genre_tags',
    );
    if (!statement) return entries;
    try {
      while (statement.step()) {
        const row = statement.getAsObject();
        try {
          const genres: unknown = JSON.parse(String(row.genres));
          if (Array.isArray(genres) && genres.every((genre) => typeof genre === 'string'))
            entries.set(String(row.cache_key), { genres, updatedAt: Number(row.updated_at) });
        } catch (error) {
          console.debug('[LibraryTaste] Invalid cached tags:', error);
        }
      }
    } finally {
      statement.free();
    }
    return entries;
  }

  put(key: string, genres: string[]): void {
    this.database()?.run(
      'INSERT OR REPLACE INTO library_genre_tags (cache_key, genres, updated_at) VALUES (?, ?, ?)',
      [key, JSON.stringify(genres), Date.now()],
    );
    this.save();
  }

  get autoAnalyze(): boolean {
    return (
      this.database()?.exec('SELECT auto_analyze FROM library_taste_preferences WHERE id = 1')[0]
        ?.values[0]?.[0] === 1
    );
  }

  setAutoAnalyze(enabled: boolean): void {
    this.database()?.run(
      'INSERT OR REPLACE INTO library_taste_preferences (id, auto_analyze) VALUES (1, ?)',
      [Number(enabled)],
    );
    this.save();
  }
}
