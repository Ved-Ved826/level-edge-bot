// Чистая отрисовка спарклайна (Этап 4.1: визуал биржи).

const SPARK_CHARS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];

/**
 * Строит спарклайн по числовому ряду.
 * Плоский ряд (min === max) рисуется средними блоками '▄'.
 */
export function sparkline(values: number[]): string {
  if (values.length === 0) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) return "▄".repeat(values.length);

  const range = max - min;
  const lastIdx = SPARK_CHARS.length - 1;
  return values
    .map((v) => {
      const idx = Math.min(Math.floor(((v - min) / range) * lastIdx), lastIdx);
      return SPARK_CHARS[idx];
    })
    .join("");
}
