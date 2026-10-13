type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const isDev =
  typeof process !== 'undefined' && process.env && process.env.NODE_ENV !== 'production';

class Logger {
  private level: LogLevel = isDev ? 'debug' : 'info';

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  debug(message: string, ...args: any[]): void {
    if (this.level === 'debug') {
      console.debug(`%c[DEBUG] ${message}`, 'color: #888', ...args);
    }
  }

  info(message: string, ...args: any[]): void {
    if (this.level === 'debug' || this.level === 'info') {
      console.info(`%c[INFO] ${message}`, 'color: #3b82f6', ...args);
    }
  }

  warn(message: string, ...args: any[]): void {
    if (this.level !== 'error') {
      console.warn(`%c[WARN] ${message}`, 'color: #f59e0b', ...args);
    }
  }

  error(message: string, ...args: any[]): void {
    console.error(`%c[ERROR] ${message}`, 'color: #ef4444', ...args);
  }
}

export const logger = new Logger();
