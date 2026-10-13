/** Hide the old generated source link without changing personal descriptions. */
export function playlistDescription(description?: string): string {
  return (description || '').replace(
    /^Перенесено (?:из|с) (VK Музыки|Яндекс Музыки): https?:\/\/\S+\s*$/,
    'Перенесено с $1',
  );
}
