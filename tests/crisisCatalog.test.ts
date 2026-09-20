// Тесты каталога кризисов: веса исходов, лимиты bps, EV-правила выбора, лимиты Discord.
// Запуск: npx tsx tests/crisisCatalog.test.ts
import assert from 'node:assert/strict';
import { CRISIS_CATALOG, CRISIS_KIND_TITLES } from '../collector/src/crisisCatalog';

// keep in sync with worker/src/exchange/constants.ts
const CRISIS_MAX_LOSS_BPS = 2500;
const CRISIS_MAX_GAIN_BPS = 1500;
/** EV вариантов одного сценария расходятся не более чем на 3 п.п. = 300 bps */
const EV_TOLERANCE_BPS = 300;

function ev(outcomes: { weight: number; pct_bps: number }[]): number {
  return outcomes.reduce((sum, o) => sum + (o.weight * o.pct_bps) / 100, 0);
}

const kinds = Object.keys(CRISIS_KIND_TITLES);
assert.equal(kinds.length, 6, `Ожидалось 6 видов кризисов, найдено ${kinds.length}`);

for (const kind of kinds) {
  const scenarios = CRISIS_CATALOG.filter((s) => s.kind === kind);
  assert.ok(scenarios.length >= 3, `Вид ${kind}: минимум 3 сценария, найдено ${scenarios.length}`);

  for (const scenario of scenarios) {
    const where = `${kind} / «${scenario.scenario_text.slice(0, 30)}…»`;

    assert.ok(scenario.scenario_text.trim().length >= 10, `${where}: пустой scenario_text`);
    assert.ok(
      scenario.options.length >= 2 && scenario.options.length <= 3,
      `${where}: у сценария 2-3 варианта, найдено ${scenario.options.length}`
    );

    const optionIds = scenario.options.map((o) => o.id);
    assert.equal(new Set(optionIds).size, optionIds.length, `${where}: id вариантов уникальны`);

    const optionEvs: number[] = [];
    for (const option of scenario.options) {
      const optWhere = `${where} [${option.id}]`;

      assert.ok(option.id.length > 0 && !option.id.includes(':'), `${optWhere}: id непустой и без двоеточий (попадает в custom_id)`);
      assert.ok(option.label.length > 0 && option.label.length <= 80, `${optWhere}: label 1-80 символов (лимит Discord)`);
      assert.ok(option.emoji.length > 0, `${optWhere}: нужен emoji кнопки`);
      assert.ok(option.outcomes.length >= 1, `${optWhere}: минимум один исход`);

      const weightSum = option.outcomes.reduce((sum, o) => sum + o.weight, 0);
      assert.equal(weightSum, 100, `${optWhere}: сумма weight исходов должна быть 100`);

      for (const outcome of option.outcomes) {
        assert.ok(outcome.text.trim().length > 0, `${optWhere}: пустой текст исхода`);
        assert.ok(
          outcome.pct_bps >= -CRISIS_MAX_LOSS_BPS && outcome.pct_bps <= CRISIS_MAX_GAIN_BPS,
          `${optWhere}: pct_bps ${outcome.pct_bps} вне лимитов [-${CRISIS_MAX_LOSS_BPS}; +${CRISIS_MAX_GAIN_BPS}]`
        );
      }

      optionEvs.push(ev(option.outcomes));
    }

    // EV вариантов одного сценария расходятся не более чем на 3 п.п. —
    // иначе выбор между надёжным и рискованным превращается в «всегда бери лучшее»
    const maxEv = Math.max(...optionEvs);
    const minEv = Math.min(...optionEvs);
    assert.ok(
      maxEv - minEv <= EV_TOLERANCE_BPS,
      `${where}: EV вариантов расходятся на ${maxEv - minEv} bps (лимит ${EV_TOLERANCE_BPS})`
    );

    // Молчание владельца — всегда строго хуже любого осознанного выбора
    const timeoutEv = ev([scenario.timeout]);
    assert.ok(
      timeoutEv < minEv,
      `${where}: EV таймаута (${timeoutEv}) должен быть строго хуже лучшего EV варианта (${minEv})`
    );
    assert.ok(
      scenario.timeout.pct_bps >= -CRISIS_MAX_LOSS_BPS && scenario.timeout.pct_bps <= CRISIS_MAX_GAIN_BPS,
      `${where}: таймаут вне лимитов bps`
    );
  }
}

console.log(`✓ Каталог кризисов валиден: ${kinds.length} видов, ${CRISIS_CATALOG.length} сценариев`);
