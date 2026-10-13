import { preparePlaybackLog } from '../utils/playbackLogSanitizer.ts';
export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export class PlaybackLogger {
  private static recentLogs: string[] = [];
  private static MAX_RECENT = 100;

  public static log(level: LogLevel, message: string, meta?: any): void {
    const safe = preparePlaybackLog(level, message, meta);
    level = safe.level;
    message = safe.message;
    meta = safe.meta;
    const timestamp = new Date().toISOString();
    const formatted = `[${timestamp}] [${level}] ${message}${safe.suffix}`;

    this.recentLogs.push(formatted);
    if (this.recentLogs.length > this.MAX_RECENT) {
      this.recentLogs.shift();
    }

    // Forward to Electron Main Process to persist in logs/playback.log
    if (typeof window !== 'undefined' && (window as any).electronAPI?.logPlaybackEvent) {
      try {
        (window as any).electronAPI.logPlaybackEvent(level, message, meta);
      } catch (e) {
        // Silently catch IPC issues
      }
    }

    // Console output in renderer
    if (level === 'ERROR') {
      console.error(`[Playback] ${message}`, meta || '');
    } else if (level === 'WARN') {
      console.warn(`[Playback] ${message}`, meta || '');
    } else {
      console.log(`[Playback] ${message}`, meta || '');
    }
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

  public static getRecentLogs(): string[] {
    return [...this.recentLogs];
  }
}
