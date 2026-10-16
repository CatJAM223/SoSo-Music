import {
  TastePolicyStore,
  tasteTrackAllowedSql,
  tastePlaylistAllowedSql,
  tasteHistoryScoreSql,
} from '../services/tastePolicyStore.ts';
import { isTasteEligible } from '../../../shared/utils/tastePolicy.ts';
import { getElectronApp } from '../services/electronRuntime.ts';
import {
  readLibraryPage,
  readLibraryStats,
  readLibraryPlaybackTracks,
  readSavedAlbumIds,
  readArtistMembership,
} from './libraryPages.ts';
import type {
  LibraryKind,
  LibraryPage,
  LibraryPageRequest,
  LibraryPlaybackRequest,
} from '../../../shared/types/libraryPage';
import { statisticsArtworkSql } from './statisticsArtwork.ts';
import { initializeLibrarySchema } from './schema.ts';
import { loadSqliteRuntime } from './sqliteRuntime.ts';
import type { Database, SqlJsStatic } from 'sql.js';
import fs from 'node:fs';
import path from 'node:path';
import type {
  LikedTrack,
  LyricsLine,
  Playlist,
  PlaylistTrack,
  SavedAlbum,
  SearchHistoryItem,
} from '../../../shared/types/index.ts';
import type {
  ListeningStats,
  PlaybackSessionUpdate,
  SmartPlaylistKind,
  SmartPlaylistTrack,
} from '../../../shared/types/index.ts';
import { fixMojibake, decodeHtmlEntities } from '../../../shared/utils/formatters.ts';

function cleanCanonicalUrl(u?: string): string {
  if (!u) return '';
  if (u.includes('127.0.0.1') && u.includes('?url=')) {
    try {
      const parsed = new URL(u);
      return parsed.searchParams.get('url') || u;
    } catch (e) {
      return u;
    }
  }
  return u;
}

export interface DatabasePersistenceStatus {
  state: 'ready' | 'recovered' | 'error';
  message?: string;
}

export class DatabaseManager {
  public db: Database | null = null;
  private changeRevision = 0;
  private tastePolicy = new TastePolicyStore(
    () => this.db,
    () => this.save(true),
  );
  public getTastePolicy() {
    return this.tastePolicy.snapshot();
  }
  private tastePolicyListeners = new Set<
    (policy: import('../../../shared/types/tastePolicy.ts').TastePolicySnapshot) => void
  >();
  public onTastePolicyChanged(
    listener: (policy: import('../../../shared/types/tastePolicy.ts').TastePolicySnapshot) => void,
  ): () => void {
    this.tastePolicyListeners.add(listener);
    return () => {
      this.tastePolicyListeners.delete(listener);
    };
  }
  private publishTastePolicy(previousRevision: number): void {
    const policy = this.getTastePolicy();
    if (policy.revision === previousRevision) return;
    for (const listener of this.tastePolicyListeners) {
      try {
        listener({
          revision: policy.revision,
          exclusions: policy.exclusions.map((row) => ({ ...row })),
        });
      } catch (error) {
        console.warn('[TastePolicy] Observer failed after committed change:', error);
      }
    }
  }
  public setTasteExcluded(value: unknown) {
    const previousRevision = this.getTastePolicy().revision;
    const policy = this.tastePolicy.set(value);
    this.publishTastePolicy(previousRevision);
    return policy;
  }
  public getTasteLikedTracks() {
    const policy = this.getTastePolicy();
    return this.getLikedTracks().filter((track) => isTasteEligible(track, policy));
  }

  /** In-memory mutation generation; independent of SQLite exports/reopened handles. */
  public getChangeRevision(): number {
    return this.changeRevision;
  }
  private dbFilePath: string;
  public statementsFreedCount: number = 0;
  private saveDebounceTimer: NodeJS.Timeout | null = null;
  private lastPersistedSnapshot: Buffer | null = null;
  private lastBackupAt = 0;
  private recoveredFromBackup = false;
  private persistenceStatus: DatabasePersistenceStatus = { state: 'ready' };
  private persistenceStatusHandler: ((status: DatabasePersistenceStatus) => void) | null = null;
  private persistenceErrorHandler: ((error: Error) => void) | null = null;

  public setPersistenceErrorHandler(handler: ((error: Error) => void) | null): void {
    this.persistenceErrorHandler = handler;
  }

  public setPersistenceStatusHandler(
    handler: ((status: DatabasePersistenceStatus) => void) | null,
  ): void {
    this.persistenceStatusHandler = handler;
  }

  private publishPersistenceStatus(status: DatabasePersistenceStatus): void {
    const changed =
      status.state !== this.persistenceStatus.state ||
      status.message !== this.persistenceStatus.message;
    this.persistenceStatus = status;
    if (changed) {
      try {
        this.persistenceStatusHandler?.({ ...status });
      } catch {
        /* UI observers cannot prevent saving. */
      }
    }
  }

  public getPersistenceStatus(): DatabasePersistenceStatus {
    return { ...this.persistenceStatus };
  }

  private persistenceFailure(message: string, cause: unknown): Error {
    const error = Object.assign(new Error(message), { name: 'SoSoDatabaseError', cause });
    this.publishPersistenceStatus({ state: 'error', message });
    console.error('[SQLite] ' + message, cause);
    try {
      this.persistenceErrorHandler?.(error);
    } catch {
      /* Reporting cannot prevent recovery. */
    }
    return error;
  }

  private openSnapshot(SQL: SqlJsStatic, bytes: Buffer): Database {
    if (bytes.length < 100 || bytes.subarray(0, 16).toString('binary') !== 'SQLite format 3\0') {
      throw new Error('Invalid SQLite header or truncated database');
    }
    const candidate: Database = new SQL.Database(bytes);
    try {
      const check = candidate.exec('PRAGMA quick_check;');
      if (check.length !== 1 || check[0].values.length !== 1 || check[0].values[0][0] !== 'ok') {
        throw new Error('SQLite integrity check failed');
      }
      return candidate;
    } catch (error) {
      candidate.close();
      throw error;
    }
  }

  private flushFileSync(filePath: string): void {
    const descriptor = fs.openSync(filePath, 'r+');
    try {
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
  }

  private flushDirectorySync(): void {
    // Windows does not permit opening directory descriptors through node:fs.
    if (process.platform === 'win32') return;
    const descriptor = fs.openSync(path.dirname(this.dbFilePath), 'r');
    try {
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
  }

  private async writeDurableSnapshot(filePath: string, bytes: Buffer): Promise<void> {
    await fs.promises.writeFile(filePath, bytes, { flag: 'wx', mode: 0o600 });
    const handle = await fs.promises.open(filePath, 'r+');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  private writeDurableSnapshotSync(filePath: string, bytes: Buffer): void {
    const descriptor = fs.openSync(filePath, 'wx', 0o600);
    try {
      fs.writeFileSync(descriptor, bytes);
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
  }

  private savedSnapshot(bytes: Buffer, backedUp: boolean): void {
    this.lastPersistedSnapshot = bytes;
    if (backedUp) this.lastBackupAt = Date.now();
    this.publishPersistenceStatus(
      this.recoveredFromBackup
        ? {
            state: 'recovered',
            message:
              'Медиатека восстановлена из резервной копии. Повреждённый файл сохранён отдельно.',
          }
        : { state: 'ready' },
    );
  }

  constructor(customDbPath?: string) {
    if (customDbPath) {
      this.dbFilePath = customDbPath;
    } else {
      let userDataPath = '';
      try {
        const app = getElectronApp();
        if (app && typeof app.getPath === 'function') {
          userDataPath = app.getPath('userData');
        }
      } catch (e) {}
      if (!userDataPath) {
        userDataPath = process.cwd();
      }
      if (!fs.existsSync(userDataPath)) {
        fs.mkdirSync(userDataPath, { recursive: true });
      }
      this.dbFilePath = path.join(userDataPath, 'soso_music.sqlite');
    }
  }

  public getDb(): Database | null {
    return this.db;
  }

  public get dbInstance(): Database | null {
    return this.db;
  }

  public prepare(sql: string) {
    if (!this.db) throw new Error('Database not initialized');
    return this.db.prepare(sql);
  }

  public async init(): Promise<void> {
    try {
      let appPath = process.cwd();
      try {
        appPath = getElectronApp()?.getAppPath?.() || appPath;
      } catch {}
      const SQL = await loadSqliteRuntime(appPath);
      this.openLibrary(SQL);
      this.observeStatements();
      this.initSchema();
      await this.saveAsync();
    } catch (error) {
      if (this.saveDebounceTimer) clearTimeout(this.saveDebounceTimer);
      this.saveDebounceTimer = null;
      try {
        this.db?.close();
      } catch {
        /* Preserve the original initialization failure. */
      }
      this.db = null;
      if (error instanceof Error && error.name === 'SoSoDatabaseError') throw error;
      throw this.persistenceFailure(
        'Не удалось открыть медиатеку. Исходные файлы сохранены; пустая база не создана. Восстановите резервную копию или проверьте диск.',
        error,
      );
    }
  }

  private openLibrary(SQL: SqlJsStatic): void {
    const primaryExists = this.dbFilePath !== ':memory:' && fs.existsSync(this.dbFilePath);
    const backupPath = this.dbFilePath + '.bak';
    const backupExists = this.dbFilePath !== ':memory:' && fs.existsSync(backupPath);
    if (!primaryExists && !backupExists) {
      this.db = new SQL.Database();
      return;
    }
    let primaryError: unknown;
    if (primaryExists) {
      try {
        const bytes = fs.readFileSync(this.dbFilePath);
        this.db = this.openSnapshot(SQL, bytes);
        this.lastPersistedSnapshot = bytes;
      } catch (error) {
        primaryError = error;
      }
    }
    if (this.db) return;
    if (!backupExists) throw primaryError || new Error('Database is missing');
    const bytes = fs.readFileSync(backupPath),
      recovered = this.openSnapshot(SQL, bytes);
    try {
      if (primaryExists) this.preserveCorruptDatabase();
    } catch (error) {
      recovered.close();
      throw error;
    }
    this.db = recovered;
    this.lastPersistedSnapshot = bytes;
    this.recoveredFromBackup = true;
  }

  private preserveCorruptDatabase(): void {
    const preserved = this.dbFilePath + '.corrupt.' + Date.now() + '.' + process.pid;
    fs.copyFileSync(this.dbFilePath, preserved, fs.constants.COPYFILE_EXCL);
    this.flushFileSync(preserved);
  }

  private observeStatements(): void {
    const prepare = this.db!.prepare.bind(this.db);
    this.db!.prepare = (...args: Parameters<Database['prepare']>) => {
      const statement = prepare(...args),
        free = statement.free.bind(statement);
      statement.free = () => {
        this.statementsFreedCount++;
        return free();
      };
      return statement;
    };
  }

  private isSavingAsync = false;
  private pendingSaveAfterCurrent = false;
  private persistenceGeneration = 0;

  public save(immediate = false): void {
    this.changeRevision++;
    if (!this.db || this.dbFilePath === ':memory:') return;

    if (!immediate) {
      if (this.saveDebounceTimer) return;
      this.saveDebounceTimer = setTimeout(() => {
        this.saveDebounceTimer = null;
        this.saveAsync().catch(() => {});
      }, 500);
      return;
    }

    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer);
      this.saveDebounceTimer = null;
    }
    this.saveAsync().catch(() => {});
  }

  private exportSnapshot(): Buffer {
    const bytes = this.db!.export();
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  public async saveAsync(): Promise<void> {
    this.changeRevision++;
    if (!this.db || this.dbFilePath === ':memory:') return;
    if (this.isSavingAsync) {
      this.pendingSaveAfterCurrent = true;
      return;
    }
    this.isSavingAsync = true;
    const generation = ++this.persistenceGeneration;
    const tempPath = this.dbFilePath + '.tmp.' + process.pid + '.' + Date.now() + '.' + generation;
    const backupTempPath = tempPath + '.backup';
    try {
      const buffer = this.exportSnapshot();
      const backUp = this.lastBackupAt === 0 || Date.now() - this.lastBackupAt >= 60000;
      await this.writeDurableSnapshot(tempPath, buffer);
      if (backUp)
        await this.writeDurableSnapshot(backupTempPath, this.lastPersistedSnapshot || buffer);
      // Guard and renames run in one turn so an old write cannot win after quit-save.
      if (generation === this.persistenceGeneration) {
        if (backUp) fs.renameSync(backupTempPath, this.dbFilePath + '.bak');
        fs.renameSync(tempPath, this.dbFilePath);
        this.flushDirectorySync();
        this.savedSnapshot(buffer, backUp);
      }
    } catch (error) {
      if (generation !== this.persistenceGeneration) return;
      throw this.persistenceFailure(
        'Не удалось сохранить медиатеку. Изменения могут не сохраниться. Проверьте свободное место и доступ к диску.',
        error,
      );
    } finally {
      for (const pending of [tempPath, backupTempPath]) {
        try {
          await fs.promises.unlink(pending);
        } catch {
          /* Already renamed, or not created. */
        }
      }
      this.isSavingAsync = false;
      if (this.pendingSaveAfterCurrent) {
        this.pendingSaveAfterCurrent = false;
        this.save(true);
      }
    }
  }

  public saveSync(): void {
    this.changeRevision++;
    if (!this.db || this.dbFilePath === ':memory:') return;
    if (this.saveDebounceTimer) clearTimeout(this.saveDebounceTimer);
    this.saveDebounceTimer = null;
    const generation = ++this.persistenceGeneration;
    this.pendingSaveAfterCurrent = false;
    const tempPath = this.dbFilePath + '.tmp.' + process.pid + '.' + Date.now() + '.' + generation;
    const backupTempPath = tempPath + '.backup';
    try {
      const buffer = this.exportSnapshot();
      const backUp = this.lastBackupAt === 0 || Date.now() - this.lastBackupAt >= 60000;
      this.writeDurableSnapshotSync(tempPath, buffer);
      if (backUp)
        this.writeDurableSnapshotSync(backupTempPath, this.lastPersistedSnapshot || buffer);
      if (backUp) fs.renameSync(backupTempPath, this.dbFilePath + '.bak');
      fs.renameSync(tempPath, this.dbFilePath);
      this.flushDirectorySync();
      this.savedSnapshot(buffer, backUp);
    } catch (error) {
      throw this.persistenceFailure(
        'Не удалось сохранить медиатеку перед выходом. Изменения могут не сохраниться. Проверьте диск и повторите сохранение.',
        error,
      );
    } finally {
      for (const pending of [tempPath, backupTempPath]) {
        try {
          fs.unlinkSync(pending);
        } catch {
          /* Already renamed, or not created. */
        }
      }
    }
  }

  private initSchema(): void {
    if (this.db) initializeLibrarySchema(this.db);
  }

  public getLibraryPage<K extends LibraryKind>(request: LibraryPageRequest<K>): LibraryPage<K> {
    return readLibraryPage(this.db, request, (value) => fixMojibake(decodeHtmlEntities(value)));
  }
  public getLibraryStats() {
    return readLibraryStats(this.db);
  }
  public getLibraryPlaybackTracks(request: LibraryPlaybackRequest) {
    return readLibraryPlaybackTracks(this.db, request, (value) =>
      fixMojibake(decodeHtmlEntities(value)),
    );
  }
  public getSavedAlbumIds() {
    return readSavedAlbumIds(this.db);
  }
  public getArtistMembership() {
    return readArtistMembership(this.db);
  }

  // ================= LIKED TRACKS =================

  public getLikedTrackIds(): string[] {
    if (!this.db) return [];
    const stmt = this.db.prepare('SELECT deezer_id FROM liked_tracks');
    const ids: string[] = [];
    try {
      while (stmt.step()) ids.push(String(stmt.get()[0]));
    } finally {
      stmt.free();
    }
    return ids;
  }

  public getLikedTracks(): LikedTrack[] {
    if (!this.db) return [];
    const stmt = this.db.prepare(
      'SELECT deezer_id, title, artist, album, album_id, cover_url, preview_url, duration, liked_at FROM liked_tracks ORDER BY liked_at DESC',
    );
    const results: LikedTrack[] = [];
    try {
      while (stmt.step()) {
        results.push(stmt.getAsObject() as unknown as LikedTrack);
      }
    } finally {
      stmt.free();
    }
    return results;
  }

  public isTrackLiked(deezerId: string | number): boolean {
    if (!this.db) return false;
    const stmt = this.db.prepare('SELECT deezer_id FROM liked_tracks WHERE deezer_id = ?');
    try {
      stmt.bind([String(deezerId)]);
      return stmt.step();
    } finally {
      stmt.free();
    }
  }

  public toggleLikeTrack(track: {
    deezer_id: string | number;
    title: string;
    artist: string;
    album?: string;
    album_id?: string | number;
    cover_url?: string;
    preview_url?: string;
    duration?: number;
  }): { liked: boolean } {
    if (!this.db) return { liked: false };
    const idStr = String(track.deezer_id);
    const alreadyLiked = this.isTrackLiked(idStr);

    if (alreadyLiked) {
      this.db.run('DELETE FROM liked_tracks WHERE deezer_id = ?', [idStr]);
      this.save();
      return { liked: false };
    } else {
      const cleanCover = cleanCanonicalUrl(track.cover_url);
      const cleanPreview = cleanCanonicalUrl(track.preview_url);
      this.db.run(
        `INSERT OR REPLACE INTO liked_tracks (deezer_id, title, artist, album, album_id, cover_url, preview_url, duration, liked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        [
          idStr,
          track.title || 'Unknown Title',
          track.artist || 'Unknown Artist',
          track.album || '',
          track.album_id ? String(track.album_id) : '',
          cleanCover,
          cleanPreview,
          Number(track.duration) || 180,
        ],
      );
      this.save();
      return { liked: true };
    }
  }

  // ================= SAVED ALBUMS =================

  public getSavedAlbums(): SavedAlbum[] {
    if (!this.db) return [];
    const stmt = this.db.prepare(
      'SELECT album_id as id, album_id, title, artist_name, artist_id, cover_url, release_date, record_type, track_count, saved_at FROM saved_albums ORDER BY saved_at DESC',
    );
    const results: SavedAlbum[] = [];
    try {
      while (stmt.step()) {
        results.push(stmt.getAsObject() as unknown as SavedAlbum);
      }
    } finally {
      stmt.free();
    }
    return results;
  }

  public isAlbumSaved(albumId: string | number): boolean {
    if (!this.db) return false;
    const stmt = this.db.prepare('SELECT album_id FROM saved_albums WHERE album_id = ?');
    try {
      stmt.bind([String(albumId)]);
      return stmt.step();
    } finally {
      stmt.free();
    }
  }

  public toggleSaveAlbum(album: {
    id: string | number;
    title: string;
    artist_name?: string;
    artist?: { id?: string | number; name: string } | string;
    cover_url?: string;
    cover?: string;
    cover_medium?: string;
    cover_big?: string;
    cover_xl?: string;
    release_date?: string;
    record_type?: string;
    track_count?: number;
  }): { saved: boolean } {
    if (!this.db) return { saved: false };
    const idStr = String(album.id);
    const alreadySaved = this.isAlbumSaved(idStr);

    if (alreadySaved) {
      this.db.run('DELETE FROM saved_albums WHERE album_id = ?', [idStr]);
      this.save();
      return { saved: false };
    } else {
      const artistName =
        album.artist_name ||
        (typeof album.artist === 'object' ? album.artist?.name : album.artist) ||
        'Unknown Artist';
      const artistId = typeof album.artist === 'object' ? String(album.artist?.id || '') : '';
      const coverUrl =
        album.cover_url ||
        album.cover_xl ||
        album.cover_big ||
        album.cover_medium ||
        album.cover ||
        '';
      const cleanCover = cleanCanonicalUrl(coverUrl);

      this.db.run(
        `INSERT OR REPLACE INTO saved_albums (album_id, title, artist_name, artist_id, cover_url, release_date, record_type, track_count, saved_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        [
          idStr,
          album.title || 'Unknown Album',
          artistName,
          artistId,
          cleanCover,
          album.release_date || '',
          album.record_type || 'album',
          Number(album.track_count) || 0,
        ],
      );
      this.save();
      return { saved: true };
    }
  }

  // ================= FOLLOWED ARTISTS =================

  public getFollowedArtists(): any[] {
    if (!this.db) return [];
    try {
      const stmt = this.db.prepare(
        'SELECT id, name, picture_url, followed_at FROM followed_artists ORDER BY followed_at DESC',
      );
      const list: any[] = [];
      while (stmt.step()) {
        const row = stmt.getAsObject();
        list.push({
          id: String(row.id),
          name: String(row.name),
          picture_url: String(row.picture_url || ''),
          followed_at: String(row.followed_at),
        });
      }
      stmt.free();
      return list;
    } catch (e) {
      console.error('Error fetching followed artists:', e);
      return [];
    }
  }

  public isArtistFollowed(artistId: string | number): boolean {
    if (!this.db || !artistId) return false;
    try {
      const stmt = this.db.prepare('SELECT 1 FROM followed_artists WHERE id = ?');
      stmt.bind([String(artistId)]);
      const has = stmt.step();
      stmt.free();
      return has;
    } catch (e) {
      return false;
    }
  }

  public toggleFollowArtist(artist: { id: string | number; name: string; picture_url?: string }): {
    followed: boolean;
  } {
    if (!this.db || !artist.id) return { followed: false };
    const idStr = String(artist.id);
    const already = this.isArtistFollowed(idStr);

    if (already) {
      this.db.run('DELETE FROM followed_artists WHERE id = ?', [idStr]);
      this.save();
      return { followed: false };
    } else {
      const cleanPic = cleanCanonicalUrl(artist.picture_url || '');
      this.db.run(
        `INSERT OR REPLACE INTO followed_artists (id, name, picture_url, followed_at)
         VALUES (?, ?, ?, datetime('now'))`,
        [idStr, artist.name || 'Unknown Artist', cleanPic],
      );
      this.save();
      return { followed: true };
    }
  }

  // ================= PLAYLISTS =================

  public getPlaylists(): Playlist[] {
    if (!this.db) return [];
    const query = `
      SELECT p.id, p.name, p.description, p.cover_url, p.created_at,
             COUNT(pt.track_deezer_id) as track_count
      FROM playlists p
      LEFT JOIN playlist_tracks pt ON p.id = pt.playlist_id
      GROUP BY p.id, p.name, p.description, p.cover_url, p.created_at
      ORDER BY p.created_at DESC
    `;
    const stmt = this.db.prepare(query);
    const results: Playlist[] = [];
    try {
      while (stmt.step()) {
        const row = stmt.getAsObject() as unknown as Playlist;
        if (row) {
          row.name = fixMojibake(decodeHtmlEntities(row.name || ''));
          row.description = fixMojibake(decodeHtmlEntities(row.description || ''));
          results.push(row);
        }
      }
    } finally {
      stmt.free();
    }
    return results;
  }

  public createPlaylist(name: string, description: string = ''): Playlist {
    if (!this.db) throw new Error('Database not initialized');
    const cleanName =
      fixMojibake(decodeHtmlEntities(String(name || 'Новый плейлист').trim())) || 'Новый плейлист';
    const cleanDesc = fixMojibake(decodeHtmlEntities(String(description || '').trim()));
    const id = 'pl_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    const createdAt = new Date().toISOString();
    this.db.run('INSERT INTO playlists (id, name, description, created_at) VALUES (?, ?, ?, ?)', [
      id,
      cleanName,
      cleanDesc,
      createdAt,
    ]);
    this.save();
    return {
      id,
      name: cleanName,
      description: cleanDesc,
      created_at: createdAt,
      updated_at: createdAt,
      track_count: 0,
    };
  }

  public setPlaylistCover(playlistId: string, coverUrl: string): boolean {
    if (!this.db) return false;
    this.db.run('UPDATE playlists SET cover_url = ? WHERE id = ?', [coverUrl, playlistId]);
    const changed = this.db.getRowsModified() > 0;
    if (changed) this.save();
    return changed;
  }

  public deletePlaylist(playlistId: string): boolean {
    if (!this.db) return false;
    try {
      this.db.run('BEGIN TRANSACTION;');
      this.db.run('DELETE FROM playlist_tracks WHERE playlist_id = ?', [playlistId]);
      this.db.run('DELETE FROM playlists WHERE id = ?', [playlistId]);
      this.db.run('COMMIT;');
      this.save();
      return true;
    } catch (e) {
      try {
        this.db.run('ROLLBACK;');
      } catch (r) {
        console.warn('[SQLite] Rollback failed:', r);
      }
      console.error('Failed to delete playlist transactionally:', e);
      return false;
    }
  }

  public getTrackPlaylistIds(trackId: string | number): string[] {
    if (!this.db) return [];
    const stmt = this.db.prepare(
      'SELECT playlist_id FROM playlist_tracks WHERE track_deezer_id = ?',
    );
    try {
      stmt.bind([String(trackId)]);
      const ids: string[] = [];
      while (stmt.step()) ids.push(String(stmt.getAsObject().playlist_id));
      return ids;
    } finally {
      stmt.free();
    }
  }

  public getPlaylistTracks(playlistId: string): PlaylistTrack[] {
    if (!this.db) return [];
    const stmt = this.db.prepare(
      `SELECT playlist_id, track_deezer_id, title, artist, album, cover_url, preview_url, duration, position, added_at
       FROM playlist_tracks
       WHERE playlist_id = ?
       ORDER BY position ASC, added_at ASC`,
    );
    const results: PlaylistTrack[] = [];
    try {
      stmt.bind([playlistId]);
      while (stmt.step()) {
        const item = stmt.getAsObject() as unknown as PlaylistTrack;
        if (item) {
          item.title = fixMojibake(decodeHtmlEntities(item.title || ''));
          item.artist = fixMojibake(decodeHtmlEntities(item.artist || ''));
          results.push(item);
        }
      }
    } finally {
      stmt.free();
    }
    return results;
  }

  public addTrackToPlaylist(
    playlistId: string,
    track: {
      deezer_id: string | number;
      title: string;
      artist: string;
      album?: string;
      cover_url?: string;
      preview_url?: string;
      duration?: number;
    },
  ): boolean {
    if (!this.db) return false;
    const idStr = String(track.deezer_id);

    // Get current max position
    const stmt = this.db.prepare(
      'SELECT MAX(position) as max_pos FROM playlist_tracks WHERE playlist_id = ?',
    );
    let nextPos = 0;
    try {
      stmt.bind([playlistId]);
      if (stmt.step()) {
        const row = stmt.getAsObject() as { max_pos: number | null };
        nextPos = row.max_pos !== null && row.max_pos !== undefined ? row.max_pos + 1 : 0;
      }
    } finally {
      stmt.free();
    }

    const cleanCover = cleanCanonicalUrl(track.cover_url);
    const cleanPreview = cleanCanonicalUrl(track.preview_url);

    this.db.run(
      `INSERT OR REPLACE INTO playlist_tracks 
       (playlist_id, track_deezer_id, title, artist, album, cover_url, preview_url, duration, position, added_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [
        playlistId,
        idStr,
        track.title || 'Unknown Title',
        track.artist || 'Unknown Artist',
        track.album || '',
        cleanCover,
        cleanPreview,
        Number(track.duration) || 180,
        nextPos,
      ],
    );
    this.save();
    return true;
  }

  public removeTrackFromPlaylist(playlistId: string, trackDeezerId: string | number): boolean {
    if (!this.db) return false;
    this.db.run('DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_deezer_id = ?', [
      playlistId,
      String(trackDeezerId),
    ]);
    this.save();
    return true;
  }

  // ================= SEARCH HISTORY =================

  public getSearchHistory(limit: number = 10): SearchHistoryItem[] {
    if (!this.db) return [];
    const stmt = this.db.prepare(
      'SELECT id, query, searched_at FROM search_history ORDER BY searched_at DESC LIMIT ?',
    );
    const results: SearchHistoryItem[] = [];
    try {
      stmt.bind([limit]);
      while (stmt.step()) {
        results.push(stmt.getAsObject() as unknown as SearchHistoryItem);
      }
    } finally {
      stmt.free();
    }
    return results;
  }

  public addSearchHistory(query: string): void {
    if (!this.db || !query.trim()) return;
    const trimmed = query.trim();
    this.db.run(
      `INSERT INTO search_history (query, searched_at) VALUES (?, datetime('now'))
       ON CONFLICT(query) DO UPDATE SET searched_at = datetime('now')`,
      [trimmed],
    );
    try {
      this.db.run(
        'DELETE FROM search_history WHERE id NOT IN (SELECT id FROM search_history ORDER BY searched_at DESC LIMIT 100)',
      );
    } catch (e) {
      console.warn('[SQLite] Failed to prune old search history:', e);
    }
    this.save();
  }

  public clearSearchHistory(): void {
    if (!this.db) return;
    this.db.run('DELETE FROM search_history');
    this.save();
  }

  public removeSearchHistoryItem(id: number): void {
    if (!this.db) return;
    this.db.run('DELETE FROM search_history WHERE id = ?', [id]);
    this.save();
  }

  // ================= BACKUP & RESTORE =================

  public exportData(): {
    success: boolean;
    error?: string;
    message?: string;
    payload?: any;
    stats?: {
      tracks: number;
      albums: number;
      artists?: number;
      playlists: number;
      playlistTracks: number;
    };
  } {
    if (!this.db) {
      return {
        success: false,
        error: 'DB_NOT_INITIALIZED',
        message: 'База данных не инициализирована.',
      };
    }

    const likedTracks = this.getLikedTracks();
    const savedAlbums = this.getSavedAlbums();
    const followedArtists = this.getFollowedArtists();
    const playlists = this.getPlaylists();

    const allPlaylistTracks: PlaylistTrack[] = [];
    for (const pl of playlists) {
      const tracks = this.getPlaylistTracks(pl.id);
      allPlaylistTracks.push(...tracks);
    }
    const searchHistory = this.getSearchHistory(100);

    const totalCount =
      likedTracks.length + savedAlbums.length + followedArtists.length + playlists.length;
    if (totalCount === 0) {
      return {
        success: false,
        error: 'EMPTY_DATABASE',
        message: 'База данных пуста. Нечего экспортировать.',
      };
    }

    const payload = {
      version: 1,
      app: 'SoSo Music',
      exported_at: new Date().toISOString(),
      data: {
        liked_tracks: likedTracks,
        saved_albums: savedAlbums,
        followed_artists: followedArtists,
        playlists: playlists,
        playlist_tracks: allPlaylistTracks,
        search_history: searchHistory,
        taste_exclusions: this.getTastePolicy().exclusions,
      },
    };

    return {
      success: true,
      payload,
      stats: {
        tracks: likedTracks.length,
        albums: savedAlbums.length,
        artists: followedArtists.length,
        playlists: playlists.length,
        playlistTracks: allPlaylistTracks.length,
      },
    };
  }

  public importData(raw: string | object): {
    success: boolean;
    error?: string;
    message?: string;
    stats?: {
      tracks: number;
      albums: number;
      artists?: number;
      playlists: number;
      playlistTracks: number;
    };
  } {
    if (!this.db) {
      return {
        success: false,
        error: 'DB_NOT_INITIALIZED',
        message: 'База данных не инициализирована.',
      };
    }

    let parsed: any;
    if (typeof raw === 'string') {
      try {
        parsed = JSON.parse(raw);
      } catch (e: any) {
        return {
          success: false,
          error: 'INVALID_JSON',
          message: 'Файл повреждён или не является корректным JSON.',
        };
      }
    } else {
      parsed = raw;
    }

    if (!parsed || typeof parsed !== 'object') {
      return {
        success: false,
        error: 'INVALID_FORMAT',
        message: 'Некорректная структура файла резервной копии.',
      };
    }

    const root = parsed.data && typeof parsed.data === 'object' ? parsed.data : parsed;

    const likedTracks: any[] = Array.isArray(root.liked_tracks)
      ? root.liked_tracks
      : Array.isArray(root.liked)
        ? root.liked
        : Array.isArray(parsed.liked_tracks)
          ? parsed.liked_tracks
          : Array.isArray(parsed.liked)
            ? parsed.liked
            : [];

    const savedAlbums: any[] = Array.isArray(root.saved_albums)
      ? root.saved_albums
      : Array.isArray(root.albums)
        ? root.albums
        : Array.isArray(parsed.saved_albums)
          ? parsed.saved_albums
          : Array.isArray(parsed.albums)
            ? parsed.albums
            : [];

    const followedArtists: any[] = Array.isArray(root.followed_artists)
      ? root.followed_artists
      : Array.isArray(root.artists)
        ? root.artists
        : Array.isArray(parsed.followed_artists)
          ? parsed.followed_artists
          : Array.isArray(parsed.artists)
            ? parsed.artists
            : [];

    const playlists: any[] = Array.isArray(root.playlists)
      ? root.playlists
      : Array.isArray(parsed.playlists)
        ? parsed.playlists
        : [];

    const playlistTracks: any[] = Array.isArray(root.playlist_tracks)
      ? root.playlist_tracks
      : Array.isArray(parsed.playlist_tracks)
        ? parsed.playlist_tracks
        : [];

    const searchHistory: any[] = Array.isArray(root.search_history)
      ? root.search_history
      : Array.isArray(parsed.search_history)
        ? parsed.search_history
        : [];

    const totalItems =
      likedTracks.length +
      savedAlbums.length +
      followedArtists.length +
      playlists.length +
      playlistTracks.length;
    if (totalItems === 0) {
      return {
        success: false,
        error: 'EMPTY_BACKUP',
        message: 'В выбранном файле нет данных для восстановления.',
      };
    }

    const previousTasteRevision = this.getTastePolicy().revision;
    let importedTracks = 0;
    let importedAlbums = 0;
    let importedArtists = 0;
    let importedPlaylists = 0;
    let importedPlaylistTracks = 0;

    try {
      this.db.run('BEGIN TRANSACTION;');

      // Old backups leave policy untouched; only explicit policy fields replace it.
      if (Array.isArray(root.taste_exclusions)) {
        if (root.taste_exclusions.length > 10000) throw new Error('Too many taste exclusions');
        this.db.run('DELETE FROM taste_exclusions');
        for (const rule of root.taste_exclusions) {
          if (
            !rule ||
            !['track', 'playlist'].includes(rule.scope) ||
            typeof rule.id !== 'string' ||
            !rule.id.trim() ||
            rule.id.length > 256 ||
            /[\u0000-\u001f]/.test(rule.id)
          )
            throw new Error('Invalid taste exclusion backup');
          this.db.run('INSERT OR REPLACE INTO taste_exclusions(scope,id,label) VALUES(?,?,?)', [
            rule.scope,
            rule.scope === 'track' ? rule.id.trim().replace(/^dz_/, '') : rule.id.trim(),
            String(rule.label || '').slice(0, 500),
          ]);
        }
        this.db.run('UPDATE taste_policy_revision SET revision=revision+1 WHERE id=1');
      }
      // 1. Liked Tracks
      for (const t of likedTracks) {
        const deezerId = String(t.deezer_id || t.id || '');
        if (!deezerId) continue;
        const title = t.title || 'Unknown Title';
        const artist =
          typeof t.artist === 'object'
            ? t.artist?.name || 'Unknown Artist'
            : t.artist || 'Unknown Artist';
        const album = typeof t.album === 'object' ? t.album?.title || '' : t.album || '';
        const cover = cleanCanonicalUrl(
          t.cover_url || t.cover || (typeof t.album === 'object' ? t.album?.cover_medium : ''),
        );
        const preview = cleanCanonicalUrl(t.preview_url || t.preview || '');
        const duration = Number(t.duration) || 180;
        const likedAt = t.liked_at || new Date().toISOString();

        this.db.run(
          `INSERT OR REPLACE INTO liked_tracks (deezer_id, title, artist, album, cover_url, preview_url, duration, liked_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [deezerId, title, artist, album, cover, preview, duration, likedAt],
        );
        importedTracks++;
      }

      // 2. Saved Albums
      for (const a of savedAlbums) {
        const albumId = String(a.album_id || a.id || '');
        if (!albumId) continue;
        const title = a.title || 'Unknown Album';
        const artistName =
          a.artist_name ||
          (typeof a.artist === 'object' ? a.artist?.name : a.artist) ||
          'Unknown Artist';
        const artistId =
          typeof a.artist === 'object' ? String(a.artist?.id || '') : String(a.artist_id || '');
        const cover = cleanCanonicalUrl(
          a.cover_url || a.cover || a.cover_big || a.cover_medium || '',
        );
        const releaseDate = a.release_date || '';
        const recordType = a.record_type || 'album';
        const trackCount = Number(a.track_count) || 0;
        const savedAt = a.saved_at || new Date().toISOString();

        this.db.run(
          `INSERT OR REPLACE INTO saved_albums (album_id, title, artist_name, artist_id, cover_url, release_date, record_type, track_count, saved_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            albumId,
            title,
            artistName,
            artistId,
            cover,
            releaseDate,
            recordType,
            trackCount,
            savedAt,
          ],
        );
        importedAlbums++;
      }

      // 3. Followed Artists
      for (const fa of followedArtists) {
        const id = String(fa.id || '');
        if (!id) continue;
        const name = String(fa.name || 'Unknown Artist');
        const pic = cleanCanonicalUrl(fa.picture_url || fa.picture || '');
        const followedAt = fa.followed_at || new Date().toISOString();

        this.db.run(
          `INSERT OR REPLACE INTO followed_artists (id, name, picture_url, followed_at)
           VALUES (?, ?, ?, ?)`,
          [id, name, pic, followedAt],
        );
        importedArtists++;
      }

      // 4. Playlists
      for (const p of playlists) {
        const pId = String(p.id || '');
        if (!pId) continue;
        const name = String(p.name || 'Без названия').trim();
        const desc = String(p.description || '').trim();
        const createdAt = p.created_at || new Date().toISOString();
        const coverUrl =
          typeof p.cover_url === 'string' &&
          /^data:image\/(?:jpeg|png|webp);base64,/.test(p.cover_url) &&
          p.cover_url.length <= 750000
            ? p.cover_url
            : '';

        this.db.run(
          `INSERT OR REPLACE INTO playlists (id, name, description, cover_url, created_at)
           VALUES (?, ?, ?, ?, ?)`,
          [pId, name, desc, coverUrl, createdAt],
        );
        importedPlaylists++;
      }

      // 5. Playlist Tracks
      for (const pt of playlistTracks) {
        const pId = String(pt.playlist_id || '');
        const trackId = String(pt.track_deezer_id || pt.deezer_id || pt.id || '');
        if (!pId || !trackId) continue;
        const title = pt.title || 'Unknown Title';
        const artist =
          typeof pt.artist === 'object'
            ? pt.artist?.name || 'Unknown Artist'
            : pt.artist || 'Unknown Artist';
        const album = typeof pt.album === 'object' ? pt.album?.title || '' : pt.album || '';
        const cover = cleanCanonicalUrl(pt.cover_url || pt.cover || '');
        const preview = cleanCanonicalUrl(pt.preview_url || pt.preview || '');
        const duration = Number(pt.duration) || 180;
        const position = Number(pt.position) || 0;
        const addedAt = pt.added_at || new Date().toISOString();

        this.db.run(
          `INSERT OR REPLACE INTO playlist_tracks (playlist_id, track_deezer_id, title, artist, album, cover_url, preview_url, duration, position, added_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [pId, trackId, title, artist, album, cover, preview, duration, position, addedAt],
        );
        importedPlaylistTracks++;
      }

      // 6. Search History
      for (const sh of searchHistory) {
        const query = String(sh.query || '').trim();
        if (query) {
          this.db.run(
            `INSERT INTO search_history (query, searched_at) VALUES (?, datetime('now'))
             ON CONFLICT(query) DO NOTHING`,
            [query],
          );
        }
      }

      this.db.run('COMMIT;');
      this.save();
      this.publishTastePolicy(previousTasteRevision);

      return {
        success: true,
        stats: {
          tracks: importedTracks,
          albums: importedAlbums,
          artists: importedArtists,
          playlists: importedPlaylists,
          playlistTracks: importedPlaylistTracks,
        },
      };
    } catch (err: any) {
      try {
        this.db.run('ROLLBACK;');
      } catch (r) {
        console.warn('[SQLite] Rollback failed:', r);
      }
      console.error('Error during database import transaction:', err);
      return {
        success: false,
        error: 'IMPORT_FAILED',
        message: err?.message || 'Ошибка записи в базу данных.',
      };
    }
  }

  // ================= SCROBBLES & DISLIKES =================

  public recordScrobble(data: {
    track: {
      id?: string | number;
      deezer_id?: string | number;
      title: string;
      artist?: string | { name: string };
    };
    completed?: boolean;
    skipped?: boolean;
    repeated?: boolean;
  }): void {
    if (!this.db || !data?.track) return;
    const trackId = String(data.track.id || data.track.deezer_id || '');
    if (!trackId) return;

    const title = data.track.title || 'Трек';
    const artist =
      typeof data.track.artist === 'object'
        ? data.track.artist?.name || 'Unknown Artist'
        : data.track.artist || 'Unknown Artist';

    const completeInc = data.completed ? 1 : 0;
    const skipInc = data.skipped ? 1 : 0;
    const repeatInc = data.repeated ? 1 : 0;

    this.db.run(
      `INSERT INTO track_scrobbles (track_id, title, artist, play_count, complete_count, skip_count, repeat_count, last_played_at)
       VALUES (?, ?, ?, 1, ?, ?, ?, datetime('now'))
       ON CONFLICT(track_id) DO UPDATE SET
         play_count = play_count + 1,
         complete_count = complete_count + ?,
         skip_count = skip_count + ?,
         repeat_count = repeat_count + ?,
         last_played_at = datetime('now'),
         title = excluded.title,
         artist = excluded.artist`,
      [trackId, title, artist, completeInc, skipInc, repeatInc, completeInc, skipInc, repeatInc],
    );
    this.save(false);
  }

  public recordPlaybackSession(data: PlaybackSessionUpdate): void {
    if (!this.db || !data?.track || typeof data.sessionId !== 'string' || !data.sessionId.trim())
      return;
    const trackId = String(data.track.id || '');
    const seconds = Number(data.playedSeconds);
    if (!trackId || !Number.isFinite(seconds) || seconds <= 0) return;
    const playedSeconds = Math.min(seconds, 24 * 3600);
    const prior = this.db.prepare(
      'SELECT track_id, played_seconds, completed, skipped, repeated FROM playback_sessions WHERE session_id = ?',
    );
    let previous: Record<string, unknown> | null = null;
    try {
      prior.bind([data.sessionId]);
      if (prior.step()) previous = prior.getAsObject();
    } finally {
      prior.free();
    }
    if (previous && String(previous.track_id) !== trackId) return;

    const completed = data.completed ? 1 : 0;
    const skipped = data.skipped ? 1 : 0;
    const repeated = data.repeated ? 1 : 0;
    // Retries and final callbacks often repeat the last checkpoint. They must not
    // rewrite the whole sql.js database or move the last-played timestamp.
    if (
      previous &&
      playedSeconds <= Number(previous.played_seconds) &&
      completed <= Number(previous.completed) &&
      skipped <= Number(previous.skipped) &&
      repeated <= Number(previous.repeated)
    )
      return;
    this.db.run(
      `INSERT INTO playback_sessions (session_id, track_id, played_seconds, completed, skipped, repeated)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET
         played_seconds = MAX(playback_sessions.played_seconds, excluded.played_seconds),
         completed = MAX(playback_sessions.completed, excluded.completed),
         skipped = MAX(playback_sessions.skipped, excluded.skipped),
         repeated = MAX(playback_sessions.repeated, excluded.repeated)`,
      [data.sessionId, trackId, playedSeconds, completed, skipped, repeated],
    );
    if (!previous) this.tastePolicy.recordOrigin(data.sessionId, data.origin);
    const addedSeconds = Math.max(0, playedSeconds - (Number(previous?.played_seconds) || 0));
    if (addedSeconds > 0) {
      this.db.run(
        `
        INSERT INTO listening_daily_time (day, played_seconds)
        VALUES (date('now', 'localtime'), ?)
        ON CONFLICT(day) DO UPDATE SET played_seconds = played_seconds + excluded.played_seconds
      `,
        [addedSeconds],
      );
    }

    const completeInc = completed && !previous?.completed ? 1 : 0;
    const skipInc = skipped && !previous?.skipped ? 1 : 0;
    const repeatInc = repeated && !previous?.repeated ? 1 : 0;
    const artist =
      typeof data.track.artist === 'object'
        ? data.track.artist?.name || 'Unknown Artist'
        : data.track.artist || 'Unknown Artist';
    this.db.run(
      `INSERT INTO track_scrobbles (track_id, title, artist, play_count, complete_count, skip_count, repeat_count, last_played_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(track_id) DO UPDATE SET
         play_count = play_count + excluded.play_count,
         complete_count = complete_count + excluded.complete_count,
         skip_count = skip_count + excluded.skip_count,
         repeat_count = repeat_count + excluded.repeat_count,
         last_played_at = datetime('now'),
         title = excluded.title,
         artist = excluded.artist`,
      [
        trackId,
        data.track.title || 'Трек',
        artist,
        previous ? 0 : 1,
        completeInc,
        skipInc,
        repeatInc,
      ],
    );
    this.save(false);
  }

  public dislikeTrack(track: {
    id?: string | number;
    deezer_id?: string | number;
    title: string;
    artist?: string | { name: string };
  }): boolean {
    if (!this.db || !track) return false;
    const trackId = String(track.id || track.deezer_id || '');
    if (!trackId) return false;

    const title = track.title || 'Трек';
    const artist =
      typeof track.artist === 'object'
        ? track.artist?.name || 'Unknown Artist'
        : track.artist || 'Unknown Artist';

    this.db.run(
      `INSERT OR REPLACE INTO disliked_tracks (track_id, title, artist, disliked_at)
       VALUES (?, ?, ?, datetime('now'))`,
      [trackId, title, artist],
    );

    // If track was in liked_tracks, remove it
    this.db.run('DELETE FROM liked_tracks WHERE deezer_id = ?', [trackId]);

    this.save(true);
    return true;
  }

  public undislikeTrack(trackId: string | number): boolean {
    if (!this.db || !trackId) return false;
    this.db.run('DELETE FROM disliked_tracks WHERE track_id = ?', [String(trackId)]);
    this.save(true);
    return true;
  }

  public getDislikedTrackIds(): string[] {
    if (!this.db) return [];
    const stmt = this.db.prepare('SELECT track_id FROM disliked_tracks');
    const ids: string[] = [];
    try {
      while (stmt.step()) {
        const row = stmt.getAsObject();
        if (row.track_id) ids.push(String(row.track_id));
      }
    } finally {
      stmt.free();
    }
    return ids;
  }

  public getDislikedWaveTracks(): { id: string; title: string; artist: string }[] {
    if (!this.db) return [];
    const stmt = this.db.prepare('SELECT track_id, title, artist FROM disliked_tracks');
    const tracks: { id: string; title: string; artist: string }[] = [];
    try {
      while (stmt.step()) {
        const row = stmt.getAsObject();
        if (row.track_id)
          tracks.push({
            id: String(row.track_id),
            title: String(row.title || ''),
            artist: String(row.artist || ''),
          });
      }
    } finally {
      stmt.free();
    }
    return tracks;
  }

  public isTrackDisliked(trackId: string | number): boolean {
    if (!this.db || !trackId) return false;
    const stmt = this.db.prepare('SELECT track_id FROM disliked_tracks WHERE track_id = ?');
    try {
      stmt.bind([String(trackId)]);
      return stmt.step();
    } finally {
      stmt.free();
    }
  }

  public getScrobbledTopArtists(limit = 20): { name: string; score: number }[] {
    if (!this.db) return [];
    const stmt = this.db.prepare(`
      SELECT s.artist, SUM(${tasteHistoryScoreSql('s')}) AS score
      FROM track_scrobbles s
      WHERE ${tasteTrackAllowedSql('s.track_id')}
      GROUP BY LOWER(s.artist)
      HAVING score > 0
      ORDER BY score DESC
      LIMIT ?
    `);
    const results: { name: string; score: number }[] = [];
    try {
      stmt.bind([limit]);
      while (stmt.step()) {
        const row = stmt.getAsObject();
        if (row.artist) {
          results.push({ name: String(row.artist), score: Number(row.score) });
        }
      }
    } finally {
      stmt.free();
    }
    return results;
  }

  public getWaveTasteTracks(
    limit = 30,
  ): { id: string; title: string; artist: string; duration: number }[] {
    if (!this.db) return [];
    const stmt = this.db.prepare(`
      SELECT s.track_id AS id, s.title, s.artist, COALESCE(l.duration, 180) AS duration,
             ${tasteHistoryScoreSql('s')} AS score
      FROM track_scrobbles s
      LEFT JOIN liked_tracks l ON l.deezer_id = s.track_id
      WHERE ${tasteHistoryScoreSql('s')} > 0 AND ${tasteTrackAllowedSql('s.track_id')}
      ORDER BY score DESC
      LIMIT ?
    `);
    const results: { id: string; title: string; artist: string; duration: number }[] = [];
    try {
      stmt.bind([limit]);
      while (stmt.step()) {
        const row = stmt.getAsObject();
        if (row.id && row.title && row.artist) {
          results.push({
            id: String(row.id),
            title: String(row.title),
            artist: String(row.artist),
            duration: Number(row.duration) || 180,
          });
        }
      }
    } finally {
      stmt.free();
    }
    return results;
  }

  /** One bounded query: no artwork/audio URLs, one candidate per artist in each playlist. */
  public getPlaylistWaveTracks(): {
    playlist_id: string;
    track_deezer_id: string;
    title: string;
    artist: string;
    duration: number;
  }[] {
    if (!this.db) return [];
    const stmt = this.db.prepare(
      'WITH artist_rows AS (SELECT playlist_id, track_deezer_id, title, artist, duration, added_at, ' +
        'ROW_NUMBER() OVER (PARTITION BY playlist_id, LOWER(TRIM(artist)) ORDER BY added_at DESC, position DESC) AS artist_rank ' +
        'FROM playlist_tracks WHERE NOT EXISTS (SELECT 1 FROM disliked_tracks d WHERE d.track_id = track_deezer_id) AND ' +
        tasteTrackAllowedSql('track_deezer_id') +
        ' AND ' +
        tastePlaylistAllowedSql('playlist_id') +
        '), ' +
        'playlist_rows AS (SELECT *, ROW_NUMBER() OVER (PARTITION BY playlist_id ORDER BY added_at DESC, track_deezer_id) AS playlist_rank ' +
        'FROM artist_rows WHERE artist_rank = 1) ' +
        'SELECT playlist_id, track_deezer_id, title, artist, duration FROM playlist_rows WHERE playlist_rank <= 8 ' +
        'ORDER BY playlist_rank, playlist_id LIMIT 64',
    );
    const rows: any[] = [];
    try {
      while (stmt.step()) rows.push(stmt.getAsObject());
    } finally {
      stmt.free();
    }
    return rows;
  }

  // ================= LISTENING HISTORY =================

  public addListeningHistory(track: {
    track_id: string | number;
    title: string;
    artist: string;
    album?: string;
    cover_url?: string;
    source?: string;
    duration?: number;
  }): void {
    if (!this.db || !track || !track.title) return;
    const trackId = String(track.track_id || '');
    if (!trackId) return;

    this.db.run(
      `INSERT INTO listening_history (track_id, title, artist, album, cover_url, source, duration)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        trackId,
        track.title,
        track.artist || 'Unknown Artist',
        track.album || '',
        cleanCanonicalUrl(track.cover_url),
        track.source || 'soundcloud',
        track.duration || 180,
      ],
    );

    // Keep history trimmed to latest 5000 entries (preserves multi-week stats and prevents unbounded DB growth)
    this.db.run(
      'DELETE FROM listening_history WHERE id NOT IN (SELECT id FROM listening_history ORDER BY id DESC LIMIT 5000)',
    );
    this.save(true);
  }

  public getListeningHistory(limit = 50, uniqueTracks = false): any[] {
    if (!this.db) return [];
    const safeLimit = Math.min(Math.max(1, limit), 500);
    const stmt = this.db.prepare(`
      SELECT id, track_id, title, artist, album, cover_url, source, duration, played_at 
      FROM listening_history 
      ${uniqueTracks ? 'WHERE id IN (SELECT MAX(id) FROM listening_history GROUP BY track_id)' : ''}
      ORDER BY id DESC 
      LIMIT ?
    `);
    const results: any[] = [];
    try {
      stmt.bind([safeLimit]);
      while (stmt.step()) {
        results.push(stmt.getAsObject());
      }
    } finally {
      stmt.free();
    }
    return results;
  }

  public clearListeningHistory(): void {
    if (!this.db) return;
    this.db.run('DELETE FROM listening_history');
    this.save(true);
  }

  // ================= LYRICS CACHE =================

  public getCachedLyrics(cacheKey: string): { synced: boolean; lines: LyricsLine[] } | null {
    if (!this.db || !cacheKey) return null;
    try {
      const stmt = this.db.prepare(
        'SELECT lyrics_json, synced FROM lyrics_cache WHERE cache_key = ?',
      );
      try {
        stmt.bind([cacheKey]);
        if (stmt.step()) {
          const row = stmt.getAsObject();
          const lines = JSON.parse(String(row.lyrics_json));
          if (Array.isArray(lines) && lines.length > 0) {
            return { synced: Number(row.synced) === 1, lines };
          }
        }
      } finally {
        stmt.free();
      }
    } catch (e) {
      console.error('[DB] Error reading lyrics cache:', e);
    }
    return null;
  }

  public saveLyricsCache(cacheKey: string, lines: LyricsLine[], synced: boolean): void {
    if (!this.db || !cacheKey || !lines || lines.length === 0) return;
    try {
      this.db.run(
        `INSERT OR REPLACE INTO lyrics_cache (cache_key, lyrics_json, synced, updated_at)
         VALUES (?, ?, ?, datetime('now'))`,
        [cacheKey, JSON.stringify(lines), synced ? 1 : 0],
      );
      this.db.run(
        'DELETE FROM lyrics_cache WHERE cache_key NOT IN (SELECT cache_key FROM lyrics_cache ORDER BY updated_at DESC LIMIT 300)',
      );
      this.save(false);
    } catch (e) {
      console.error('[DB] Error saving lyrics cache:', e);
    }
  }

  // ================= LISTENING STATS =================

  public getStatsSummary(): ListeningStats {
    const empty: ListeningStats = {
      totalPlays: 0,
      uniqueTracks: 0,
      uniqueArtists: 0,
      likedCount: 0,
      approxHours: 0,
      topTracks: [],
      topArtists: [],
      activity: [],
      todaySeconds: 0,
      weekly: {
        plays: 0,
        measuredSeconds: 0,
        uniqueTracks: 0,
        uniqueArtists: 0,
        completions: 0,
        repeats: 0,
        likes: 0,
        topTracks: [],
        topArtists: [],
        activity: [],
      },
    };
    if (!this.db) return empty;

    const scalar = (sql: string): number => {
      const stmt = this.db!.prepare(sql);
      try {
        if (stmt.step()) {
          const row = stmt.getAsObject();
          return Number(Object.values(row)[0]) || 0;
        }
        return 0;
      } finally {
        stmt.free();
      }
    };

    const rows = (sql: string): Record<string, unknown>[] => {
      const stmt = this.db!.prepare(sql);
      const result: Record<string, unknown>[] = [];
      try {
        while (stmt.step()) result.push(stmt.getAsObject());
      } finally {
        stmt.free();
      }
      return result;
    };

    try {
      const totalPlays = scalar(`SELECT COALESCE(SUM(play_count), 0) FROM track_scrobbles`);
      if (totalPlays === 0) return empty;

      const uniqueTracks = scalar(`SELECT COUNT(*) FROM track_scrobbles`);
      const uniqueArtists = scalar(`SELECT COUNT(DISTINCT LOWER(artist)) FROM track_scrobbles`);
      const likedCount = scalar(`SELECT COUNT(*) FROM liked_tracks`);
      const approxSeconds = scalar(
        'SELECT COALESCE(SUM(played_seconds), 0) FROM playback_sessions',
      );
      const todaySeconds = scalar(
        "SELECT COALESCE(played_seconds, 0) FROM listening_daily_time WHERE day = date('now', 'localtime')",
      );

      const weekHistoryFilter =
        "date(played_at, 'localtime') >= date('now', 'localtime', '-6 days')";
      const weekSessionsFilter =
        "date(started_at, 'localtime') >= date('now', 'localtime', '-6 days')";
      const weeklyPlays = scalar(
        `SELECT COUNT(*) FROM listening_history WHERE ${weekHistoryFilter}`,
      );
      const weeklyMeasuredSeconds = scalar(
        "SELECT COALESCE(SUM(played_seconds), 0) FROM listening_daily_time WHERE day >= date('now', 'localtime', '-6 days')",
      );
      const weeklyTopTracks: ListeningStats['topTracks'] = rows(`
        SELECT h.track_id AS id, MAX(h.title) AS title, MAX(h.artist) AS artist,
               ${statisticsArtworkSql('h.track_id')} AS cover_url, COUNT(*) AS play_count
        FROM listening_history h WHERE ${weekHistoryFilter}
        GROUP BY h.track_id ORDER BY play_count DESC LIMIT 5
      `).map((row) => ({
        id: String(row.id),
        title: String(row.title),
        artist: String(row.artist),
        cover_url: String(row.cover_url || ''),
        play_count: Number(row.play_count) || 0,
      }));
      const weeklyTopArtists: ListeningStats['topArtists'] = rows(`
        SELECT MAX(h.artist) AS artist, COUNT(*) AS plays,
               COALESCE((SELECT f.picture_url FROM followed_artists f
                         WHERE LOWER(f.name) = LOWER(h.artist) AND f.picture_url <> '' LIMIT 1), '') AS picture_url
        FROM listening_history h WHERE ${weekHistoryFilter}
        GROUP BY LOWER(h.artist) ORDER BY plays DESC LIMIT 5
      `).map((row) => ({
        artist: String(row.artist),
        plays: Number(row.plays) || 0,
        sharePercent:
          weeklyPlays > 0 ? Math.round(((Number(row.plays) || 0) / weeklyPlays) * 100) : 0,
        picture_url: String(row.picture_url || ''),
      }));
      const weeklyTimes = new Map(
        rows(
          "SELECT day, played_seconds AS seconds FROM listening_daily_time WHERE day >= date('now', 'localtime', '-6 days')",
        ).map((row) => [String(row.day), Number(row.seconds) || 0]),
      );
      const weeklyActivity: NonNullable<ListeningStats['weekly']>['activity'] = rows(`
        SELECT date(played_at, 'localtime') AS day, COUNT(*) AS plays
        FROM listening_history WHERE ${weekHistoryFilter} GROUP BY day ORDER BY day ASC
      `).map((row) => ({
        day: String(row.day),
        plays: Number(row.plays) || 0,
        measuredSeconds: weeklyTimes.get(String(row.day)) || 0,
      }));
      for (const [day, measuredSeconds] of weeklyTimes) {
        if (!weeklyActivity.some((item) => item.day === day))
          weeklyActivity.push({ day, plays: 0, measuredSeconds });
      }
      weeklyActivity.sort((a, b) => a.day.localeCompare(b.day));
      const weekly: NonNullable<ListeningStats['weekly']> = {
        plays: weeklyPlays,
        measuredSeconds: weeklyMeasuredSeconds,
        uniqueTracks: scalar(
          `SELECT COUNT(DISTINCT track_id) FROM listening_history WHERE ${weekHistoryFilter}`,
        ),
        uniqueArtists: scalar(
          `SELECT COUNT(DISTINCT LOWER(artist)) FROM listening_history WHERE ${weekHistoryFilter}`,
        ),
        completions: scalar(
          `SELECT COALESCE(SUM(completed), 0) FROM playback_sessions WHERE ${weekSessionsFilter}`,
        ),
        repeats: scalar(
          `SELECT COALESCE(SUM(repeated), 0) FROM playback_sessions WHERE ${weekSessionsFilter}`,
        ),
        likes: scalar(
          "SELECT COUNT(*) FROM liked_tracks WHERE date(liked_at, 'localtime') >= date('now', 'localtime', '-6 days')",
        ),
        topTracks: weeklyTopTracks,
        topArtists: weeklyTopArtists,
        activity: weeklyActivity,
      };

      const totalRepeats = scalar(`SELECT COALESCE(SUM(repeat_count), 0) FROM track_scrobbles`);
      const totalCompletions = scalar(
        `SELECT COALESCE(SUM(complete_count), 0) FROM track_scrobbles`,
      );
      const completionRate =
        totalPlays > 0 ? Math.min(100, Math.round((totalCompletions / totalPlays) * 100)) : 0;

      // Most replayed track
      let mostReplayedTrack: ListeningStats['mostReplayedTrack'] = null;
      const replayedStmt = this.db.prepare(`
        SELECT s.track_id as id, s.title, s.artist, s.repeat_count,
               ${statisticsArtworkSql('s.track_id')} as cover_url
        FROM track_scrobbles s
        WHERE s.repeat_count > 0
        ORDER BY s.repeat_count DESC
        LIMIT 1
      `);
      try {
        if (replayedStmt.step()) {
          const row = replayedStmt.getAsObject() as any;
          mostReplayedTrack = {
            id: String(row.id),
            title: String(row.title),
            artist: String(row.artist),
            cover_url: String(row.cover_url || ''),
            repeat_count: Number(row.repeat_count) || 0,
          };
        }
      } finally {
        replayedStmt.free();
      }

      const topTracks: ListeningStats['topTracks'] = [];
      const topTracksStmt = this.db.prepare(`
        SELECT s.track_id as id, s.title, s.artist, s.play_count,
               ${statisticsArtworkSql('s.track_id')} as cover_url
        FROM track_scrobbles s
        ORDER BY s.play_count DESC
        LIMIT 10
      `);
      try {
        while (topTracksStmt.step()) {
          const row = topTracksStmt.getAsObject() as any;
          topTracks.push({
            id: String(row.id),
            title: String(row.title),
            artist: String(row.artist),
            cover_url: String(row.cover_url || ''),
            play_count: Number(row.play_count) || 0,
          });
        }
      } finally {
        topTracksStmt.free();
      }

      const topArtists: ListeningStats['topArtists'] = [];
      const topArtistsStmt = this.db.prepare(`
        SELECT MAX(artist) as artist, SUM(play_count) as plays
        FROM track_scrobbles
        GROUP BY LOWER(artist)
        ORDER BY plays DESC
        LIMIT 8
      `);
      try {
        while (topArtistsStmt.step()) {
          const row = topArtistsStmt.getAsObject() as any;
          const plays = Number(row.plays) || 0;
          topArtists.push({
            artist: String(row.artist),
            plays,
            sharePercent: totalPlays > 0 ? Math.round((plays / totalPlays) * 100) : 0,
          });
        }
      } finally {
        topArtistsStmt.free();
      }

      const activity: ListeningStats['activity'] = [];
      const activityStmt = this.db.prepare(`
        SELECT date(played_at, 'localtime') as day, COUNT(*) as plays
        FROM listening_history
        WHERE date(played_at, 'localtime') >= date('now', 'localtime', '-13 days')
        GROUP BY day
        ORDER BY day ASC
      `);
      try {
        while (activityStmt.step()) {
          const row = activityStmt.getAsObject() as any;
          activity.push({ day: String(row.day), plays: Number(row.plays) || 0 });
        }
      } finally {
        activityStmt.free();
      }

      let hours = Math.floor(approxSeconds / 3600);
      let minutes = Math.round((approxSeconds % 3600) / 60);
      if (minutes >= 60) {
        hours += 1;
        minutes = 0;
      }

      return {
        totalPlays,
        uniqueTracks,
        uniqueArtists,
        likedCount,
        approxHours: hours,
        approxMinutes: minutes,
        measuredSeconds: approxSeconds,
        todaySeconds,
        weekly,
        totalRepeats,
        totalCompletions,
        completionRate,
        mostReplayedTrack,
        topTracks,
        topArtists,
        activity,
      };
    } catch (e) {
      console.error('[DB] Error building listening stats:', e);
      return empty;
    }
  }

  // ================= SMART PLAYLISTS =================

  public getSmartPlaylist(kind: SmartPlaylistKind, limit = 50): SmartPlaylistTrack[] {
    if (!this.db) return [];

    const queries: Record<SmartPlaylistKind, string> = {
      // Самые прослушиваемые
      top: `
        SELECT s.track_id as id, s.title, s.artist,
               COALESCE(l.album, '') as album,
               COALESCE(l.cover_url, '') as cover_url,
               COALESCE(l.preview_url, '') as preview_url,
               COALESCE(l.duration, 180) as duration,
               s.play_count
        FROM track_scrobbles s
        LEFT JOIN liked_tracks l ON l.deezer_id = s.track_id
        ORDER BY s.play_count DESC
        LIMIT ?`,
      // Недавно добавленные в любимые
      recent: `
        SELECT deezer_id as id, title, artist, album, cover_url, preview_url, duration,
               0 as play_count
        FROM liked_tracks
        ORDER BY liked_at DESC
        LIMIT ?`,
      // Любимое, но давно не игравшееся
      forgotten: `
        SELECT l.deezer_id as id, l.title, l.artist, l.album, l.cover_url, l.preview_url, l.duration,
               COALESCE(s.play_count, 0) as play_count
        FROM liked_tracks l
        LEFT JOIN track_scrobbles s ON s.track_id = l.deezer_id
        WHERE s.track_id IS NULL OR s.last_played_at < datetime('now', '-30 days')
        ORDER BY COALESCE(s.last_played_at, l.liked_at) ASC
        LIMIT ?`,
      // Чаще всего ставились на повтор
      repeat: `
        SELECT s.track_id as id, s.title, s.artist,
               COALESCE(l.album, '') as album,
               COALESCE(l.cover_url, '') as cover_url,
               COALESCE(l.preview_url, '') as preview_url,
               COALESCE(l.duration, 180) as duration,
               s.repeat_count as play_count
        FROM track_scrobbles s
        LEFT JOIN liked_tracks l ON l.deezer_id = s.track_id
        WHERE s.repeat_count > 0
        ORDER BY s.repeat_count DESC
        LIMIT ?`,
    };

    const sql = queries[kind];
    if (!sql) return [];

    const results: SmartPlaylistTrack[] = [];
    const stmt = this.db.prepare(sql);
    try {
      stmt.bind([limit]);
      while (stmt.step()) {
        const row = stmt.getAsObject() as any;
        results.push({
          id: String(row.id),
          title: String(row.title),
          artist: String(row.artist),
          album: String(row.album || ''),
          cover_url: String(row.cover_url || ''),
          preview_url: String(row.preview_url || ''),
          duration: Number(row.duration) || 180,
          play_count: Number(row.play_count) || 0,
        });
      }
    } catch (e) {
      console.error('[DB] Error building smart playlist:', kind, e);
    } finally {
      stmt.free();
    }
    return results;
  }
}
