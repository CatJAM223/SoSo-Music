export function cardColumns(
  viewportWidth: number,
  kind: 'playlists' | 'albums' | 'artists',
): number {
  return viewportWidth >= 1024
    ? kind === 'artists'
      ? 6
      : 5
    : viewportWidth >= 768
      ? 4
      : viewportWidth >= 640
        ? 3
        : 2;
}
export function cardRowHeight(
  containerWidth: number,
  columns: number,
  viewportWidth: number,
  kind: 'playlists' | 'albums' | 'artists',
): number {
  const cell = Math.max(0, (containerWidth - 16 * (columns - 1)) / columns);
  // Enforced outer height gives deterministic spacer geometry; generous text/padding allowance.
  return kind === 'artists'
    ? viewportWidth >= 640
      ? 206
      : 190
    : Math.max(190, Math.ceil(cell + 88));
}
export function cardWindow(
  count: number,
  columns: number,
  rowHeight: number,
  scroll: number,
  viewport: number,
  overscan = 3,
) {
  const rows = Math.ceil(Math.max(0, count) / Math.max(1, columns));
  const stride = Math.max(1, rowHeight) + 16;
  const first = Math.max(0, Math.min(rows, Math.floor(Math.max(0, scroll) / stride) - overscan));
  const last = Math.max(
    first,
    Math.min(rows, Math.ceil((Math.max(0, scroll) + Math.max(0, viewport)) / stride) + overscan),
  );
  return {
    first,
    last,
    start: first * columns,
    end: Math.min(count, last * columns),
    top: Math.min(Math.max(0, rows * stride - 16), first * stride),
    bottom: Math.max(0, Math.max(0, rows * stride - 16) - last * stride),
    height: Math.max(0, rows * stride - 16),
    stride,
  };
}
