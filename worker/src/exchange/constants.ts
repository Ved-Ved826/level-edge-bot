// Константы биржи компаний (Этап 4.1: визуал и воркер биржи).

/** Кит-сделка: минимальное количество акций в сделке. */
export const WHALE_MIN_SHARES = 5;

/** Кит-сделка: минимальная сумма сделки в монетах. */
export const WHALE_MIN_COINS = 1000;

/** Порог значимого движения NAV, %. */
export const NAV_MOVE_THRESHOLD_PCT = 10;

/** Окно наблюдения за движением NAV, часов. */
export const NAV_MOVE_LOOKBACK_HOURS = 24;

/** Антидубль nav_move: минимальный интервал между событиями, часов. */
export const NAV_MOVE_DEDUP_HOURS = 6;

/** Сколько компаний попадает в ежедневный дайджест. */
export const DIGEST_TOP_N = 5;

/** Минимум компаний на сервере для публикации дайджеста. */
export const DIGEST_MIN_COMPANIES = 2;

/** Количество точек спарклайна NAV. */
export const SPARKLINE_POINTS = 24;

/** Размер батча выборки событий из очереди рынка. */
export const MARKET_EVENTS_BATCH = 20;

/** Максимум попыток доставки события в канал. */
export const MARKET_EVENTS_MAX_ATTEMPTS = 5;

/** Пауза между отправками событий, мс. */
export const MARKET_EVENTS_SEND_PAUSE_MS = 250;
