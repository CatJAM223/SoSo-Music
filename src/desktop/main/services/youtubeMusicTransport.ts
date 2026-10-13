import { requestSignal } from '../../../shared/utils/requestSignal.ts';
import { desktopFetch } from './desktopFetch.ts';

export class YouTubeMusicTransport {
  static fetch(url: string, init?: RequestInit): Promise<Response> {
    return desktopFetch(url, init);
  }

  static postPlayer(
    payload: unknown,
    headers: Record<string, string>,
    timeoutMs = 8000,
  ): Promise<Response> {
    return this.fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    });
  }

  static postMusic(
    path: string,
    body: unknown,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<Response> {
    return this.fetch(`https://music.youtube.com${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'X-YouTube-Client-Name': '67',
        'X-YouTube-Client-Version': '1.20240401.01.00',
        Origin: 'https://music.youtube.com',
        Referer: 'https://music.youtube.com/',
      },
      body: JSON.stringify(body),
      signal: requestSignal(signal, timeoutMs),
    });
  }
}
