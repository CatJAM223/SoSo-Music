import type {
  ExternalPlaylist,
  ExternalPlaylistTrack,
  PlaylistReadResult,
} from '../types/playlistImport.ts';

export interface PlaylistTransport {
  (url: string, options?: { body?: string; headers?: Record<string, string> }): Promise<string>;
}
export type PlaylistLink =
  | { source: 'yandex'; url: string; uuid?: string; owner?: string; kind?: string }
  | { source: 'vk'; url: string; owner: string; kind: string; hash: string };

export class PlaylistImportError extends Error {
  code: Extract<PlaylistReadResult, { success: false }>['code'];
  constructor(code: PlaylistImportError['code'], message: string) {
    super(message);
    this.code = code;
  }
}

/** VK can return legacy Windows-1251 JSON. Response.text() always reads UTF-8. */
export function decodePlaylistResponse(
  bytes: ArrayBuffer,
  contentType: string,
  allowWindows1251 = false,
): string {
  const charset = contentType.match(/charset\s*=\s*["']?([^;\s"']+)/i)?.[1];
  if (charset && !/^utf-?8$/i.test(charset)) {
    try {
      return new TextDecoder(charset, { fatal: true }).decode(bytes);
    } catch {
      /* Unsupported/misdeclared charset: try strict UTF-8 below. */
    }
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    if (allowWindows1251) {
      try {
        return new TextDecoder('windows-1251', { fatal: true }).decode(bytes);
      } catch {
        /* Do not silently search replacement characters. */
      }
    }
    throw new PlaylistImportError(
      'incomplete',
      'Не удалось прочитать кодировку названий треков. Загрузите список заново.',
    );
  }
}

/** Validate links at both the renderer and network boundary. Never fetch an arbitrary URL. */
export function parsePlaylistLink(input: string): PlaylistLink {
  const invalid = () =>
    new PlaylistImportError(
      'invalid_url',
      'Вставьте полную ссылку на публичный плейлист Яндекс Музыки или VK.',
    );
  if (typeof input !== 'string' || input.length > 2048) throw invalid();
  let link: URL;
  try {
    link = new URL(input.trim());
  } catch {
    throw invalid();
  }
  if (!['https:', 'http:'].includes(link.protocol) || link.username || link.password || link.port)
    throw invalid();
  if (/^music\.yandex\.(ru|com|kz|by)$/.test(link.hostname)) {
    const uuid = link.pathname.match(
      /^\/playlists\/((?:[a-z]{2}\.)?[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})(?:\/)?$/i,
    )?.[1];
    if (uuid) return { source: 'yandex', uuid, url: `https://music.yandex.ru/playlists/${uuid}` };
    const old = link.pathname.match(/^\/users\/([^/]+)\/playlists\/(\d+)\/?$/);
    if (old) {
      let owner: string;
      try {
        owner = decodeURIComponent(old[1]);
      } catch {
        throw invalid();
      }
      if (!/^[\w.@-]{1,150}$/.test(owner)) throw invalid();
      return {
        source: 'yandex',
        owner,
        kind: old[2],
        url: `https://music.yandex.ru/users/${encodeURIComponent(owner)}/playlists/${old[2]}`,
      };
    }
  }
  if (/^(?:(?:m|www)\.)?vk\.(ru|com)$/.test(link.hostname)) {
    const target =
      link.pathname +
      ' ' +
      (link.searchParams.get('act') || '') +
      ' ' +
      (link.searchParams.get('z') || '');
    const match = target.match(
      /(?:audio_playlist|\/music\/playlist\/)(-?\d+)_(\d+)(?:_([a-zA-Z0-9]+))?/,
    );
    if (match) {
      const hash = match[3] || link.searchParams.get('access_hash') || '';
      if (hash && !/^[a-zA-Z0-9]{1,128}$/.test(hash)) throw invalid();
      return {
        source: 'vk',
        owner: match[1],
        kind: match[2],
        hash,
        url: `https://vk.ru/audio_playlist${match[1]}_${match[2]}${hash ? `_${hash}` : ''}`,
      };
    }
  }
  throw invalid();
}

export function decodePlaylistText(value: unknown): string {
  return String(value ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi, (all, entity: string) => {
      if (entity[0] === '#') {
        const n =
          entity[1].toLowerCase() === 'x'
            ? parseInt(entity.slice(2), 16)
            : parseInt(entity.slice(1), 10);
        return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : all;
      }
      return (
        ({ amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' } as Record<string, string>)[
          entity.toLowerCase()
        ] || all
      );
    })
    .replace(/<[^>]*>/g, '')
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim();
}

export function parseYandexTrack(entry: any): ExternalPlaylistTrack | null {
  const track = entry?.track || entry;
  if (!track?.title || !track?.id) return null;
  const title = [decodePlaylistText(track.title), decodePlaylistText(track.version)]
    .filter(Boolean)
    .join(' — ');
  return {
    id: String(track.id),
    title,
    artist: (track.artists || [])
      .map((a: any) => decodePlaylistText(a.name))
      .filter(Boolean)
      .join(', '),
    duration: Math.round(Number(track.durationMs || 0) / 1000),
  };
}

function parseJson(text: string): any {
  try {
    return JSON.parse(text.replace(/^\s*(?:<!--|<!json>)/, ''));
  } catch {
    throw new PlaylistImportError(
      'access',
      'Площадка не отдала список треков. Проверьте публичность плейлиста и попробуйте ещё раз.',
    );
  }
}

async function readYandex(
  link: Extract<PlaylistLink, { source: 'yandex' }>,
  request: PlaylistTransport,
): Promise<ExternalPlaylist> {
  const path = link.uuid
    ? `/playlist/${encodeURIComponent(link.uuid)}`
    : `/users/${encodeURIComponent(link.owner!)}/playlists/${link.kind}`;
  const base = `https://api.music.yandex.net${path}`;
  const first = parseJson(await request(`${base}?page=0&page-size=1000`));
  if (first.error || !first.result || first.result.visibility === 'private') {
    throw new PlaylistImportError(
      'access',
      'Плейлист Яндекс Музыки недоступен. Отключите «Приватный плейлист» и скопируйте ссылку через «Поделиться».',
    );
  }
  const playlist = first.result;
  const expected = Number(playlist.trackCount);
  if (!Number.isInteger(expected) || expected < 0 || expected > 10000) {
    throw new PlaylistImportError(
      'incomplete',
      'Не удалось определить размер плейлиста. Поддерживаются плейлисты до 10 000 треков.',
    );
  }
  const entries: any[] = [...(playlist.tracks || [])];
  const seenPages = new Set([entries.map((t: any) => t.id).join(',')]);
  for (let page = 1; entries.length < expected && page < 11; page++) {
    const next =
      parseJson(await request(`${base}?page=${page}&page-size=1000`)).result?.tracks || [];
    const fingerprint = next.map((t: any) => t.id).join(',');
    if (!next.length || seenPages.has(fingerprint)) break;
    seenPages.add(fingerprint);
    entries.push(...next);
  }
  if (entries.length !== expected)
    throw new PlaylistImportError(
      'incomplete',
      `Получено ${entries.length} из ${expected} треков. Импорт неполного плейлиста остановлен.`,
    );
  // Some playlist responses contain IDs only. Hydrate metadata in bounded batches.
  const missing = entries.filter((entry) => !parseYandexTrack(entry));
  const metadata = new Map<string, any>();
  for (let i = 0; i < missing.length; i += 100) {
    const ids = missing
      .slice(i, i + 100)
      .map((entry) => entry.id)
      .filter(Boolean);
    const response = parseJson(
      await request('https://api.music.yandex.net/tracks', {
        body: new URLSearchParams({ 'track-ids': ids.join(',') }).toString(),
      }),
    );
    for (const track of response.result || []) metadata.set(String(track.id), track);
  }
  const tracks = entries.map(
    (entry) => parseYandexTrack(entry) || parseYandexTrack(metadata.get(String(entry.id))),
  );
  if (tracks.some((track) => !track))
    throw new PlaylistImportError(
      'incomplete',
      'Для части песен площадка не вернула название и исполнителя. Попробуйте повторить загрузку.',
    );
  return {
    source: 'yandex',
    url: link.url,
    title: decodePlaylistText(playlist.title) || 'Плейлист Яндекс Музыки',
    tracks: tracks as ExternalPlaylistTrack[],
  };
}

export function parseVkTrack(row: any): ExternalPlaylistTrack | null {
  const checked = (track: ExternalPlaylistTrack): ExternalPlaylistTrack => {
    if (/[\uFFFD]/.test(track.title + track.artist)) {
      throw new PlaylistImportError(
        'incomplete',
        'VK вернул повреждённые названия треков. Загрузите список заново, чтобы сохранить кириллицу.',
      );
    }
    return track;
  };
  if (Array.isArray(row)) {
    if (!row[0] || !row[1] || typeof row[3] !== 'string' || typeof row[4] !== 'string') return null;
    return checked({
      id: `${row[1]}_${row[0]}`,
      title: decodePlaylistText(row[3]),
      artist: decodePlaylistText(row[4]),
      duration: Number(row[5]) || 0,
    });
  }
  if (!row?.id || !row?.title || !(row.artist || row.performer)) return null;
  return checked({
    id: `${row.owner_id || ''}_${row.id}`,
    title: decodePlaylistText(row.title),
    artist: decodePlaylistText(row.artist || row.performer),
    duration: Number(row.duration) || 0,
  });
}

export async function readVkPlaylist(
  link: Extract<PlaylistLink, { source: 'vk' }>,
  request: PlaylistTransport,
  desktop = false,
): Promise<ExternalPlaylist> {
  const tracks: ExternalPlaylistTrack[] = [];
  let title = 'Плейлист VK';
  let coverUrl: string | undefined;
  let offset = 0;
  const seen = new Set<string>();
  for (let page = 0; page < 100; page++) {
    const body = new URLSearchParams({
      act: 'load_section',
      al: '1',
      owner_id: link.owner,
      playlist_id: link.kind,
      offset: String(offset),
      type: 'playlist',
      access_hash: link.hash,
      is_loading_all: '1',
    }).toString();
    const json = parseJson(
      await request(desktop ? 'https://vk.ru/al_audio.php' : 'https://m.vk.ru/audio', {
        body,
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      }),
    );
    const candidates = Array.isArray(json.data)
      ? json.data
      : Array.isArray(json.payload?.[1])
        ? json.payload[1]
        : [];
    const wrapper = candidates.find(
      (item: any) => Array.isArray(item?.list) || Array.isArray(item?.playlist?.list),
    );
    // Desktop responses may keep rows beside playlist metadata rather than inside it.
    const playlist = wrapper
      ? { ...wrapper, ...wrapper.playlist, list: wrapper.list ?? wrapper.playlist?.list }
      : undefined;
    if (!playlist || !Array.isArray(playlist.list))
      throw new PlaylistImportError(
        'access',
        'VK не отдал список треков без входа. Откройте плейлист в окне VK и войдите в аккаунт, если потребуется.',
      );
    if (
      (playlist.ownerId != null && String(playlist.ownerId) !== link.owner) ||
      (playlist.id != null && String(playlist.id) !== link.kind)
    ) {
      throw new PlaylistImportError(
        'access',
        'VK вернул другой плейлист. Откройте исходную ссылку и повторите загрузку.',
      );
    }
    title = decodePlaylistText(playlist.title || playlist.name) || title;
    const thumb = playlist.thumb || playlist.cover || playlist.coverUrl || playlist.cover_url;
    const cover =
      typeof thumb === 'string'
        ? thumb
        : thumb?.photo_600 ||
          thumb?.photo_300 ||
          thumb?.photo_270 ||
          thumb?.photo_135 ||
          thumb?.photo_68 ||
          thumb?.url;
    // The first page may be the only one with artwork. Validate before downloading.
    if (typeof cover === 'string' && cover.length <= 4096) coverUrl ||= cover;
    const rows = playlist.list.map(parseVkTrack);
    if (rows.some((row: ExternalPlaylistTrack | null) => !row))
      throw new PlaylistImportError(
        'incomplete',
        'Не удалось прочитать часть записей VK. Импорт остановлен, чтобы не потерять песни.',
      );
    for (const row of rows as ExternalPlaylistTrack[]) {
      if (seen.has(row.id)) continue;
      tracks.push(row);
      seen.add(row.id);
    }
    if (tracks.length > 10000)
      throw new PlaylistImportError('incomplete', 'Поддерживаются плейлисты до 10 000 треков.');
    const count = Number(playlist.totalCount ?? playlist.count ?? playlist.total);
    const more =
      playlist.hasMore ??
      playlist.has_more ??
      (Number.isFinite(count) ? tracks.length < count : false);
    if (!more) {
      if (Number.isFinite(count) && count > tracks.length)
        throw new PlaylistImportError(
          'incomplete',
          `Получено ${tracks.length} из ${count} треков VK. Импорт остановлен.`,
        );
      return { source: 'vk', url: link.url, title, tracks, ...(coverUrl ? { coverUrl } : {}) };
    }
    if (!rows.length || tracks.length <= offset)
      throw new PlaylistImportError(
        'incomplete',
        'VK перестал отдавать новые треки до конца плейлиста. Попробуйте повторить загрузку.',
      );
    offset += rows.length;
  }
  throw new PlaylistImportError('incomplete', 'Не удалось загрузить весь плейлист VK.');
}

export async function readExternalPlaylist(
  input: string,
  request: PlaylistTransport,
): Promise<PlaylistReadResult> {
  try {
    const link = parsePlaylistLink(input);
    return {
      success: true,
      data: await (link.source === 'yandex'
        ? readYandex(link, request)
        : readVkPlaylist(link, request)),
    };
  } catch (error) {
    return error instanceof PlaylistImportError
      ? { success: false, error: error.message, code: error.code }
      : {
          success: false,
          error: 'Не удалось связаться с площадкой. Проверьте подключение и повторите загрузку.',
          code: 'network',
        };
  }
}
