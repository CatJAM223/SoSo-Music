import { isYouTubeStreamUrl } from './youtubeAccountStream.ts';

export const YOUTUBE_ACCOUNT_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15';
const MAX_WATCH_BYTES = 8 * 1024 * 1024;

/** Signed web URLs must keep the browser identity used to request their player response. */
export function youtubeAccountMediaUserAgent(url: string): string | undefined {
  return isYouTubeStreamUrl(url) &&
    (new URL(url).searchParams.get('c') === 'WEB' || /\/c\/WEB(?:\/|$)/.test(new URL(url).pathname))
    ? YOUTUBE_ACCOUNT_USER_AGENT
    : undefined;
}

/** Read only bounded HTML; never execute code taken from the watch page. */
export async function readYouTubeWatchPage(response: Response): Promise<string> {
  if (
    !response.ok ||
    !/^text\/html(?:;|$)/i.test(response.headers.get('content-type') || '') ||
    Number(response.headers.get('content-length')) > MAX_WATCH_BYTES
  ) {
    await response.body?.cancel().catch(() => {});
    throw new Error('YouTube watch page unavailable');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('YouTube watch page unavailable');
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_WATCH_BYTES) throw new Error('YouTube watch page too large');
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally {
    await reader.cancel().catch(() => {});
  }
}

export function parseYouTubeWatchPage(
  html: string,
  videoId: string,
): { response: Record<string, any>; playerId?: string } {
  if (Buffer.byteLength(html, 'utf8') > MAX_WATCH_BYTES)
    throw new Error('YouTube watch page too large');
  const marker = /(?:\bytInitialPlayerResponse|window\["ytInitialPlayerResponse"\])\s*=\s*(?=\{)/g;
  while (marker.exec(html)) {
    const start = marker.lastIndex;
    let depth = 0,
      quoted = false,
      escaped = false;
    for (let index = start; index < html.length; index++) {
      const char = html[index];
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') quoted = false;
      } else if (char === '"') quoted = true;
      else if (char === '{') depth++;
      else if (char === '}' && --depth === 0) {
        const response = JSON.parse(html.slice(start, index + 1));
        if (response.videoDetails?.videoId !== videoId)
          throw new Error('YouTube watch page returned another recording');
        const playerId = /\/s\/player\/([a-zA-Z0-9_-]{4,64})\//.exec(html)?.[1];
        return { response, playerId };
      }
    }
  }
  throw new Error('YouTube watch page has no player response');
}
