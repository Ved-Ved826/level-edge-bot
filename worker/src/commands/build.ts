// ============================================
// Система Города: команды /build и /upgrade (Шаг 3)
// Постройка зданий на участках и апгрейд до уровня 3
// ============================================

import { createClient } from "@libsql/client";

import { PLOTS_CATALOG, BUILDINGS_CONFIG } from "../city/catalog";
import { BuildingType } from "../city/types";
import { CommandInteraction, Env, ExecutionContext } from "../types";

interface CityPlotRow {
  id: number;
  guild_id: string;
  owner_type: string | null;
  owner_id: string | null;
  building_type: string | null;
  building_level: number;
  price: number;
  for_sale_price: number | null;
}

interface CompanyRow {
  id: number;
  owner_id: string;
  name: string;
  ticker: string;
  treasury: number;
}

/**
 * Дескриптор плательщика за постройку/апгрейд:
 * владелец-игрок (users.coins) или компания-владелец (companies.treasury).
 */
type PlotOwner =
  | { ok: true; ownerType: "user"; ownerId: string; label: string }
  | { ok: true; ownerType: "company"; ownerId: string; label: string; treasury: number }
  | { ok: false; error: string };

const COLOR_SUCCESS = 0x2ecc71;
const COLOR_ERROR = 0xe74c3c;

function fmt(n: number): string {
  return Math.round(n).toLocaleString("ru-RU");
}

function errEmbed(text: string): Record<string, any> {
  return { embeds: [{ title: "❌ Ошибка", description: text, color: COLOR_ERROR }] };
}

/**
 * Ephemeral followup после type 5 defer.
 */
async function sendEphemeralFollowUp(inter: CommandInteraction, payload: Record<string, any>): Promise<void> {
  const applicationId = (inter as any).application_id;
  if (!applicationId) return;
  try {
    await fetch(`https://discord.com/api/v10/webhooks/${applicationId}/${inter.token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ flags: 64, ...payload }),
    });
  } catch (e) {
    console.error("[Build] Failed to send followup:", e);
  }
}

/**
 * Разбор опций верхнего уровня /build и /upgrade (без подкоманд).
 */
function parseOptions(inter: CommandInteraction): Record<string, any> {
  const options: Record<string, any> = {};
  for (const opt of inter.data?.options ?? []) options[opt.name] = opt.value;
  return options;
}

async function getCompanyById(db: any, companyId: number): Promise<CompanyRow | null> {
  if (!companyId || Number.isNaN(companyId)) return null;
  const res = await db.execute({
    sql: "SELECT id, owner_id, name, ticker, treasury FROM companies WHERE id = ?",
    args: [companyId],
  });
  return (res.rows[0] as CompanyRow | undefined) ?? null;
}

/**
 * Право управления участком: владелец-игрок или создатель компании-владельца.
 */
async function resolvePlotOwner(db: any, userId: string, row: CityPlotRow): Promise<PlotOwner> {
  if (row.owner_id == null) {
    return { ok: false, error: "Участок свободен — сначала купите его через /plot buy." };
  }

  if (row.owner_type === "company") {
    const comp = await getCompanyById(db, Number(row.owner_id));
    if (!comp) return { ok: false, error: "Компания-владелец участка не найдена." };
    if (String(comp.owner_id) !== String(userId)) {
      return { ok: false, error: "Управлять постройками компании может только её создатель." };
    }
    return {
      ok: true,
      ownerType: "company",
      ownerId: String(comp.id),
      label: `🏢 **${comp.name}** (\`${comp.ticker}\`)`,
      treasury: Number(comp.treasury) || 0,
    };
  }

  if (String(row.owner_id) !== String(userId)) {
    return { ok: false, error: "Вы не являетесь владельцем этого участка." };
  }
  return { ok: true, ownerType: "user", ownerId: String(row.owner_id), label: `👤 <@${userId}>` };
}

/**
 * Предварительная проверка средств — для точного сообщения об ошибке.
 * Финальная проверка всё равно выполняется атомарно внутри batch.
 */
async function ensureEnoughFunds(db: any, guildId: string, owner: PlotOwner, cost: number): Promise<string | null> {
  if (!owner.ok) return null;
  if (owner.ownerType === "user") {
    const res = await db.execute({
      sql: "SELECT coins FROM users WHERE user_id = ? AND guild_id = ?",
      args: [owner.ownerId, guildId],
    });
    const coins = Number(res.rows[0]?.coins) || 0;
    if (coins < cost) return `Недостаточно монет: **${fmt(coins)} / ${fmt(cost)} 🪙**.`;
  } else if (owner.treasury < cost) {
    return `В казне компании недостаточно монет: **${fmt(owner.treasury)} / ${fmt(cost)} 🪙**.`;
  }
  return null;
}

// ============================================
// /build — постройка здания на участке
// ============================================

async function plotBuild(
  db: any,
  guildId: string,
  userId: string,
  plotId: number,
  buildingType: string
): Promise<Record<string, any>> {
  if (!Number.isInteger(plotId) || plotId < 1 || plotId > 12) {
    return errEmbed("Укажите корректный ID участка (1-12).");
  }

  const catalog = PLOTS_CATALOG.find((p) => p.id === plotId);
  if (!catalog) return errEmbed("Участок не найден.");

  const cfg = BUILDINGS_CONFIG[buildingType as BuildingType];
  if (!cfg) return errEmbed("Неизвестный тип постройки.");

  if (!catalog.allowed_buildings.includes(cfg.type)) {
    const allowed = catalog.allowed_buildings
      .map((t) => `${BUILDINGS_CONFIG[t].emoji} ${BUILDINGS_CONFIG[t].name}`)
      .join(", ");
    return errEmbed(
      `${cfg.emoji} **${cfg.name}** нельзя построить на участке «${catalog.title}».\nРазрешено: ${allowed}.`
    );
  }

  const res = await db.execute({
    sql: "SELECT * FROM city_plots WHERE guild_id = ? AND id = ?",
    args: [guildId, plotId],
  });
  const row = (res.rows[0] ?? null) as CityPlotRow | null;
  if (!row) return errEmbed("Участок ещё не создан на этом сервере.");

  // Аукцион по участку (Город — Шаг 4): пока идут торги, строить нельзя —
  // по завершении аукциона участок может перейти к победителю.
  const activeAuctionRes = await db.execute({
    sql: "SELECT id FROM plot_auctions WHERE guild_id = ? AND plot_id = ? AND status = 'active' LIMIT 1",
    args: [guildId, plotId],
  });
  if (activeAuctionRes.rows.length > 0) {
    return errEmbed("По этому участку идёт аукцион — постройка недоступна до завершения торгов.");
  }

  const owner = await resolvePlotOwner(db, userId, row);
  if (!owner.ok) return errEmbed(owner.error);

  if (row.building_type != null || (Number(row.building_level) || 0) >= 1) {
    return errEmbed("На этом участке уже есть постройка. Используйте /upgrade для улучшения.");
  }

  const cost = cfg.base_cost;
  const fundsError = await ensureEnoughFunds(db, guildId, owner, cost);
  if (fundsError) return errEmbed(fundsError);

  const nowSec = Math.floor(Date.now() / 1000);

  // ---------- Атомарная постройка: один batch = одна транзакция ----------
  // 1) claim участка — CAS по владельцу + отсутствие постройки + проверка средств;
  // 2) списание — только если claim прошёл (building_type = ?).
  const fundsSubquery =
    owner.ownerType === "user"
      ? "(SELECT coins FROM users WHERE user_id = ? AND guild_id = ?)"
      : "(SELECT treasury FROM companies WHERE id = ?)";

  const claimArgs: any[] = [cfg.type, nowSec, nowSec, 0, guildId, plotId, owner.ownerType, owner.ownerId, cost];
  claimArgs.push(...(owner.ownerType === "user" ? [owner.ownerId, guildId] : [owner.ownerId]));

  const claimStmt = {
    sql: `UPDATE city_plots
          SET building_type = ?, building_level = 1,
              last_revenue_at = ?, last_tax_at = ?, unpaid_taxes_count = 0
          WHERE guild_id = ? AND id = ?
            AND owner_type = ? AND owner_id = ?
            AND building_type IS NULL
            AND ? <= COALESCE(${fundsSubquery}, 0)`,
    args: claimArgs,
  };

  const claimOkGuard = "EXISTS (SELECT 1 FROM city_plots WHERE guild_id = ? AND id = ? AND building_type = ?)";

  const debitStmt =
    owner.ownerType === "user"
      ? {
          sql: `UPDATE users SET coins = coins - ?
                WHERE user_id = ? AND guild_id = ? AND coins >= ? AND ${claimOkGuard}`,
          args: [cost, userId, guildId, cost, guildId, plotId, cfg.type],
        }
      : {
          sql: `UPDATE companies SET treasury = treasury - ?
                WHERE id = ? AND treasury >= ? AND ${claimOkGuard}`,
          args: [cost, owner.ownerId, cost, guildId, plotId, cfg.type],
        };

  const results = await db.batch([claimStmt, debitStmt], "write");

  if ((results[0].rowsAffected as number) !== 1) {
    return errEmbed("Постройка не удалась: не хватает монет либо состояние участка изменилось. Попробуйте ещё раз.");
  }
  if ((results[1].rowsAffected as number) !== 1) {
    console.error(`[Build] Debit failed after claim (plot ${plotId}, guild ${guildId}, owner ${owner.ownerId})`);
  }

  const lines: string[] = [
    `🗺️ Участок #${plotId} — **${catalog.title}**`,
    `**Владелец:** ${owner.label}`,
    `**Построено:** ${cfg.emoji} ${cfg.name} — уровень 1/3`,
    `💵 Суточный доход: **${fmt(cfg.daily_revenue[0])} 🪙**`,
    `🧾 Недельный налог: **${fmt(cfg.weekly_tax[0])} 🪙**`,
    `💰 Затрачено: **${fmt(cost)} 🪙**`,
  ];

  return {
    embeds: [{ title: "🏗️ Постройка возведена!", description: lines.join("\n"), color: COLOR_SUCCESS }],
  };
}

// ============================================
// /upgrade — апгрейд здания на участке (максимум уровень 3)
// ============================================

async function plotUpgrade(
  db: any,
  guildId: string,
  userId: string,
  plotId: number
): Promise<Record<string, any>> {
  if (!Number.isInteger(plotId) || plotId < 1 || plotId > 12) {
    return errEmbed("Укажите корректный ID участка (1-12).");
  }

  const catalog = PLOTS_CATALOG.find((p) => p.id === plotId);
  if (!catalog) return errEmbed("Участок не найден.");

  const res = await db.execute({
    sql: "SELECT * FROM city_plots WHERE guild_id = ? AND id = ?",
    args: [guildId, plotId],
  });
  const row = (res.rows[0] ?? null) as CityPlotRow | null;
  if (!row) return errEmbed("Участок ещё не создан на этом сервере.");

  // Аукцион по участку (Город — Шаг 4): пока идут торги, улучшать нельзя —
  // по завершении аукциона участок может перейти к победителю.
  const activeAuctionRes = await db.execute({
    sql: "SELECT id FROM plot_auctions WHERE guild_id = ? AND plot_id = ? AND status = 'active' LIMIT 1",
    args: [guildId, plotId],
  });
  if (activeAuctionRes.rows.length > 0) {
    return errEmbed("По этому участку идёт аукцион — апгрейд недоступен до завершения торгов.");
  }

  const owner = await resolvePlotOwner(db, userId, row);
  if (!owner.ok) return errEmbed(owner.error);

  const level = Number(row.building_level) || 0;
  if (!row.building_type || level < 1) {
    return errEmbed("На этом участке нет постройки — сначала возведите здание через /build.");
  }
  if (level >= 3) {
    return errEmbed("Здание уже достигло максимального уровня 3/3.");
  }

  const cfg = BUILDINGS_CONFIG[row.building_type as BuildingType];
  if (!cfg) return errEmbed("Тип постройки на участке не найден в каталоге.");

  const cost = Math.round(cfg.base_cost * Math.pow(cfg.upgrade_multiplier, level));
  const fundsError = await ensureEnoughFunds(db, guildId, owner, cost);
  if (fundsError) return errEmbed(fundsError);

  const newLevel = level + 1;
  const lvlIdx = newLevel - 1;

  // ---------- Атомарный апгрейд: один batch = одна транзакция ----------
  // 1) claim уровня — CAS по текущему уровню + проверка средств;
  // 2) списание — только если claim прошёл (building_level = newLevel).
  const fundsSubquery =
    owner.ownerType === "user"
      ? "(SELECT coins FROM users WHERE user_id = ? AND guild_id = ?)"
      : "(SELECT treasury FROM companies WHERE id = ?)";

  const claimArgs: any[] = [newLevel, guildId, plotId, owner.ownerType, owner.ownerId, level, cost];
  claimArgs.push(...(owner.ownerType === "user" ? [owner.ownerId, guildId] : [owner.ownerId]));

  const claimStmt = {
    sql: `UPDATE city_plots
          SET building_level = ?
          WHERE guild_id = ? AND id = ?
            AND owner_type = ? AND owner_id = ?
            AND building_type IS NOT NULL
            AND building_level = ?
            AND ? <= COALESCE(${fundsSubquery}, 0)`,
    args: claimArgs,
  };

  const claimOkGuard = "EXISTS (SELECT 1 FROM city_plots WHERE guild_id = ? AND id = ? AND building_level = ?)";

  const debitStmt =
    owner.ownerType === "user"
      ? {
          sql: `UPDATE users SET coins = coins - ?
                WHERE user_id = ? AND guild_id = ? AND coins >= ? AND ${claimOkGuard}`,
          args: [cost, userId, guildId, cost, guildId, plotId, newLevel],
        }
      : {
          sql: `UPDATE companies SET treasury = treasury - ?
                WHERE id = ? AND treasury >= ? AND ${claimOkGuard}`,
          args: [cost, owner.ownerId, cost, guildId, plotId, newLevel],
        };

  const results = await db.batch([claimStmt, debitStmt], "write");

  if ((results[0].rowsAffected as number) !== 1) {
    return errEmbed("Апгрейд не удался: не хватает монет либо состояние участка изменилось. Попробуйте ещё раз.");
  }
  if ((results[1].rowsAffected as number) !== 1) {
    console.error(`[Upgrade] Debit failed after claim (plot ${plotId}, guild ${guildId}, owner ${owner.ownerId})`);
  }

  const lines: string[] = [
    `🗺️ Участок #${plotId} — **${catalog.title}**`,
    `**Здание:** ${cfg.emoji} ${cfg.name} — уровень ${newLevel}/3`,
    `💵 Суточный доход: **${fmt(cfg.daily_revenue[lvlIdx])} 🪙**`,
    `🧾 Недельный налог: **${fmt(cfg.weekly_tax[lvlIdx])} 🪙**`,
    `💰 Затрачено: **${fmt(cost)} 🪙**`,
  ];

  return {
    embeds: [{ title: "⬆️ Здание улучшено!", description: lines.join("\n"), color: COLOR_SUCCESS }],
  };
}

// ============================================
// Главные обработчики /build и /upgrade
// ============================================

async function processCityCommand(
  kind: "build" | "upgrade",
  options: Record<string, any>,
  inter: CommandInteraction,
  db: any,
  guildId: string,
  userId: string
): Promise<void> {
  const payload =
    kind === "build"
      ? await plotBuild(db, guildId, userId, Number(options.plot_id), String(options.type ?? ""))
      : await plotUpgrade(db, guildId, userId, Number(options.plot_id));

  await sendEphemeralFollowUp(inter, payload);
}

function runCityCommand(kind: "build" | "upgrade", inter: CommandInteraction, env: Env, ctx: ExecutionContext): Response {
  const options = parseOptions(inter);
  if (options.plot_id == null || !Number.isInteger(Number(options.plot_id))) {
    return Response.json({ type: 4, data: { content: "❌ Укажите корректный ID участка (1-12)", flags: 64 } });
  }
  if (kind === "build" && options.type == null) {
    return Response.json({ type: 4, data: { content: "❌ Укажите тип постройки", flags: 64 } });
  }

  const guildId = (inter as any).guild_id as string | undefined;
  if (!guildId) {
    return Response.json({ type: 4, data: { content: "❌ Команда доступна только на сервере", flags: 64 } });
  }

  const userId: string | undefined = (inter as any).member?.user?.id ?? (inter as any).user?.id;
  if (!userId) {
    return Response.json({ type: 4, data: { content: "❌ Не удалось определить пользователя", flags: 64 } });
  }

  const db = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });

  // Отвечаем defer'ом сразу, работу с БД выполняем в фоне (ctx.waitUntil)
  ctx.waitUntil(
    processCityCommand(kind, options, inter, db, guildId, userId).catch((e) => {
      console.error("[Build] Unhandled error:", e);
      return sendEphemeralFollowUp(inter, {
        content: `❌ Ошибка выполнения команды: ${e instanceof Error && e.message ? e.message : String(e)}`.slice(0, 1800),
      });
    })
  );

  return Response.json({ type: 5, data: { flags: 64 } });
}

export async function handleBuildCommand(inter: CommandInteraction, env: Env, ctx: ExecutionContext): Promise<Response> {
  return runCityCommand("build", inter, env, ctx);
}

export async function handleUpgradeCommand(inter: CommandInteraction, env: Env, ctx: ExecutionContext): Promise<Response> {
  return runCityCommand("upgrade", inter, env, ctx);
}
