// Почасовой ряд NAV и расчёт дельты (Этап 4.1: визуал биржи).

/**
 * Строит почасовой ряд NAV длиной points с fill-forward для пропусков:
 * для каждого часа берётся последний снимок, не новее этого часа.
 * Точки до первого снимка остаются нулями.
 *
 * @param records снимки истории NAV (ts в секундах, nav — монет на акцию)
 * @param nowSec текущее время в секундах
 * @param points количество точек (по умолчанию 24)
 */
export function buildHourlyNavSeries(
  records: { ts: number; nav: number }[],
  nowSec: number,
  points: number = 24
): number[] {
  const sorted = [...records].sort((a, b) => a.ts - b.ts);
  const series: number[] = [];
  let lastNav = 0;
  let ptr = 0;

  for (let i = points - 1; i >= 0; i--) {
    const hourTs = nowSec - i * 3600;
    // Fill-forward: продвигаем указатель на последний снимок, не новее hourTs
    while (ptr < sorted.length && sorted[ptr].ts <= hourTs) {
      lastNav = sorted[ptr].nav;
      ptr++;
    }
    series.push(lastNav);
  }

  return series;
}

/**
 * Дельта NAV в процентах: ((current - base) / base) * 100.
 * При base <= 0 возвращает 0 (защита от деления на ноль).
 */
export function navChangePct(current: number, base: number): number {
  if (base <= 0) return 0;
  return ((current - base) / base) * 100;
}
