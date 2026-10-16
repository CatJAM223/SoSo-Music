import type { Database, SqlValue } from 'sql.js';
import type {
  ArtistMembership,
  LibraryItems,
  LibraryKind,
  LibraryPage,
  LibraryPageRequest,
  LibraryPlaybackRequest,
  LibraryStats,
} from '../../../shared/types/libraryPage';
import type { LikedTrack } from '../../../shared/types';
type CanonicalText = (value: string) => string;
const layouts = {
  tracks: {
    table: 'liked_tracks',
    pk: 'deezer_id',
    date: 'liked_at',
    title: 'title',
    search: ['title', 'artist', 'album'],
    select: '*',
  },
  playlists: {
    table: 'playlists',
    pk: 'id',
    date: 'created_at',
    title: 'name',
    search: ['name', 'description'],
    select:
      '*, (SELECT COUNT(*) FROM playlist_tracks pt WHERE pt.playlist_id = playlists.id) AS track_count',
  },
  albums: {
    table: 'saved_albums',
    pk: 'album_id',
    date: 'saved_at',
    title: 'title',
    search: ['title', 'artist_name'],
    select: '*, album_id AS id',
  },
  artists: {
    table: 'followed_artists',
    pk: 'id',
    date: 'followed_at',
    title: 'name',
    search: ['name'],
    select: '*',
  },
} as const;
export function validateLibraryRequest(input: unknown): Required<LibraryPageRequest> {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new TypeError('Invalid library request');
  const r = input as Record<string, unknown>;
  if (typeof r.kind !== 'string' || !Object.prototype.hasOwnProperty.call(layouts, r.kind))
    throw new TypeError('Invalid library kind');
  const sort = r.sort ?? 'recent';
  if (sort !== 'recent' && sort !== 'oldest' && sort !== 'title')
    throw new TypeError('Invalid library sort');
  if (r.query !== undefined && (typeof r.query !== 'string' || r.query.length > 512))
    throw new TypeError('Invalid library query');
  const offset = r.offset ?? 0,
    limit = r.limit ?? 100;
  if (
    typeof offset !== 'number' ||
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset > 10_000_000
  )
    throw new TypeError('Invalid library offset');
  if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > 200)
    throw new TypeError('Invalid library limit');
  return {
    kind: r.kind as LibraryKind,
    sort,
    query: String(r.query ?? '')
      .trim()
      .toLowerCase(),
    offset,
    limit,
  };
}
function prepare(db: Database, canonical: CanonicalText) {
  // Install on the current handle each read: recovery/import can replace it.
  db.create_function('soso_fold', (value: unknown) => String(value ?? '').toLowerCase());
  db.create_function('soso_playlist_fold', (value: unknown) =>
    canonical(String(value ?? '')).toLowerCase(),
  );
}
function rows<T>(db: Database, sql: string, values: SqlValue[] = []): T[] {
  const stmt = db.prepare(sql);
  try {
    stmt.bind(values);
    const out: T[] = [];
    while (stmt.step()) out.push(stmt.getAsObject() as unknown as T);
    return out;
  } finally {
    stmt.free();
  }
}
function queryParts(r: Required<LibraryPageRequest>) {
  const layout = layouts[r.kind];
  const fold = r.kind === 'playlists' ? 'soso_playlist_fold' : 'soso_fold';
  // INSTR treats %, _, quotes and backslashes literally; each field is separate.
  const where = r.query
    ? ' WHERE (' +
      layout.search.map((column) => 'INSTR(' + fold + '(' + column + '), ?) > 0').join(' OR ') +
      ')'
    : '';
  const params: SqlValue[] = r.query ? layout.search.map(() => r.query) : [];
  const sort =
    r.sort === 'title'
      ? fold + '(' + layout.title + ') ASC'
      : layout.date + (r.sort === 'oldest' ? ' ASC' : ' DESC');
  return {
    layout,
    where,
    params,
    order: ' ORDER BY ' + sort + ', ' + layout.pk + ' COLLATE BINARY ASC',
  };
}
function canonicalRows<K extends LibraryKind>(
  kind: K,
  values: LibraryItems[K][],
  canonical: CanonicalText,
): LibraryItems[K][] {
  if (kind === 'playlists')
    for (const value of values) {
      const row = value as LibraryItems['playlists'];
      row.name = canonical(row.name || '');
      row.description = canonical(row.description || '');
    }
  return values;
}
export function readLibraryPage<K extends LibraryKind>(
  db: Database | null,
  input: LibraryPageRequest<K>,
  canonical: CanonicalText,
): LibraryPage<K> {
  const r = validateLibraryRequest(input);
  if (!db) throw new Error('Database not initialized');
  prepare(db, canonical);
  const { layout, where, params, order } = queryParts(r);
  // sql.js operations are synchronous: count and rows share this invoke's DB snapshot.
  const total = Number(
    rows<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM ' + layout.table + where, params)[0]?.n || 0,
  );
  const items = canonicalRows(
    input.kind,
    rows<LibraryItems[K]>(
      db,
      'SELECT ' + layout.select + ' FROM ' + layout.table + where + order + ' LIMIT ? OFFSET ?',
      [...params, r.limit, r.offset],
    ),
    canonical,
  );
  const end = r.offset + items.length;
  return {
    kind: input.kind,
    items,
    total,
    offset: r.offset,
    nextOffset: end < total && items.length ? end : null,
  };
}
export function readLibraryPlaybackTracks(
  db: Database | null,
  input: LibraryPlaybackRequest,
  canonical: CanonicalText,
): LikedTrack[] {
  const r = validateLibraryRequest({ ...input, kind: 'tracks', offset: 0, limit: 100 });
  if (!db) throw new Error('Database not initialized');
  prepare(db, canonical);
  const { layout, where, params, order } = queryParts(r);
  // Deliberately unbounded only on an explicit play action, never on page mount.
  return rows<LikedTrack>(
    db,
    'SELECT ' + layout.select + ' FROM ' + layout.table + where + order,
    params,
  );
}
export function readLibraryStats(db: Database | null): LibraryStats {
  if (!db) throw new Error('Database not initialized');
  return rows<LibraryStats>(
    db,
    'SELECT (SELECT COUNT(*) FROM liked_tracks) AS tracks, (SELECT COUNT(*) FROM playlists) AS playlists, (SELECT COUNT(*) FROM saved_albums) AS albums, (SELECT COUNT(*) FROM followed_artists) AS artists, (SELECT COALESCE(SUM(CASE WHEN duration IS NULL OR duration = 0 THEN 180 ELSE duration END),0) FROM liked_tracks) AS durationSeconds',
  )[0];
}
export function readSavedAlbumIds(db: Database | null): string[] {
  if (!db) throw new Error('Database not initialized');
  return rows<{ album_id: string }>(db, 'SELECT album_id FROM saved_albums').map((row) =>
    String(row.album_id),
  );
}
export function readArtistMembership(db: Database | null): ArtistMembership[] {
  if (!db) throw new Error('Database not initialized');
  return rows<ArtistMembership>(db, 'SELECT id,name FROM followed_artists').map((row) => ({
    id: String(row.id),
    name: row.name,
  }));
}
