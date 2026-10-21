import { DEFAULT_COVER_SVG_DATA_URI } from './placeholder.ts';
import { trackArtworkCandidates } from './trackArtwork.ts';

/**
 * Formats seconds into MM:SS or H:MM:SS format (e.g. 185 -> '3:05', 3665 -> '1:01:05')
 */
export function formatTime(seconds: number): string {
  if (!seconds || isNaN(seconds) || seconds < 0) return '0:00';
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}:${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`;
  }
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

/**
 * Formats total seconds into Russian readable duration (e.g. '1 ч 25 мин' or '35 мин 12 сек')
 */
export function formatTotalDuration(totalSecs: number): string {
  if (!totalSecs || totalSecs <= 0) return '';
  const hours = Math.floor(totalSecs / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = Math.floor(totalSecs % 60);

  if (hours > 0) {
    return `${hours} ч ${mins} мин`;
  }
  return `${mins} мин ${secs} сек`;
}

/**
 * Safely extracts cover image URL with reliable fallback
 */
export function getCoverUrl(cover?: string, fallback = DEFAULT_COVER_SVG_DATA_URI): string {
  if (cover && cover.trim() && cover.startsWith('http') && !cover.includes('unsplash.com')) {
    return cover;
  }
  return fallback;
}

/**
 * Safely extracts cover image URL with comprehensive fallback chain
 * (cover_medium, cover_big, cover, cover_xl, cover_small, artist picture, cover_url, cover)
 * Normalizes SoundCloud -large. to -t500x500. and rejects Unsplash placeholders.
 */
export function resolveTrackCover(
  track?: any,
  fallback: string = DEFAULT_COVER_SVG_DATA_URI,
  size: 'default' | 'thumbnail' = 'default',
): string {
  return trackArtworkCandidates(track, size)[0] || fallback;
}

/**
 * Accurately detects whether a track is from YouTube Music or SoundCloud based on multiple attributes:
 * explicit source, yt_/sc_ ID prefix, preview/stream URL, or artwork domain.
 */
export function detectTrackSource(trackOrItem: any): 'youtube' | 'soundcloud' | 'deezer' {
  if (!trackOrItem) return 'soundcloud';

  // Database rows can have their own numeric row ID as well as the provider's track ID.
  // Prefer that stable identity, including when an older import saved the wrong source.
  const idStr = String(
    trackOrItem.track_deezer_id || trackOrItem.deezer_id || trackOrItem.id || '',
  );
  if (idStr.startsWith('yt_')) return 'youtube';
  if (idStr.startsWith('sc_')) return 'soundcloud';

  if (trackOrItem.source === 'youtube') return 'youtube';
  if (trackOrItem.source === 'soundcloud') return 'soundcloud';
  if (trackOrItem.source === 'deezer') return 'deezer';

  // 3. Preview URL / Stream URL domain
  const preview = String(
    trackOrItem.preview_url ||
      trackOrItem.preview ||
      trackOrItem.stream_url ||
      trackOrItem.resolvedStreamUrl ||
      '',
  );
  if (
    preview.includes('youtube.com') ||
    preview.includes('youtu.be') ||
    preview.includes('googlevideo.com')
  )
    return 'youtube';
  if (preview.includes('soundcloud.com') || preview.includes('sndcdn.com')) return 'soundcloud';
  if (preview.includes('dzcdn.net') || preview.includes('deezer.com')) return 'deezer';

  // 4. Cover URL domain
  const cover = String(
    trackOrItem.cover_url ||
      trackOrItem.cover ||
      trackOrItem.album?.cover ||
      trackOrItem.album?.cover_medium ||
      trackOrItem.album?.cover_big ||
      trackOrItem.album?.cover_xl ||
      (typeof trackOrItem.artist === 'object'
        ? trackOrItem.artist?.picture || trackOrItem.artist?.picture_medium
        : '') ||
      '',
  );
  if (
    cover.includes('ytimg.com') ||
    cover.includes('ggpht.com') ||
    cover.includes('googleusercontent.com')
  )
    return 'youtube';
  if (cover.includes('sndcdn.com')) return 'soundcloud';
  if (cover.includes('dzcdn.net') || cover.includes('deezer.com')) return 'deezer';

  return 'soundcloud';
}

/**
 * Decodes standard and numerical HTML entities in titles and text
 */
export function decodeHtmlEntities(str: string): string {
  if (!str || typeof str !== 'string' || !str.includes('&')) return str || '';
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;|&#039;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      try {
        return String.fromCharCode(parseInt(hex, 16));
      } catch {
        return _;
      }
    })
    .replace(/&#([0-9]+);/g, (_, dec) => {
      try {
        return String.fromCharCode(parseInt(dec, 10));
      } catch {
        return _;
      }
    });
}

/**
 * Detects whether a string is corrupted with Windows-1251 or UTF-8 decoded as Latin-1 (ISO-8859-1).
 */
export function isMojibake(str: string | null | undefined): boolean {
  if (!str || typeof str !== 'string') return false;
  // If string already contains Cyrillic letters, don't touch it unless it has obvious UTF-8 Latin-1 fragments
  if (/[а-яА-ЯёЁ]/.test(str)) {
    return /[\u00D0\u00D1][\u0080-\u00BF]/.test(str);
  }

  const highLatinMatches = str.match(/[\u00C0-\u00FF]/g);
  if (!highLatinMatches || highLatinMatches.length < 2) return false;

  const asciiLetters = str.match(/[a-zA-Z]/g) || [];
  const highRatio = highLatinMatches.length / (highLatinMatches.length + asciiLetters.length);
  return highRatio > 0.5;
}

/**
 * Detects and repairs Windows-1251 / UTF-8 text incorrectly decoded as ISO-8859-1,
 * and decodes HTML entities (e.g. &#39;, &amp;).
 */
export function fixMojibake(str: string | null | undefined): string {
  if (!str || typeof str !== 'string') return '';
  let cleaned = decodeHtmlEntities(str.trim()).replace(/\uFFFD/g, '');

  if (!isMojibake(cleaned)) return cleaned;

  try {
    const bytes = new Uint8Array(cleaned.length);
    for (let i = 0; i < cleaned.length; i++) {
      bytes[i] = cleaned.charCodeAt(i) & 0xff;
    }

    // Try UTF-8 decode first (common for double-encoded modern API strings)
    try {
      const utf8Decoded = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
      if (/[а-яА-ЯёЁ]{2,}/.test(utf8Decoded)) {
        return decodeHtmlEntities(utf8Decoded);
      }
    } catch {}

    // Try Windows-1251 decode
    const cp1251Decoded = new TextDecoder('windows-1251').decode(bytes);
    if (/[а-яА-ЯёЁ]{2,}/.test(cp1251Decoded)) {
      return decodeHtmlEntities(cp1251Decoded);
    }
  } catch (e) {}

  return cleaned;
}

/**
 * Normalizes a local or remote media path into a media://local/... or http(s) URL
 */
export function toMediaFileUrl(p: string): string {
  if (p.startsWith('http:') || p.startsWith('https:')) return p;
  if (p.startsWith('media://local/')) return p;
  let clean = p;
  if (clean.startsWith('file:///')) {
    clean = clean.replace(/^file:\/\/\//, '');
  } else if (clean.startsWith('file://')) {
    clean = clean.replace(/^file:\/\//, '');
  } else if (clean.startsWith('media:///')) {
    clean = clean.replace(/^media:\/\/\//, '');
  } else if (clean.startsWith('media://')) {
    clean = clean.replace(/^media:\/\//, '');
  }
  const normalized = clean.replace(/\\/g, '/').replace(/^\/+/, '');
  const url = `media://local/${normalized}`;
  return encodeURI(url).replace(/#/g, '%23');
}

/**
 * Formats record type (album, single, ep, compilation, podcast) into localized string
 */
export function formatRecordType(type?: string): string {
  if (!type) return 'Альбом';
  const lower = type.toLowerCase();
  if (lower === 'single') return 'Сингл';
  if (lower === 'ep') return 'EP';
  if (lower === 'compile' || lower === 'compilation') return 'Сборник';
  if (lower === 'podcast') return 'Подкаст';
  if (lower === 'album') return 'Альбом';
  return type.charAt(0).toUpperCase() + type.slice(1);
}
