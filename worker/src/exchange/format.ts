// Санитизация отображаемых имён для embed'ов биржи (Этап 4.1).

/**
 * Очищает имя от символов разметки Discord/Markdown
 * (@, <, >, `, *, ~, |, _) и обрезает до 32 символов.
 */
export function sanitizeDisplayName(raw: string): string {
  return raw
    .replace(/[@<>`*~|_]/g, "")
    .trim()
    .slice(0, 32);
}
