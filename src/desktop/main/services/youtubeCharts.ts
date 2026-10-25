import type { Track } from '../../../shared/types/index.ts';
import { isChartRegion, type ChartRegion } from '../../../shared/utils/chartRegions.ts';
import { BoundedMap } from '../../../shared/utils/boundedCache.ts';
import { cleanDiscoveryTracks } from '../../../shared/utils/discoveryTracks.ts';
import {
  isValidYouTubeVideoId,
  parsePlaylistPanelItem,
} from '../../../shared/services/parsers/youtubeMusicParser.ts';
import { YouTubeMusicTransport } from './youtubeMusicTransport.ts';

type ChartEntry = { videoId: string; alternateId?: string; rank: number };
type QueueLoader = (videoIds: string[]) => Promise<any>;
const chartCache = new BoundedMap<ChartRegion, { entries: ChartEntry[]; expiresAt: number }>(
  20,
  (value) => value.expiresAt,
);
const chartRequests = new Map<ChartRegion, Promise<ChartEntry[]>>();

async function loadRanking(region: ChartRegion): Promise<ChartEntry[]> {
  const cached = chartCache.get(region);
  if (cached) return cached.entries;
  const pending = chartRequests.get(region);
  if (pending) return pending;
  const request = (async () => {
    const response = await YouTubeMusicTransport.postCharts(region);
    if (!response.ok) throw new Error('YouTube Music chart is unavailable');
    const data = await response.json();
    const sections = data?.contents?.sectionListRenderer?.contents || [];
    const country = region.toLowerCase();
    const content = sections
      .map((section: any) => section?.musicAnalyticsSectionRenderer?.content)
      .find((item: any) => {
        const params = item?.perspectiveMetadata?.requestParams?.chartParams;
        return (
          params?.countryCode === country &&
          params?.chartType === 'CHART_TYPE_TRACKS' &&
          params?.chartPeriodType === 'CHART_PERIOD_TYPE_WEEKLY'
        );
      });
    const chart = content?.trackTypes?.find(
      (item: any) =>
        item.listType === 'TOP_VIEWS_CHART' && item.chartPeriodType === 'CHART_PERIOD_TYPE_WEEKLY',
    );
    if (!Array.isArray(chart?.trackViews)) throw new Error('YouTube Music chart is unavailable');
    const entries: ChartEntry[] = [];
    for (const row of chart.trackViews.slice(0, 100)) {
      if (row?.isVisible === false) continue;
      const videoId = isValidYouTubeVideoId(row.atvExternalVideoId)
        ? row.atvExternalVideoId
        : row.encryptedVideoId;
      const rank = Number(row.chartEntryMetadata?.currentPosition);
      if (!isValidYouTubeVideoId(videoId) || !Number.isInteger(rank) || rank < 1) continue;
      const alternateId =
        isValidYouTubeVideoId(row.encryptedVideoId) && row.encryptedVideoId !== videoId
          ? row.encryptedVideoId
          : undefined;
      entries.push({ videoId, alternateId, rank });
    }
    entries.sort((left, right) => left.rank - right.rank);
    if (entries.length) chartCache.set(region, { entries, expiresAt: Date.now() + 5 * 60 * 1000 });
    return entries;
  })();
  chartRequests.set(region, request);
  try {
    return await request;
  } finally {
    if (chartRequests.get(region) === request) chartRequests.delete(region);
  }
}

/** Official weekly song ranking plus batch metadata for the exact chart recording IDs. */
export async function loadYouTubeCharts(
  region: ChartRegion,
  limit: number,
  loadQueue: QueueLoader,
): Promise<{ data: Track[]; total: number }> {
  if (!isChartRegion(region)) throw new Error('Unknown chart region');
  const entries = await loadRanking(region);
  const recordings = new Map<string, Track>();
  const hydrate = async (ids: string[]) => {
    const unique = [...new Set(ids)];
    for (let offset = 0; offset < unique.length; offset += 50) {
      const batch = unique.slice(offset, offset + 50);
      const response = await loadQueue(batch);
      if (!Array.isArray(response?.queueDatas))
        throw new Error('YouTube Music chart metadata is unavailable');
      const expected = new Set(batch);
      for (const item of response.queueDatas) {
        const renderer = item?.content?.playlistPanelVideoRenderer;
        if (!renderer || renderer.isPlayable === false || !expected.has(renderer.videoId)) continue;
        const track = parsePlaylistPanelItem(renderer, { requireDuration: true });
        if (track) recordings.set(renderer.videoId, track);
      }
    }
  };
  await hydrate(entries.map((entry) => entry.videoId));
  const alternatives = entries.filter(
    (entry) => !recordings.has(entry.videoId) && entry.alternateId,
  );
  if (alternatives.length) await hydrate(alternatives.map((entry) => entry.alternateId!));
  const ranked: Track[] = [];
  for (const entry of entries) {
    const track =
      recordings.get(entry.videoId) ||
      (entry.alternateId ? recordings.get(entry.alternateId) : undefined);
    if (track) ranked.push({ ...track, chartRank: entry.rank });
  }
  return { data: cleanDiscoveryTracks(ranked, limit), total: entries.length };
}
