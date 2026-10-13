import type { StreamResolveOptions } from '../../../shared/types/index.ts';
import { selectYouTubeAudioFormat } from '../../../shared/services/parsers/youtubeMusicParser.ts';
import { classifyYouTubeAudioAccessError } from '../../../shared/utils/youtubeAudioAccessError.ts';

export interface YouTubeAccountStream {
  url: string;
  duration?: number;
  gainDb?: number;
  audioIncludesVideo?: boolean;
  audioContainer?: 'hls' | 'progressive';
  audioItag?: number;
  /** Delivery was checked using the same network route as the player. */
  deliveryVerified?: boolean;
}

export function isYouTubeStreamUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      (url.hostname === 'googlevideo.com' || url.hostname.endsWith('.googlevideo.com'))
    );
  } catch {
    return false;
  }
}

/** Pick an original audio rendition, never a video stream or a translated dub. */
export function selectYouTubeHlsAudio(manifest: string, baseUrl: string): string {
  const lines = manifest.split(/\r?\n/).map((line) => line.trim());
  const audio: { url: string; itag: number; preferred: boolean; bandwidth: number }[] = [];
  const add = (uri: string, attributes: string) => {
    let url: string;
    try {
      url = new URL(uri, baseUrl).href;
    } catch {
      return;
    }
    if (!isYouTubeStreamUrl(url)) return;
    const itag = Number(/\/itag\/(\d+)/.exec(url)?.[1] || new URL(url).searchParams.get('itag'));
    audio.push({
      url,
      itag,
      preferred: /(?:^|,)DEFAULT=YES(?:,|$)/.test(attributes),
      bandwidth: Number(/(?:^|,)BANDWIDTH=(\d+)/.exec(attributes)?.[1]) || 0,
    });
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('#EXT-X-MEDIA:') && /(?:^|,)TYPE=AUDIO(?:,|$)/.test(line.slice(13))) {
      const uri = /\bURI="([^"]+)"/.exec(line)?.[1];
      if (uri) add(uri, line.slice(13));
    }
    if (line.startsWith('#EXT-X-STREAM-INF:')) {
      const codecs = /\bCODECS="([^"]+)"/
        .exec(line)?.[1]
        ?.split(',')
        .map((codec) => codec.trim());
      if (
        !/\bRESOLUTION=/.test(line) &&
        codecs?.length &&
        codecs.every((codec) => /^(?:mp4a|opus|vorbis|mp3|ac-3|ec-3)(?:\.|$)/i.test(codec))
      ) {
        const uri = lines[i + 1];
        if (uri && !uri.startsWith('#')) add(uri, line.slice(18));
      }
    }
  }
  audio.sort(
    (a, b) =>
      Number(b.preferred) - Number(a.preferred) ||
      Number([140, 234].includes(b.itag)) - Number([140, 234].includes(a.itag)) ||
      b.bandwidth - a.bandwidth,
  );
  return audio[0]?.url || '';
}

/** Some signed Safari responses provide only combined HLS renditions. */
function selectCombinedHlsAudio(manifest: string, baseUrl: string): string {
  const lines = manifest.split(/\r?\n/).map((line) => line.trim());
  const candidates: { url: string; pixels: number; bandwidth: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith('#EXT-X-STREAM-INF:')) continue;
    const codecs = /\bCODECS="([^"]+)"/
      .exec(line)?.[1]
      ?.split(',')
      .map((codec) => codec.trim());
    const size = /\bRESOLUTION=(\d+)x(\d+)/.exec(line);
    if (
      !size ||
      !codecs?.some((codec) => /^(?:mp4a|opus|vorbis|mp3|ac-3|ec-3)(?:\.|$)/i.test(codec))
    )
      continue;
    const uri = lines[i + 1];
    if (!uri || uri.startsWith('#')) continue;
    try {
      const url = new URL(uri, baseUrl).href;
      if (isYouTubeStreamUrl(url))
        candidates.push({
          url,
          pixels: Number(size[1]) * Number(size[2]),
          bandwidth: Number(/\bBANDWIDTH=(\d+)/.exec(line)?.[1]) || 0,
        });
    } catch {}
  }
  candidates.sort((a, b) => a.pixels - b.pixels || a.bandwidth - b.bandwidth);
  return candidates[0]?.url || '';
}

type WebFormat = {
  itag: number;
  bitrate: number;
  mime_type: string;
  has_audio: boolean;
  has_video: boolean;
  url?: string;
  signature_cipher?: string;
  cipher?: string;
  height?: number;
  drm_families?: string[];
  audio_track?: { audio_is_default?: boolean };
  is_original?: boolean;
  is_dubbed?: boolean;
  is_auto_dubbed?: boolean;
  is_descriptive?: boolean;
  is_secondary?: boolean;
  decipher: (player?: any) => Promise<string>;
};

function isOriginalAudio(format: WebFormat): boolean {
  return (
    !format.is_dubbed &&
    !format.is_auto_dubbed &&
    !format.is_descriptive &&
    !format.is_secondary &&
    (!format.audio_track || format.audio_track.audio_is_default !== false || !!format.is_original)
  );
}

/** The audio codec is reliable even when YouTube omits the audioQuality flag. */
function containsAudio(format: WebFormat): boolean {
  if (format.has_audio || format.mime_type?.startsWith('audio/')) return true;
  const codecs = /codecs="([^"]+)"/i
    .exec(format.mime_type || '')?.[1]
    ?.split(',')
    .map((codec) => codec.trim());
  return !!codecs?.some((codec) => /^(?:mp4a|opus|vorbis|mp3|ac-3|ec-3)(?:\.|$)/i.test(codec));
}

/** SABR responses may describe formats without exposing a directly playable URL. */
function hasStreamAddress(format: WebFormat): boolean {
  return !!(format.url || format.signature_cipher || format.cipher);
}

type WebInfo = {
  basic_info: { id?: string; duration?: number };
  playability_status?: { status?: string; reason?: string };
  player_config?: { audio_config?: { loudness_db?: number } };
  streaming_data?: {
    adaptive_formats?: WebFormat[];
    formats?: WebFormat[];
    hls_manifest_url?: string;
  };
};

/** Prefer Safari HLS; web direct formats may require a separate GVS attestation token. */
export async function extractYouTubeAccountStream(
  videoId: string,
  info: WebInfo,
  player: { decipher: (url: string) => Promise<string> } | undefined,
  fetchManifest: (url: string) => Promise<string>,
  options: StreamResolveOptions = {},
): Promise<YouTubeAccountStream> {
  if (info.basic_info.id && info.basic_info.id !== videoId)
    throw new Error('YouTube returned another recording');
  const access = classifyYouTubeAudioAccessError(info.playability_status);
  if (access) throw new Error(access);
  if (info.playability_status?.status !== 'OK')
    throw new Error('YouTube не разрешил воспроизведение этого трека.');
  // Keep Format instances intact: decipher uses prototype methods and private signature state.
  const described = [
    ...(info.streaming_data?.adaptive_formats || []),
    ...(info.streaming_data?.formats || []),
  ];
  const usable = described.filter(
    (format) => hasStreamAddress(format) && !format.drm_families?.length && isOriginalAudio(format),
  );
  const formats = usable.filter(
    (format) => format.mime_type?.startsWith('audio/') && !format.has_video,
  );

  const chosen = selectYouTubeAudioFormat(formats, options);
  const loudness = info.player_config?.audio_config?.loudness_db;
  const metadata = {
    duration: info.basic_info.duration,
    ...(typeof loudness === 'number' && Number.isFinite(loudness)
      ? { gainDb: Math.max(-24, Math.min(18, -loudness)) }
      : {}),
  };
  const manifestUrl = info.streaming_data?.hls_manifest_url;
  let combinedHls = '';
  if (manifestUrl && isYouTubeStreamUrl(manifestUrl)) {
    const decoded = player ? await player.decipher(manifestUrl) : manifestUrl;
    if (!isYouTubeStreamUrl(decoded)) throw new Error('Некорректный адрес аудио YouTube.');
    const manifest = await fetchManifest(decoded);
    const url = selectYouTubeHlsAudio(manifest, decoded);
    if (url) return { url, ...metadata, audioContainer: 'hls' };
    combinedHls = selectCombinedHlsAudio(manifest, decoded);
  }
  if (chosen) {
    const url = await chosen.decipher(player);
    if (isYouTubeStreamUrl(url))
      return { url, ...metadata, audioContainer: 'progressive', audioItag: chosen.itag };
  }
  if (combinedHls)
    return { url: combinedHls, ...metadata, audioIncludesVideo: true, audioContainer: 'hls' };
  // Some account responses expose only a progressive video+audio rendition (usually itag 18).
  // Prefer small video frames to keep transfer and decoding costs bounded by available formats.
  const combined = usable.filter(
    (format) =>
      /^video\/(?:mp4|webm)(?:;|$)/i.test(format.mime_type || '') && containsAudio(format),
  );
  combined.sort((a, b) => (a.height || 360) - (b.height || 360) || a.bitrate - b.bitrate);
  const rejectedCombinedItag = options.excludeItag ?? combined[0]?.itag;
  for (const format of combined) {
    if (options.preferAlternateFormat && format.itag === rejectedCombinedItag) continue;
    const url = await format.decipher(player);
    if (isYouTubeStreamUrl(url))
      return {
        url,
        ...metadata,
        audioIncludesVideo: true,
        audioContainer: 'progressive',
        audioItag: format.itag,
      };
  }
  throw new Error('YouTube не выдал поддерживаемый аудиопоток для подключённой сессии.');
}

/** Select a video rendition for the small clip panel; audio keeps playing separately. */
export function selectYouTubeHlsVideo(manifest: string, baseUrl: string): string {
  const lines = manifest.split(/\r?\n/).map((line) => line.trim());
  const candidates: { url: string; height: number; bandwidth: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith('#EXT-X-STREAM-INF:')) continue;
    const resolution = /\bRESOLUTION=\d+x(\d+)/.exec(line);
    if (!resolution || !lines[i + 1] || lines[i + 1].startsWith('#')) continue;
    try {
      const url = new URL(lines[i + 1], baseUrl).href;
      if (isYouTubeStreamUrl(url))
        candidates.push({
          url,
          height: Number(resolution[1]),
          bandwidth: Number(/\bBANDWIDTH=(\d+)/.exec(line)?.[1]) || 0,
        });
    } catch {}
  }
  candidates.sort(
    (a, b) => Math.abs(a.height - 720) - Math.abs(b.height - 720) || a.bandwidth - b.bandwidth,
  );
  return candidates[0]?.url || '';
}

export async function extractYouTubeAccountVideo(
  videoId: string,
  info: WebInfo,
  player: { decipher: (url: string) => Promise<string> } | undefined,
  fetchManifest: (url: string) => Promise<string>,
): Promise<YouTubeAccountStream> {
  if (info.basic_info.id && info.basic_info.id !== videoId)
    throw new Error('YouTube returned another recording');
  const access = classifyYouTubeAudioAccessError(info.playability_status);
  if (access) throw new Error(access);
  if (info.playability_status?.status !== 'OK')
    throw new Error('YouTube не разрешил воспроизведение клипа.');
  const metadata = { duration: info.basic_info.duration };
  const manifestUrl = info.streaming_data?.hls_manifest_url;
  if (manifestUrl && isYouTubeStreamUrl(manifestUrl)) {
    const decoded = player ? await player.decipher(manifestUrl) : manifestUrl;
    if (!isYouTubeStreamUrl(decoded)) throw new Error('Некорректный адрес видео YouTube.');
    const url = selectYouTubeHlsVideo(await fetchManifest(decoded), decoded);
    if (url) return { url, ...metadata };
  }
  const formats = [
    ...(info.streaming_data?.formats || []),
    ...(info.streaming_data?.adaptive_formats || []),
  ].filter(
    (format) =>
      hasStreamAddress(format) &&
      format.has_video &&
      format.mime_type.startsWith('video/mp4') &&
      !format.drm_families?.length,
  );
  formats.sort(
    (a, b) =>
      Math.abs((a.height || 360) - 720) - Math.abs((b.height || 360) - 720) ||
      a.bitrate - b.bitrate,
  );
  for (const format of formats) {
    const url = await format.decipher(player);
    if (isYouTubeStreamUrl(url)) return { url, ...metadata };
  }
  throw new Error('YouTube не выдал поддерживаемый видеопоток для подключённой сессии.');
}
