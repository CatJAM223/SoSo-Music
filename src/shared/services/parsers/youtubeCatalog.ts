/** Read catalog shelves and their own continuation, excluding menus and recommendations. */
export function readYouTubeCatalogPage(response: any): { items: any[]; continuation?: string } {
  const items: any[] = [];
  const tokens: string[] = [];
  const rendererKeys = new Set([
    'musicShelfRenderer',
    'musicPlaylistShelfRenderer',
    'musicCarouselShelfRenderer',
    'gridRenderer',
    'musicShelfContinuation',
    'musicPlaylistShelfContinuation',
    'musicCarouselShelfContinuation',
    'gridContinuation',
  ]);
  const tokenFrom = (value: any) => {
    const token =
      value?.nextContinuationData?.continuation ||
      value?.reloadContinuationData?.continuation ||
      value?.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
    if (typeof token === 'string' && token) tokens.push(token);
  };
  const visit = (value: any): void => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      if (rendererKeys.has(key)) {
        const shelf = child as any;
        const rows = shelf.contents || shelf.items || [];
        items.push(...rows.filter((row: any) => !row.continuationItemRenderer));
        rows.forEach(tokenFrom);
        (shelf.continuations || []).forEach(tokenFrom);
      } else if (
        key === 'appendContinuationItemsAction' ||
        key === 'reloadContinuationItemsCommand'
      ) {
        const rows = (child as any).continuationItems || [];
        items.push(...rows.filter((row: any) => !row.continuationItemRenderer));
        rows.forEach(tokenFrom);
      } else if (key !== 'header' && key !== 'menu') visit(child);
    }
  };
  visit(response);
  return { items, continuation: tokens[0] };
}
