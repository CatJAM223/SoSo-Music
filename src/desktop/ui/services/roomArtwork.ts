export function safeRoomArtwork(value: string | undefined): string | undefined {
  if (!value || value.length > 2048) return undefined;
  try {
    const url = new URL(value);
    const domains = ['ytimg.com', 'googleusercontent.com', 'ggpht.com', 'sndcdn.com', 'dzcdn.net'];
    if (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      domains.some((domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`))
    )
      return url.href;
  } catch {
    // Ignore invalid or unsupported artwork URLs.
  }
  return undefined;
}
