// Чистые функции биржи: настроение рынка, котировки сделок и расчёт дельты кризиса.
// Используются обработчиками сделок (worker/src/commands/invest.ts), кнопок кризиса
// (worker/src/commands/crisis.ts) и тестами.
// Логика кризисов дублируется в collector/src/crises.ts (коллектор не может импортировать
// из worker) — keep in sync with collector/src/crises.ts.

import {
  BUY_FOUNDER_BPS,
  BUY_RESERVE_BPS,
  CRISIS_LOSS_MOOD_FACTOR,
  CRISIS_MAX_GAIN_COINS,
  MOOD_HALF_LIFE_HOURS,
  MOOD_IMPULSE_BPS,
  MOOD_MAX_BPS,
  MOOD_MAX_SHIFT_PER_TRADE_BPS,
  SELL_RESERVE_BPS,
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

/**
 * Маркер промаха guard: состояние компании (казна, акции, настроение) изменилось
 * с момента расчёта котировки. Обработчик сделки откатывает транзакцию и
 * пересчитывает котировку на свежем состоянии.
 */
export class StaleStateError extends Error {
  constructor() {
    super("stale company state");
    this.name = "StaleStateError";
  }
}

export interface BuyQuote {
  /** Базовая стоимость по NAV — уходит в казну. */
  baseCost: number;
  /** Надбавка ажиотажа (mood > 0) — уходит в казну и растит NAV держателей. */
  premium: number;
  /** Роялти основателю с базы. */
  founderFee: number;
  /** Взнос в резерв сервера с базы. */
  reserveFee: number;
  /** Итого к оплате покупателем. */
  totalCost: number;
  /** Сколько уходит в казну: baseCost + premium. */
  treasuryDelta: number;
}

export interface SellQuote {
  /** Базовая выплата по NAV — потолок для продавца при любом настроении. */
  basePayout: number;
  /** Скидка паники (mood < 0) — остаётся в казне для оставшихся держателей. */
  discount: number;
  /** Комиссия резерва с выплаты. */
  reserveCut: number;
  /** Итого продавцу, всегда <= basePayout. */
  netPayout: number;
  /** Сколько уходит из казны: basePayout - discount. */
  treasuryDelta: number;
}

/**
 * Котировка покупки, целочисленно. Округление в пользу системы: baseCost и
 * premium — ceil (платит покупатель), founderFee — floor (получает основатель),
 * reserveFee — ceil (в резерв). Премия ажиотажа (mood > 0) доплачивается
 * покупателем и целиком попадает в казну, поднимая NAV держателей.
 */
export function quoteBuy(treasury: number, circulating: number, amount: number, effectiveMoodBps: number): BuyQuote {
  // ceil(a*b/c) = floor((a*b + c - 1) / c) — целочисленный ceil без дробей
  const baseCost = Math.floor((amount * treasury + circulating - 1) / circulating);
  const premium = effectiveMoodBps > 0 ? Math.ceil((baseCost * effectiveMoodBps) / 10000) : 0;
  const founderFee = Math.floor((baseCost * BUY_FOUNDER_BPS) / 10000);
  const reserveFee = Math.ceil((baseCost * BUY_RESERVE_BPS) / 10000);
  return {
    baseCost,
    premium,
    founderFee,
    reserveFee,
    totalCost: baseCost + premium + founderFee + reserveFee,
    treasuryDelta: baseCost + premium,
  };
}

/**
 * Котировка продажи, целочисленно. Казна никогда не платит продавцу больше NAV:
 * при панике (mood < 0) продавец получает NAV * (1 + mood), разница (discount)
 * остаётся в казне. Округление в пользу системы: discount и reserveCut — ceil.
 */
export function quoteSell(treasury: number, circulating: number, amount: number, effectiveMoodBps: number): SellQuote {
  const basePayout = Math.floor((amount * treasury) / circulating);
  const discount = effectiveMoodBps < 0 ? Math.ceil((basePayout * -effectiveMoodBps) / 10000) : 0;
  const grossPayout = basePayout - discount;
  const reserveCut = Math.ceil((grossPayout * SELL_RESERVE_BPS) / 10000);
  return {
    basePayout,
    discount,
    reserveCut,
    netPayout: grossPayout - reserveCut,
    treasuryDelta: grossPayout,
  };
}

/**
 * Модуль сдвига настроения за сделку: пропорционален доле сделки в обращении
 * (MOOD_IMPULSE_BPS * amount / circulating), поэтому нарезка крупной сделки на
 * мелкие не даёт преимущества (сумма округлённых вниз частей не превышает сдвига
 * целой сделки + допуск на округления). Знак применяет вызывающий код:
 * покупка — ажиотаж (+), продажа — паника (−).
 */
export function tradeMoodShift(amount: number, circulating: number): number {
  const proportional = Math.floor((MOOD_IMPULSE_BPS * amount) / circulating);
  // Потолок страхует только вырожденные случаи (amount > circulating); в реальной
  // торговле amount <= 100 - circulating < circulating, поэтому не превышается.
  return Math.min(MOOD_MAX_SHIFT_PER_TRADE_BPS, proportional);
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
