import type { Database, SqlValue } from 'sql.js';
import type { Track } from '../../../shared/types/index.ts';
import { providerTrackRef, providerRecordingKey } from '../../../shared/types/musicDomain.ts';
import { matchesCanonicalRecording } from '../../../shared/utils/recordingIdentity.ts';

export function createRecordingSchema(db: Database): void {
  db.run(
    'CREATE TABLE IF NOT EXISTS recordings (id TEXT PRIMARY KEY, title TEXT NOT NULL, artist TEXT NOT NULL, duration REAL NOT NULL)',
  );
  db.run(
    'CREATE TABLE IF NOT EXISTS provider_tracks (provider TEXT NOT NULL, provider_id TEXT NOT NULL, legacy_id TEXT NOT NULL, recording_id TEXT NOT NULL REFERENCES recordings(id), PRIMARY KEY(provider, provider_id))',
  );
  db.run('CREATE INDEX IF NOT EXISTS idx_provider_recording ON provider_tracks(recording_id)');
}
/** Provider aliases are durable; metadata alone never merges search results. */
export class RecordingCatalog {
  private database: () => Database | null;
  private changed: () => void;
  constructor(database: () => Database | null, changed: () => void) {
    this.database = database;
    this.changed = changed;
  }
  private row(sql: string, args: SqlValue[]) {
    const stmt = this.database()!.prepare(sql);
    try {
      stmt.bind(args);
      return stmt.step() ? stmt.getAsObject() : undefined;
    } finally {
      stmt.free();
    }
  }
  id(track: Pick<Track, 'id' | 'source'>): string {
    const ref = providerTrackRef(track);
    return this.database()
      ? String(
          this.row('SELECT recording_id FROM provider_tracks WHERE provider=? AND provider_id=?', [
            ref.provider,
            ref.providerId,
          ])?.recording_id || providerRecordingKey(ref),
        )
      : providerRecordingKey(ref);
  }

  /** Reuse one prepared lookup for a synchronous batch of library rows. */
  withIds<T extends Pick<Track, 'id' | 'source'>>(
    length: number,
    getTrack: (index: number) => T,
    visit: (index: number, id: string, fallback: string) => void,
  ): void {
    if (!length) return;
    const statement = this.database()?.prepare(
      `SELECT p.recording_id
       FROM json_each(?) AS input
       LEFT JOIN provider_tracks AS p
         ON p.provider=json_extract(input.value, '$[0]')
        AND p.provider_id=json_extract(input.value, '$[1]')
       ORDER BY input.key`,
    );
    try {
      const batchSize = 256;
      for (let start = 0; start < length; start += batchSize) {
        const refs = Array.from({ length: Math.min(batchSize, length - start) }, (_, offset) =>
          providerTrackRef(getTrack(start + offset)),
        );
        statement?.bind([JSON.stringify(refs.map((ref) => [ref.provider, ref.providerId]))]);
        for (const [offset, ref] of refs.entries()) {
          const fallback = providerRecordingKey(ref);
          const id = statement?.step() ? statement.get()[0] : null;
          visit(start + offset, id ? String(id) : fallback, fallback);
        }
      }
    } finally {
      statement?.free();
    }
  }

  identify<T extends Track>(tracks: T[]): T[] {
    const result: T[] = [];
    this.withIds(
      tracks.length,
      (index) => tracks[index],
      (index, recordingId) => result.push({ ...tracks[index], recordingId }),
    );
    return result;
  }
  register(track: Track): string {
    const db = this.database();
    const id = this.id(track);
    if (!db) return id;
    const ref = providerTrackRef(track);
    db.run('INSERT OR IGNORE INTO recordings (id,title,artist,duration) VALUES (?,?,?,?)', [
      id,
      track.title || '',
      track.artist?.name || '',
      Number.isFinite(track.duration) ? track.duration : 0,
    ]);
    db.run(
      'INSERT OR IGNORE INTO provider_tracks (provider,provider_id,legacy_id,recording_id) VALUES (?,?,?,?)',
      [ref.provider, ref.providerId, String(track.id), id],
    );
    return id;
  }
  link(original: Track, replacement: Track): boolean {
    const db = this.database();
    if (!db || !matchesCanonicalRecording(original, replacement)) return false;
    db.run('SAVEPOINT recording_alias');
    try {
      const keep = this.register(original),
        other = this.register(replacement);
      if (keep !== other) {
        db.run('UPDATE provider_tracks SET recording_id=? WHERE recording_id=?', [keep, other]);
        db.run('DELETE FROM recordings WHERE id=?', [other]);
      }
      db.run('RELEASE recording_alias');
    } catch (error) {
      db.run('ROLLBACK TO recording_alias');
      db.run('RELEASE recording_alias');
      throw error;
    }
    this.changed();
    return true;
  }

  exportAliases(): unknown[] {
    const db = this.database();
    if (!db) return [];
    const stmt = db.prepare(
      'SELECT p.*, r.title, r.artist, r.duration FROM provider_tracks p JOIN recordings r ON r.id=p.recording_id',
    );
    const rows: unknown[] = [];
    try {
      while (stmt.step()) rows.push(stmt.getAsObject());
    } finally {
      stmt.free();
    }
    return rows;
  }
  importAliases(rows: unknown): void {
    if (!Array.isArray(rows) || rows.length > 100000) return;
    const groups = new Map<string, Track[]>();
    for (const value of rows) {
      if (!value || typeof value !== 'object') continue;
      const r = value as Record<string, unknown>;
      if (
        !['youtube', 'soundcloud', 'deezer'].includes(String(r.provider)) ||
        typeof r.provider_id !== 'string' ||
        !r.provider_id ||
        r.provider_id.length > 256 ||
        typeof r.recording_id !== 'string' ||
        r.recording_id.length > 1024 ||
        typeof r.title !== 'string' ||
        typeof r.artist !== 'string' ||
        typeof r.duration !== 'number' ||
        !Number.isFinite(r.duration)
      )
        continue;
      const canonicalId =
        (r.provider === 'youtube' ? 'yt_' : r.provider === 'soundcloud' ? 'sc_' : '') +
        r.provider_id;
      const legacy =
        typeof r.legacy_id === 'string' && r.legacy_id.length <= 256 ? r.legacy_id : canonicalId;
      const track: Track = {
        id: legacy,
        source: r.provider as Track['source'],
        title: r.title,
        artist: { name: r.artist },
        duration: r.duration,
        preview: '',
        album: { title: '' },
      };
      if (providerTrackRef(track).providerId !== r.provider_id) continue;
      const group = groups.get(r.recording_id) || [];
      group.push(track);
      groups.set(r.recording_id, group);
    }
    for (const [id, tracks] of groups) {
      const original = tracks.find((t) => providerRecordingKey(providerTrackRef(t)) === id);
      if (!original) continue;
      this.register(original);
      for (const candidate of tracks) if (candidate !== original) this.link(original, candidate);
    }
  }

  aliases(trackId: string): string[] {
    const db = this.database();
    if (!db) return [trackId];
    const roots =
      db.exec('SELECT DISTINCT recording_id FROM provider_tracks WHERE legacy_id=?', [trackId])[0]
        ?.values || [];
    if (roots.length !== 1) return [trackId];
    const id = String(roots[0][0]);
    const stmt = db.prepare(
      'SELECT provider, provider_id, legacy_id FROM provider_tracks WHERE recording_id=?',
    );
    const result = new Set([trackId]);
    try {
      stmt.bind([id]);
      while (stmt.step()) {
        const r = stmt.getAsObject();
        result.add(String(r.legacy_id));
        result.add(
          (r.provider === 'youtube' ? 'yt_' : r.provider === 'soundcloud' ? 'sc_' : '') +
            String(r.provider_id),
        );
      }
    } finally {
      stmt.free();
    }
    return [...result];
  }
}
