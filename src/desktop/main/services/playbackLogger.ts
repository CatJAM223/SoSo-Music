import { getElectronApp } from './electronRuntime.ts';
import fs from 'node:fs';
import path from 'node:path';
import { preparePlaybackLog } from '../../../shared/utils/playbackLogSanitizer.ts';

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  meta?: any;
}

export class PlaybackLogger {
  private static logFilePath: string | null = null;
  private static workspaceLogPath: string | null = null;
  private static recentLogs: string[] = [];
  private static MAX_RECENT_LOGS = 150;
  private static pendingLines: string[] = [];
  private static pendingBytes = 0;
  private static flushTimer: ReturnType<typeof setTimeout> | null = null;
  private static shutdownRegistered = false;
  private static MAX_FILE_SIZE_BYTES = 1 * 1024 * 1024; // 1MB per file (max 2MB total with .old.log)

  private static initPaths(): void {
    if (this.logFilePath) return;

    try {
      // 1. User Data Directory (standard production log location)
      let userData = '';
      const electronApp = getElectronApp();
      if (electronApp && typeof electronApp.getPath === 'function') {
        userData = electronApp.getPath('userData');
      } else {
        userData = process.env.APPDATA
          ? path.join(process.env.APPDATA, 'soso-music')
          : path.join(process.cwd(), 'appData');
      }
      const logsDir = path.join(userData, 'logs');
      if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
      }
      this.logFilePath = path.join(logsDir, 'playback.log');

      // Packaged apps write only to their private user-data folder.
      if (!electronApp?.isPackaged) {
        const cwdLogsDir = path.join(process.cwd(), 'logs');
        if (!fs.existsSync(cwdLogsDir)) fs.mkdirSync(cwdLogsDir, { recursive: true });
        this.workspaceLogPath = path.join(cwdLogsDir, 'playback.log');
      }
      if (!this.shutdownRegistered) {
        this.shutdownRegistered = true;
        if (electronApp?.once) electronApp.once('will-quit', () => this.flush());
        else process.once('exit', () => this.flush());
      }
    } catch (e) {
      console.warn('[PlaybackLogger] Failed to init log directory:', e);
    }
  }

  private static rotateFileIfNeeded(filePath: string, incomingBytes = 0): void {
    try {
      if (!fs.existsSync(filePath)) return;
      const stats = fs.statSync(filePath);
      if (stats.size > 0 && stats.size + incomingBytes >= this.MAX_FILE_SIZE_BYTES) {
        const ext = path.extname(filePath);
        const base = path.basename(filePath, ext);
        const dir = path.dirname(filePath);
        const rotatedPath = path.join(dir, `${base}.old${ext}`);

        try {
          if (fs.existsSync(rotatedPath)) {
            fs.unlinkSync(rotatedPath);
          }
          fs.renameSync(filePath, rotatedPath);
        } catch {
          // If rename fails (e.g. file lock on Windows), truncate in place
          fs.writeFileSync(filePath, '', 'utf8');
        }

        const header = `--- Log rotated at ${new Date().toISOString()} ---\n`;
        fs.writeFileSync(filePath, header, 'utf8');
      }
    } catch {
      // Non-fatal
    }
  }

  private static writeToFiles(line: string): void {
    this.initPaths();
    this.recentLogs.push(line);
    if (this.recentLogs.length > this.MAX_RECENT_LOGS) this.recentLogs.shift();
    this.pendingLines.push(line);
    this.pendingBytes += Buffer.byteLength(line, 'utf8') + 1;
    // One bounded append per batch rather than stat+append for every API event.
    if (this.pendingBytes >= 64 * 1024) this.flush();
    else if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flush(), 100);
      this.flushTimer.unref?.();
    }
  }

  public static flush(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    if (!this.pendingLines.length) return;
    const batch = this.pendingLines.join('\n') + '\n';
    this.pendingLines = [];
    this.pendingBytes = 0;
    const destinations = new Set(
      [this.workspaceLogPath, this.logFilePath].filter(Boolean) as string[],
    );
    for (const filePath of destinations) {
      try {
        this.rotateFileIfNeeded(filePath, Buffer.byteLength(batch, 'utf8'));
        fs.appendFileSync(filePath, batch, 'utf8');
      } catch {
        /* Diagnostics must never stop playback. */
      }
    }
  }

  public static log(level: LogLevel, message: string, meta?: any): void {
    const safe = preparePlaybackLog(level, message, meta);
    const formatted =
      '[' + new Date().toISOString() + '] [' + safe.level + '] ' + safe.message + safe.suffix;
    if (safe.level === 'ERROR') console.error(formatted);
    else if (safe.level === 'WARN') console.warn(formatted);
    else console.log(formatted);
    this.writeToFiles(formatted);
    if (safe.level === 'ERROR') this.flush();
  }

  public static info(message: string, meta?: any): void {
    this.log('INFO', message, meta);
  }

  public static warn(message: string, meta?: any): void {
    this.log('WARN', message, meta);
  }

  public static error(message: string, meta?: any): void {
    this.log('ERROR', message, meta);
  }

  public static debug(message: string, meta?: any): void {
    this.log('DEBUG', message, meta);
  }

  public static getRecentLogs(limit: number = 50): string[] {
    const count = Number.isFinite(limit)
      ? Math.max(0, Math.min(Math.floor(limit), this.MAX_RECENT_LOGS))
      : 50;
    return count ? this.recentLogs.slice(-count) : [];
  }

  public static getLogFilePath(): string {
    this.initPaths();
    this.flush();
    return this.logFilePath || this.workspaceLogPath || '';
  }
}
