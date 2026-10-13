import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export function normalizeLastFmApiKey(value: unknown): string {
  if (typeof value !== 'string' || (value.trim() && !/^[a-f0-9]{32}$/i.test(value.trim())))
    throw new Error('Invalid Last.fm API key');
  return value.trim();
}

/** Private application configuration, deliberately separate from exported library data. */
export class LastFmKeyStore {
  private filename: string;
  private directory: string;
  constructor(directory: string) {
    this.directory = directory;
    this.filename = path.join(directory, 'lastfm-api-key.json');
  }
  read(): string {
    if (!fs.existsSync(this.filename)) return '';
    return normalizeLastFmApiKey(JSON.parse(fs.readFileSync(this.filename, 'utf8')).apiKey);
  }
  save(value: unknown): string {
    const apiKey = normalizeLastFmApiKey(value);
    fs.mkdirSync(this.directory, { recursive: true });
    const temporary = this.filename + '.' + randomUUID() + '.tmp';
    try {
      fs.writeFileSync(temporary, JSON.stringify({ apiKey }) + '\n', { mode: 0o600, flag: 'wx' });
      fs.renameSync(temporary, this.filename);
    } finally {
      fs.rmSync(temporary, { force: true });
    }
    return apiKey;
  }
}
