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

// ============================================
// Кризисы и настроение рынка
// ============================================

/** Максимальное отклонение настроения от нуля, bps (коридор ±25%). */
export const MOOD_MAX_BPS = 2500;

/** Период полураспада настроения, часов (ленивое затухание при чтении). */
export const MOOD_HALF_LIFE_HOURS = 18;

/** Минимум казны компании для спавна кризиса. */
export const CRISIS_MIN_TREASURY = 300;

/** Интервал спавна кризисов по гильдии: минимум, часов. */
export const CRISIS_MIN_INTERVAL_HOURS = 6;

/** Интервал спавна кризисов по гильдии: максимум, часов. */
export const CRISIS_MAX_INTERVAL_HOURS = 8;

/** Пауза между кризисами одной компании, часов. */
export const CRISIS_COMPANY_COOLDOWN_HOURS = 48;

/** Время на решение кризиса владельцем, часов. */
export const CRISIS_TTL_HOURS = 24;

/** Потолок потери казны за кризис, bps. */
export const CRISIS_MAX_LOSS_BPS = 2500;

/** Потолок прибыли казны за кризис, bps. */
export const CRISIS_MAX_GAIN_BPS = 1500;

/** Потолок прибыли за кризис в монетах (прибыль также ограничена резервом). */
export const CRISIS_MAX_GAIN_COINS = 1500;

/** Усиление паники при потере (множитель сдвига настроения). */
export const CRISIS_LOSS_MOOD_FACTOR = 1.5;
