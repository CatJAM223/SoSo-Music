/** Detect subscription previews independently of artist or genre. */
export function isSoundCloudPreviewUrl(url: unknown): boolean {
  return (
    typeof url === 'string' && /(?:^|[/?&=_-])(?:preview|snip|snipped)(?:$|[/?&=_.-])/i.test(url)
  );
}
export function isSoundCloudPreviewTranscoding(value: any, fullDuration = 0): boolean {
  const duration = Number(value?.duration) || 0;
  return (
    value?.snipped === true ||
    isSoundCloudPreviewUrl(value?.url) ||
    (duration > 0 && duration <= 35000 && fullDuration >= 60000 && fullDuration > duration * 1.5)
  );
}
export function isSoundCloudRestrictedTrack(item: any): boolean {
  if (!item) return false;
  if (
    ['BLOCK', 'SNIP'].includes(item.policy) ||
    item.monetization_model === 'SUB_HIGH_TIER' ||
    item.streamable === false
  )
    return true;
  const duration = Math.max(Number(item.full_duration) || 0, Number(item.duration) || 0);
  if (
    Number(item.duration) > 0 &&
    Number(item.duration) <= 35000 &&
    Number(item.full_duration) >= 60000
  )
    return true;
  const formats = item.media?.transcodings;
  return (
    Array.isArray(formats) &&
    (formats.length === 0 ||
      formats.every((format) => isSoundCloudPreviewTranscoding(format, duration)))
  );
}
export function isFullSoundCloudTranscoding(value: any, fullDuration = 0): boolean {
  return (
    value?.is_legacy_transcoding !== true &&
    typeof value?.url === 'string' &&
    Boolean(value.url) &&
    !isSoundCloudPreviewTranscoding(value, fullDuration) &&
    ['progressive', 'hls'].includes(value.format?.protocol) &&
    !value.url.includes('encrypted')
  );
}
