import type { Track } from '../types/index.ts';

export const SOSO_LISTEN_SCHEME = 'sosomusic';
export type ListenTrackData = {
  trackId?: string | number;
  source?: string;
  title: string;
  artist: string;
  duration?: number;
  coverUrl?: string;
};
export const LOCAL_LISTEN_PORT = 47836;
export const LOCAL_LISTEN_ORIGIN = 'http://127.0.0.1:' + LOCAL_LISTEN_PORT;

/** Restrict shared artwork to provider image CDNs; never load arbitrary URLs from a link. */
function listenCover(input: string | null | undefined, source: string): string {
  if (!input || input.length > 1024) return '';
  try {
    const url = new URL(input);
    const host = url.hostname.toLowerCase();
    const allowed =
      source === 'youtube'
        ? host === 'i.ytimg.com' ||
          host === 'img.youtube.com' ||
          /^(?:lh[0-9]+|yt3|yt4)\.googleusercontent\.com$/.test(host) ||
          host === 'yt3.ggpht.com'
        : host === 'i1.sndcdn.com' || host === 'i2.sndcdn.com';
    return allowed &&
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.hash
      ? url.href
      : '';
  } catch {
    return '';
  }
}

export function parseLocalListenTrack(url: URL): Track | null {
  if (url.pathname !== '/listen') return null;
  const id = url.searchParams.get('id') || '',
    source = url.searchParams.get('source');
  if (source !== 'youtube' && source !== 'soundcloud') return null;
  if (
    source === 'youtube'
      ? !/^yt_[\w-]{11}$/.test(id)
      : source === 'soundcloud'
        ? !/^(?:sc_)?\d{1,20}$/.test(id)
        : true
  )
    return null;
  const duration = Number(url.searchParams.get('duration'));
  const cover =
    listenCover(url.searchParams.get('cover'), source) ||
    (source === 'youtube' ? 'https://i.ytimg.com/vi/' + id.slice(3) + '/hqdefault.jpg' : '');
  let names: string[] | undefined;
  const encoded = url.searchParams.get('names');
  if (encoded && /^[a-zA-Z0-9_-]{1,1200}$/.test(encoded)) {
    try {
      const bytes = Uint8Array.from(atob(encoded.replace(/-/g, '+').replace(/_/g, '/')), (char) =>
        char.charCodeAt(0),
      );
      const parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      if (
        Array.isArray(parsed) &&
        parsed.length === 2 &&
        parsed.every((value) => typeof value === 'string')
      )
        names = parsed;
    } catch {}
  }
  return {
    id,
    source,
    title: (names?.[0] || url.searchParams.get('title') || 'Трек из Discord').slice(0, 120),
    artist: { name: (names?.[1] || url.searchParams.get('artist') || 'Исполнитель').slice(0, 100) },
    album: {
      title: '',
      cover,
      cover_small: cover,
      cover_medium: cover,
      cover_big: cover,
      cover_xl: cover,
    },
    cover_url: cover,
    preview: '',
    duration: Number.isFinite(duration) && duration > 0 && duration < 86400 ? duration : 180,
  };
}

/** Only provider identity is shared. Stream URLs, proxy details and file paths never leave the player. */
export function buildLocalListenUrl(
  data: ListenTrackData,
  origin = LOCAL_LISTEN_ORIGIN,
): string | null {
  try {
    const url = new URL('/listen', origin);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password)
      return null;
    url.searchParams.set('id', String(data.trackId || ''));
    url.searchParams.set('source', data.source || '');
    url.searchParams.set('duration', String(Math.round(data.duration || 180)));
    if (!parseLocalListenTrack(url)) return null;
    let title = data.title.slice(0, 120),
      artist = data.artist.slice(0, 100);
    const cover = listenCover(data.coverUrl, data.source || '');
    if (cover) url.searchParams.set('cover', cover);
    url.searchParams.set('title', title);
    url.searchParams.set('artist', artist);
    if (url.href.length <= 512) return url.href;
    // Compact UTF-8 names preserve Cyrillic titles and artwork within Discord's URL budget.
    url.searchParams.delete('title');
    url.searchParams.delete('artist');
    if (url.href.length > 480) url.searchParams.delete('cover');
    do {
      const bytes = new TextEncoder().encode(JSON.stringify([title, artist]));
      const encoded = btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
      url.searchParams.set('names', encoded);
      if (url.href.length <= 512) return url.href;
      if (title.length >= artist.length) title = title.slice(0, -1);
      else artist = artist.slice(0, -1);
    } while (title.length || artist.length);
    return url.href.length <= 512 ? url.href : null;
  } catch {
    return null;
  }
}

/** Provider identity only: never accept file paths, stream URLs, or executable arguments. */
export function parseSoSoListenTrack(input: string): Track | null {
  if (input.length > 4096) return null;
  try {
    const url = new URL(input);
    if (
      url.protocol !== SOSO_LISTEN_SCHEME + ':' ||
      url.hostname !== 'listen' ||
      (url.pathname !== '' && url.pathname !== '/') ||
      url.port ||
      url.username ||
      url.password ||
      url.hash
    )
      return null;
    return parseLocalListenTrack(
      new URL('/listen?' + url.searchParams.toString(), LOCAL_LISTEN_ORIGIN),
    );
  } catch {
    return null;
  }
}

export function buildSoSoListenUrl(data: ListenTrackData): string | null {
  const local = buildLocalListenUrl(data);
  if (!local) return null;
  const url = new URL(SOSO_LISTEN_SCHEME + '://listen');
  url.search = new URL(local).search;
  return url.href;
}

export function getSoSoListenTrackFromArgs(args: readonly string[]): Track | null {
  for (const arg of args) {
    if (!/^sosomusic:\/\//i.test(arg)) continue;
    const track = parseSoSoListenTrack(arg);
    if (track) return track;
  }
  return null;
}
