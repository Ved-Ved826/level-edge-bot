// Outbox публичных событий биржи (таблица market_events).
// События НЕ отправляются в Discord напрямую из обработчиков: statement вставки
// добавляется в тот же батч/транзакцию, что и операция, поэтому событие
// коммитится атомарно с ней. Доставка в Discord — отдельный фоновый процесс
// после коммита: он проставляет sent_at, наращивает attempts и пишет last_error.

/** Допустимые типы событий ленты биржи. */
export type MarketEventKind =
  | 'whale_trade'
  | 'nav_move'
  | 'crisis_spawn'
  | 'crisis_resolved'
  | 'daily_digest'
  | 'season_results';

const ALLOWED_KINDS: readonly MarketEventKind[] = [
  'whale_trade',
  'nav_move',
  'crisis_spawn',
  'crisis_resolved',
  'daily_digest',
  'season_results',
];

/**
 * Готовит statement вставки события в outbox market_events.
 * Statement НЕ выполняется: его нужно добавить в массив существующего db.batch
 * или выполнить внутри транзакции операции, чтобы событие не потерялось при сбое.
 * sent_at остаётся NULL до успешной доставки; отправленные записи чистятся по возрасту.
 */
export function enqueueMarketEventStatement(
  guildId: string,
  kind: MarketEventKind,
  payload: Record<string, unknown>
): { sql: string; args: (string | number | null)[] } {
  if (!ALLOWED_KINDS.includes(kind)) {
    throw new Error(`Неизвестный kind события биржи: ${kind}`);
  }
  return {
    sql: `INSERT INTO market_events (guild_id, kind, payload_json, created_at, sent_at, attempts, last_error)
          VALUES (?, ?, ?, ?, NULL, 0, NULL)`,
    args: [guildId, kind, JSON.stringify(payload), Math.floor(Date.now() / 1000)],
  };
}
