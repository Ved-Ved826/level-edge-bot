// Тесты чистых функций биржи: дельта кризиса, настроение, взвешенный выбор.
// Запуск: npx tsx tests/exchangeMath.test.ts
import assert from 'node:assert/strict';
import {
  applyMoodShift,
  computeCrisisDelta,
  computeEffectiveMood,
  crisisMoodShift,
  pickWeightedOutcome,
} from '../worker/src/exchange/math';
import { CRISIS_MAX_GAIN_COINS, MOOD_MAX_BPS } from '../worker/src/exchange/constants';

// --- computeCrisisDelta: целочисленное усечение ---
// trunc(999 * 2500 / 10000) = trunc(249.75) = 249
assert.deepEqual(
  computeCrisisDelta(999, 2500, 10000),
  { delta: 249, newTreasury: 1248, reserveDelta: -249 }
);
// trunc(-999 * 2500 / 10000) = trunc(-249.75) = -249
assert.deepEqual(
  computeCrisisDelta(999, -2500, 10000),
  { delta: -249, newTreasury: 750, reserveDelta: 249 }
);

// --- потеря ограничена так, чтобы казна осталась >= 1 ---
assert.equal(computeCrisisDelta(10, -2500, 10000).delta, -9);
assert.equal(computeCrisisDelta(10, -2500, 10000).newTreasury, 1);
assert.equal(computeCrisisDelta(1, -2500, 10000).delta, 0);

// --- прибыль ограничена потолком в монетах и балансом резерва ---
assert.equal(computeCrisisDelta(1000000, 1500, 100000).delta, CRISIS_MAX_GAIN_COINS);
assert.equal(computeCrisisDelta(1000000, 1500, 100).delta, 100);
assert.equal(computeCrisisDelta(1000000, 1500, 0).delta, 0);
assert.equal(computeCrisisDelta(1000000, 1500, -5).delta, 0);

// --- нулевой сдвиг ---
assert.deepEqual(computeCrisisDelta(500, 0, 100), { delta: 0, newTreasury: 500, reserveDelta: 0 });

// --- инварианты: сохранение монет и treasury >= 1 на сетке параметров ---
for (const pctBps of [-2500, -1000, -1, 0, 1, 500, 1500]) {
  for (const treasury of [1, 2, 100, 12345, 999999]) {
    const r = computeCrisisDelta(treasury, pctBps, 777);
    assert.equal(r.delta + r.reserveDelta, 0, `сохранение монет: pct=${pctBps}, treasury=${treasury}`);
    assert.ok(r.newTreasury >= 1, `казна >= 1: pct=${pctBps}, treasury=${treasury}`);
    assert.equal(r.newTreasury, treasury + r.delta, `согласованность: pct=${pctBps}, treasury=${treasury}`);
  }
}

// --- computeEffectiveMood: ленивое затухание с усечением к нулю ---
assert.equal(computeEffectiveMood(2000, 1000, 1000 + 18 * 3600), 1000); // ровно один полураспад
assert.equal(computeEffectiveMood(-2000, 1000, 1000 + 18 * 3600), -1000);
assert.equal(computeEffectiveMood(0, 0, 5000), 0); // нет отметки времени
assert.equal(computeEffectiveMood(1500, 5000, 4000), 1500); // метка из будущего — без затухания

// --- crisisMoodShift: прибыль как есть, потеря усиливается фактором паники ---
assert.equal(crisisMoodShift(500), 500);
assert.equal(crisisMoodShift(-1000), -1500);
assert.equal(crisisMoodShift(-1), -1); // trunc(1 * 1.5) = 1

// --- applyMoodShift: обрезка в коридор ±MOOD_MAX_BPS ---
assert.equal(applyMoodShift(2000, 1500), MOOD_MAX_BPS);
assert.equal(applyMoodShift(-2000, -1500), -MOOD_MAX_BPS);
assert.equal(applyMoodShift(100, 50), 150);

// --- pickWeightedOutcome: детерминированный выбор по фиксированному rnd ---
const outcomes = [
  { weight: 70, pct_bps: -100, text: 'a' },
  { weight: 30, pct_bps: -1200, text: 'b' },
];
assert.equal(pickWeightedOutcome(outcomes, 0).text, 'a');
assert.equal(pickWeightedOutcome(outcomes, 0.69).text, 'a');
assert.equal(pickWeightedOutcome(outcomes, 0.7).text, 'b');
assert.equal(pickWeightedOutcome(outcomes, 0.999).text, 'b');

console.log('✓ Чистые функции биржи: все проверки прошли');
