// РљСЂРёР·РёСЃС‹ РєРѕРјРїР°РЅРёР№ (Р‘РёСЂР¶Р°): СЃРїР°РІРЅ РїРѕ СЂР°СЃРїРёСЃР°РЅРёСЋ Рё СЂР°Р·СЂРµС€РµРЅРёРµ РїРѕ С‚Р°Р№РјР°СѓС‚Сѓ.
// РЎРїР°РІРЅ (С‚РёРє СЂР°Р· РІ 30 РјРёРЅСѓС‚): РєР°РЅРґРёРґР°С‚ РІС‹Р±РёСЂР°РµС‚СЃСЏ РІР·РІРµС€РµРЅРЅРѕ (РІРµСЃ = 1 + С‡РёСЃР»Рѕ
// РІРЅРµС€РЅРёС… РґРµСЂР¶Р°С‚РµР»РµР№), РєСЂРёР·РёСЃ + СЃРѕР±С‹С‚РёРµ 'crisis_spawn' + СЃР»РѕС‚ СЃР»РµРґСѓСЋС‰РµРіРѕ СЃРїР°РІРЅР°
// РїРёС€СѓС‚СЃСЏ РћР”РќРРњ Р°С‚РѕРјР°СЂРЅС‹Рј Р±Р°С‚С‡РµРј СЃ guard-Р°РјРё РѕС‚ РїР°СЂР°Р»Р»РµР»СЊРЅС‹С… Р·Р°РїСѓСЃРєРѕРІ.
// РўР°Р№РјР°СѓС‚ (С‚РёРє СЂР°Р· РІ РјРёРЅСѓС‚Сѓ): РїСЂРѕСЃСЂРѕС‡РµРЅРЅС‹Рµ pending-РєСЂРёР·РёСЃС‹ РїРѕР»СѓС‡Р°СЋС‚ РёСЃС…РѕРґ РёР·
// timeout_json С‚РµРј Р¶Рµ Р°С‚РѕРјР°СЂРЅС‹Рј Р±Р°С‚С‡РµРј, С‡С‚Рѕ Рё РѕР±С‹С‡РЅРѕРµ СЂР°Р·СЂРµС€РµРЅРёРµ.
// Р‘Р°С‚С‡-Р»РѕРіРёРєР° РґСѓР±Р»РёСЂСѓРµС‚СЃСЏ РІ worker/src/commands/crisis.ts вЂ” keep in sync.
// РљРѕРЅСЃС‚Р°РЅС‚С‹ РґСѓР±Р»РёСЂСѓСЋС‚СЃСЏ РёР· worker/src/exchange/constants.ts вЂ” keep in sync.

import { Client } from 'discord.js';
import { CRISIS_CATALOG, CrisisOutcome, CrisisScenario } from './crisisCatalog.js';

// keep in sync with worker/src/exchange/constants.ts
const MOOD_MAX_BPS = 2500;
const MOOD_HALF_LIFE_HOURS = 18;
const CRISIS_MIN_TREASURY = 300;
const CRISIS_MAX_GAIN_COINS = 1500;
const CRISIS_LOSS_MOOD_FACTOR = 1.5;

// РРЅС‚РµСЂРІР°Р»С‹ Рё TTL РїРµСЂРµРѕРїСЂРµРґРµР»СЏСЋС‚СЃСЏ env-РїРµСЂРµРјРµРЅРЅС‹РјРё РґР»СЏ С‚РµСЃС‚РѕРІРѕР№ РіРёР»СЊРґРёРё, РЅР°РїСЂРёРјРµСЂ:
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
  // Р›РµРЅРёРІРѕРµ Р·Р°С‚СѓС…Р°РЅРёРµ: mood * 0.5^(С‡Р°СЃС‹ / РїРµСЂРёРѕРґ РїРѕР»СѓСЂР°СЃРїР°РґР°), СѓСЃРµС‡РµРЅРёРµ Рє РЅСѓР»СЋ
  const hours = (nowSec - moodUpdatedAt) / 3600;
  return Math.trunc(moodBps * Math.pow(0.5, hours / MOOD_HALF_LIFE_HOURS));
}

// keep in sync with worker/src/exchange/math.ts
function crisisMoodShiftLocal(pctBps: number): number {
  if (pctBps >= 0) return pctBps;
  // РџРѕС‚РµСЂСЏ СѓСЃРёР»РёРІР°РµС‚ РїР°РЅРёРєСѓ: -|pct_bps| * CRISIS_LOSS_MOOD_FACTOR, С†РµР»РѕС‡РёСЃР»РµРЅРЅРѕ
  return -Math.trunc(Math.abs(pctBps) * CRISIS_LOSS_MOOD_FACTOR);
}

// keep in sync with worker/src/exchange/math.ts
function applyMoodShiftLocal(effectiveMoodBps: number, shiftBps: number): number {
  return Math.max(-MOOD_MAX_BPS, Math.min(MOOD_MAX_BPS, effectiveMoodBps + shiftBps));
}

/**
 * Р”РµР»СЊС‚Р° РєР°Р·РЅС‹ РєСЂРёР·РёСЃР°: trunc(treasury * pct_bps / 10000) СЃ Р»РёРјРёС‚Р°РјРё.
 * РџРѕС‚РµСЂСЏ РѕРіСЂР°РЅРёС‡РµРЅР° С‚Р°Рє, С‡С‚РѕР±С‹ РєР°Р·РЅР° РѕСЃС‚Р°Р»Р°СЃСЊ >= 1 (РёРЅРІР°СЂРёР°РЅС‚ treasury >= 1);
 * РїСЂРёР±С‹Р»СЊ РѕРіСЂР°РЅРёС‡РµРЅР° РїРѕС‚РѕР»РєРѕРј РІ РјРѕРЅРµС‚Р°С… Рё Р±Р°Р»Р°РЅСЃРѕРј СЂРµР·РµСЂРІР° вЂ” РґРµРЅСЊРіРё РЅР° РїСЂРёР±С‹Р»СЊ
 * Р±РµСЂСѓС‚СЃСЏ РёР· server_reserve, РїРѕСЌС‚РѕРјСѓ Р±РѕР»СЊС€Рµ СЂРµР·РµСЂРІР° РІР·СЏС‚СЊ РЅРµР»СЊР·СЏ.
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
 * РЎРґРІРёРіР°РµС‚ СЃР»РѕС‚ СЃР»РµРґСѓСЋС‰РµРіРѕ СЃРїР°РІРЅР° РєСЂРёР·РёСЃР°. РЈСЃР»РѕРІРЅС‹Р№ UPSERT Р·Р°С‰РёС‰Р°РµС‚ РѕС‚ РіРѕРЅРєРё
 * РїР°СЂР°Р»Р»РµР»СЊРЅС‹С… Р·Р°РїСѓСЃРєРѕРІ: СЃР»РѕС‚ РґРІРёРіР°РµС‚СЃСЏ С‚РѕР»СЊРєРѕ РµСЃР»Рё РµРіРѕ РІСЂРµРјСЏ РЅР°СЃС‚СѓРїРёР»Рѕ.
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
 * РЎРїР°РІРЅ РєСЂРёР·РёСЃРѕРІ: РґР»СЏ РєР°Р¶РґРѕР№ РіРёР»СЊРґРёРё СЃ РєРѕРјРїР°РЅРёСЏРјРё, РµСЃР»Рё РЅР°СЃС‚СѓРїРёР»Рѕ РІСЂРµРјСЏ
 * next_crisis_at (РёР»Рё РµРіРѕ РµС‰С‘ РЅРµС‚), РІС‹Р±РёСЂР°РµС‚ РєРѕРјРїР°РЅРёСЋ-РєР°РЅРґРёРґР°С‚Р° Рё СЃРѕР·РґР°С‘С‚ РєСЂРёР·РёСЃ.
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
          // РљР°РЅРґРёРґР°С‚РѕРІ РЅРµС‚ вЂ” РїСЂРѕСЃС‚Рѕ СЃРґРІРёРіР°РµРј СЃР»РѕС‚ СЃР»РµРґСѓСЋС‰РµРіРѕ СЃРїР°РІРЅР°
          await shiftNextCrisisAt(db, guildId, nextAt, nowSec);
          continue;
        }

        // Р’Р·РІРµС€РµРЅРЅС‹Р№ РІС‹Р±РѕСЂ РєРѕРјРїР°РЅРёРё: РІРµСЃ = 1 + С‡РёСЃР»Рѕ СЂР°Р·Р»РёС‡РЅС‹С… РІРЅРµС€РЅРёС… РґРµСЂР¶Р°С‚РµР»РµР№
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
        // message_id РІ СЃС…РµРјРµ NOT NULL UNIQUE: РґРѕ РїСѓР±Р»РёРєР°С†РёРё СЃРѕРѕР±С‰РµРЅРёСЏ РїРёС€РµРј СѓРЅРёРєР°Р»СЊРЅСѓСЋ
        // Р·Р°РіР»СѓС€РєСѓ вЂ” СЂРµР°Р»СЊРЅС‹Р№ message_id РІРµСЂРЅС‘С‚ РѕС‚РїСЂР°РІРёС‚РµР»СЊ outbox РїРѕСЃР»Рµ РѕС‚РїСЂР°РІРєРё
        const placeholder = `pending:${guildId}:${companyId}:${nowSec}:${Math.random().toString(36).slice(2, 8)}`;
        const payload = {
          crisis_ref: placeholder,
          company_id: companyId,
          company_name: String(chosen.name || 'РљРѕРјРїР°РЅРёСЏ'),
          ticker: String(chosen.ticker || '???'),
          owner_id: String(chosen.owner_id || ''),
          kind: scenario.kind,
          scenario_text: scenario.scenario_text,
          options: scenario.options.map((o: any) => ({ id: o.id, label: o.label, emoji: o.emoji })),
          expires_at: expiresAt,
        };

        // РћР”РРќ Р±Р°С‚С‡: Р·Р°С…РІР°С‚ СЃР»РѕС‚Р° -> INSERT РєСЂРёР·РёСЃР° -> СЃРѕР±С‹С‚РёРµ 'crisis_spawn' РІ outbox.
        // Guard-С‹: РµСЃР»Рё СЃР»РѕС‚ Р·Р°Р±СЂР°Р» РїР°СЂР°Р»Р»РµР»СЊРЅС‹Р№ Р·Р°РїСѓСЃРє, INSERT-С‹ РїСЂРѕРїСѓСЃС‚СЏС‚СЃСЏ.
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
          // РЎР»РѕС‚ Р·Р°Р±СЂР°Р» РїР°СЂР°Р»Р»РµР»СЊРЅС‹Р№ Р·Р°РїСѓСЃРє вЂ” РЅРёС‡РµРіРѕ РЅРµ РґРµР»Р°РµРј (РёРґРµРјРїРѕС‚РµРЅС‚РЅРѕСЃС‚СЊ)
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
 * РџСЂРёРјРµРЅСЏРµС‚ РёСЃС…РѕРґ РєСЂРёР·РёСЃР° РѕРґРЅРёРј Р°С‚РѕРјР°СЂРЅС‹Рј Р±Р°С‚С‡РµРј (РґРѕ 3 РїРѕРїС‹С‚РѕРє).
 * Р”СѓР±Р»РёРєР°С‚ worker/src/commands/crisis.ts вЂ” keep in sync.
 * РРЅРІР°СЂРёР°РЅС‚ СЃРѕС…СЂР°РЅРµРЅРёСЏ РјРѕРЅРµС‚: РєР°Р·РЅР° +delta, СЂРµР·РµСЂРІ -delta.
 * Guard РїРµСЂРІРѕРіРѕ statement: РєСЂРёР·РёСЃ РµС‰С‘ pending, РґРµРґР»Р°Р№РЅ РІ РЅСѓР¶РЅСѓСЋ СЃС‚РѕСЂРѕРЅСѓ,
 * РєР°Р·РЅР°, mood_bps Рё mood_updated_at РЅРµ РёР·РјРµРЅРёР»РёСЃСЊ СЃ РјРѕРјРµРЅС‚Р° СЂР°СЃС‡С‘С‚Р°
 * (РїР°СЂР°Р»Р»РµР»СЊРЅР°СЏ СЃРґРµР»РєР° РґРІРёРіР°РµС‚ РЅР°СЃС‚СЂРѕРµРЅРёРµ вЂ” РёРЅР°С‡Рµ Р±Р°С‚С‡ РїРµСЂРµР·Р°РїРёСЃР°Р» Р±С‹ РµС‘ СЃРґРІРёРі).
 * РћСЃС‚Р°Р»СЊРЅС‹Рµ statement-С‹ РІС‹РїРѕР»РЅСЏСЋС‚СЃСЏ С‚РѕР»СЊРєРѕ РµСЃР»Рё Р·Р°С…РІР°С‚ РєСЂРёР·РёСЃР° СѓРґР°Р»СЃСЏ Рё РґРµР»СЊС‚Р° СЃРѕРІРїР°РґР°РµС‚.
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
    // РЎРІРµР¶РёР№ СЃСЂРµР· СЃРѕСЃС‚РѕСЏРЅРёСЏ: РјРµР¶РґСѓ СЂР°СЃС‡С‘С‚РѕРј Рё Р±Р°С‚С‡РµРј РјРѕРіР»Р° РїСЂРѕР№С‚Рё СЃРґРµР»РєР°
    const compRes = await db.execute({
      sql: 'SELECT treasury, total_shares, available_shares, mood_bps, mood_updated_at FROM companies WHERE id = ?',
      args: [companyId],
    });
    if (compRes.rows.length === 0) {
      // РљРѕРјРїР°РЅРёСЏ СѓРґР°Р»РµРЅР° (РЅР°РїСЂРёРјРµСЂ, СЃРµР·РѕРЅРЅРѕР№ Р»РёРєРІРёРґР°С†РёРµР№)
      return { ...empty, alreadyClosed: true };
    }
    const prevTreasury = Number(compRes.rows[0].treasury) || 0;
    const circulating = (Number(compRes.rows[0].total_shares) || 100) - (Number(compRes.rows[0].available_shares) || 0);
    // РЎС‹СЂС‹Рµ Р·РЅР°С‡РµРЅРёСЏ РЅР°СЃС‚СЂРѕРµРЅРёСЏ РґР»СЏ guard: РµСЃР»Рё РјРµР¶РґСѓ С‡С‚РµРЅРёРµРј Рё Р±Р°С‚С‡РµРј РїСЂРѕС€Р»Р°
    // СЃРґРµР»РєР° (РѕРЅР° РїРёС€РµС‚ mood_bps/mood_updated_at), Р±Р°С‚С‡ РїСЂРѕРјР°С…РЅС‘С‚СЃСЏ Рё РїРѕР№РґС‘С‚
    // РЅР° РїРµСЂРµСЃС‡С‘С‚, Р° РЅРµ РїРµСЂРµР·Р°РїРёС€РµС‚ СЃРґРІРёРі РЅР°СЃС‚СЂРѕРµРЅРёСЏ РѕС‚ СЃРґРµР»РєРё
    const rawMoodBps = compRes.rows[0].mood_bps ?? null;
    const rawMoodUpdatedAt = compRes.rows[0].mood_updated_at ?? null;

    const reserveRes = await db.execute({
      sql: 'SELECT balance FROM server_reserve WHERE guild_id = ?',
      args: [guildId],
    });
    const reserveBalance = reserveRes.rows.length > 0 ? Number(reserveRes.rows[0].balance) || 0 : 0;

    const delta = computeCrisisDeltaLocal(prevTreasury, outcome.pct_bps, reserveBalance);
    const newTreasury = prevTreasury + delta;

    // РќР°СЃС‚СЂРѕРµРЅРёРµ: СЃС‡РёС‚Р°РµРј РѕС‚ СЌС„С„РµРєС‚РёРІРЅРѕРіРѕ (Р·Р°С‚СѓС…С€РµРіРѕ) Р·РЅР°С‡РµРЅРёСЏ, РїРёС€РµРј РЅРѕРІРѕР№ С‚РѕС‡РєРѕР№
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
      text: `**${crisis.ticker}**: ${outcome.text} (РєР°Р·РЅР° ${delta >= 0 ? '+' : ''}${delta} рџЄ™)`,
      resolved_by: resolvedBy,
    });

    const results = await db.batch(
      [
        {
          sql: `UPDATE company_crises
                SET status = ?, resolved_option = ?, resolved_at = ?, outcome_text = ?, treasury_delta = ?
                WHERE id = ? AND status = 'pending' AND expires_at ${expiryOp} ?
                  AND (SELECT treasury FROM companies WHERE id = ?) = ?
                  AND (SELECT mood_bps FROM companies WHERE id = ?) IS ?
                  AND (SELECT mood_updated_at FROM companies WHERE id = ?) IS ?`,
          args: [finalStatus, resolvedOption, nowSec, outcome.text, delta, crisisId, nowSec, companyId, prevTreasury, companyId, rawMoodBps, companyId, rawMoodUpdatedAt],
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

    // Р‘Р°С‚С‡ РїСЂРѕС€С‘Р» РІС…РѕР»РѕСЃС‚СѓСЋ: РєСЂРёР·РёСЃ СѓР¶Рµ Р·Р°РєСЂС‹С‚ РєРµРј-С‚Рѕ РґСЂСѓРіРёРј РёР»Рё РєР°Р·РЅР° РёР·РјРµРЅРёР»Р°СЃСЊ
    const re = await db.execute({
      sql: 'SELECT status FROM company_crises WHERE id = ?',
      args: [crisisId],
    });
    if (String(re.rows[0]?.status || '') !== 'pending') {
      return { ...empty, alreadyClosed: true };
    }
    // РљР°Р·РЅР° РёР»Рё РЅР°СЃС‚СЂРѕРµРЅРёРµ РёР·РјРµРЅРёР»РёСЃСЊ РјРµР¶РґСѓ СЂР°СЃС‡С‘С‚РѕРј Рё Р±Р°С‚С‡РµРј вЂ” РїРµСЂРµСЃС‡С‘С‚ Рё РїРѕРІС‚РѕСЂ (РґРѕ 3 СЂР°Р·)
  }

  return empty;
}

/**
 * РўР°Р№РјР°СѓС‚С‹ РєСЂРёР·РёСЃРѕРІ (С‚РёРє СЂР°Р· РІ РјРёРЅСѓС‚Сѓ): РІСЃРµ pending СЃ РёСЃС‚С‘РєС€РёРј РґРµРґР»Р°Р№РЅРѕРј
 * РїРѕР»СѓС‡Р°СЋС‚ РёСЃС…РѕРґ РёР· timeout_json С‚РµРј Р¶Рµ Р°С‚РѕРјР°СЂРЅС‹Рј Р±Р°С‚С‡РµРј, СЃС‚Р°С‚СѓСЃ 'expired'.
 * РџРѕРІС‚РѕСЂРЅС‹Р№ Р·Р°РїСѓСЃРє РЅРёС‡РµРіРѕ РЅРµ РґСѓР±Р»РёСЂСѓРµС‚: SELECT Р±РµСЂС‘С‚ С‚РѕР»СЊРєРѕ pending.
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
          // Р‘РёС‚С‹Р№ timeout_json: Р·Р°РєСЂС‹РІР°РµРј Р±РµР· РґРµРЅРµРі, С‡С‚РѕР±С‹ РєСЂРёР·РёСЃ РЅРµ Р·Р°РІРёСЃ РЅР°РІСЃРµРіРґР°
          timeout = { weight: 100, pct_bps: 0, text: 'РљСЂРёР·РёСЃ Р·Р°РєСЂС‹С‚ РїРѕ С‚Р°Р№РјР°СѓС‚Сѓ Р±РµР· РїРѕСЃР»РµРґСЃС‚РІРёР№.' };
        }

        // РСЃС…РѕРґ РїРѕ С‚Р°Р№РјР°СѓС‚Сѓ РїСЂРёРјРµРЅСЏРµС‚СЃСЏ РєР°Рє Р·Р°РїРёСЃР°РЅ РІ РєР°С‚Р°Р»РѕРіРµ (С…СѓРґС€РёР№, Р±РµР· СЃР»СѓС‡Р°Р№РЅРѕСЃС‚Рё)
        const result = await applyCrisisOutcome(db, crisis, timeout, 'expired', '<=', null, 'timeout');
        if (!result.applied) continue; // РЈР¶Рµ Р·Р°РєСЂС‹С‚ РїР°СЂР°Р»Р»РµР»СЊРЅС‹Рј РїСЂРѕС†РµСЃСЃРѕРј вЂ” РёРґРµРјРїРѕС‚РµРЅС‚РЅРѕ

        // Р РµРґР°РєС‚РёСЂРѕРІР°РЅРёРµ СЃРѕРѕР±С‰РµРЅРёСЏ вЂ” РїРѕСЃР»Рµ РєРѕРјРјРёС‚Р°; СЃР±РѕР№ Discord РЅРµ РѕС‚РєР°С‚С‹РІР°РµС‚ РёСЃС…РѕРґ
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
 * РЈР±РёСЂР°РµС‚ РєРЅРѕРїРєРё Рё РїРѕРєР°Р·С‹РІР°РµС‚ РёСЃС…РѕРґ РІ РёСЃС…РѕРґРЅРѕРј СЃРѕРѕР±С‰РµРЅРёРё РєСЂРёР·РёСЃР° (С‡РµСЂРµР· REST
 * СЃСЂРµРґСЃС‚РІР°РјРё discord.js, РєР°Рє РІ checkExpiredDuels). РЎР±РѕР№ РЅРµ Р±СЂРѕСЃР°РµС‚ РёСЃРєР»СЋС‡РµРЅРёРµ.
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
    // РЎРѕРѕР±С‰РµРЅРёРµ РјРѕРіР»Рѕ РµС‰С‘ РЅРµ РѕРїСѓР±Р»РёРєРѕРІР°С‚СЊСЃСЏ (message_id вЂ” Р·Р°РіР»СѓС€РєР° СЃРїР°РІРЅР°)
    if (!channelId || !messageId || messageId.startsWith('pending:')) return;

    const guild = bot.guilds.cache.get(String(crisis.guild_id));
    if (!guild) return;
    const channel: any = guild.channels.cache.get(channelId);
    if (!channel || channel.type !== 0) return;

    const embed = {
      embeds: [{
        title: `вЊ› Р’СЂРµРјСЏ РІС‹С€Р»Рѕ: ${crisis.company_name} (${crisis.ticker})`.slice(0, 256),
        description: `${outcome.text}\n\nР РµС€РµРЅРёРµ РЅРµ Р±С‹Р»Рѕ РІС‹Р±СЂР°РЅРѕ РІРѕРІСЂРµРјСЏ вЂ” РїСЂРёРјРµРЅС‘РЅ РёСЃС…РѕРґ РїРѕ СѓРјРѕР»С‡Р°РЅРёСЋ.`,
        color: 0xE74C3C,
        fields: [
          {
            name: 'РљР°Р·РЅР°',
            value: `**${result.newTreasury.toLocaleString('ru-RU')} рџЄ™** (${result.delta >= 0 ? '+' : ''}${result.delta})`,
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
 * РџСѓР±Р»РёРєСѓРµС‚ СЃРѕРѕР±С‰РµРЅРёРµ РєСЂРёР·РёСЃР° (embed + РєРЅРѕРїРєРё РІР°СЂРёР°РЅС‚РѕРІ) РёР· outbox-СЃРѕР±С‹С‚РёСЏ
 * 'crisis_spawn' Рё Р·Р°РїРёСЃС‹РІР°РµС‚ channel_id/message_id РѕР±СЂР°С‚РЅРѕ РІ company_crises.
 * Р’РѕР·РІСЂР°С‰Р°РµС‚ false, РµСЃР»Рё РєСЂРёР·РёСЃ СѓР¶Рµ СѓРґР°Р»С‘РЅ (РЅР°РїСЂРёРјРµСЂ, СЃРµР·РѕРЅРЅРѕР№ Р»РёРєРІРёРґР°С†РёРµР№) вЂ”
 * СЃРѕР±С‹С‚РёРµ РїРѕРјРµС‡Р°РµС‚СЃСЏ РґРѕСЃС‚Р°РІР»РµРЅРЅС‹Рј, С‡С‚РѕР±С‹ РЅРµ Р±Р»РѕРєРёСЂРѕРІР°С‚СЊ РѕС‡РµСЂРµРґСЊ.
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
    .slice(0, 5) // Р›РёРјРёС‚ Discord: РјР°РєСЃРёРјСѓРј 5 РєРЅРѕРїРѕРє РІ СЂСЏРґСѓ
    .map((o: any) => ({
      type: 2, // Button
      style: 1, // Primary
      custom_id: `crisis:${crisisId}:${String(o.id)}`,
      label: String(o.label || '').slice(0, 80), // Р›РёРјРёС‚ Discord: 80 СЃРёРјРІРѕР»РѕРІ
      emoji: { name: String(o.emoji || 'вљ–пёЏ') },
    }));

  const messagePayload = {
    embeds: [{
      title: `рџљЁ РљСЂРёР·РёСЃ: ${String(payload.company_name || 'РљРѕРјРїР°РЅРёСЏ')} (${String(payload.ticker || '???')})`.slice(0, 256),
      description: `${String(payload.scenario_text || '')}\n\nР РµС€РµРЅРёРµ РїСЂРёРЅРёРјР°РµС‚ <@${ownerId}> вЂў РґРµРґР»Р°Р№РЅ: <t:${Number(payload.expires_at) || 0}:R>`,
      color: 0xE74C3C,
    }],
    components: buttons.length > 0 ? [{ type: 1, components: buttons }] : [],
    // РЈРїРѕРјРёРЅР°РЅРёРµ РІР»Р°РґРµР»СЊС†Р° вЂ” С‚РѕР»СЊРєРѕ С‡РµСЂРµР· allowed_mentions.users (Р±РµР· РјР°СЃСЃРѕРІС‹С… РїРёРЅРіРѕРІ)
    allowed_mentions: { parse: [], users: ownerId ? [ownerId] : [] },
  };

  const message = await channel.send(messagePayload);

  // Writeback РїРѕСЃР»Рµ СѓСЃРїРµС€РЅРѕР№ РѕС‚РїСЂР°РІРєРё; С‚РѕР»СЊРєРѕ РґР»СЏ РµС‰С‘ РЅРµР·Р°РєСЂС‹С‚С‹С… РєСЂРёР·РёСЃРѕРІ
  await db.execute({
    sql: "UPDATE company_crises SET channel_id = ?, message_id = ? WHERE id = ? AND status = 'pending'",
    args: [channel.id, message.id, crisisId],
  });
  return true;
}

