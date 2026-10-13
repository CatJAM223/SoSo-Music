/**
 * Audio URL Validator
 *
 * Strict validator to guarantee that only actual media stream URLs or audio blobs
 * are ever passed to HTML5 <audio src>. Blocks HTML web pages and API metadata endpoints
 * that cause fatal Chromium demuxer crashes (MEDIA_ELEMENT_ERROR / FFmpegDemuxer).
 */
export function isPlayableDirectAudioUrl(url: string | null | undefined): boolean {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (
    !trimmed.startsWith('http://') &&
    !trimmed.startsWith('https://') &&
    !trimmed.startsWith('blob:') &&
    !trimmed.startsWith('data:')
  ) {
    return false;
  }
  if (
    trimmed.includes('youtube.com/watch') ||
    trimmed.includes('youtube.com/embed') ||
    trimmed.includes('youtu.be/') ||
    trimmed.includes('music.youtube.com') ||
    trimmed.includes('api-v2.soundcloud.com')
  ) {
    return false;
  }
  return true;
}

export function isYouTubeAudioStreamUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname === 'googlevideo.com' || hostname.endsWith('.googlevideo.com');
  } catch {
    return false;
  }
}
