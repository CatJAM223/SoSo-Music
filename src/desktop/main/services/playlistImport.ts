import { BrowserWindow, nativeImage } from 'electron';
import { attachPlaylistCover } from './playlistImportCover.ts';
import { desktopFetch } from './desktopFetch.ts';
import {
  decodePlaylistResponse,
  parsePlaylistLink,
  readExternalPlaylist,
  readVkPlaylist,
  PlaylistImportError,
  type PlaylistTransport,
} from '../../../shared/services/externalPlaylist.ts';
import type { PlaylistReadResult } from '../../../shared/types/playlistImport.ts';
import { isVkImportUrl, isVkPlaylistPage } from './vkImportPolicy.ts';

const headers = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
};
const request: PlaylistTransport = async (url, options) => {
  const response = await desktopFetch(url, {
    method: options?.body ? 'POST' : 'GET',
    headers: {
      ...headers,
      ...(options?.body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      ...options?.headers,
    },
    body: options?.body,
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return decodePlaylistResponse(
    await response.arrayBuffer(),
    response.headers.get('content-type') || '',
    isVkImportUrl(url),
  );
};

let vkWindow: BrowserWindow | null = null;
function prepareImportedCover(bytes: Buffer): string {
  const image = nativeImage.createFromBuffer(bytes);
  if (image.isEmpty()) throw new Error('Invalid image');
  const { width, height } = image.getSize();
  const side = Math.min(width, height);
  const square = image.crop({
    x: Math.floor((width - side) / 2),
    y: Math.floor((height - side) / 2),
    width: side,
    height: side,
  });
  return `data:image/jpeg;base64,${square.resize({ width: 512, height: 512, quality: 'best' }).toJPEG(80).toString('base64')}`;
}
export const loadExternalPlaylist = async (url: string) =>
  attachPlaylistCover(await readExternalPlaylist(url, request), desktopFetch, prepareImportedCover);
export function cancelVkPlaylistRead(): void {
  vkWindow?.destroy();
}

/** Login happens only on VK's page in a sandboxed, isolated, temporary session. */
export async function loadVkPlaylistInWindow(
  input: string,
  parent?: BrowserWindow | null,
): Promise<PlaylistReadResult> {
  let link;
  try {
    link = parsePlaylistLink(input);
  } catch (error) {
    return {
      success: false,
      code: 'invalid_url',
      error: error instanceof Error ? error.message : 'Некорректная ссылка',
    };
  }
  if (link.source !== 'vk')
    return {
      success: false,
      code: 'invalid_url',
      error: 'Окно входа поддерживается только для VK.',
    };
  if (vkWindow)
    return {
      success: false,
      code: 'access',
      error: 'Окно VK уже открыто. Завершите загрузку или закройте его.',
    };
  const win = new BrowserWindow({
    title: 'VK — загрузка плейлиста',
    width: 900,
    height: 760,
    ...(parent ? { parent } : {}),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      partition: `playlist-import-${Date.now()}`,
    },
  });
  vkWindow = win;
  const vkSession = win.webContents.session;
  vkSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  win.on('page-title-updated', (event) => event.preventDefault());
  const children = new Set<BrowserWindow>();
  let finished = false;
  const guard = (window: BrowserWindow) => {
    window.webContents.on('will-navigate', (event, url) => {
      if (!isVkImportUrl(url)) event.preventDefault();
    });
    window.webContents.on('will-redirect', (event, url) => {
      if (!isVkImportUrl(url)) event.preventDefault();
    });
    window.webContents.setWindowOpenHandler(({ url }) =>
      url === 'about:blank' || isVkImportUrl(url)
        ? {
            action: 'allow',
            overrideBrowserWindowOptions: {
              parent: win,
              width: 600,
              height: 760,
              webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                sandbox: true,
                session: vkSession,
              },
            },
          }
        : { action: 'deny' },
    );
    window.webContents.on('did-create-window', (child) => {
      children.add(child);
      guard(child);
      child.on('closed', () => {
        children.delete(child);
        // OAuth may complete in a popup without navigating the parent back.
        if (!finished && !win.isDestroyed()) void win.loadURL(link.url).catch(() => {});
      });
    });
  };
  guard(win);
  const transportAbort = new AbortController();
  const authenticatedRequest: PlaylistTransport = async (url, options) => {
    // Fixed hosts and paths come exclusively from the validated VK loader.
    if (!['https://m.vk.ru/audio', 'https://vk.ru/al_audio.php'].includes(url))
      throw new Error('Unsupported VK endpoint');
    const response = await vkSession.fetch(url, {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/x-www-form-urlencoded',
        Origin: new URL(url).origin,
        Referer: url.startsWith('https://vk.ru/') ? link.url : 'https://m.vk.ru/audio',
        ...options?.headers,
      },
      body: options?.body,
      credentials: 'include',
      signal: AbortSignal.any([AbortSignal.timeout(15000), transportAbort.signal]),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return decodePlaylistResponse(
      await response.arrayBuffer(),
      response.headers.get('content-type') || '',
      true,
    );
  };
  return new Promise((resolve) => {
    let settled = false;
    let loading = false;
    let playlistFailures = 0;
    const finish = (result: PlaylistReadResult) => {
      if (settled) return;
      settled = true;
      finished = true;
      transportAbort.abort();
      clearInterval(interval);
      clearTimeout(timeout);
      if (vkWindow === win) vkWindow = null;
      for (const child of children) if (!child.isDestroyed()) child.destroy();
      if (!win.isDestroyed()) win.destroy();
      void vkSession.clearStorageData().catch(() => {});
      resolve(result);
    };
    const check = async () => {
      if (settled || loading) return;
      loading = true;
      try {
        let result: PlaylistReadResult;
        try {
          result = { success: true, data: await readVkPlaylist(link, authenticatedRequest, true) };
        } catch (error) {
          if (finished) return;
          result =
            error instanceof PlaylistImportError
              ? { success: false, code: error.code, error: error.message }
              : {
                  success: false,
                  code: 'network',
                  error: 'Не удалось загрузить список треков VK. Проверьте подключение.',
                };
          if (result.code !== 'incomplete')
            result = await readExternalPlaylist(input, authenticatedRequest);
        }
        if (settled) return;
        if (result.success) {
          const withCover = await attachPlaylistCover(
            result,
            (url, init) => vkSession.fetch(url, { ...init, credentials: 'include' }),
            prepareImportedCover,
            transportAbort.signal,
          );
          if (!settled) finish(withCover);
        } else if (result.code === 'incomplete') finish(result);
        else if (
          !win.isDestroyed() &&
          isVkPlaylistPage(win.webContents.getURL()) &&
          ++playlistFailures >= 3
        ) {
          finish({
            ...result,
            error:
              result.code === 'access'
                ? 'VK открыл плейлист, но не отдал список треков. Проверьте доступ к нему в своём аккаунте и повторите импорт.'
                : result.error,
          });
        }
      } finally {
        loading = false;
      }
    };
    const interval = setInterval(() => {
      void check();
    }, 4000);
    const timeout = setTimeout(
      () =>
        finish({
          success: false,
          code: 'access',
          error: 'Время ожидания входа в VK истекло. Попробуйте ещё раз.',
        }),
      10 * 60 * 1000,
    );
    win.on('closed', () =>
      finish({ success: false, code: 'access', error: 'Загрузка VK отменена: окно было закрыто.' }),
    );
    win.webContents.on('did-finish-load', () => {
      void check();
    });
    void win.loadURL(link.url).catch(() =>
      finish({
        success: false,
        code: 'network',
        error: 'Не удалось открыть VK. Проверьте подключение.',
      }),
    );
  });
}
