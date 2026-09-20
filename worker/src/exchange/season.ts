// Дубль getSeasonId из collector/src/collector.ts: worker (Cloudflare Workers)
// не может импортировать код collector — разные пакеты и рантаймы.
// keep in sync with collector/src/collector.ts (getSeasonId)

/**
 * ID сезона в формате YYYY-<season>, например '2026-spring'.
 * Та же логика, что использует сезонная ликвидация компаний в collector,
 * чтобы season_id в company_trades совпадал с маркером ликвидации сезона.
 */
export function getSeasonId(date: Date = new Date()): string {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1; // 1-12

  let seasonName = '';
  if (month >= 3 && month <= 5) seasonName = 'spring';
  else if (month >= 6 && month <= 8) seasonName = 'summer';
  else if (month >= 9 && month <= 11) seasonName = 'autumn';
  else seasonName = 'winter';

  return `${year}-${seasonName}`;
}
