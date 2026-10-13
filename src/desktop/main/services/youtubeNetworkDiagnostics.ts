// Keep signed URLs, client IPs and visitor tokens out of playback logs.
export function describeYouTubeMediaRequest(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    if (
      url.protocol !== 'https:' ||
      !(url.hostname === 'googlevideo.com' || url.hostname.endsWith('.googlevideo.com'))
    ) {
      return null;
    }
    const itag = url.searchParams.get('itag');
    return `${url.protocol}//${url.host}/videoplayback${itag && /^\d{1,5}$/.test(itag) ? ` (itag=${itag})` : ''}`;
  } catch {
    return null;
  }
}
