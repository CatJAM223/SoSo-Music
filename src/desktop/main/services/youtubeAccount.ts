import { BrowserWindow, dialog, session, type Session } from 'electron';
import fs from 'node:fs/promises';
import { electronFetch } from './electronFetch.ts';
import {
  YOUTUBE_ACCOUNT_USER_AGENT,
  parseYouTubeWatchPage,
  readYouTubeWatchPage,
} from './youtubeWatchPage.ts';
import type { Innertube } from 'youtubei.js';
import type { StreamResolveOptions, YouTubeAccountStatus } from '../../../shared/types/index.ts';
import { buildYouTubeCookieHeader, parseYouTubeCookieFile } from './youtubeAccountCookies.ts';
import {
  extractYouTubeAccountStream,
  extractYouTubeAccountVideo,
  isYouTubeStreamUrl,
  type YouTubeAccountStream,
} from './youtubeAccountStream.ts';
import { PlaybackLogger } from './playbackLogger.ts';
import { probeYouTubeMedia, discardYouTubeResponse } from './youtubeMediaProbe.ts';
import {
  getYouTubeAudioAccessError,
  YOUTUBE_AUDIO_LOGIN_REQUIRED,
} from '../../../shared/utils/youtubeAudioAccessError.ts';

import {
  allowedYouTubeLoginUrl,
  isYouTubeLoginAccountHost,
  youtubeLoginHost,
} from './youtubeAccountNavigation.ts';

const ACCOUNT_PARTITION = 'persist:soso-youtube-account';
const SAFARI_UA = YOUTUBE_ACCOUNT_USER_AGENT;

/** Categorize failures without recording signed URLs, cookies, or provider response bodies. */
function accountAudioFailureReason(error: unknown): string {
  const message =
    error && typeof error === 'object' && 'message' in error ? String(error.message) : '';
  const cause = error && typeof error === 'object' && 'cause' in error ? error.cause : null;
  if (
    cause &&
    typeof cause === 'object' &&
    'message' in cause &&
    /^(no-supported-audio|no-supported-video|network|cdn-(?:http-\d{3}|redirect|response))$/.test(
      String(cause.message),
    )
  )
    return String(cause.message);
  if (/Unsupported YouTube endpoint/.test(message)) return 'unsupported-endpoint';
  if (/session redirected/.test(message)) return 'session-redirect';
  if (/поддерживаемый аудиопоток/.test(message)) return 'no-supported-audio';
  if (/No valid URL to decipher/.test(message)) return 'no-stream-url';
  if (/поддерживаемый видеопоток/.test(message)) return 'no-supported-video';
  if (/signature|decipher|cipher/i.test(message)) return 'signature';
  if (/manifest unavailable/.test(message)) return 'manifest-unavailable';
  if (/fetch failed|failed to fetch|ERR_|ECONN|network|timeout|timed out/i.test(message))
    return 'network';
  return 'unknown';
}

/** The account lives in Chromium's separate persistent cookie store, never in the library or renderer. */
export class YouTubeAccountService {
  private accountSession: Session;
  private loginWindow: BrowserWindow | null = null;
  private loginChildren = new Set<BrowserWindow>();
  private loginNeedsReload = false;
  private completeLogin: (() => void) | null = null;
  private cookieHeader = '';
  private error = '';
  private sessionError = '';
  private refreshError = '';
  private lastFailedMedia: {
    videoId: string;
    kind: 'audio' | 'video';
    options: StreamResolveOptions;
  } | null = null;
  private epoch = 0;
  private clientRequest: Promise<Innertube> | null = null;
  private deliveryRecovery: Promise<boolean> | null = null;
  private lastDeliveryRecoveryAt = 0;
  private preferredWatchUntil = 0;
  private playerCache = new Map<string, ArrayBuffer>();
  private cipherQueue: Promise<unknown> = Promise.resolve();
  private mutation: Promise<YouTubeAccountStatus> | null = null;
  private onChange: (invalidate?: boolean) => void;
  private cookieTimer: ReturnType<typeof setTimeout> | undefined;
  private getParent: () => BrowserWindow | null;

  constructor(
    getParent: () => BrowserWindow | null,
    onChange: (invalidate?: boolean) => void,
    private onConnected: () => void = () => {},
  ) {
    this.getParent = getParent;
    this.onChange = onChange;
    this.accountSession = session.fromPartition(ACCOUNT_PARTITION);
    this.accountSession.setPermissionRequestHandler((_contents, _permission, callback) =>
      callback(false),
    );
    this.accountSession.setPermissionCheckHandler(() => false);
    this.accountSession.cookies.on('changed', () => {
      if (this.cookieTimer) clearTimeout(this.cookieTimer);
      this.cookieTimer = setTimeout(() => {
        void this.refreshCookies()
          .then(() => this.completeLogin?.())
          .catch(() => {});
      }, 250);
    });
  }

  async status(): Promise<YouTubeAccountStatus> {
    await this.refreshCookies();
    return this.snapshot();
  }

  private snapshot(): YouTubeAccountStatus {
    return {
      connected: !!this.cookieHeader,
      loginOpen: !!this.loginWindow && !this.loginWindow.isDestroyed(),
      ...(this.error || this.refreshError || this.sessionError
        ? { error: this.error || this.refreshError || this.sessionError }
        : {}),
    };
  }

  private invalidate(): void {
    this.preferredWatchUntil = 0;
    this.epoch++;
    this.clientRequest = null;
    this.onChange(true);
  }

  private async refreshCookies(force = false): Promise<void> {
    if (this.mutation && !force) return;
    const epoch = this.epoch;
    const cookies = await this.accountSession.cookies.get({ url: 'https://www.youtube.com/' });
    if (epoch !== this.epoch) return;
    const next = buildYouTubeCookieHeader(cookies);
    if (next === this.cookieHeader) return;
    const identity = (header: string) =>
      header
        .split('; ')
        .filter((part) => /^(?:SAPISID|SID|__Secure-[13]P(?:APISID|SID))=/.test(part))
        .sort()
        .join('; ');
    const identityChanged = identity(next) !== identity(this.cookieHeader);
    this.cookieHeader = next;
    if (!identityChanged) return;
    this.error = '';
    this.sessionError = '';
    this.refreshError = '';
    this.invalidate();
    await this.accountSession.cookies.flushStore();
  }

  private loadLogin(win: BrowserWindow): void {
    this.loginNeedsReload = false;
    this.error = '';
    void win.loadURL('https://www.youtube.com/').catch((error) => {
      // Redirecting or closing a window can abort loadURL without failing sign-in.
      if (
        win.isDestroyed() ||
        this.loginWindow !== win ||
        error?.code === 'ERR_ABORTED' ||
        error?.errno === -3
      )
        return;
      this.failLogin(win, 'initial-load');
    });
  }

  private failLogin(win: BrowserWindow, reason: string): void {
    if (win.isDestroyed() || this.loginWindow !== win) return;
    this.loginNeedsReload = true;
    this.error = 'Окно входа не загрузилось. Нажмите «Открыть окно», чтобы попробовать снова.';
    PlaybackLogger.warn('[YouTubeMusic:Account] Login window failed (' + reason + ')');
    this.onChange();
  }

  async connect(): Promise<YouTubeAccountStatus> {
    if (this.mutation) await this.mutation;
    // Recheck after import: simultaneous clicks must reuse one window.
    if (this.loginWindow && !this.loginWindow.isDestroyed()) {
      const win = this.loginWindow;
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      if (this.loginNeedsReload) {
        for (const child of this.loginChildren) if (!child.isDestroyed()) child.destroy();
        this.loadLogin(win);
      } else {
        // A Google challenge may continue in a child window.
        const child = [...this.loginChildren].find((child) => !child.isDestroyed());
        if (child) {
          if (child.isMinimized()) child.restore();
          child.show();
          child.focus();
        }
      }
      PlaybackLogger.info('[YouTubeMusic:Account] Login window reopened');
      this.onChange();
      return this.snapshot();
    }
    this.error = '';
    const wasConnected = !!this.cookieHeader;
    const parent = this.getParent();
    const win = new BrowserWindow({
      title: 'YouTube — подключение аккаунта',
      width: 1000,
      height: 780,
      ...(parent && !parent.isDestroyed() ? { parent } : {}),
      autoHideMenuBar: true,
      webPreferences: {
        session: this.accountSession,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
      },
    });
    const children = new Set<BrowserWindow>();
    this.loginWindow = win;
    win.webContents.setAudioMuted(true);
    let returnedToYouTube = false;
    let enteredSignIn = false;
    const complete = () => {
      if (
        (wasConnected && !enteredSignIn) ||
        !this.cookieHeader ||
        win.isDestroyed() ||
        this.loginWindow !== win
      )
        return;
      if (returnedToYouTube) {
        this.error = '';
        this.sessionError = '';
        this.refreshError = '';
        this.playerCache.clear();
        this.invalidate();
        PlaybackLogger.info('[YouTubeMusic:Account] Login completed');
        win.close();
        this.onConnected();
      }
    };
    this.completeLogin = complete;
    const guard = (window: BrowserWindow) => {
      const checkNavigation = (
        event: Electron.Event & { isMainFrame?: boolean },
        url: string,
        _isInPlace?: boolean,
        isMainFrame?: boolean,
      ) => {
        // will-redirect also fires for iframes; only the top-level page owns sign-in state.
        if ((isMainFrame ?? event.isMainFrame) === false) return;
        returnedToYouTube = false;
        const host = youtubeLoginHost(url);
        const allowed = allowedYouTubeLoginUrl(url);
        if (allowed && isYouTubeLoginAccountHost(host)) enteredSignIn = true;
        if (!allowed) {
          event.preventDefault();
          PlaybackLogger.warn(
            '[YouTubeMusic:Account] Login navigation blocked (host=' + youtubeLoginHost(url) + ')',
          );
          this.failLogin(win, 'blocked-navigation');
        }
      };
      window.webContents.on('will-navigate', checkNavigation);
      window.webContents.on('will-redirect', checkNavigation);
      window.webContents.setWindowOpenHandler(({ url }) =>
        allowedYouTubeLoginUrl(url)
          ? {
              action: 'allow',
              overrideBrowserWindowOptions: {
                parent: win,
                autoHideMenuBar: true,
                webPreferences: {
                  session: this.accountSession,
                  contextIsolation: true,
                  sandbox: true,
                  nodeIntegration: false,
                  webSecurity: true,
                },
              },
            }
          : { action: 'deny' },
      );
      window.webContents.on('did-create-window', (child) => {
        this.loginChildren.add(child);
        children.add(child);
        guard(child);
        child.on('closed', () => {
          this.loginChildren.delete(child);
          children.delete(child);
        });
      });
      window.webContents.on('did-navigate', (_event, url) => {
        const host = youtubeLoginHost(url);
        returnedToYouTube = host === 'www.youtube.com' || host === 'music.youtube.com';
        PlaybackLogger.info(
          '[YouTubeMusic:Account] Login navigation (host=' + youtubeLoginHost(url) + ')',
        );
        void this.refreshCookies()
          .then(complete)
          .catch(() => {});
      });
      window.webContents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
        if (!isMainFrame) return;
        const host = youtubeLoginHost(url);
        returnedToYouTube = host === 'www.youtube.com' || host === 'music.youtube.com';
        void this.refreshCookies()
          .then(complete)
          .catch(() => {});
      });
      window.webContents.on('did-fail-load', (_event, code, _description, _url, isMainFrame) => {
        if (isMainFrame && code !== -3) this.failLogin(win, 'load-code=' + code);
      });
      window.webContents.on('render-process-gone', (_event, details) =>
        this.failLogin(win, 'renderer-' + details.reason),
      );
    };
    guard(win);
    win.on('closed', () => {
      if (this.loginWindow === win) {
        this.loginWindow = null;
        this.completeLogin = null;
        this.loginNeedsReload = false;
      }
      for (const child of children) if (!child.isDestroyed()) child.destroy();
      children.clear();
      void this.refreshCookies()
        .finally(() => this.onChange())
        .catch(() => {});
    });
    this.loadLogin(win);
    PlaybackLogger.info('[YouTubeMusic:Account] Login window opened');
    this.onChange();
    return this.snapshot();
  }
  async importSession(): Promise<YouTubeAccountStatus> {
    if (this.mutation) return this.mutation;
    const work = (async () => {
      const epoch = this.epoch;
      const options = {
        title: 'Подключить сессию YouTube из браузера',
        properties: ['openFile'] as 'openFile'[],
        filters: [{ name: 'Сессия YouTube (Netscape или JSON)', extensions: ['txt', 'json'] }],
      };
      const parent = this.getParent();
      const selection = await (parent
        ? dialog.showOpenDialog(parent, options)
        : dialog.showOpenDialog(options));
      if (selection.canceled || !selection.filePaths[0] || epoch !== this.epoch)
        return this.status();
      try {
        const file = selection.filePaths[0];
        if ((await fs.stat(file)).size > 256 * 1024)
          throw new Error('Экспортируйте cookies только для YouTube: файл слишком большой.');
        const cookies = parseYouTubeCookieFile(await fs.readFile(file, 'utf8'));
        if (epoch !== this.epoch) return this.status();
        // Validation is complete before replacing any existing account.
        this.closeLogin();
        const previous = await this.accountSession.cookies.get({ domain: 'youtube.com' });
        try {
          await this.accountSession.clearStorageData({ storages: ['cookies'] });
          for (const cookie of cookies)
            await this.accountSession.cookies.set({
              ...cookie,
              url:
                'https://' +
                (cookie.domain || '.youtube.com').replace(/^\./, '') +
                (cookie.path || '/'),
            });
        } catch {
          await this.accountSession.clearStorageData({ storages: ['cookies'] });
          for (const cookie of previous)
            await this.accountSession.cookies.set({
              name: cookie.name,
              value: cookie.value,
              domain: cookie.domain,
              path: cookie.path,
              secure: cookie.secure,
              httpOnly: cookie.httpOnly,
              ...(cookie.expirationDate ? { expirationDate: cookie.expirationDate } : {}),
              url: 'https://' + (cookie.domain || '.youtube.com').replace(/^\./, '') + cookie.path,
            });
          throw new Error('Не удалось сохранить сессию YouTube.');
        }
        this.error = '';
        this.sessionError = '';
        this.refreshError = '';
        await this.refreshCookies(true);
        await this.accountSession.cookies.flushStore();
        this.onChange();
        PlaybackLogger.info('[YouTubeMusic:Account] YouTube session imported');
        if (this.cookieHeader) this.onConnected();
      } catch (error) {
        // These errors come from our validator/file operations; never log file contents.
        this.error =
          error instanceof Error && /YouTube|cookies|сессии|списка/.test(error.message)
            ? error.message
            : 'Не удалось прочитать файл сессии YouTube.';
        this.onChange();
      }
      return this.snapshot();
    })();
    this.mutation = work;
    try {
      return await work;
    } finally {
      if (this.mutation === work) this.mutation = null;
    }
  }

  /** Rebuild playback state without deleting the signed-in browser's cookies. */
  async refresh(): Promise<YouTubeAccountStatus> {
    if (this.mutation) return this.mutation;
    const retry = this.lastFailedMedia;
    const work = (async () => {
      try {
        await this.refreshCookies(true);
        if (!this.cookieHeader) return this.snapshot();
        this.error = '';
        this.invalidate();
        await this.resetCache();
        await this.accountSession.cookies.flushStore();
        PlaybackLogger.info(
          '[YouTubeMusic:Account] Refreshing playback session (cookies preserved)',
        );
        if (retry) await this.resolveMedia(retry.videoId, retry.kind, retry.options);
        else await this.getClient();
        this.sessionError = '';
        this.refreshError = '';
        this.onChange();
        if (retry) this.onConnected();
        PlaybackLogger.info(
          '[YouTubeMusic:Account] ' +
            (retry
              ? 'Playback session refreshed and failed recording delivery checked'
              : 'Playback cache refreshed; no recording checked'),
        );
      } catch (error) {
        const reason = accountAudioFailureReason(error);
        this.refreshError = getYouTubeAudioAccessError(error)
          ? 'YouTube всё ещё требует проверку. Откройте YouTube и завершите её или импортируйте новую сессию из браузера.'
          : reason.startsWith('cdn-')
            ? 'Аккаунт подключён, но сервер YouTube не отдаёт поток' +
              (/^cdn-http-/.test(reason) ? ' (HTTP ' + reason.slice(-3) + ')' : '') +
              '. Обновление кэша не устранило отказ сервера.'
            : reason === 'no-supported-audio' || reason === 'no-supported-video'
              ? 'Вход сохранён, но YouTube не выдал поддерживаемый поток. Повторное подключение аккаунта может не помочь.'
              : 'Не удалось обновить воспроизведение YouTube. Вход сохранён; проверьте соединение и попробуйте снова.';
        this.onChange();
        PlaybackLogger.warn(
          '[YouTubeMusic:Account] Playback session refresh failed (' +
            (getYouTubeAudioAccessError(error) || reason) +
            ')',
        );
      }
      return this.snapshot();
    })();
    this.mutation = work;
    try {
      return await work;
    } finally {
      if (this.mutation === work) this.mutation = null;
    }
  }

  async disconnect(): Promise<YouTubeAccountStatus> {
    if (this.mutation) await this.mutation;
    this.closeLogin();
    this.lastFailedMedia = null;
    this.cookieHeader = '';
    this.error = '';
    this.sessionError = '';
    this.refreshError = '';
    this.invalidate();
    await this.accountSession.clearStorageData();
    await this.accountSession.clearCache();
    await this.accountSession.cookies.flushStore();
    PlaybackLogger.info('[YouTubeMusic:Account] Local YouTube session disconnected');
    this.onChange();
    return this.snapshot();
  }

  private closeLogin(): void {
    if (this.loginWindow && !this.loginWindow.isDestroyed()) this.loginWindow.destroy();
    this.loginWindow = null;
    this.completeLogin = null;
    this.loginNeedsReload = false;
    for (const child of this.loginChildren) if (!child.isDestroyed()) child.destroy();
    this.loginChildren.clear();
  }

  /** Clear bootstrap and browser HTTP caches, keeping account cookies and credentials intact. */
  async resetCache(): Promise<void> {
    this.clientRequest = null;
    this.playerCache.clear();
    await this.accountSession.clearCache();
    await this.accountSession.clearStorageData({ storages: ['cachestorage'] });
    await this.accountSession.forceReloadProxyConfig();
  }

  /** Active playback shares at most one recovery per 30 seconds; never remove login cookies. */
  private async recoverDelivery(): Promise<boolean> {
    if (this.deliveryRecovery) return this.deliveryRecovery;
    if (Date.now() - this.lastDeliveryRecoveryAt < 30000) return false;
    this.lastDeliveryRecoveryAt = Date.now();
    this.clientRequest = null;
    this.playerCache.clear();
    PlaybackLogger.info(
      '[YouTubeMusic:AccountRecovery] Refreshing player and network route after CDN 403; cookies preserved',
    );
    const recovery = (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          Promise.all([
            this.accountSession.clearCache(),
            this.accountSession.forceReloadProxyConfig(),
          ]),
          new Promise<void>((resolve) => {
            timer = setTimeout(resolve, 2000);
          }),
        ]);
      } catch {
        /* Try a fresh player response even when network refresh itself fails. */
      } finally {
        if (timer) clearTimeout(timer);
      }
      return true;
    })();
    this.deliveryRecovery = recovery;
    try {
      return await recovery;
    } finally {
      if (this.deliveryRecovery === recovery) this.deliveryRecovery = null;
    }
  }

  private async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const target =
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(target);
    const youtube = url.hostname === 'www.youtube.com' || url.hostname === 'music.youtube.com';
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      (!youtube && !isYouTubeStreamUrl(target))
    ) {
      throw new Error('Unsupported YouTube endpoint');
    }
    const request = input instanceof Request ? input : null;
    const headers = new Headers(init?.headers ?? request?.headers);
    headers.set('User-Agent', SAFARI_UA);
    if (youtube) {
      headers.set('Cookie', this.cookieHeader);
      headers.set('Origin', 'https://www.youtube.com');
      headers.set('Referer', 'https://www.youtube.com/');
    } else {
      headers.delete('Cookie');
      headers.delete('Authorization');
      headers.delete('X-Goog-Authuser');
    }
    let body = init?.body;
    if (!body && request && !['GET', 'HEAD'].includes(request.method))
      body = await request.clone().text();
    if (url.pathname === '/youtubei/v1/player' && typeof body === 'string') {
      const payload = JSON.parse(body);
      if (payload.context?.client?.clientName === 'WEB') {
        Object.assign(payload.context.client, {
          browserName: 'Safari',
          browserVersion: '26.0',
          userAgent: SAFARI_UA,
          osName: 'Macintosh',
          osVersion: '15_7_3',
        });
        payload.playbackContext ??= {};
        payload.playbackContext.contentPlaybackContext ??= {};
        payload.playbackContext.contentPlaybackContext.html5Preference = 'HTML5_PREF_WANTS';
        body = JSON.stringify(payload);
      }
    }
    const signal = AbortSignal.any([
      AbortSignal.timeout(12000),
      ...(init?.signal ? [init.signal] : []),
    ]);
    let current = target;
    for (let redirects = 0; redirects <= 2; redirects++) {
      const response = await electronFetch(
        current,
        {
          ...init,
          method: init?.method ?? request?.method,
          headers,
          body,
          redirect: 'manual',
          credentials: youtube ? 'include' : 'omit',
          signal,
          ...(url.pathname === '/youtubei/v1/player' ? { cache: 'no-store' } : {}),
        },
        this.accountSession,
      );
      if (response.status < 300 || response.status >= 400) return response;
      const location = response.headers.get('location');
      await discardYouTubeResponse(response);
      if (youtube) throw new Error('YouTube session redirected; reconnect the account');
      let next = '';
      try {
        if (location) next = new URL(location, current).href;
      } catch {
        /* Reject malformed redirects. */
      }
      if (redirects < 2 && isYouTubeStreamUrl(next) && next !== current) {
        current = next;
        continue;
      }
      throw Object.assign(new Error('YouTube CDN redirect rejected'), {
        cause: new Error('cdn-redirect'),
      });
    }
    throw Object.assign(new Error('YouTube CDN redirect rejected'), {
      cause: new Error('cdn-redirect'),
    });
  }

  private async getClient(): Promise<Innertube> {
    if (!this.clientRequest) {
      const epoch = this.epoch;
      const request = (async () => {
        const { Innertube, Platform, Log } = await import('youtubei.js');
        Log.setLevel(Log.Level.NONE);
        // Remote signature code runs only in an isolated sandbox with no network or app APIs.
        Platform.shim.eval = (data) => this.evaluateCipher(data.output);
        const client = await Innertube.create({
          cookie: this.cookieHeader,
          lang: 'ru',
          retrieve_player: true,
          enable_session_cache: false,
          generate_session_locally: false,
          user_agent: SAFARI_UA,
          fetch: (input, init) => this.fetch(input, init),
          cache: {
            cache_dir: '',
            get: async (key) => this.playerCache.get(key),
            set: async (key, value) => {
              if (epoch !== this.epoch) return;
              if (this.playerCache.size >= 8)
                this.playerCache.delete(this.playerCache.keys().next().value!);
              this.playerCache.set(key, new Uint8Array(value).slice().buffer);
            },
            remove: async (key) => {
              this.playerCache.delete(key);
            },
          },
        });
        if (epoch !== this.epoch) throw new Error('YouTube account changed');
        return client;
      })();
      this.clientRequest = request;
      void request.catch(() => {
        if (this.clientRequest === request) this.clientRequest = null;
      });
    }
    return this.clientRequest;
  }

  /** A watch response uses the signed-in browser context when the bare player API cannot deliver media. */
  private async getWatchInfo(videoId: string, client: Innertube) {
    const response = await this.fetch(
      'https://www.youtube.com/watch?v=' + encodeURIComponent(videoId),
      { cache: 'no-store' },
    );
    const page = parseYouTubeWatchPage(await readYouTubeWatchPage(response), videoId);
    const { YT, Player } = await import('youtubei.js');
    const player =
      page.playerId && page.playerId !== client.session.player?.player_id
        ? await Player.create(
            undefined,
            (input, init) => this.fetch(input, init),
            undefined,
            page.playerId,
          )
        : client.session.player;
    const info = new YT.VideoInfo(
      [{ data: page.response, success: true, status_code: 200 }],
      client.actions,
      '',
    );
    PlaybackLogger.info(
      '[YouTubeMusic:AccountWatch] Loaded the same recording from the signed-in watch page',
    );
    return { info, player };
  }

  private evaluateCipher(code: string): Promise<Record<string, unknown>> {
    const execute = async () => {
      if (code.length > 2 * 1024 * 1024) throw new Error('YouTube player script too large');
      const sandbox = session.fromPartition('youtube-cipher-sandbox');
      sandbox.webRequest.onBeforeRequest((details, callback) =>
        callback({ cancel: details.url !== 'about:blank' }),
      );
      sandbox.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
      sandbox.setPermissionCheckHandler(() => false);
      const win = new BrowserWindow({
        show: false,
        webPreferences: {
          session: sandbox,
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          webSecurity: true,
          backgroundThrottling: false,
        },
      });
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      win.webContents.on('will-navigate', (event, url) => {
        if (url !== 'about:blank') event.preventDefault();
      });
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const result = await Promise.race([
          (async () => {
            await win.loadURL('about:blank');
            return win.webContents.executeJavaScript(
              'new Function(' + JSON.stringify(code) + ')()',
            );
          })(),
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => reject(new Error('YouTube signature timed out')), 3000);
          }),
        ]);
        if (!result || typeof result !== 'object')
          throw new Error('Invalid YouTube signature result');
        return result as Record<string, unknown>;
      } finally {
        if (timer) clearTimeout(timer);
        if (!win.isDestroyed()) win.destroy();
      }
    };
    const request = this.cipherQueue.then(execute);
    this.cipherQueue = request.catch(() => {});
    return request;
  }

  async resolve(
    videoId: string,
    options: StreamResolveOptions,
  ): Promise<YouTubeAccountStream | null> {
    if (this.mutation) await this.mutation;
    return this.resolveMedia(videoId, 'audio', options);
  }

  async resolveVideo(videoId: string): Promise<YouTubeAccountStream | null> {
    if (this.mutation) await this.mutation;
    return this.resolveMedia(videoId, 'video');
  }

  private async resolveMedia(
    videoId: string,
    kind: 'audio' | 'video',
    options: StreamResolveOptions = {},
  ): Promise<YouTubeAccountStream | null> {
    await this.refreshCookies();
    if (!this.cookieHeader) return null;
    const epoch = this.epoch;
    const start = Date.now();
    let stage: 'bootstrap' | 'player' | 'audio' | 'video' | 'delivery' = 'bootstrap';
    try {
      // Reuse a verified route briefly across songs, rather than paying the same 403 on every click.
      let useWatchPage = kind === 'audio' && Date.now() < this.preferredWatchUntil;
      for (let attempt = 0; attempt < 2; attempt++) {
        const client = await this.getClient();
        stage = 'player';
        let watch: Awaited<ReturnType<YouTubeAccountService['getWatchInfo']>> | undefined;
        if (useWatchPage) {
          try {
            watch = await this.getWatchInfo(videoId, client);
          } catch (error) {
            if (kind === 'audio') this.preferredWatchUntil = 0;
            // A per-recording access restriction must never be replaced with a different source.
            if (getYouTubeAudioAccessError(error)) throw error;
            PlaybackLogger.warn(
              '[YouTubeMusic:AccountWatch] Watch response unavailable' +
                (attempt === 0 || kind === 'video' || options.allowSessionRecovery
                  ? '; using a fresh player response'
                  : ' during prefetch'),
            );
          }
        }
        if (epoch !== this.epoch) throw new Error(YOUTUBE_AUDIO_LOGIN_REQUIRED);
        // A speculative watch failure must not repeat the identical API URL that just failed.
        if (
          useWatchPage &&
          !watch &&
          attempt > 0 &&
          kind === 'audio' &&
          !options.allowSessionRecovery
        ) {
          stage = 'delivery';
          const failure = new Error('YouTube media delivery failed');
          Object.assign(failure, { cause: new Error('cdn-http-403') });
          throw failure;
        }
        const info = watch?.info ?? (await client.getBasicInfo(videoId, { client: 'WEB' }));
        stage = kind;
        const data = info.streaming_data;
        const described = [...(data?.formats || []), ...(data?.adaptive_formats || [])];
        const addressed = described.filter(
          (format) => !!(format.url || format.signature_cipher || format.cipher),
        );
        PlaybackLogger.debug(
          '[YouTubeMusic:AccountFormats] media=' +
            kind +
            ' described=' +
            described.length +
            ' addressed=' +
            addressed.length +
            ' audioOnly=' +
            addressed.filter((format) => format.mime_type?.startsWith('audio/')).length +
            ' hls=' +
            !!data?.hls_manifest_url +
            ' progressive=' +
            addressed
              .filter((format) => format.mime_type?.startsWith('video/'))
              .map((format) => format.itag)
              .join(','),
        );
        if (!data?.hls_manifest_url && !addressed.length) {
          PlaybackLogger.warn(
            '[YouTubeMusic:AccountFormats] media=' +
              kind +
              ' described=' +
              described.length +
              ' playable=0 hls=false sabr=' +
              !!data?.server_abr_streaming_url,
          );
        }
        const extract = kind === 'audio' ? extractYouTubeAccountStream : extractYouTubeAccountVideo;
        const stream = await extract(
          videoId,
          info,
          watch?.player ?? client.session.player,
          async (url) => {
            const response = await this.fetch(url);
            if (!response.ok) {
              await discardYouTubeResponse(response);
              throw new Error('YouTube manifest unavailable');
            }
            return response.text();
          },
          options,
        );
        if (epoch !== this.epoch) throw new Error(YOUTUBE_AUDIO_LOGIN_REQUIRED);
        stage = 'delivery';
        const delivery = await probeYouTubeMedia(stream.url, kind);
        if (epoch !== this.epoch) throw new Error(YOUTUBE_AUDIO_LOGIN_REQUIRED);
        if (!delivery.ok) {
          if (attempt === 0 && delivery.reason === 'cdn-http' && delivery.status === 403) {
            // Prefetch can try the same recording's watch response without touching session/cache state.
            const reset =
              kind === 'video' || options.allowSessionRecovery
                ? await this.recoverDelivery()
                : false;
            useWatchPage = !watch;
            if (watch && kind === 'audio') this.preferredWatchUntil = 0;
            PlaybackLogger.info(
              '[YouTubeMusic:AccountRecovery] Trying ' +
                (useWatchPage ? 'signed watch page' : 'player API') +
                ' after CDN 403 (cacheReset=' +
                reset +
                ')',
            );
            if (epoch !== this.epoch) throw new Error(YOUTUBE_AUDIO_LOGIN_REQUIRED);
            continue;
          }
          const failure = new Error('YouTube media delivery failed');
          Object.assign(failure, {
            cause: new Error(
              delivery.reason === 'cdn-http' ? 'cdn-http-' + delivery.status : delivery.reason,
            ),
          });
          throw failure;
        }
        if (kind === 'audio') {
          this.preferredWatchUntil = watch ? Date.now() + 5 * 60 * 1000 : 0;
          PlaybackLogger.debug(
            '[YouTubeMusic:AccountRoute] track=' +
              videoId +
              ' via=' +
              (watch ? 'watch' : 'player') +
              ' attempts=' +
              (attempt + 1),
          );
        }
        stream.url = delivery.url;
        stream.deliveryVerified = true;
        if (kind === 'audio')
          PlaybackLogger.info(
            '[YouTubeMusic:AccountAudio] track=' +
              videoId +
              ' delivery=' +
              (stream.audioContainer || 'progressive') +
              ' audioOnly=' +
              !stream.audioIncludesVideo +
              ' itag=' +
              (stream.audioItag || '?'),
          );
        if (stream.audioIncludesVideo)
          PlaybackLogger.info(
            '[YouTubeMusic:Account] Audio uses the smallest combined ' +
              (stream.audioContainer === 'hls' ? 'HLS' : 'progressive') +
              ' rendition; no audio-only stream was provided',
          );
        if (this.lastFailedMedia?.videoId === videoId && this.lastFailedMedia.kind === kind)
          this.lastFailedMedia = null;
        if (this.sessionError || this.refreshError) {
          this.sessionError = '';
          this.refreshError = '';
          this.onChange();
        }
        PlaybackLogger.info(
          '[YouTubeMusic:Account] Authenticated ' +
            kind +
            ' resolved for ' +
            videoId +
            ' in ' +
            (Date.now() - start) +
            'ms',
        );
        return stream;
      }
      throw new Error('YouTube media delivery failed');
    } catch (error) {
      if (epoch !== this.epoch) throw new Error(YOUTUBE_AUDIO_LOGIN_REQUIRED);
      this.lastFailedMedia = { videoId, kind, options: { ...options } };
      const access = getYouTubeAudioAccessError(error);
      // Transport/format failures concern this recording, not the account's login state.
      // Age restrictions are also per-recording and must not suggest reconnecting a valid account.
      if (access === 'verification-required' || access === 'sign-in-required') {
        const message =
          'YouTube отклонил сессию. Нажмите «Обновить сессию» или завершите проверку в окне YouTube.';
        if (this.sessionError !== message) {
          this.sessionError = message;
          this.onChange();
        }
      }
      PlaybackLogger.warn(
        '[YouTubeMusic:Account] Authenticated playback failed for ' +
          videoId +
          (access ? ' (' + access + ')' : ' (stream unavailable)') +
          ' stage=' +
          stage +
          ' failure=' +
          (access || accountAudioFailureReason(error)),
      );
      if (access) throw error;
      const failure = new Error(
        kind === 'audio'
          ? 'Не удалось получить аудио через подключённый аккаунт.'
          : 'Не удалось получить клип через подключённый аккаунт.',
      );
      Object.assign(failure, { cause: new Error(accountAudioFailureReason(error)) });
      throw failure;
    }
  }

  dispose(): void {
    if (this.cookieTimer) clearTimeout(this.cookieTimer);
    this.closeLogin();
  }
}
