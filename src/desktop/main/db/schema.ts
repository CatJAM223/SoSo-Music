import type { Database } from 'sql.js';
import { createLibraryTasteSchema } from '../services/libraryTasteStore.ts';
import { createTastePolicySchema } from '../services/tastePolicyStore.ts';

const LIBRARY_TABLES = [
  `CREATE TABLE IF NOT EXISTS liked_tracks (
  deezer_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  album TEXT,
  album_id TEXT,
  cover_url TEXT,
  preview_url TEXT,
  duration INTEGER,
  liked_at DATETIME DEFAULT CURRENT_TIMESTAMP
);`,
  `CREATE TABLE IF NOT EXISTS saved_albums (
  album_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  artist_name TEXT NOT NULL,
  artist_id TEXT,
  cover_url TEXT,
  release_date TEXT,
  record_type TEXT,
  track_count INTEGER,
  saved_at DATETIME DEFAULT CURRENT_TIMESTAMP
);`,
  `CREATE TABLE IF NOT EXISTS followed_artists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  picture_url TEXT,
  followed_at DATETIME DEFAULT CURRENT_TIMESTAMP
);`,
  `CREATE TABLE IF NOT EXISTS playlists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  cover_url TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);`,
  `CREATE TABLE IF NOT EXISTS playlist_tracks (
  playlist_id TEXT NOT NULL,
  track_deezer_id TEXT NOT NULL,
  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  album TEXT,
  cover_url TEXT,
  preview_url TEXT,
  duration INTEGER,
  position INTEGER NOT NULL,
  added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (playlist_id, track_deezer_id)
);`,
  `CREATE TABLE IF NOT EXISTS search_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  query TEXT NOT NULL UNIQUE,
  searched_at DATETIME DEFAULT CURRENT_TIMESTAMP
);`,
  `CREATE TABLE IF NOT EXISTS track_scrobbles (
  track_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  play_count INTEGER DEFAULT 1,
  complete_count INTEGER DEFAULT 0,
  skip_count INTEGER DEFAULT 0,
  repeat_count INTEGER DEFAULT 0,
  last_played_at DATETIME DEFAULT CURRENT_TIMESTAMP
);`,
  `CREATE TABLE IF NOT EXISTS playback_sessions (
  session_id TEXT PRIMARY KEY,
  track_id TEXT NOT NULL,
  played_seconds REAL NOT NULL DEFAULT 0,
  completed INTEGER NOT NULL DEFAULT 0,
  skipped INTEGER NOT NULL DEFAULT 0,
  repeated INTEGER NOT NULL DEFAULT 0,
  started_at DATETIME DEFAULT CURRENT_TIMESTAMP
);`,
  `CREATE TABLE IF NOT EXISTS listening_daily_time (
  day TEXT PRIMARY KEY,
  played_seconds REAL NOT NULL DEFAULT 0
);`,
  `CREATE TABLE IF NOT EXISTS disliked_tracks (
  track_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  disliked_at DATETIME DEFAULT CURRENT_TIMESTAMP
);`,
  `CREATE TABLE IF NOT EXISTS listening_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  track_id TEXT NOT NULL,
  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  album TEXT,
  cover_url TEXT,
  source TEXT,
  duration INTEGER,
  played_at DATETIME DEFAULT CURRENT_TIMESTAMP
);`,
  `CREATE TABLE IF NOT EXISTS lyrics_cache (
  cache_key TEXT PRIMARY KEY,
  lyrics_json TEXT NOT NULL,
  synced INTEGER NOT NULL DEFAULT 0,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);`,
];

function ensureTextColumn(
  db: Database,
  table: 'liked_tracks' | 'playlists',
  column: 'album_id' | 'cover_url',
): void {
  const columns = db.exec('PRAGMA table_info(' + table + ');')[0]?.values || [];
  if (!columns.some((value) => value[1] === column))
    db.run('ALTER TABLE ' + table + ' ADD COLUMN ' + column + ' TEXT;');
}

function migrateLibrarySchema(db: Database): void {
  try {
    const version = Number(db.exec('PRAGMA user_version;')[0]?.values[0]?.[0]) || 0;
    if (version < 1) {
      db.run(
        'CREATE INDEX IF NOT EXISTS idx_playlist_tracks_pos ON playlist_tracks(playlist_id, position);',
      );
      db.run(
        'CREATE INDEX IF NOT EXISTS idx_playlist_tracks_track ON playlist_tracks(track_deezer_id);',
      );
      db.run('CREATE INDEX IF NOT EXISTS idx_liked_tracks_liked_at ON liked_tracks(liked_at);');
      db.run('CREATE INDEX IF NOT EXISTS idx_scrobbles_played ON track_scrobbles(last_played_at);');
      db.run('PRAGMA user_version = 1;');
    }
    if (version < 2) {
      ensureTextColumn(db, 'playlists', 'cover_url');
      db.run('PRAGMA user_version = 2;');
    }
  } catch (cause) {
    throw Object.assign(
      new Error('Не удалось обновить структуру медиатеки. Исходный файл не изменён.'),
      { cause },
    );
  }
}

export function initializeLibrarySchema(db: Database): void {
  createLibraryTasteSchema(db);
  try {
    db.run('PRAGMA foreign_keys = ON;');
  } catch {
    /* Compatibility with older SQLite runtimes. */
  }
  for (const sql of LIBRARY_TABLES) db.run(sql);
  createTastePolicySchema(db);
  ensureTextColumn(db, 'liked_tracks', 'album_id');
  db.run(`INSERT INTO listening_daily_time (day, played_seconds)
SELECT date(started_at, 'localtime'), SUM(played_seconds)
FROM playback_sessions
WHERE NOT EXISTS (SELECT 1 FROM listening_daily_time)
GROUP BY date(started_at, 'localtime')`);
  migrateLibrarySchema(db);
}
