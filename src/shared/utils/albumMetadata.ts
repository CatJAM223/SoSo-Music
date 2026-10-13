/** YouTube video statistics are metadata, never an album name. */
export function isYouTubeStatisticText(value: string): boolean {
  const text = (value || '').trim();
  return (
    /^\d/.test(text) &&
    /просмотр|прослуш|зрител|лайк|views?|plays?|listeners?|watching|likes?/i.test(text)
  );
}

export function cleanAlbumTitle(value: string | null | undefined): string {
  const title = (value || '').trim();
  return !title || isYouTubeStatisticText(title) ? 'Single' : title;
}
