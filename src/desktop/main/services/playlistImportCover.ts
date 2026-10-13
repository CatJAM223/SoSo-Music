import type { PlaylistReadResult } from '../../../shared/types/playlistImport.ts';

export function isVkCoverUrl(input: string): boolean {
  try {
    const url = new URL(input);
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.port &&
      /(?:^|\.)(?:userapi\.com|vkuserphoto\.ru|vkuser\.net|vk\.com|vk\.ru)$/.test(url.hostname)
    );
  } catch {
    return false;
  }
}

/** Keep artwork locally, without retaining signed links or the login session. */
export async function attachPlaylistCover(
  result: PlaylistReadResult,
  fetchCover: (url: string, init: RequestInit) => Promise<Response>,
  prepare: (bytes: Buffer) => string,
  signal?: AbortSignal,
): Promise<PlaylistReadResult> {
  if (!result.success || result.data.source !== 'vk' || !result.data.coverUrl) return result;
  const { coverUrl, ...playlist } = result.data;
  try {
    if (!isVkCoverUrl(coverUrl)) throw new Error('Unsupported artwork host');
    const response = await fetchCover(coverUrl, {
      redirect: 'error',
      signal: AbortSignal.any([AbortSignal.timeout(10000), ...(signal ? [signal] : [])]),
    });
    const limit = 10 * 1024 * 1024;
    if (
      !response.ok ||
      !/^image\/(?:jpeg|png|webp)(?:;|$)/i.test(response.headers.get('content-type') || '') ||
      Number(response.headers.get('content-length')) > limit ||
      !response.body
    )
      throw new Error('Invalid artwork');
    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > limit) throw new Error('Artwork too large');
        chunks.push(Buffer.from(value));
      }
    } finally {
      await reader.cancel();
    }
    const data = prepare(Buffer.concat(chunks));
    if (!/^data:image\/(?:jpeg|png|webp);base64,/.test(data) || data.length > 750000)
      throw new Error('Invalid prepared artwork');
    return { success: true, data: { ...playlist, coverUrl: data } };
  } catch {
    // An unavailable cover must not discard the successfully read track list.
    return { success: true, data: playlist };
  }
}
