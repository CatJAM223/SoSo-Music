/** Frequently used chart markets supported by YouTube; this list is not a popularity ranking. */
export const CHART_REGIONS = [
  { code: 'GLOBAL', label: 'Весь мир' },
  { code: 'RU', label: 'Россия' },
  { code: 'UA', label: 'Украина' },
  { code: 'US', label: 'США' },
  { code: 'GB', label: 'Великобритания' },
  { code: 'DE', label: 'Германия' },
  { code: 'FR', label: 'Франция' },
  { code: 'ES', label: 'Испания' },
  { code: 'IT', label: 'Италия' },
  { code: 'PL', label: 'Польша' },
  { code: 'TR', label: 'Турция' },
  { code: 'BR', label: 'Бразилия' },
  { code: 'MX', label: 'Мексика' },
  { code: 'CA', label: 'Канада' },
  { code: 'AU', label: 'Австралия' },
  { code: 'IN', label: 'Индия' },
  { code: 'JP', label: 'Япония' },
  { code: 'KR', label: 'Южная Корея' },
  { code: 'ID', label: 'Индонезия' },
  { code: 'NL', label: 'Нидерланды' },
] as const;

export type ChartRegion = (typeof CHART_REGIONS)[number]['code'];
export const CHART_REGION_STORAGE_KEY = 'soso_chart_region';
export function isChartRegion(value: unknown): value is ChartRegion {
  return CHART_REGIONS.some((region) => region.code === value);
}
