import type { Track } from '../types/index.ts';
/** Share public track pages, never signed audio streams or local app URLs. */
export function getTrackShareData(track: Track): ShareData {
  const artist = typeof track.artist === 'string' ? track.artist : track.artist?.name || '';
  const data: ShareData = {
    title: track.title,
    text: 'Слушаю «' + track.title + ' — ' + artist + '» в SoSo Music',
  };
  const id = String(track.id);
  if (track.source === 'youtube' || id.startsWith('yt_')) {
    const videoId = id.replace(/^yt_/, '');
    if (/^[A-Za-z0-9_-]{11}$/.test(videoId))
      data.url = 'https://www.youtube.com/watch?v=' + videoId;
  } else {
    const permalink = (track as Track & { permalink_url?: string }).permalink_url;
    if (typeof permalink === 'string') {
      try {
        const url = new URL(permalink);
        if (
          url.protocol === 'https:' &&
          (url.hostname === 'soundcloud.com' || url.hostname === 'www.soundcloud.com')
        )
          data.url = url.href;
      } catch {}
    }
  }
  return data;
}
