/** The import window has no application preload and only visits VK's own hosts. */
export function isVkImportUrl(input: string): boolean {
  try {
    const url = new URL(input);
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.port &&
      /(^|\.)(vk\.ru|vk\.com|vk\.id)$/.test(url.hostname)
    );
  } catch {
    return false;
  }
}

export function isVkPlaylistPage(input: string): boolean {
  if (!isVkImportUrl(input)) return false;
  return /^\/(?:audio_playlist|audios(?:-?\d+)?(?:\/|$)|music\/playlist\/)/.test(
    new URL(input).pathname,
  );
}
