import type { App, BrowserWindow, CrashReporter } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { PlaybackLogger } from './playbackLogger.ts';

type RuntimeSession = {
  version: string;
  electron: string;
  startedAt: string;
  lastSeenAt: string;
  cleanExit: boolean;
};

/** Local diagnostics also cover native failures, which JS error handlers cannot catch. */
export function startRuntimeDiagnostics(
  app: App,
  reporter: CrashReporter,
  readWindows: () => BrowserWindow[] = () => [],
): void {
  const log = (level: 'info' | 'warn' | 'error', message: string, meta?: unknown) => {
    try {
      PlaybackLogger[level]('[Runtime] ' + message, meta);
      PlaybackLogger.flush();
    } catch {
      // A broken console or full disk must not make the exception handler throw again.
    }
  };
  process.on('uncaughtException', (error) => log('error', 'Uncaught main exception', error));
  process.on('unhandledRejection', (reason) => log('error', 'Unhandled main rejection', reason));
  try {
    reporter.start({ uploadToServer: false, ignoreSystemCrashHandler: true });
    log('info', 'Local crash reports enabled', { directory: app.getPath('crashDumps') });
  } catch (error) {
    log('error', 'Could not enable local crash reports', error);
  }

  const sessionPath = path.join(app.getPath('userData'), 'logs', 'runtime-session.json');
  const state: RuntimeSession = {
    version: app.getVersion(),
    electron: process.versions.electron || '',
    startedAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    cleanExit: false,
  };
  try {
    if (fs.existsSync(sessionPath) && fs.statSync(sessionPath).size <= 4096) {
      const previous = JSON.parse(fs.readFileSync(sessionPath, 'utf8')) as RuntimeSession;
      if (previous.cleanExit === false) {
        log('warn', 'Previous session ended without a normal quit', {
          version: previous.version,
          electron: previous.electron,
          startedAt: previous.startedAt,
          lastSeenAt: previous.lastSeenAt,
        });
      }
    }
  } catch (error) {
    log('warn', 'Could not read previous runtime session', error);
  }
  const save = () => {
    try {
      state.lastSeenAt = new Date().toISOString();
      fs.mkdirSync(path.dirname(sessionPath), { recursive: true });
      fs.writeFileSync(sessionPath + '.tmp', JSON.stringify(state), 'utf8');
      fs.renameSync(sessionPath + '.tmp', sessionPath);
    } catch (error) {
      log('warn', 'Could not save runtime session', error);
    }
  };
  const snapshot = () => {
    try {
      const memory = process.memoryUsage();
      const windows = new Map(
        readWindows()
          .filter((window) => !window.isDestroyed() && !window.webContents.isDestroyed())
          .map((window) => {
            const url = new URL(window.webContents.getURL() || 'about:blank');
            const page =
              url.hash === '#/overlay'
                ? 'overlay'
                : url.hash === '#/widget'
                  ? 'widget'
                  : url.protocol === 'file:'
                    ? 'player'
                    : 'auxiliary';
            return [window.webContents.getOSProcessId(), page];
          }),
      );
      log('info', 'Process memory', {
        main: { rss: memory.rss, heapUsed: memory.heapUsed, external: memory.external },
        processes: app
          .getAppMetrics()
          .slice(0, 20)
          .map((metric) => ({
            pid: metric.pid,
            type: metric.type,
            serviceName: metric.serviceName,
            workingSetKB: metric.memory.workingSetSize,
            privateBytesKB: metric.memory.privateBytes,
            window: windows.get(metric.pid),
          })),
      });
    } catch (error) {
      log('warn', 'Could not sample process memory', error);
    }
    save();
  };
  save();
  log('info', 'Session started', { ...state, executable: process.execPath });
  if (app.isReady()) snapshot();
  else app.once('ready', snapshot);
  const timer = setInterval(snapshot, 60000);
  timer.unref();
  app.on('child-process-gone', (_event, details) => {
    log(details.reason === 'clean-exit' ? 'info' : 'error', 'Child process gone', details);
  });
  app.on('render-process-gone', (_event, contents, details) => {
    log('error', 'Renderer process gone', { webContentsId: contents.id, ...details });
  });
  app.once('will-quit', () => {
    clearInterval(timer);
    state.cleanExit = true;
    save();
    log('info', 'Normal quit');
  });
  process.once('exit', (exitCode) => {
    log('info', 'Main process exit', { exitCode });
  });
}

/** Recover only the existing trusted page, with a budget to prevent crash/reload loops. */
export function recoverMainRenderer(window: BrowserWindow, isQuitting: () => boolean): void {
  const attempts: number[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  window.webContents.on('render-process-gone', (_event, details) => {
    if (
      isQuitting() ||
      window.isDestroyed() ||
      !['crashed', 'oom', 'abnormal-exit', 'memory-eviction'].includes(details.reason)
    )
      return;
    const now = Date.now();
    while (attempts.length && now - attempts[0] > 5 * 60000) attempts.shift();
    if (attempts.length >= 2) {
      PlaybackLogger.error('[Runtime] Main renderer recovery budget exhausted', details);
      return;
    }
    if (timer) return;
    attempts.push(now);
    PlaybackLogger.error('[Runtime] Recovering main renderer', details);
    timer = setTimeout(() => {
      timer = undefined;
      if (!isQuitting() && !window.isDestroyed() && !window.webContents.isDestroyed())
        window.webContents.reload();
    }, 500);
  });
  window.on('unresponsive', () => PlaybackLogger.warn('[Runtime] Main window unresponsive'));
  window.once('closed', () => clearTimeout(timer));
}
