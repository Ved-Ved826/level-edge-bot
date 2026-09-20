// Обработчик кнопок кризисов компаний (Биржа).
// custom_id: crisis:<crisisId>:<optionId>.
// Правила: решает только владелец; исход выбирается на сервере взвешенным
// случайным выбором; деньги идут через server_reserve (инвариант сохранения
// монет); применение — один атомарный db.batch с guard-ами.
// Батч-логика дублируется в collector/src/crises.ts (таймауты) — keep in sync.

import { createClient } from "@libsql/client";
import { ButtonInteraction, Env, ExecutionContext } from "../types";
import { CRISIS_MAX_GAIN_COINS } from "../exchange/constants";
import {
  applyMoodShift,
  computeCrisisDelta,
  computeEffectiveMood,
  crisisMoodShift,
  pickWeightedOutcome,
} from "../exchange/math";

interface CrisisOutcomeJson {
  weight: number;
  pct_bps: number;
  text: string;
}

interface CrisisOptionJson {
  id: string;
  label: string;
  emoji: string;
  outcomes: CrisisOutcomeJson[];
}

const EPHEMERAL_FLAGS = 64;

function ephemeral(content: string): Response {
  return Response.json({ type: 4, data: { content, flags: EPHEMERAL_FLAGS } });
}

interface CrisisApplyResult {
  applied: boolean;
  alreadyClosed: boolean;
  delta: number;
  prevTreasury: number;
  newTreasury: number;
  circulating: number;
}

/**
 * Применяет исход кризиса одним атомарным батчем (до 3 попыток).
 * Guard первого statement: кризис ещё pending, дедлайн не прошёл, казна не
 * изменилась с момента расчёта (параллельная сделка). Остальные statement-ы
 * выполняются только если захват кризиса удался и дельта совпадает.
 */
async function applyCrisisOutcomeBatch(
  db: any,
  crisis: any,
  resolvedOption: string,
  outcome: CrisisOutcomeJson
): Promise<CrisisApplyResult> {
  const nowSec = Math.floor(Date.now() / 1000);
  const crisisId = Number(crisis.id);
  const companyId = Number(crisis.company_id);
  const guildId = String(crisis.guild_id);
  const empty: CrisisApplyResult = { applied: false, alreadyClosed: false, delta: 0, prevTreasury: 0, newTreasury: 0, circulating: 0 };

  for (let attempt = 0; attempt < 3; attempt++) {
    // Свежий срез состояния компании: между расчётом и батчем могла пройти сделка
    const compRes = await db.execute({
      sql: "SELECT treasury, total_shares, available_shares, mood_bps, mood_updated_at FROM companies WHERE id = ?",
      args: [companyId],
    });
    if (compRes.rows.length === 0) {
      // Компания удалена (например, сезонной ликвидацией)
      return { ...empty, alreadyClosed: true };
    }
    const prevTreasury = Number(compRes.rows[0].treasury) || 0;
    const circulating = (Number(compRes.rows[0].total_shares) || 100) - (Number(compRes.rows[0].available_shares) || 0);

    const reserveRes = await db.execute({
      sql: "SELECT balance FROM server_reserve WHERE guild_id = ?",
      args: [guildId],
    });
    const reserveBalance = reserveRes.rows.length > 0 ? Number(reserveRes.rows[0].balance) || 0 : 0;

    // Дельта с лимитами: потеря держит казну >= 1, прибыль ограничена резервом
    const { delta, newTreasury } = computeCrisisDelta(prevTreasury, outcome.pct_bps, reserveBalance, CRISIS_MAX_GAIN_COINS);

    // Настроение: от эффективного (затухшего) значения, записываем новой точкой
    const effMood = computeEffectiveMood(
      Number(compRes.rows[0].mood_bps) || 0,
      Number(compRes.rows[0].mood_updated_at) || 0,
      nowSec
    );
    const newMood = applyMoodShift(effMood, crisisMoodShift(outcome.pct_bps));

    const feedPayload = JSON.stringify({
      company_id: companyId,
      companyName: String(crisis.company_name || ""),
      ticker: String(crisis.ticker || ""),
      text: `**${crisis.ticker}**: ${outcome.text} (казна ${delta >= 0 ? "+" : ""}${delta} 🪙)`,
      resolved_by: "owner",
    });

    const results = await db.batch(
      [
        {
          // (1) Захват кризиса: pending, дедлайн не прошёл, казна не изменилась с расчёта
          sql: `UPDATE company_crises
                SET status = 'resolved', resolved_option = ?, resolved_at = ?, outcome_text = ?, treasury_delta = ?
                WHERE id = ? AND status = 'pending' AND expires_at > ?
                  AND (SELECT treasury FROM companies WHERE id = ?) = ?`,
          args: [resolvedOption, nowSec, outcome.text, delta, crisisId, nowSec, companyId, prevTreasury],
        },
        {
          // (2) Казна и настроение — только если (1) сработал и дельта совпадает
          sql: `UPDATE companies
                SET treasury = treasury + ?, mood_bps = ?, mood_updated_at = ?
                WHERE id = ?
                  AND (SELECT status FROM company_crises WHERE id = ?) = 'resolved'
                  AND (SELECT treasury_delta FROM company_crises WHERE id = ?) = ?`,
          args: [delta, newMood, nowSec, companyId, crisisId, crisisId, delta],
        },
        {
          // (3) Резерв зеркально: потеря пополняет резерв, прибыль берётся из него
          sql: `INSERT INTO server_reserve (guild_id, balance) VALUES (?, ?)
                ON CONFLICT(guild_id) DO UPDATE SET balance = balance + excluded.balance
                WHERE (SELECT status FROM company_crises WHERE id = ?) = 'resolved'
                  AND (SELECT treasury_delta FROM company_crises WHERE id = ?) = ?`,
          args: [guildId, -delta, crisisId, crisisId, delta],
        },
        {
          // (4) История NAV (reason='crisis') — в том же батче
          sql: `INSERT INTO company_nav_history (guild_id, company_id, ts, treasury, circulating, mood_bps, reason)
                SELECT ?, ?, ?, ?, ?, ?, 'crisis'
                WHERE (SELECT status FROM company_crises WHERE id = ?) = 'resolved'
                  AND (SELECT treasury_delta FROM company_crises WHERE id = ?) = ?`,
          args: [guildId, companyId, nowSec, newTreasury, circulating, newMood, crisisId, crisisId, delta],
        },
        {
          // (5) Событие в ленту — в том же батче, что и исход
          sql: `INSERT INTO market_events (guild_id, kind, payload_json, created_at)
                SELECT ?, 'crisis_resolved', ?, ?
                WHERE (SELECT status FROM company_crises WHERE id = ?) = 'resolved'
                  AND (SELECT treasury_delta FROM company_crises WHERE id = ?) = ?`,
          args: [guildId, feedPayload, nowSec, crisisId, crisisId, delta],
        },
      ],
      "write"
    );

    if ((results[0].rowsAffected as number) === 1) {
      return { applied: true, alreadyClosed: false, delta, prevTreasury, newTreasury, circulating };
    }

    // Батч прошёл вхолостую: кризис уже закрыт или казна изменилась — проверяем статус
    const re = await db.execute({
      sql: "SELECT status FROM company_crises WHERE id = ?",
      args: [crisisId],
    });
    if (String(re.rows[0]?.status || "") !== "pending") {
      return { ...empty, alreadyClosed: true };
    }
    // Казна изменилась между расчётом и батчем — пересчёт и повтор (до 3 раз)
  }

  return empty;
}

export async function handleCrisisResolve(inter: ButtonInteraction, env: Env, _ctx: ExecutionContext): Promise<Response> {
  const db = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });

  // Разбор custom_id: crisis:<crisisId>:<optionId>
  const parts = inter.data.custom_id.split(":");
  if (parts.length !== 3 || parts[0] !== "crisis") {
    return ephemeral("Неизвестная кнопка кризиса.");
  }
  const crisisId = Number(parts[1]);
  const optionId = parts[2];
  if (!Number.isInteger(crisisId) || crisisId <= 0 || !optionId) {
    return ephemeral("Неизвестная кнопка кризиса.");
  }

  const raw: any = inter;
  const userId: string = raw?.member?.user?.id || raw?.user?.id || "";

  const crisisRes = await db.execute({
    sql: `SELECT cc.id, cc.guild_id, cc.company_id, cc.status, cc.expires_at, cc.options_json,
                 c.owner_id, c.name AS company_name, c.ticker
          FROM company_crises cc
          JOIN companies c ON c.id = cc.company_id
          WHERE cc.id = ?`,
    args: [crisisId],
  });
  if (crisisRes.rows.length === 0) {
    // Кризис удалён (например, сезонной ликвидацией компаний)
    return ephemeral("Кризис уже закрыт");
  }
  const crisis: any = crisisRes.rows[0];

  // Решение принимает только владелец компании
  if (!userId || userId !== String(crisis.owner_id)) {
    return ephemeral("Решает только владелец компании");
  }

  const nowSec = Math.floor(Date.now() / 1000);
  // Уже не pending / истёк — исход применит таймаут-задача collector'а
  if (String(crisis.status) !== "pending" || Number(crisis.expires_at) <= nowSec) {
    return ephemeral("Кризис уже закрыт");
  }

  let options: CrisisOptionJson[] = [];
  try {
    options = JSON.parse(String(crisis.options_json || "[]"));
  } catch {
    options = [];
  }
  const option = options.find((o) => o && o.id === optionId);
  if (!option || !Array.isArray(option.outcomes) || option.outcomes.length === 0) {
    return ephemeral("Вариант не найден");
  }

  // Исход выбирается на сервере один раз; ретраи пересчитывают только дельту
  const outcome = pickWeightedOutcome(option.outcomes);

  const result = await applyCrisisOutcomeBatch(db, crisis, option.id, outcome);
  if (result.applied) {
    const sign = result.delta >= 0 ? "+" : "";
    const navBefore = result.circulating > 0 ? result.prevTreasury / result.circulating : 0;
    const navAfter = result.circulating > 0 ? result.newTreasury / result.circulating : 0;

    // Ответ type 7 (UPDATE_MESSAGE): убираем кнопки и показываем исход
    return Response.json({
      type: 7,
      data: {
        embeds: [
          {
            title: `${option.emoji} Решение принято: ${option.label}`.slice(0, 256),
            description: outcome.text,
            color: result.delta >= 0 ? 0x2ECC71 : 0xE74C3C,
            fields: [
              {
                name: "Казна",
                value: `${result.prevTreasury.toLocaleString("ru-RU")} → **${result.newTreasury.toLocaleString("ru-RU")} 🪙** (${sign}${result.delta})`,
                inline: true,
              },
              { name: "NAV", value: `${navBefore.toFixed(2)} → **${navAfter.toFixed(2)} 🪙**`, inline: true },
            ],
            footer: { text: `${crisis.company_name} (${crisis.ticker})` },
          },
        ],
        components: [],
        allowed_mentions: { parse: [] },
      },
    });
  }
  if (result.alreadyClosed) {
    return ephemeral("Кризис уже закрыт");
  }
  // Три попытки не прошли из-за параллельных сделок или истёкшего дедлайна
  const finalCheck = await db.execute({
    sql: "SELECT status, expires_at FROM company_crises WHERE id = ?",
    args: [crisisId],
  });
  const finalRow = finalCheck.rows[0];
  if (!finalRow || String(finalRow.status) !== "pending" || Number(finalRow.expires_at) <= Math.floor(Date.now() / 1000)) {
    return ephemeral("Кризис уже закрыт");
  }
  return ephemeral("Не удалось применить решение из-за активности на бирже — попробуйте ещё раз.");
}
