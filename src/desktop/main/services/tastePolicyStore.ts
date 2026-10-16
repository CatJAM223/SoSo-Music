import type { Database } from 'sql.js';
import type {
  TasteExclusionChange,
  TastePolicySnapshot,
} from '../../../shared/types/tastePolicy.ts';
import {
  normalizePlaybackOrigin,
  tasteContextId,
  tasteTrackId,
} from '../../../shared/utils/tastePolicy.ts';
export function createTastePolicySchema(db: Database): void {
  db.run(
    "CREATE TABLE IF NOT EXISTS taste_exclusions (scope TEXT NOT NULL CHECK(scope IN ('track','playlist')), id TEXT NOT NULL, label TEXT NOT NULL DEFAULT '', PRIMARY KEY(scope,id))",
  );
  db.run(
    'CREATE TABLE IF NOT EXISTS taste_policy_revision (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL)',
  );
  db.run('INSERT OR IGNORE INTO taste_policy_revision(id,revision) VALUES(1,0)');
  db.run('CREATE INDEX IF NOT EXISTS idx_playback_sessions_track ON playback_sessions(track_id)');
  db.run(
    'CREATE TABLE IF NOT EXISTS taste_playback_origins (session_id TEXT PRIMARY KEY, kind TEXT NOT NULL, context_id TEXT NOT NULL, FOREIGN KEY(session_id) REFERENCES playback_sessions(session_id) ON DELETE CASCADE)',
  );
}
/** Expressions below are internal SQL identifiers, never IPC input. */
export function tasteTrackAllowedSql(expression: string): string {
  const canonical =
    'CASE WHEN substr(' +
    expression +
    ",1,3)='dz_' THEN substr(" +
    expression +
    ',4) ELSE ' +
    expression +
    ' END';
  return (
    "NOT EXISTS (SELECT 1 FROM taste_exclusions tx WHERE tx.scope='track' AND tx.id=(" +
    canonical +
    '))'
  );
}
export function tastePlaylistAllowedSql(expression: string): string {
  return (
    "NOT EXISTS (SELECT 1 FROM taste_exclusions px WHERE px.scope='playlist' AND px.id=" +
    expression +
    ')'
  );
}
/** Subtract only attributed ignored sessions; legacy events remain unattributed. Raw statistics survive. */
export function tasteHistoryScoreSql(alias: string): string {
  return (
    '(' +
    alias +
    '.complete_count*3 + ' +
    alias +
    '.repeat_count*5 + ' +
    alias +
    '.play_count - ' +
    alias +
    '.skip_count*2' +
    ' - COALESCE((SELECT SUM(1+p.completed*3+p.repeated*5-p.skipped*2)' +
    ' FROM playback_sessions p JOIN taste_playback_origins o ON o.session_id=p.session_id' +
    " JOIN taste_exclusions x ON x.scope='playlist' AND x.id=o.context_id" +
    ' WHERE p.track_id=' +
    alias +
    ".track_id AND o.kind='playlist'),0))"
  );
}
export class TastePolicyStore {
  private database: () => Database | null;
  private save: () => void;
  constructor(database: () => Database | null, save: () => void) {
    this.database = database;
    this.save = save;
  }
  snapshot(): TastePolicySnapshot {
    const db = this.database();
    if (!db) return { revision: -1, exclusions: [] };
    const revision = Number(
      db.exec('SELECT revision FROM taste_policy_revision WHERE id=1')[0]?.values[0]?.[0] || 0,
    );
    const rows =
      db.exec('SELECT scope,id,label FROM taste_exclusions ORDER BY scope,id')[0]?.values || [];
    return {
      revision,
      exclusions: rows.map((row) => ({
        scope: row[0] as 'track' | 'playlist',
        id: String(row[1]),
        label: String(row[2]),
      })),
    };
  }
  set(value: unknown): TastePolicySnapshot {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new TypeError('Invalid taste exclusion');
    const input = value as TasteExclusionChange;
    if (!['track', 'playlist'].includes(input.scope) || typeof input.excluded !== 'boolean')
      throw new TypeError('Invalid taste exclusion');
    const id = input.scope === 'track' ? tasteTrackId(input.id) : tasteContextId(input.id);
    if (!id || (input.label !== undefined && typeof input.label !== 'string'))
      throw new TypeError('Invalid taste identity');
    const db = this.database();
    if (!db) throw new Error('Database unavailable');
    const current = this.snapshot(),
      existing = current.exclusions.some((row) => row.scope === input.scope && row.id === id);
    if (existing === input.excluded) return current;
    if (input.excluded && current.exclusions.length >= 10000)
      throw new Error('Too many taste exclusions');
    db.run('BEGIN TRANSACTION');
    try {
      if (input.excluded)
        db.run('INSERT INTO taste_exclusions(scope,id,label) VALUES(?,?,?)', [
          input.scope,
          id,
          String(input.label || '').slice(0, 500),
        ]);
      else db.run('DELETE FROM taste_exclusions WHERE scope=? AND id=?', [input.scope, id]);
      db.run('UPDATE taste_policy_revision SET revision=revision+1 WHERE id=1');
      db.run('COMMIT');
    } catch (error) {
      db.run('ROLLBACK');
      throw error;
    }
    this.save();
    return this.snapshot();
  }
  recordOrigin(sessionId: string, value: unknown): void {
    const origin = normalizePlaybackOrigin(value);
    if (origin)
      this.database()?.run(
        'INSERT OR IGNORE INTO taste_playback_origins(session_id,kind,context_id) VALUES(?,?,?)',
        [sessionId, origin.kind, origin.id || ''],
      );
  }
}
