// Тесты чистой математики биржи: котировки сделок с настроением, комиссии,
// сдвиги настроения, ленивое затухание и инвариант сохранения монет.
// Запуск: npx vitest run worker/src/exchange/math.test.ts
import { describe, expect, it } from "vitest";
import {
  applyMoodShift,
  computeCrisisDelta,
  computeEffectiveMood,
  pickWeightedOutcome,
  quoteBuy,
  quoteSell,
  tradeMoodShift,
} from "./math";
import { MOOD_MAX_BPS } from "./constants";

describe("золотые тесты комиссий (BUY_FOUNDER_BPS=200, BUY_RESERVE_BPS=200, SELL_RESERVE_BPS=300)", () => {
  it("покупка без настроения: база 200, роялти 4, резерв 4, итог 208", () => {
    // Вручную: T=1000, C=50, a=10.
    // baseCost = ceil(10*1000/50) = 200 (вся база — в казну).
    // founderFee = floor(200*200/10000) = 4; reserveFee = ceil(200*200/10000) = 4.
    // premium = 0 (mood = 0). totalCost = 200 + 0 + 4 + 4 = 208.
    const q = quoteBuy(1000, 50, 10, 0);
    expect(q.baseCost).toBe(200);
    expect(q.premium).toBe(0);
    expect(q.founderFee).toBe(4);
    expect(q.reserveFee).toBe(4);
    expect(q.totalCost).toBe(208);
    expect(q.treasuryDelta).toBe(200);
  });

  it("покупка при mood +12%: премия 24 уходит в казну, итог 232", () => {
    // Вручную: baseCost = 200; premium = ceil(200*1200/10000) = 24;
    // totalCost = 200 + 24 + 4 + 4 = 232; в казну уходит 200 + 24 = 224.
    const q = quoteBuy(1000, 50, 10, 1200);
    expect(q.premium).toBe(24);
    expect(q.totalCost).toBe(232);
    expect(q.treasuryDelta).toBe(224);
  });

  it("продажа без настроения: база 200, комиссия резерва 6, продавцу 194", () => {
    // Вручную: basePayout = floor(10*1000/50) = 200; discount = 0;
    // reserveCut = ceil(200*300/10000) = 6; netPayout = 194; из казны уходит 200.
    const q = quoteSell(1000, 50, 10, 0);
    expect(q.basePayout).toBe(200);
    expect(q.discount).toBe(0);
    expect(q.reserveCut).toBe(6);
    expect(q.netPayout).toBe(194);
    expect(q.treasuryDelta).toBe(200);
  });

  it("продажа при mood −15%: скидка 30 остаётся в казне, продавцу 164", () => {
    // Вручную: basePayout = 200; discount = ceil(200*1500/10000) = 30;
    // grossPayout = 170 — только она уходит из казны (скидка достаётся держателям);
    // reserveCut = ceil(170*300/10000) = ceil(5.1) = 6; netPayout = 164.
    const q = quoteSell(1000, 50, 10, -1500);
    expect(q.discount).toBe(30);
    expect(q.treasuryDelta).toBe(170);
    expect(q.reserveCut).toBe(6);
    expect(q.netPayout).toBe(164);
  });
});

describe("премия и скидка настроения", () => {
  it("премия (mood > 0) целиком уходит в казну: разбивка покупки сходится без остатка", () => {
    for (const mood of [1, 300, 1200, 2500]) {
      const q = quoteBuy(777, 40, 3, mood);
      // Покупатель платит ровно сумму частей — монеты не создаются
      expect(q.baseCost + q.premium + q.founderFee + q.reserveFee).toBe(q.totalCost);
      // Премия достаётся казне (растит NAV держателей), а не основателю или резерву
      expect(q.treasuryDelta).toBe(q.baseCost + q.premium);
      expect(q.premium).toBe(Math.ceil((q.baseCost * mood) / 10000));
    }
  });

  it("скидка (mood < 0) остаётся в казне: из казны уходит только grossPayout", () => {
    for (const mood of [-1, -300, -2500]) {
      const q = quoteSell(777, 40, 3, mood);
      // Продавец + резерв получают всё, что вышло из казны
      expect(q.netPayout + q.reserveCut).toBe(q.treasuryDelta);
      // Скидка не покидает казну
      expect(q.treasuryDelta).toBe(q.basePayout - q.discount);
      expect(q.discount).toBe(Math.ceil((q.basePayout * -mood) / 10000));
    }
  });

  it("продавец никогда не получает больше basePayout при любом настроении", () => {
    for (let mood = -MOOD_MAX_BPS; mood <= MOOD_MAX_BPS; mood += 100) {
      const q = quoteSell(1234, 61, 7, mood);
      expect(q.netPayout).toBeLessThanOrEqual(q.basePayout);
      if (mood < 0) expect(q.netPayout).toBeLessThan(q.basePayout);
    }
  });
});

describe("сдвиг настроения от сделок", () => {
  it("сдвиг пропорционален доле сделки в обращении", () => {
    // floor(1500*10/50) = 300 bps за сделку на 20% обращения
    expect(tradeMoodShift(10, 50)).toBe(300);
    // Сделка на всё обращение: floor(1500*100/100) = 1500, потолок не мешает
    expect(tradeMoodShift(100, 100)).toBe(1500);
  });

  it("100 сделок по 1 акции сдвигают настроение не сильнее одной сделки на 100 акций (±100 bps на округление)", () => {
    const circulating = 100;
    let totalSmall = 0;
    for (let i = 0; i < 100; i++) totalSmall += tradeMoodShift(1, circulating);
    const oneBig = tradeMoodShift(100, circulating);
    // Округление вниз каждой части даёт суммарный сдвиг не выше целого + допуск
    expect(totalSmall).toBeLessThanOrEqual(oneBig + 100);
    expect(totalSmall).toBeGreaterThan(0);
  });

  it("покупка разогревает, продажа охлаждает, коридор ±MOOD_MAX_BPS соблюдается", () => {
    expect(applyMoodShift(0, tradeMoodShift(10, 50))).toBe(300);
    expect(applyMoodShift(0, -tradeMoodShift(10, 50))).toBe(-300);
    expect(applyMoodShift(MOOD_MAX_BPS, tradeMoodShift(100, 100))).toBe(MOOD_MAX_BPS);
    expect(applyMoodShift(-MOOD_MAX_BPS, -tradeMoodShift(100, 100))).toBe(-MOOD_MAX_BPS);
  });
});

describe("ленивое затухание настроения", () => {
  it("через 72 часа остаётся менее 7% исходного настроения (полураспад 18 ч: 0.5^4 = 6.25%)", () => {
    const now = 1_800_000_000;
    const initial = 2000;
    const after = computeEffectiveMood(initial, now - 72 * 3600, now);
    expect(after).toBe(125); // trunc(2000 * 0.5^(72/18)) = trunc(2000 * 0.0625)
    expect(Math.abs(after)).toBeLessThan(initial * 0.07);
  });

  it("нулевое или будущее время обновления не меняет настроение", () => {
    expect(computeEffectiveMood(-1300, 0, 1000)).toBe(-1300);
    expect(computeEffectiveMood(900, 1000, 1000)).toBe(900);
  });
});

describe("кризисы (регресс шага 2)", () => {
  it("потеря не опустошает казну, прибыль ограничена потолком и балансом резерва", () => {
    // trunc(1000 * -2500/10000) = -250; казна остаётся 750 >= 1; резерв +250
    expect(computeCrisisDelta(1000, -2500, 5000)).toEqual({ delta: -250, newTreasury: 750, reserveDelta: 250 });
    // Сырая прибыль 1000 монет, но потолок 1500 и резерв 300 → только 300
    expect(computeCrisisDelta(1000, 10000, 300)).toEqual({ delta: 300, newTreasury: 1300, reserveDelta: -300 });
    expect(computeCrisisDelta(1000, 0, 0).delta).toBe(0);
  });

  it("pickWeightedOutcome выбирает исход по накопленному весу", () => {
    const outcomes = [
      { weight: 50, id: "a" },
      { weight: 50, id: "b" },
    ];
    expect(pickWeightedOutcome(outcomes, 0.49).id).toBe("a");
    expect(pickWeightedOutcome(outcomes, 0.5).id).toBe("b");
    expect(pickWeightedOutcome(outcomes, 0.999).id).toBe("b");
  });
});

// --- Мини-модель биржи: два аккаунта, казна, резерв и настроение.
// Воспроизводит правила обработчиков /invest и /divest; guard здесь не нужен,
// операции последовательны, инварианты сохранения монет проверяются напрямую.

interface LedgerState {
  coinsA: number;
  coinsB: number;
  treasury: number;
  reserve: number;
  sharesA: number; // основатель (владелец), контрольный пакет 51
  sharesB: number;
  moodBps: number;
  moodUpdatedAt: number;
}

const NOW = 1_800_000_000;

function freshLedger(): LedgerState {
  return { coinsA: 5000, coinsB: 5000, treasury: 500, reserve: 1000, sharesA: 51, sharesB: 0, moodBps: 0, moodUpdatedAt: NOW };
}

function effMood(s: LedgerState): number {
  return computeEffectiveMood(s.moodBps, s.moodUpdatedAt, NOW);
}

/** Покупка по правилам /invest; возвращает false, если операция невозможна. */
function applyBuy(s: LedgerState, buyer: "A" | "B", amount: number): boolean {
  const circulating = s.sharesA + s.sharesB;
  if (s.treasury < 1) return false; // «Компания банкрот»
  if (100 - circulating < amount) return false; // «В свободной продаже нет столько акций»
  const m = effMood(s);
  const q = quoteBuy(s.treasury, circulating, amount, m);
  const coins = buyer === "A" ? s.coinsA : s.coinsB;
  if (coins < q.totalCost) return false; // «Недостаточно монет»
  if (buyer === "A") s.coinsA -= q.totalCost;
  else s.coinsB -= q.totalCost;
  s.treasury += q.treasuryDelta; // база + премия ажиотажа
  s.coinsA += q.founderFee; // роялти основателю (владелец — A)
  s.reserve += q.reserveFee;
  if (buyer === "A") s.sharesA += amount;
  else s.sharesB += amount;
  s.moodBps = applyMoodShift(m, tradeMoodShift(amount, circulating));
  s.moodUpdatedAt = NOW;
  return true;
}

/** Продажа по правилам /divest; возвращает false, если операция невозможна. */
function applySell(s: LedgerState, seller: "A" | "B", amount: number): boolean {
  const circulating = s.sharesA + s.sharesB;
  const shares = seller === "A" ? s.sharesA : s.sharesB;
  if (shares < amount) return false;
  if (seller === "A" && s.sharesA - amount < 51) return false; // контрольный пакет владельца
  const m = effMood(s);
  const q = quoteSell(s.treasury, circulating, amount, m);
  if (q.netPayout < 1) return false;
  if (q.treasuryDelta > s.treasury) return false; // «Недостаточно средств в казне»
  s.treasury -= q.treasuryDelta; // grossPayout: скидка паники остаётся в казне
  if (seller === "A") s.sharesA -= amount;
  else s.sharesB -= amount;
  if (seller === "A") s.coinsA += q.netPayout;
  else s.coinsB += q.netPayout;
  s.reserve += q.reserveCut;
  s.moodBps = applyMoodShift(m, -tradeMoodShift(amount, circulating));
  s.moodUpdatedAt = NOW;
  return true;
}

function assertConservation(s: LedgerState, totalAll: number): void {
  expect(s.coinsA + s.coinsB + s.treasury + s.reserve).toBe(totalAll);
  expect(s.treasury).toBeGreaterThanOrEqual(0);
  expect(s.reserve).toBeGreaterThanOrEqual(0);
}

describe("длинная симуляция с настроением (5000 операций)", () => {
  it("сумма монет постоянна, казна и резерв неотрицательны", () => {
    // Детерминированный LCG (Лемер): прогон воспроизводим, без Math.random
    let seed = 123456789;
    const rnd = () => {
      seed = (seed * 48271) % 2147483647;
      return seed / 2147483647;
    };
    const s = freshLedger();
    const totalAll = s.coinsA + s.coinsB + s.treasury + s.reserve;
    for (let i = 0; i < 5000; i++) {
      const who = rnd() < 0.5 ? "A" : "B";
      const amount = 1 + Math.floor(rnd() * 5);
      if (rnd() < 0.5) applyBuy(s, who, amount);
      else applySell(s, who, amount);
      if (i % 100 === 0) assertConservation(s, totalAll);
    }
    assertConservation(s, totalAll);
  });
});

describe("анти-накрутка: «накачать и слить» двумя аккаунтами", () => {
  it("при случайных последовательностях суммарные монеты A+B не растут (10000 прогонов)", () => {
    for (let run = 0; run < 10000; run++) {
      const s = freshLedger();
      const totalAll = s.coinsA + s.coinsB + s.treasury + s.reserve;
      const startAB = s.coinsA + s.coinsB;
      const ops = 4 + Math.floor(Math.random() * 5); // 4..8 операций: покупки качают mood, продажи сливают
      for (let i = 0; i < ops; i++) {
        const who = Math.random() < 0.5 ? "A" : "B";
        const amount = 1 + Math.floor(Math.random() * 5);
        if (Math.random() < 0.5) applyBuy(s, who, amount);
        else applySell(s, who, amount);
        assertConservation(s, totalAll);
      }
      // Схема не может нарастить суммарные монеты участников: премии уходят в казну,
      // скидки в ней же остаются, комиссии — в резерв
      expect(s.coinsA + s.coinsB).toBeLessThanOrEqual(startAB);
    }
  }, 30000);
});
