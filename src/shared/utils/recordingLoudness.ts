/** Bounded, silence-gated estimate of recording loudness; no audio samples are retained. */
export class RecordingLoudness {
  private counts = new Uint32Array(96);
  private powers = new Float64Array(96);
  frames = 0;
  addPower(power: number): void {
    if (!Number.isFinite(power) || power <= 0) return;
    const db = -0.691 + 10 * Math.log10(power);
    if (db < -65) return;
    const bin = Math.max(0, Math.min(95, Math.floor(db + 70)));
    this.counts[bin]++;
    this.powers[bin] += power;
    this.frames++;
  }
  gainDb(): number | null {
    if (this.frames < 16) return null;
    let total = 0;
    for (const power of this.powers) total += power;
    const relativePower = total / this.frames / 10;
    let keptPower = 0,
      keptFrames = 0;
    for (let i = 0; i < this.counts.length; i++) {
      if (this.counts[i] && this.powers[i] / this.counts[i] >= relativePower) {
        keptPower += this.powers[i];
        keptFrames += this.counts[i];
      }
    }
    if (!keptFrames) return null;
    const loudness = -0.691 + 10 * Math.log10(keptPower / keptFrames);
    return Math.max(-24, Math.min(18, -14 - loudness));
  }
}
export const normalizationGain = (db: number): number =>
  Number.isFinite(db) ? Math.pow(10, Math.max(-24, Math.min(18, db)) / 20) : 1;
export function recordingKey(track: { id: string | number; source?: string }): string {
  const id = String(track.id || '');
  return id && id.length < 120
    ? (track.source || (id.startsWith('yt_') ? 'youtube' : 'soundcloud')) + ':' + id
    : '';
}
export interface LoudnessRecord {
  db: number;
  at: number;
}
export class LoudnessProfiles {
  private profiles = new Map<string, LoudnessRecord>();
  static readonly LIMIT = 128;
  static readonly STORAGE_KEY = 'soso_recording_loudness_v1';
  private storage?: Pick<Storage, 'getItem' | 'setItem'>;
  private now: () => number;
  constructor(storage?: Pick<Storage, 'getItem' | 'setItem'>, now = () => Date.now()) {
    this.storage = storage;
    this.now = now;
    try {
      const raw = storage?.getItem(LoudnessProfiles.STORAGE_KEY);
      if (!raw || raw.length > 40000) return;
      const rows: unknown = JSON.parse(raw);
      if (!Array.isArray(rows)) return;
      for (const row of rows.slice(-LoudnessProfiles.LIMIT)) {
        if (
          Array.isArray(row) &&
          typeof row[0] === 'string' &&
          row[0].length < 160 &&
          Number.isFinite(row[1]?.db) &&
          row[1].db >= -24 &&
          row[1].db <= 18 &&
          Number.isFinite(row[1]?.at) &&
          row[1].at <= this.now() &&
          this.now() - row[1].at < 30 * 86400000
        ) {
          this.profiles.set(row[0], row[1]);
        }
      }
    } catch {
      /* Storage failure must not interfere with playback. */
    }
  }
  get(key: string): number | null {
    const value = this.profiles.get(key);
    return value && this.now() - value.at < 30 * 86400000 ? value.db : null;
  }
  set(key: string, db: number): void {
    if (!key || key.length >= 160 || !Number.isFinite(db)) return;
    this.profiles.delete(key);
    this.profiles.set(key, { db: Math.max(-24, Math.min(18, db)), at: this.now() });
    while (this.profiles.size > LoudnessProfiles.LIMIT)
      this.profiles.delete(this.profiles.keys().next().value!);
    try {
      this.storage?.setItem(LoudnessProfiles.STORAGE_KEY, JSON.stringify([...this.profiles]));
    } catch {}
  }
}
