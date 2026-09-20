// Чистые функции биржи: настроение рынка и расчёт дельты кризиса.
// Используются обработчиком кнопок кризиса (worker/src/commands/crisis.ts) и тестами.
// Логика дублируется в collector/src/crises.ts (коллектор не может импортировать
// из worker) — keep in sync with collector/src/crises.ts.

import {
  CRISIS_LOSS_MOOD_FACTOR,
  CRISIS_MAX_GAIN_COINS,
  MOOD_HALF_LIFE_HOURS,
  MOOD_MAX_BPS,
} from "./constants";

/**
 * Эффективное настроение с ленивым затуханием: mood * 0.5^(часы / период
 * полураспада), с усечением к нулю. Затухание считается при чтении, крон не нужен.
 */
export function computeEffectiveMood(moodBps: number, moodUpdatedAt: number, nowSec: number): number {
  if (!moodUpdatedAt || moodUpdatedAt >= nowSec) return Math.trunc(moodBps);
  const hours = (nowSec - moodUpdatedAt) / 3600;
  return Math.trunc(moodBps * Math.pow(0.5, hours / MOOD_HALF_LIFE_HOURS));
}

/**
 * Сдвиг настроения от кризиса: прибыль двигает на +pct_bps, потеря усиливается
 * фактором паники. В bps считаем целыми — усечение вниз.
 */
export function crisisMoodShift(pctBps: number): number {
  if (pctBps >= 0) return pctBps;
  return -Math.trunc(Math.abs(pctBps) * CRISIS_LOSS_MOOD_FACTOR);
}

/** Применяет сдвиг к эффективному настроению с обрезкой в коридор ±MOOD_MAX_BPS. */
export function applyMoodShift(effectiveMoodBps: number, shiftBps: number): number {
  const next = effectiveMoodBps + shiftBps;
  return Math.max(-MOOD_MAX_BPS, Math.min(MOOD_MAX_BPS, next));
}

export interface CrisisDelta {
  /** Итоговое изменение казны (со знаком, после всех лимитов). */
  delta: number;
  /** Казна после применения дельты, всегда >= 1. */
  newTreasury: number;
  /** Зеркальное изменение резерва: reserveDelta = -delta (инвариант сохранения монет). */
  reserveDelta: number;
}

/**
 * Дельта казны кризиса: trunc(treasury * pct_bps / 10000).
 * Потеря ограничена так, чтобы казна осталась >= 1 (инвариант treasury >= 1).
 * Прибыль ограничена потолком в монетах и балансом резерва: деньги на прибыль
 * берутся из server_reserve, поэтому больше резерва взять нельзя.
 * Все итоговые суммы целочисленные — монеты не создаются и не исчезают.
 */
export function computeCrisisDelta(
  treasury: number,
  pctBps: number,
  reserveBalance: number,
  maxGainCoins: number = CRISIS_MAX_GAIN_COINS
): CrisisDelta {
  const raw = Math.trunc((treasury * pctBps) / 10000);
  if (raw < 0) {
    // Потеря не должна опустошить казну: остаётся минимум 1 монета
    const maxLoss = Math.max(0, treasury - 1);
    const loss = Math.min(-raw, maxLoss);
    return { delta: -loss, newTreasury: treasury - loss, reserveDelta: loss };
  }
  if (raw > 0) {
    // Прибыль ограничена потолком в монетах и остатком резерва
    const cap = Math.min(maxGainCoins, Math.max(0, Math.trunc(reserveBalance)));
    const gain = Math.min(raw, cap);
    return { delta: gain, newTreasury: treasury + gain, reserveDelta: -gain };
  }
  return { delta: 0, newTreasury: treasury, reserveDelta: 0 };
}

/**
 * Взвешенный случайный выбор исхода. Веса внутри варианта суммируются в 100,
 * rnd — число из [0, 1); в тестах передаётся фиксированное значение.
 */
export function pickWeightedOutcome<T extends { weight: number }>(outcomes: T[], rnd: number = Math.random()): T {
  if (outcomes.length === 0) throw new Error("Пустой список исходов");
  const roll = rnd * 100;
  let acc = 0;
  for (const outcome of outcomes) {
    acc += outcome.weight;
    if (roll < acc) return outcome;
  }
  // Страховка от ошибок округления: последний исход
  return outcomes[outcomes.length - 1];
}
