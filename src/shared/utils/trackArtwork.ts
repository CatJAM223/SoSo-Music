import { DEFAULT_COVER_SVG_DATA_URI } from './placeholder.ts';

const MAX_ARTWORK_CANDIDATES = 10;

function artworkUrl(value: unknown): string {
  if (typeof value !== 'string') return '';
  const url = value.trim().replace(/^\/\//, 'https://');
  if (/unsplash\.com/i.test(url)) return '';
  return /^(?:https?:\/\/|data:image\/|blob:|media:\/\/|file:\/\/|\/(?!\/))/.test(url) ? url : '';
}

/** Keep real recording artwork ahead of artist portraits and local placeholders. */
export function trackArtworkCandidates(
  track?: any,
  size: 'default' | 'thumbnail' = 'default',
): string[] {
  if (!track) return [];
  const album = track.album,
    artist = typeof track.artist === 'object' ? track.artist : undefined;
  const recording = [
    album?.cover_medium,
    album?.cover_big,
    album?.cover,
    album?.cover_xl,
    album?.cover_small,
    track.cover_url,
    track.cover,
    track.artwork_url,
  ]
    .map(artworkUrl)
    .filter(Boolean);
  const urls: string[] = [];
  for (const url of recording) {
    if (url.includes('sndcdn.com') && url.includes('-large.'))
      urls.push(url.replace('-large.', '-t500x500.'));
    urls.push(url);
  }
  const video = String(track.id || track.deezer_id || track.track_deezer_id || '').match(
    /^yt_([\w-]{11})$/,
  )?.[1];
  if (video)
    urls.push(
      `https://i.ytimg.com/vi/${video}/hqdefault.jpg`,
      `https://i.ytimg.com/vi/${video}/mqdefault.jpg`,
    );
  urls.push(
    ...[artist?.picture_medium, artist?.picture_big, artist?.picture_xl, artist?.picture]
      .map(artworkUrl)
      .filter(Boolean),
  );
  const sized =
    size === 'thumbnail'
      ? urls.map((url) => {
          try {
            const host = new URL(url).hostname;
            if (host.endsWith('.sndcdn.com'))
              return url.replace(/-(?:t\d+x\d+|large|crop|small|badge)\./, '-large.');
            if (host.endsWith('.googleusercontent.com'))
              return url.replace(/=w\d+-h\d+[^?&]*/, '=w120-h120-l90-rj');
            if (host === 'i.ytimg.com')
              return url.replace(/\/(?:hqdefault|mqdefault|maxresdefault)\.jpg/, '/default.jpg');
          } catch {
            /* Local artwork and placeholders keep their original URL. */
          }
          return url;
        })
      : urls;
  return [...new Set(sized)].slice(0, MAX_ARTWORK_CANDIDATES);
}

/** Each failure advances once; exhausting the list ends at an offline placeholder. */
export function advanceTrackArtwork(
  image: HTMLImageElement,
  track: unknown,
  size: 'default' | 'thumbnail' = 'default',
): void {
  const current = image.getAttribute('src') || image.src;
  if (current === DEFAULT_COVER_SVG_DATA_URI) return;
  const urls = trackArtworkCandidates(track, size),
    index = urls.indexOf(current);
  image.src =
    index >= 0 ? urls[index + 1] || DEFAULT_COVER_SVG_DATA_URI : DEFAULT_COVER_SVG_DATA_URI;
}

/** Taste seeds may carry a bounded remote URL, never inline image data or audio URLs. */
export function waveSeedArtwork(track: unknown): { title: string; cover?: string } {
  const cover = trackArtworkCandidates(track).find(
    (url) => /^https:\/\//.test(url) && url.length <= 2048,
  );
  return { title: '', ...(cover ? { cover } : {}) };
}
