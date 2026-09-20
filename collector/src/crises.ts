// Кризисы компаний (Биржа): спавн по расписанию и разрешение по таймауту.
// Спавн (тик раз в 30 минут): кандидат выбирается взвешенно (вес = 1 + число
// внешних держателей), кризис + событие 'crisis_spawn' + слот следующего спавна
// пишутся ОДНИМ атомарным батчем с guard-ами от параллельных запусков.
// Таймаут (тик раз в минуту): просроченные pending-кризисы получают исход из
// timeout_json тем же атомарным батчем, что и обычное разрешение.
// Батч-логика дублируется в worker/src/commands/crisis.ts — keep in sync.
// Константы дублируются из worker/src/exchange/constants.ts — keep in sync.

import { Client } from 'discord.js';
import { CRISIS_CATALOG, CrisisOutcome, CrisisScenario } from './crisisCatalog';

// keep in sync with worker/src/exchange/constants.ts
const MOOD_MAX_BPS = 2500;
const MOOD_HALF_LIFE_HOURS = 18;
const CRISIS_MIN_TREASURY = 300;
const CRISIS_MAX_GAIN_COINS = 1500;
const CRISIS_LOSS_MOOD_FACTOR = 1.5;

// Интервалы и TTL переопределяются env-переменными для тестовой гильдии, например:
// CRISIS_MIN_INTERVAL_HOURS=0.01 CRISIS_MAX_INTERVAL_HOURS=0.02 CRISIS_TTL_HOURS=0.05
// CRISIS_COMPANY_COOLDOWN_HOURS=0
// keep in sync with worker/src/exchange/constants.ts
function envHours(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

const CRISIS_MIN_INTERVAL_HOURS = envHours(process.env.CRISIS_MIN_INTERVAL_HOURS, 6);
const CRISIS_MAX_INTERVAL_HOURS = envHours(process.env.CRISIS_MAX_INTERVAL_HOURS, 8);
const CRISIS_COMPANY_COOLDOWN_HOURS = envHours(process.env.CRISIS_COMPANY_COOLDOWN_HOURS, 48);
const CRISIS_TTL_HOURS = envHours(process.env.CRISIS_TTL_HOURS, 24);

// keep in sync with worker/src/exchange/math.ts
function computeEffectiveMoodLocal(moodBps: number, moodUpdatedAt: number, nowSec: number): number {
  if (!moodUpdatedAt || moodUpdatedAt >= nowSec) return Math.trunc(moodBps);
  // Ленивое затухание: mood * 0.5^(часы / период полураспада), усечение к нулю
  const hours = (nowSec - moodUpdatedAt) / 3600;
  return Math.trunc(moodBps * Math.pow(0.5, hours / MOOD_HALF_LIFE_HOURS));
}

// keep in sync with worker/src/exchange/math.ts
function crisisMoodShiftLocal(pctBps: number): number {
  if (pctBps >= 0) return pctBps;
  // Потеря усиливает панику: -|pct_bps| * CRISIS_LOSS_MOOD_FACTOR, целочисленно
  return -Math.trunc(Math.abs(pctBps) * CRISIS_LOSS_MOOD_FACTOR);
}

// keep in sync with worker/src/exchange/math.ts
function applyMoodShiftLocal(effectiveMoodBps: number, shiftBps: number): number {
  return Math.max(-MOOD_MAX_BPS, Math.min(MOOD_MAX_BPS, effectiveMoodBps + shiftBps));
}

/**
 * Дельта казны кризиса: trunc(treasury * pct_bps / 10000) с лимитами.
 * Потеря ограничена так, чтобы казна осталась >= 1 (инвариант treasury >= 1);
 * прибыль ограничена потолком в монетах и балансом резерва — деньги на прибыль
 * берутся из server_reserve, поэтому больше резерва взять нельзя.
 * keep in sync with worker/src/exchange/math.ts (computeCrisisDelta)
 */
function computeCrisisDeltaLocal(treasury: number, pctBps: number, reserveBalance: number): number {
  const raw = Math.trunc((treasury * pctBps) / 10000);
  if (raw < 0) {
    const maxLoss = Math.max(0, treasury - 1);
    return -Math.min(-raw, maxLoss);
  }
  if (raw > 0) {
    const cap = Math.min(CRISIS_MAX_GAIN_COINS, Math.max(0, Math.trunc(reserveBalance)));
    return Math.min(raw, cap);
  }
  return 0;
}

function pickRandomScenario(): CrisisScenario {
  return CRISIS_CATALOG[Math.floor(Math.random() * CRISIS_CATALOG.length)];
}

function randomIntervalSeconds(): number {
  const minH = CRISIS_MIN_INTERVAL_HOURS;
  const maxH = Math.max(minH, CRISIS_MAX_INTERVAL_HOURS);
  return Math.round((minH + Math.random() * (maxH - minH)) * 3600);
}

/**
 * Сдвигает слот следующего спавна кризиса. Условный UPSERT защищает от гонки
 * параллельных запусков: слот двигается только если его время наступило.
 */
async function shiftNextCrisisAt(db: any, guildId: string, nextAt: number, nowSec: number): Promise<void> {
  await db.execute({
    sql: `INSERT INTO exchange_guild_state (guild_id, next_crisis_at) VALUES (?, ?)
          ON CONFLICT(guild_id) DO UPDATE SET next_crisis_at = excluded.next_crisis_at
          WHERE (exchange_guild_state.next_crisis_at IS NULL OR exchange_guild_state.next_crisis_at <= ?)`,
    args: [guildId, nextAt, nowSec],
  });
}

/**
 * Спавн кризисов: для каждой гильдии с компаниями, если наступило время
 * next_crisis_at (или его ещё нет), выбирает компанию-кандидата и создаёт кризис.
 */
export async function processCompanyCrises(db: any, bot: Client): Promise<void> {
  const nowSec = Math.floor(Date.now() / 1000);

  try {
    const guildsResult = await db.execute({ sql: 'SELECT DISTINCT guild_id FROM companies', args: [] });
    const guildIds = (guildsResult.rows || []).map((r: any) => r.guild_id as string);

    for (const guildId of guildIds) {
      try {
        const stateResult = await db.execute({
          sql: 'SELECT next_crisis_at FROM exchange_guild_state WHERE guild_id = ?',
          args: [guildId],
        });
        const nextCrisisAt = stateResult.rows.length > 0 ? stateResult.rows[0].next_crisis_at : null;
        if (nextCrisisAt !== null && Number(nextCrisisAt) > nowSec) continue;

        const cooldownSec = Math.round(CRISIS_COMPANY_COOLDOWN_HOURS * 3600);
        const candidatesResult = await db.execute({
          sql: `SELECT c.id, c.owner_id, c.name, c.ticker,
                  (SELECT COUNT(*) FROM company_shares s
                    WHERE s.company_id = c.id AND s.user_id != c.owner_id AND s.shares_count > 0) AS external_holders
                FROM companies c
                WHERE c.guild_id = ?
                  AND c.frozen = 0
                  AND c.treasury >= ?
                  AND (c.total_shares - c.available_shares) > 0
                  AND NOT EXISTS (
                    SELECT 1 FROM company_crises cc
                    WHERE cc.company_id = c.id AND cc.status = 'pending'
                  )
                  AND NOT EXISTS (
                    SELECT 1 FROM company_crises cc2
                    WHERE cc2.company_id = c.id
                      AND COALESCE(cc2.resolved_at, cc2.expires_at, 0) > ?
                  )`,
          args: [guildId, CRISIS_MIN_TREASURY, nowSec - cooldownSec],
        });
        const candidates = candidatesResult.rows || [];
        const nextAt = nowSec + randomIntervalSeconds();

        if (candidates.length === 0) {
          // Кандидатов нет — просто сдвигаем слот следующего спавна
          await shiftNextCrisisAt(db, guildId, nextAt, nowSec);
          continue;
        }

        // Взвешенный выбор компании: вес = 1 + число различных внешних держателей
        const weights = candidates.map((c: any) => 1 + (Number(c.external_holders) || 0));
        const totalWeight = weights.reduce((s: number, w: number) => s + w, 0);
        let roll = Math.random() * totalWeight;
        let chosen: any = candidates[candidates.length - 1];
        for (let i = 0; i < candidates.length; i++) {
          roll -= weights[i];
          if (roll < 0) {
            chosen = candidates[i];
            break;
          }
        }

        const scenario = pickRandomScenario();
        const companyId = Number(chosen.id);
        const expiresAt = nowSec + Math.round(CRISIS_TTL_HOURS * 3600);
        // message_id в схеме NOT NULL UNIQUE: до публикации сообщения пишем уникальную
        // заглушку — реальный message_id вернёт отправитель outbox после отправки
        const placeholder = `pending:${guildId}:${companyId}:${nowSec}:${Math.random().toString(36).slice(2, 8)}`;
        const payload = {
          crisis_ref: placeholder,
          company_id: companyId,
          company_name: String(chosen.name || 'Компания'),
          ticker: String(chosen.ticker || '???'),
          owner_id: String(chosen.owner_id || ''),
          kind: scenario.kind,
          scenario_text: scenario.scenario_text,
          options: scenario.options.map((o) => ({ id: o.id, label: o.label, emoji: o.emoji })),
          expires_at: expiresAt,
        };

        // ОДИН батч: захват слота -> INSERT кризиса -> событие 'crisis_spawn' в outbox.
        // Guard-ы: если слот забрал параллельный запуск, INSERT-ы пропустятся.
        const results = await db.batch(
          [
            {
              sql: `INSERT INTO exchange_guild_state (guild_id, next_crisis_at) VALUES (?, ?)
                    ON CONFLICT(guild_id) DO UPDATE SET next_crisis_at = excluded.next_crisis_at
                    WHERE (exchange_guild_state.next_crisis_at IS NULL OR exchange_guild_state.next_crisis_at <= ?)`,
              args: [guildId, nextAt, nowSec],
            },
            {
              sql: `INSERT INTO company_crises (company_id, guild_id, channel_id, message_id, kind, scenario_text, options_json, timeout_json, status, created_at, expires_at)
                    SELECT ?, ?, '', ?, ?, ?, ?, ?, 'pending', ?, ?
                    WHERE (SELECT next_crisis_at FROM exchange_guild_state WHERE guild_id = ?) = ?`,
              args: [companyId, guildId, placeholder, scenario.kind, scenario.scenario_text, JSON.stringify(scenario.options), JSON.stringify(scenario.timeout), nowSec, expiresAt, guildId, nextAt],
            },
            {
              sql: `INSERT INTO market_events (guild_id, kind, payload_json, created_at)
                    SELECT ?, 'crisis_spawn', ?, ?
                    WHERE (SELECT id FROM company_crises WHERE message_id = ?) IS NOT NULL`,
              args: [guildId, JSON.stringify(payload), nowSec, placeholder],
            },
          ],
          'write'
        );

        if ((results[1].rowsAffected as number) === 1) {
          console.log(`[Crises] Spawned ${scenario.kind} crisis for company ${companyId} (${chosen.ticker}) in guild ${guildId}, ttl ${Math.round(CRISIS_TTL_HOURS * 60)} min`);
        } else {
          // Слот забрал параллельный запуск — ничего не делаем (идемпотентность)
          console.log(`[Crises] Guild ${guildId}: spawn slot taken by parallel run, skipped`);
        }
      } catch (e) {
        console.error('[Crises] Error processing guild', guildId, e);
      }
    }
  } catch (err) {
    console.error('[Crises] Error in processCompanyCrises:', err);
  }
}

interface CrisisApplyResult {
  applied: boolean;
  alreadyClosed: boolean;
  delta: number;
  newTreasury: number;
}

/**
 * Применяет исход кризиса одним атомарным батчем (до 3 попыток).
 * Дубликат worker/src/commands/crisis.ts — keep in sync.
 * Инвариант сохранения монет: казна +delta, резерв -delta.
 * Guard первого statement: кризис ещё pending, дедлайн в нужную сторону,
 * казна не изменилась с момента расчёта (параллельная сделка). Остальные
 * statement-ы выполняются только если захват кризиса удался и дельта совпадает.
 */
async function applyCrisisOutcome(
  db: any,
  crisis: any,
  outcome: CrisisOutcome,
  finalStatus: 'resolved' | 'expired',
  expiryOp: '>' | '<=',
  resolvedOption: string | null,
  resolvedBy: 'owner' | 'timeout'
): Promise<CrisisApplyResult> {
  const nowSec = Math.floor(Date.now() / 1000);
  const crisisId = Number(crisis.id);
  const companyId = Number(crisis.company_id);
  const guildId = String(crisis.guild_id);
  const empty: CrisisApplyResult = { applied: false, alreadyClosed: false, delta: 0, newTreasury: 0 };

  for (let attempt = 0; attempt < 3; attempt++) {
    // Свежий срез состояния: между расчётом и батчем могла пройти сделка
    const compRes = await db.execute({
      sql: 'SELECT treasury, total_shares, available_shares, mood_bps, mood_updated_at FROM companies WHERE id = ?',
      args: [companyId],
    });
    if (compRes.rows.length === 0) {
      // Компания удалена (например, сезонной ликвидацией)
      return { ...empty, alreadyClosed: true };
    }
    const prevTreasury = Number(compRes.rows[0].treasury) || 0;
    const circulating = (Number(compRes.rows[0].total_shares) || 100) - (Number(compRes.rows[0].available_shares) || 0);

    const reserveRes = await db.execute({
      sql: 'SELECT balance FROM server_reserve WHERE guild_id = ?',
      args: [guildId],
    });
    const reserveBalance = reserveRes.rows.length > 0 ? Number(reserveRes.rows[0].balance) || 0 : 0;

    const delta = computeCrisisDeltaLocal(prevTreasury, outcome.pct_bps, reserveBalance);
    const newTreasury = prevTreasury + delta;

    // Настроение: считаем от эффективного (затухшего) значения, пишем новой точкой
    const effMood = computeEffectiveMoodLocal(
      Number(compRes.rows[0].mood_bps) || 0,
      Number(compRes.rows[0].mood_updated_at) || 0,
      nowSec
    );
    const newMood = applyMoodShiftLocal(effMood, crisisMoodShiftLocal(outcome.pct_bps));

    const feedPayload = JSON.stringify({
      company_id: companyId,
      companyName: String(crisis.company_name || ''),
      ticker: String(crisis.ticker || ''),
      text: `**${crisis.ticker}**: ${outcome.text} (казна ${delta >= 0 ? '+' : ''}${delta} 🪙)`,
      resolved_by: resolvedBy,
    });

    const results = await db.batch(
      [
        {
          sql: `UPDATE company_crises
                SET status = ?, resolved_option = ?, resolved_at = ?, outcome_text = ?, treasury_delta = ?
                WHERE id = ? AND status = 'pending' AND expires_at ${expiryOp} ?
                  AND (SELECT treasury FROM companies WHERE id = ?) = ?`,
          args: [finalStatus, resolvedOption, nowSec, outcome.text, delta, crisisId, nowSec, companyId, prevTreasury],
        },
        {
          sql: `UPDATE companies
                SET treasury = treasury + ?, mood_bps = ?, mood_updated_at = ?
                WHERE id = ?
                  AND (SELECT status FROM company_crises WHERE id = ?) = ?
                  AND (SELECT treasury_delta FROM company_crises WHERE id = ?) = ?`,
          args: [delta, newMood, nowSec, companyId, crisisId, finalStatus, crisisId, delta],
        },
        {
          sql: `INSERT INTO server_reserve (guild_id, balance) VALUES (?, ?)
                ON CONFLICT(guild_id) DO UPDATE SET balance = balance + excluded.balance
                WHERE (SELECT status FROM company_crises WHERE id = ?) = ?
                  AND (SELECT treasury_delta FROM company_crises WHERE id = ?) = ?`,
          args: [guildId, -delta, crisisId, finalStatus, crisisId, delta],
        },
        {
          sql: `INSERT INTO company_nav_history (guild_id, company_id, ts, treasury, circulating, mood_bps, reason)
                SELECT ?, ?, ?, ?, ?, ?, 'crisis'
                WHERE (SELECT status FROM company_crises WHERE id = ?) = ?
                  AND (SELECT treasury_delta FROM company_crises WHERE id = ?) = ?`,
          args: [guildId, companyId, nowSec, newTreasury, circulating, newMood, crisisId, finalStatus, crisisId, delta],
        },
        {
          sql: `INSERT INTO market_events (guild_id, kind, payload_json, created_at)
                SELECT ?, 'crisis_resolved', ?, ?
                WHERE (SELECT status FROM company_crises WHERE id = ?) = ?
                  AND (SELECT treasury_delta FROM company_crises WHERE id = ?) = ?`,
          args: [guildId, feedPayload, nowSec, crisisId, finalStatus, crisisId, delta],
        },
      ],
      'write'
    );

    if ((results[0].rowsAffected as number) === 1) {
      return { applied: true, alreadyClosed: false, delta, newTreasury };
    }

    // Батч прошёл вхолостую: кризис уже закрыт кем-то другим или казна изменилась
    const re = await db.execute({
      sql: 'SELECT status FROM company_crises WHERE id = ?',
      args: [crisisId],
    });
    if (String(re.rows[0]?.status || '') !== 'pending') {
      return { ...empty, alreadyClosed: true };
    }
    // Казна изменилась между расчётом и батчем — пересчёт и повтор (до 3 раз)
  }

  return empty;
}

/**
 * Таймауты кризисов (тик раз в минуту): все pending с истёкшим дедлайном
 * получают исход из timeout_json тем же атомарным батчем, статус 'expired'.
 * Повторный запуск ничего не дублирует: SELECT берёт только pending.
 */
export async function processCrisisTimeouts(db: any, bot: Client): Promise<void> {
  const nowSec = Math.floor(Date.now() / 1000);

  try {
    const dueResult = await db.execute({
      sql: `SELECT cc.*, c.name AS company_name, c.ticker, c.owner_id
            FROM company_crises cc
            JOIN companies c ON c.id = cc.company_id
            WHERE cc.status = 'pending' AND cc.expires_at <= ?`,
      args: [nowSec],
    });

    for (const crisis of dueResult.rows || []) {
      try {
        let timeout: CrisisOutcome | null = null;
        try {
          const parsed = JSON.parse(String(crisis.timeout_json || 'null'));
          if (parsed && typeof parsed.pct_bps === 'number' && typeof parsed.text === 'string') {
            timeout = parsed as CrisisOutcome;
          }
        } catch {
          timeout = null;
        }
        if (!timeout) {
          // Битый timeout_json: закрываем без денег, чтобы кризис не завис навсегда
          timeout = { weight: 100, pct_bps: 0, text: 'Кризис закрыт по таймауту без последствий.' };
        }

        // Исход по таймауту применяется как записан в каталоге (худший, без случайности)
        const result = await applyCrisisOutcome(db, crisis, timeout, 'expired', '<=', null, 'timeout');
        if (!result.applied) continue; // Уже закрыт параллельным процессом — идемпотентно

        // Редактирование сообщения — после коммита; сбой Discord не откатывает исход
        await editCrisisMessageAfterTimeout(bot, crisis, timeout, result);
        console.log(`[Crises] Crisis ${crisis.id} expired: treasury ${result.delta >= 0 ? '+' : ''}${result.delta}`);
      } catch (e) {
        console.error('[Crises] Error resolving timeout for crisis', crisis.id, e);
      }
    }
  } catch (err) {
    console.error('[Crises] Error in processCrisisTimeouts:', err);
  }
}

/**
 * Убирает кнопки и показывает исход в исходном сообщении кризиса (через REST
 * средствами discord.js, как в checkExpiredDuels). Сбой не бросает исключение.
 */
async function editCrisisMessageAfterTimeout(
  bot: Client,
  crisis: any,
  outcome: CrisisOutcome,
  result: CrisisApplyResult
): Promise<void> {
  try {
    const channelId = String(crisis.channel_id || '');
    const messageId = String(crisis.message_id || '');
    // Сообщение могло ещё не опубликоваться (message_id — заглушка спавна)
    if (!channelId || !messageId || messageId.startsWith('pending:')) return;

    const guild = bot.guilds.cache.get(String(crisis.guild_id));
    if (!guild) return;
    const channel: any = guild.channels.cache.get(channelId);
    if (!channel || channel.type !== 0) return;

    const embed = {
      embeds: [{
        title: `⌛ Время вышло: ${crisis.company_name} (${crisis.ticker})`.slice(0, 256),
        description: `${outcome.text}\n\nРешение не было выбрано вовремя — применён исход по умолчанию.`,
        color: 0xE74C3C,
        fields: [
          {
            name: 'Казна',
            value: `**${result.newTreasury.toLocaleString('ru-RU')} 🪙** (${result.delta >= 0 ? '+' : ''}${result.delta})`,
            inline: true,
          },
        ],
      }],
      components: [],
    };

    const message = await channel.messages.fetch(messageId);
    await message.edit(embed);
  } catch (e) {
    console.error('[Crises] Failed to edit crisis message after timeout:', e);
  }
}

/**
 * Публикует сообщение кризиса (embed + кнопки вариантов) из outbox-события
 * 'crisis_spawn' и записывает channel_id/message_id обратно в company_crises.
 * Возвращает false, если кризис уже удалён (например, сезонной ликвидацией) —
 * событие помечается доставленным, чтобы не блокировать очередь.
 */
export async function sendCrisisSpawnEvent(db: any, channel: any, payload: any): Promise<boolean> {
  const crisisRef = String(payload?.crisis_ref || '');

  let crisisId: number | null = null;
  if (crisisRef) {
    const lookup = await db.execute({
      sql: 'SELECT id FROM company_crises WHERE message_id = ?',
      args: [crisisRef],
    });
    crisisId = (lookup.rows[0]?.id as number) || null;
  }
  if (!crisisId) {
    return false;
  }

  const ownerId = String(payload.owner_id || '');
  const buttons = (Array.isArray(payload.options) ? payload.options : [])
    .slice(0, 5) // Лимит Discord: максимум 5 кнопок в ряду
    .map((o: any) => ({
      type: 2, // Button
      style: 1, // Primary
      custom_id: `crisis:${crisisId}:${String(o.id)}`,
      label: String(o.label || '').slice(0, 80), // Лимит Discord: 80 символов
      emoji: { name: String(o.emoji || '⚖️') },
    }));

  const messagePayload = {
    embeds: [{
      title: `🚨 Кризис: ${String(payload.company_name || 'Компания')} (${String(payload.ticker || '???')})`.slice(0, 256),
      description: `${String(payload.scenario_text || '')}\n\nРешение принимает <@${ownerId}> • дедлайн: <t:${Number(payload.expires_at) || 0}:R>`,
      color: 0xE74C3C,
    }],
    components: buttons.length > 0 ? [{ type: 1, components: buttons }] : [],
    // Упоминание владельца — только через allowed_mentions.users (без массовых пингов)
    allowed_mentions: { parse: [], users: ownerId ? [ownerId] : [] },
  };

  const message = await channel.send(messagePayload);

  // Writeback после успешной отправки; только для ещё незакрытых кризисов
  await db.execute({
    sql: "UPDATE company_crises SET channel_id = ?, message_id = ? WHERE id = ? AND status = 'pending'",
    args: [channel.id, message.id, crisisId],
  });
  return true;
}
