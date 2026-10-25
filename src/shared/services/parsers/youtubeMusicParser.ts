import type { Album, StreamResolveOptions, Track } from '../../types/index.ts';
import { isYouTubeStatisticText } from '../../utils/albumMetadata.ts';

interface YouTubeAudioFormat {
  itag?: number;
  url?: string;
  mimeType?: string;
  bitrate?: number;
  audioBitrate?: number;
}

export function selectYouTubeAudioFormat<T extends YouTubeAudioFormat>(
  formats: T[],
  options: StreamResolveOptions = {},
): T | null {
  const rank = (format: T, alternate: boolean) => {
    if (format.itag === (alternate ? 251 : 140)) return 0;
    if (format.itag === (alternate ? 140 : 251)) return 1;
    return 2;
  };
  const byPreference = (alternate: boolean) => (a: T, b: T) =>
    rank(a, alternate) - rank(b, alternate) ||
    (b.bitrate || b.audioBitrate || 0) - (a.bitrate || a.audioBitrate || 0);

  const primary = [...formats].sort(byPreference(false))[0];
  if (!options.preferAlternateFormat) return primary || null;

  const rejectedItag = options.excludeItag ?? primary?.itag;
  if (!rejectedItag) return null;
  const alternatives = formats.filter((format) => format.itag !== rejectedItag);
  return alternatives.sort(byPreference(true))[0] || null;
}

export function isValidYouTubeVideoId(videoId: unknown): videoId is string {
  return typeof videoId === 'string' && /^[a-zA-Z0-9_-]{11}$/.test(videoId);
}

export function parseDuration(durationStr: string): number {
  if (!durationStr) return 180;
  const clean = String(durationStr).trim();
  if (!clean) return 180;
  const parts = clean.split(':').map((p) => parseInt(p.trim(), 10));
  if (parts.some(isNaN)) return 180;

  if (parts.length === 1 && parts[0] > 0) {
    return parts[0];
  } else if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  } else if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  return 180;
}

export function cleanYTTitle(rawTitle: string): { artist: string; title: string } {
  let trackTitle = rawTitle;
  let artistName = 'Unknown Artist';

  if (trackTitle.includes(' - ')) {
    const parts = trackTitle.split(' - ');
    if (parts.length >= 2) {
      artistName = parts[0].trim();
      trackTitle = parts.slice(1).join(' - ').trim();
    }
  }

  const clean = trackTitle
    .replace(
      /\((Official (Music )?Video|Official Audio|Lyric Video|Audio|Visualizer|Clip Officiel)\)/gi,
      '',
    )
    .replace(
      /\[(Official (Music )?Video|Official Audio|Lyric Video|Audio|Visualizer|Clip Officiel)\]/gi,
      '',
    )
    .replace(/\(Lyrics\)/gi, '')
    .replace(/\[Lyrics\]/gi, '')
    .trim();

  return { artist: artistName, title: clean || trackTitle };
}

export function isDurationClose(
  targetDuration: number,
  candidateDuration: number,
  toleranceSec = 15,
): boolean {
  if (targetDuration > 60 && candidateDuration > 0) {
    const diff = Math.abs(candidateDuration - targetDuration);
    return diff <= toleranceSec;
  }
  return true;
}

export function extractAlbumFromFlexColumns(flexColumns: any[]): {
  albumTitle: string;
  albumBrowseId?: string;
} {
  let albumTitle = 'Single';
  let albumBrowseId: string | undefined;

  if (!Array.isArray(flexColumns)) return { albumTitle };

  // 1. Look for explicit album browseId
  for (let i = 1; i < flexColumns.length; i++) {
    const runs = flexColumns[i]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];
    for (const run of runs) {
      const bId = run.navigationEndpoint?.browseEndpoint?.browseId;
      if (
        bId &&
        (bId.startsWith('MPREb_') ||
          bId.startsWith('FEmusic_library_privately_owned_release_detail'))
      ) {
        albumTitle = run.text;
        albumBrowseId = bId;
        break;
      }
    }
    if (albumTitle !== 'Single') break;
  }

  // A video byline has artist + views, with no album. Skip the artist group,
  // counters, durations and labels before considering an unlinked release.
  for (let index = 1; albumTitle === 'Single' && index < flexColumns.length; index++) {
    const runs: any[] =
      flexColumns[index]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];
    let artistSeen = false;
    let afterArtist = index > 1;
    for (const p of runs) {
      const t = String(p.text || '').trim();
      const bId = p.navigationEndpoint?.browseEndpoint?.browseId;
      if (t === '•' || t === '·') {
        if (artistSeen) afterArtist = true;
        continue;
      }
      if (bId?.startsWith('UC')) {
        artistSeen = true;
        continue;
      }
      if (isYouTubeStatisticText(t)) continue;
      if (/^\d+:\d+(:\d+)?$/.test(t)) continue; // Duration
      if (/^(song|песня|video|видео|album|альбом|single|сингл|ep|•|·)$/i.test(t)) continue;
      if (/^(19|20)\d{2}$/.test(t)) continue;
      if (!afterArtist) {
        artistSeen = true;
        continue;
      }
      if (t && t !== 'Single') {
        albumTitle = t;
        break;
      }
    }
  }

  return { albumTitle, albumBrowseId };
}

export function parseAlbumSearchResults(response: any, limit = 5): Album[] {
  const sections =
    response?.contents?.tabbedSearchResultsRenderer?.tabs?.[0]?.tabRenderer?.content
      ?.sectionListRenderer?.contents || [];
  const albums: Album[] = [];
  const seenIds = new Set<string>();

  for (const section of sections) {
    const items =
      section.musicShelfRenderer?.contents || section.itemSectionRenderer?.contents || [];
    for (const item of items) {
      const renderer = item.musicTwoRowItemRenderer || item.musicResponsiveListItemRenderer;
      if (!renderer) continue;
      const titleRuns =
        renderer.title?.runs ||
        renderer.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs ||
        [];
      const title = titleRuns
        .map((run: any) => run.text || '')
        .join('')
        .trim();
      const browseId =
        renderer.navigationEndpoint?.browseEndpoint?.browseId ||
        titleRuns.find((run: any) => run.navigationEndpoint?.browseEndpoint?.browseId)
          ?.navigationEndpoint?.browseId ||
        renderer.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]
          ?.navigationEndpoint?.browseEndpoint?.browseId;
      if (
        !title ||
        !browseId ||
        (!String(browseId).startsWith('MPREb_') && !String(browseId).startsWith('OLAK5uy_'))
      )
        continue;
      if (seenIds.has(String(browseId))) continue;
      seenIds.add(String(browseId));

      const subtitleRuns =
        renderer.subtitle?.runs ||
        renderer.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs ||
        [];
      const artistRun = subtitleRuns.find((run: any) => {
        const id = run.navigationEndpoint?.browseEndpoint?.browseId || '';
        return String(id).startsWith('UC') || String(id).startsWith('MPLA');
      });
      const artistName =
        artistRun?.text ||
        subtitleRuns
          .map((run: any) => String(run.text || '').trim())
          .filter(
            (text: string) =>
              text &&
              !/^(album|single|ep|сингл|альбом|мини-альбом|•|·)$/i.test(text) &&
              !/^(19|20)\d{2}$/.test(text),
          )
          .slice(0, 1)[0] ||
        '';
      const thumbnails =
        renderer.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails ||
        renderer.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails ||
        [];
      const rawCover = thumbnails.slice(-1)[0]?.url || '';
      const cover = rawCover ? rawCover.replace(/=w\d+-h\d+[^?&]*/, '=w544-h544-l90-rj') : '';

      albums.push({
        id: `yt_alb_${browseId}`,
        title,
        cover,
        cover_medium: cover,
        cover_big: cover,
        cover_xl: cover,
        artist_name: artistName,
        artist: { name: artistName },
        source: 'youtube',
      });
      if (albums.length >= limit) return albums;
    }
  }

  return albums;
}

export function extractArtistsFromRuns(runs: any[]): {
  artistName: string;
  artistBrowseId?: string;
} {
  if (!Array.isArray(runs) || runs.length === 0) {
    return { artistName: 'Unknown Artist' };
  }

  // 1. Identify start index: skip leading "Song • " / "Песня • " / "Video • " / "Видео • " if present
  let startIdx = 0;
  if (
    runs.length >= 3 &&
    ['song', 'песня', 'video', 'видео'].includes(
      String(runs[0]?.text || '')
        .trim()
        .toLowerCase(),
    ) &&
    ['•', '·'].includes(String(runs[1]?.text || '').trim())
  ) {
    startIdx = 2;
  }

  // 2. Identify end index: stops before bullet separator '•', or album browseId (MPREb_), or duration, or view count
  let endIdx = runs.length;
  for (let i = startIdx; i < runs.length; i++) {
    const r = runs[i];
    const txt = String(r?.text || '').trim();
    const bId = r?.navigationEndpoint?.browseEndpoint?.browseId;

    if (txt === '•' || txt === '·') {
      endIdx = i;
      break;
    }
    if (
      bId &&
      (bId.startsWith('MPREb_') || bId.startsWith('FEmusic_library_privately_owned_release_detail'))
    ) {
      endIdx = i;
      break;
    }
    if (/^\d+:\d+(:\d+)?$/.test(txt)) {
      endIdx = i;
      break;
    }
    if (/^\d+[\s,.\d]*\s*(прослуш|просмотр|views|plays|млн|тыс)/i.test(txt)) {
      endIdx = i;
      break;
    }
  }

  const artistRuns = runs.slice(startIdx, endIdx);

  // Find first artist browseId (UC...)
  let artistBrowseId: string | undefined;
  for (const r of artistRuns) {
    const bId = r?.navigationEndpoint?.browseEndpoint?.browseId;
    if (bId && bId.startsWith('UC')) {
      artistBrowseId = bId;
      break;
    }
  }

  // If no browseId in artistRuns, check all runs before first duration
  if (!artistBrowseId) {
    for (const r of runs) {
      const bId = r?.navigationEndpoint?.browseEndpoint?.browseId;
      if (bId && bId.startsWith('UC')) {
        artistBrowseId = bId;
        break;
      }
    }
  }

  // Build combined artist string (preserves multiple artists, feats, separators)
  let artistName = artistRuns
    .map((r: any) => r?.text || '')
    .join('')
    .trim();

  // Clean trailing/leading punctuation or separators
  artistName = artistName.replace(/^[,&/\s•·]+|[,&/\s•·]+$/g, '').trim();

  // Fallback if empty
  if (!artistName) {
    for (const r of runs) {
      const bId = r?.navigationEndpoint?.browseEndpoint?.browseId;
      if (bId && bId.startsWith('UC')) {
        artistName = String(r.text || '').trim();
        artistBrowseId = bId;
        break;
      }
    }
  }

  if (!artistName && runs.length > 0) {
    artistName = String(runs[0]?.text || '').trim();
  }

  if (!artistName) {
    artistName = 'Unknown Artist';
  }

  return { artistName, artistBrowseId };
}

export function parseInnerTubeShelfItem(
  r: any,
  seenIds?: Set<string>,
  options: { requireDuration?: boolean } = {},
): Track | null {
  if (!r) return null;
  const renderer = r.musicResponsiveListItemRenderer || r;

  const flex0 =
    renderer.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];
  const flex1 =
    renderer.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];

  const title = flex0
    .map((x: any) => x.text)
    .join('')
    .trim();
  const videoId =
    renderer.playlistItemData?.videoId ||
    renderer.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer
      ?.playNavigationEndpoint?.watchEndpoint?.videoId ||
    flex0[0]?.navigationEndpoint?.watchEndpoint?.videoId;

  if (!title || !isValidYouTubeVideoId(videoId)) return null;
  if (seenIds) {
    if (seenIds.has(videoId)) return null;
    seenIds.add(videoId);
  }

  const { artistName, artistBrowseId } = extractArtistsFromRuns(flex1);

  const { albumTitle, albumBrowseId } = extractAlbumFromFlexColumns(renderer.flexColumns);

  let durationSec: number | undefined;

  // 1. Check fixedColumns (runs & simpleText)
  if (Array.isArray(renderer.fixedColumns)) {
    for (const fc of renderer.fixedColumns) {
      const colRenderer = fc?.musicResponsiveListItemFixedColumnRenderer;
      const text = colRenderer?.text?.runs?.[0]?.text || colRenderer?.text?.simpleText;
      const clean = String(text || '').trim();
      if (/^\d+:\d+(:\d+)?$/.test(clean)) {
        durationSec = parseDuration(clean);
        break;
      }
    }
  }

  // 2. Fallback: check all flexColumns from last to first
  if (durationSec === undefined && Array.isArray(renderer.flexColumns)) {
    for (let colIdx = renderer.flexColumns.length - 1; colIdx >= 1; colIdx--) {
      const runs =
        renderer.flexColumns[colIdx]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];
      for (let i = runs.length - 1; i >= 0; i--) {
        const run = runs[i];
        const t = String(run?.text || '').trim();
        if (/^\d+:\d+(:\d+)?$/.test(t)) {
          durationSec = parseDuration(t);
          break;
        }
      }
      if (durationSec !== undefined) break;
    }
  }

  if (options.requireDuration && durationSec === undefined) return null;

  const thumbs =
    renderer.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails ||
    renderer.thumbnail?.thumbnails ||
    [];
  const rawThumb = thumbs.slice(-1)[0]?.url || '';
  // Use smaller thumbnail for list views (faster loading), larger for player
  const smCover = rawThumb
    ? rawThumb.replace(/=w\d+-h\d+[^?&]*/, '=w226-h226-l90-rj')
    : `https://i.ytimg.com/vi/${videoId}/default.jpg`;
  const hdCover = rawThumb
    ? rawThumb.replace(/=w\d+-h\d+[^?&]*/, '=w544-h544-l90-rj')
    : `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

  return {
    id: `yt_${videoId}`,
    title,
    title_short: title,
    duration: durationSec ?? 180,
    preview: `https://www.youtube.com/watch?v=${videoId}`,
    artist: {
      id: `yt_art_${artistBrowseId || artistName.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '_')}`,
      name: artistName,
      picture_medium: smCover,
      source: 'youtube',
    },
    album: {
      id: `yt_alb_${albumBrowseId || videoId}`,
      title: albumTitle,
      cover: smCover,
      cover_small: smCover,
      cover_medium: smCover,
      cover_big: hdCover,
      cover_xl: hdCover,
    },
    cover_url: smCover,
    resolvedStreamUrl: '',
    source: 'youtube',
  };
}

export function parsePlaylistPanelItem(
  r: any,
  options: { requireDuration?: boolean } = {},
): Track | null {
  if (!r) return null;
  const renderer = r.playlistPanelVideoRenderer || r;
  const videoId = renderer.videoId || renderer.navigationEndpoint?.watchEndpoint?.videoId;
  const title = (renderer.title?.runs || [])
    .map((x: any) => x.text)
    .join('')
    .trim();
  if (!isValidYouTubeVideoId(videoId) || !title) return null;

  const bylineRuns = renderer.longBylineText?.runs || renderer.shortBylineText?.runs || [];
  const { artistName, artistBrowseId } = extractArtistsFromRuns(bylineRuns);

  const lengthText = renderer.lengthText?.runs?.[0]?.text || renderer.lengthText?.simpleText || '';
  if (options.requireDuration && !/^\d+:\d+(:\d+)?$/.test(String(lengthText).trim())) return null;
  const duration = lengthText ? parseDuration(lengthText) : 180;

  const thumbs = renderer.thumbnail?.thumbnails || [];
  const rawThumb = thumbs.slice(-1)[0]?.url || '';
  const smCover = rawThumb
    ? rawThumb.replace(/=w\d+-h\d+[^?&]*/, '=w226-h226-l90-rj')
    : `https://i.ytimg.com/vi/${videoId}/default.jpg`;
  const hdCover = rawThumb
    ? rawThumb.replace(/=w\d+-h\d+[^?&]*/, '=w544-h544-l90-rj')
    : `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

  return {
    id: `yt_${videoId}`,
    title,
    title_short: title,
    duration,
    preview: `https://www.youtube.com/watch?v=${videoId}`,
    artist: {
      id: `yt_art_${artistBrowseId || artistName.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '_')}`,
      name: artistName,
      picture_medium: smCover,
      source: 'youtube',
    },
    album: {
      id: `yt_alb_${videoId}`,
      title: 'Single',
      cover: smCover,
      cover_small: smCover,
      cover_medium: smCover,
      cover_big: hdCover,
      cover_xl: hdCover,
    },
    cover_url: smCover,
    resolvedStreamUrl: '',
    source: 'youtube',
  };
}

/** The provider's song-radio queue is a candidate pool, not our final playback order. */
export function parseYouTubeRadioResponse(response: any, limit = 25): Track[] {
  if (!Number.isFinite(limit) || limit <= 0) return [];
  const tabs =
    response?.contents?.singleColumnMusicWatchNextResultsRenderer?.tabbedRenderer
      ?.watchNextTabbedResultsRenderer?.tabs || [];
  const contents =
    tabs[0]?.tabRenderer?.content?.musicQueueRenderer?.content?.playlistPanelRenderer?.contents ||
    [];
  const seen = new Set<string>();
  const tracks: Track[] = [];
  for (const item of contents) {
    const renderer = item.playlistPanelVideoRenderer;
    if (!renderer || renderer.isPlayable === false) continue;
    const track = parsePlaylistPanelItem(renderer);
    if (!track || seen.has(String(track.id))) continue;
    seen.add(String(track.id));
    tracks.push(track);
    if (tracks.length >= limit) break;
  }
  return tracks;
}
