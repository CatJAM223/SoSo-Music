import type { ChartRegion } from '../../../shared/utils/chartRegions.ts';
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

  static postCharts(region: ChartRegion): Promise<Response> {
    const query = new URLSearchParams({
      perspective: 'CHART_DETAILS',
      chart_params_country_code: region.toLowerCase(),
      chart_params_chart_type: 'TRACKS',
      chart_params_period_type: 'WEEKLY',
    }).toString();
    return this.fetch('https://charts.youtube.com/youtubei/v1/browse?alt=json', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-YouTube-Client-Name': '31',
        'X-YouTube-Client-Version': '2.0',
      },
      body: JSON.stringify({
        context: {
          client: { clientName: 'WEB_MUSIC_ANALYTICS', clientVersion: '2.0', hl: 'en', gl: 'US' },
        },
        browseId: 'FEmusic_analytics_charts_home',
        query,
      }),
      signal: AbortSignal.timeout(10000),
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
