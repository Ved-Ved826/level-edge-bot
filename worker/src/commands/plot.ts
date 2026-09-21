// ============================================
// Система Города: команда /plot (Шаг 2)
// Подкоманды: info, buy, sell
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

const EMBED_COLOR = 0x5865f2;
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
    console.error("[Plot] Failed to send followup:", e);
  }
}

/**
 * Разбор подкоманды /plot: Discord присылает один option типа 1 (SUB_COMMAND)
 * с вложенными options.
 */
function parseSubcommand(inter: CommandInteraction): { name: string; options: Record<string, any> } | null {
  const top = (inter.data?.options?.[0] ?? null) as any;
  if (!top || top.type !== 1) return null;
  const options: Record<string, any> = {};
  for (const opt of top.options ?? []) options[opt.name] = opt.value;
  return { name: String(top.name), options };
}

async function getCompanyById(db: any, companyId: number): Promise<CompanyRow | null> {
  if (!companyId || Number.isNaN(companyId)) return null;
  const res = await db.execute({
    sql: "SELECT id, owner_id, name, ticker, treasury FROM companies WHERE id = ?",
    args: [companyId],
  });
  return (res.rows[0] as CompanyRow | undefined) ?? null;
}

async function getCompanyByTicker(db: any, guildId: string, ticker: string): Promise<CompanyRow | null> {
  const res = await db.execute({
    sql: "SELECT id, owner_id, name, ticker, treasury FROM companies WHERE guild_id = ? AND UPPER(ticker) = UPPER(?)",
    args: [guildId, ticker.trim()],
  });
  return (res.rows[0] as CompanyRow | undefined) ?? null;
}

/**
 * Резолв компании-получателя участка (единоличное владение запрещено):
 * участок всегда оформляется на компанию покупателя.
 * - Явный тикер: компания должна быть компанией покупателя (глава или участник).
 * - Без тикера: компания, где покупатель глава; иначе единственное членство.
 * Возвращает CompanyRow или текст ошибки.
 */
async function resolveBuyerCompany(
  db: any,
  guildId: string,
  userId: string,
  companyTicker?: string
): Promise<CompanyRow | string> {
  if (companyTicker) {
    const comp = await getCompanyByTicker(db, guildId, companyTicker);
    if (!comp) return `Компания \`${companyTicker}\` не найдена на этом сервере.`;
    if (String(comp.owner_id) !== String(userId)) {
      const memberRes = await db.execute({
        sql: "SELECT 1 FROM company_shares WHERE guild_id = ? AND user_id = ? AND company_id = ? AND shares_count > 0 LIMIT 1",
        args: [guildId, userId, Number(comp.id)],
      });
      if (memberRes.rows.length === 0) {
        return `Вы не состоите в компании \`${comp.ticker}\`: участок могут купить только её глава или участники (оформляется на компанию).`;
      }
    }
    return comp;
  }

  // Без тикера: компания, где покупатель — глава
  const leaderRes = await db.execute({
    sql: "SELECT id, owner_id, name, ticker, treasury FROM companies WHERE guild_id = ? AND owner_id = ? LIMIT 1",
    args: [guildId, userId],
  });
  const leaderComp = leaderRes.rows[0] as CompanyRow | undefined;
  if (leaderComp) return leaderComp;

  // Иначе — компании, где покупатель держит акции
  const memberRes = await db.execute({
    sql: `SELECT c.id, c.owner_id, c.name, c.ticker, c.treasury
          FROM company_shares s
          JOIN companies c ON c.id = s.company_id
          WHERE s.guild_id = ? AND s.user_id = ? AND s.shares_count > 0
          ORDER BY s.shares_count DESC, c.id ASC`,
    args: [guildId, userId],
  });
  if (memberRes.rows.length === 0) {
    return "Покупка участка доступна только главам и участникам компаний — участок оформляется на компанию. Создайте компанию (/company-create) или купите акции /invest.";
  }
  if (memberRes.rows.length > 1) {
    return "Вы состоите в нескольких компаниях — укажите тикер компании опцией `company`.";
  }
  return memberRes.rows[0] as CompanyRow;
}

// ============================================
// /plot info
// ============================================

async function plotInfo(db: any, guildId: string, plotId: number): Promise<Record<string, any>> {
  const catalog = PLOTS_CATALOG.find((p) => p.id === plotId);
  if (!catalog) {
    return errEmbed("Участок не найден. Допустимые ID: 1-12.");
  }

  const res = await db.execute({
    sql: "SELECT * FROM city_plots WHERE guild_id = ? AND id = ?",
    args: [guildId, plotId],
  });
  const row = (res.rows[0] ?? null) as CityPlotRow | null;

  let ownerLine: string;
  if (!row || row.owner_id == null) {
    ownerLine = "🕊️ Свободен";
  } else if (row.owner_type === "company") {
    const comp = await getCompanyById(db, Number(row.owner_id));
    ownerLine = comp ? `🏢 Компания **${comp.name}** (\`${comp.ticker}\`)` : `🏢 Компания (id ${row.owner_id})`;
  } else {
    ownerLine = `👤 <@${row.owner_id}>`;
  }

  const lines: string[] = [`👤 **Владелец:** ${ownerLine}`];

  const level = Number(row?.building_level) || 0;
  const buildingCfg = row && row.building_type ? BUILDINGS_CONFIG[row.building_type as BuildingType] : undefined;
  if (buildingCfg && level >= 1) {
    const lvlIdx = Math.min(level, 3) - 1;
    lines.push(
      `🏗️ **Постройка:** ${buildingCfg.emoji} ${buildingCfg.name} — уровень ${level}/3`,
      `💵 Суточный доход: **${fmt(buildingCfg.daily_revenue[lvlIdx])} 🪙**`,
      `🧾 Недельный налог: **${fmt(buildingCfg.weekly_tax[lvlIdx])} 🪙**`
    );
  } else {
    lines.push("🏗️ **Постройка:** нет");
  }

  if (row && row.owner_id != null && row.for_sale_price != null && row.for_sale_price > 0) {
    lines.push(`🏷️ **Выставлен на продажу за ${fmt(row.for_sale_price)} 🪙**`);
  } else if (row && row.owner_id == null) {
    lines.push(`🏷️ **Цена покупки:** ${fmt(Number(row.price) || 0)} 🪙`);
  } else if (!row) {
    lines.push(`🏷️ **Цена покупки (стартовая):** ${fmt(catalog.base_price)} 🪙`);
  }

  const allowed = catalog.allowed_buildings
    .map((t) => `${BUILDINGS_CONFIG[t].emoji} ${BUILDINGS_CONFIG[t].name}`)
    .join(" • ");
  lines.push(`🔨 **Допустимые постройки:** ${allowed}`);

  return {
    embeds: [
      {
        title: `🗺️ Участок #${plotId} — ${catalog.title} (${catalog.zone})`,
        description: lines.join("\n"),
        color: EMBED_COLOR,
      },
    ],
  };
}

// ============================================
// /plot buy
// ============================================

async function plotBuy(
  db: any,
  guildId: string,
  userId: string,
  plotId: number,
  companyTicker?: string
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

  const isFree = row.owner_id == null;
  const forSale = row.for_sale_price == null ? 0 : Number(row.for_sale_price);

  if (!isFree && forSale <= 0) {
    return errEmbed("Участок занят и не выставлен на продажу.");
  }

  // Пока на занятый участок идут ставки аукциона — прямая покупка недоступна
  if (!isFree) {
    const activeAuctionRes = await db.execute({
      sql: `SELECT id FROM plot_auctions
            WHERE guild_id = ? AND plot_id = ? AND status = 'active' AND expires_at > ?
            LIMIT 1`,
      args: [guildId, plotId, Date.now()],
    });
    if (activeAuctionRes.rows.length > 0) {
      return errEmbed("На этот участок уже идут ставки в аукционе. Используйте /auction bid plot_id amount.");
    }
  }

  const price = isFree ? Math.max(0, Number(row.price) || 0) : forSale;

  // ---------- Покупатель: всегда игрок, участок оформляется на его компанию ----------
  // Единоличное владение запрещено: участок может купить только глава компании
  // или участник, покупающий участок в подарок своей компании.
  // Оплата ВСЕГДА с личного баланса покупателя (users.coins).
  const companyOrError = await resolveBuyerCompany(db, guildId, userId, companyTicker);
  if (typeof companyOrError === "string") {
    return errEmbed(companyOrError);
  }
  const buyerCompany = companyOrError;
  const buyerCompanyId = String(buyerCompany.id);
  const buyerLabel = `🏢 **${buyerCompany.name}** (\`${buyerCompany.ticker}\`)`;

  const userRes = await db.execute({
    sql: "SELECT coins FROM users WHERE user_id = ? AND guild_id = ?",
    args: [userId, guildId],
  });
  const coins = Number(userRes.rows[0]?.coins) || 0;
  if (coins < price) {
    return errEmbed(`Недостаточно монет на личном балансе: **${fmt(coins)} / ${fmt(price)} 🪙**.`);
  }

  // ---------- Продавец (если участок занят) ----------
  let seller: { type: "user" | "company"; id: string; label: string } | null = null;
  if (!isFree) {
    if (row.owner_type === "company") {
      const sellerCompany = await getCompanyById(db, Number(row.owner_id));
      if (!sellerCompany) return errEmbed("Компания-владелец участка не найдена.");
      if (String(sellerCompany.id) === buyerCompanyId) {
        return errEmbed("Эта компания уже владеет участком.");
      }
      seller = {
        type: "company",
        id: String(sellerCompany.id),
        label: `🏢 **${sellerCompany.name}** (\`${sellerCompany.ticker}\`)`,
      };
    } else {
      const sellerId = String(row.owner_id);
      if (sellerId === String(userId)) {
        return errEmbed("Вы уже владеете этим участком.");
      }
      seller = { type: "user", id: sellerId, label: `👤 <@${sellerId}>` };
    }
  }

  // ---------- Атомарная покупка: один batch = одна транзакция ----------
  // Guard-условия защищают от гонок между покупателями:
  // 1) claim участка — CAS по текущему состоянию + проверка ЛИЧНЫХ средств покупателя;
  //    владелец фиксируется как компания покупателя (owner_type = 'company');
  // 2) списание личного баланса покупателя — только если claim прошёл
  //    (owner_id = компания покупателя);
  // 3) выплата продавцу — только если claim прошёл.
  const ownedGuard = isFree ? "owner_id IS NULL" : "owner_id IS NOT NULL AND for_sale_price = ?";
  const fundsSubquery = "(SELECT coins FROM users WHERE user_id = ? AND guild_id = ?)";

  const claimArgs: any[] = [buyerCompanyId, guildId, plotId];
  if (!isFree) claimArgs.push(price);
  claimArgs.push(price, userId, guildId);

  const claimStmt = {
    sql: `UPDATE city_plots
          SET owner_type = 'company', owner_id = ?, for_sale_price = NULL
          WHERE guild_id = ? AND id = ?
            AND ${ownedGuard}
            AND ? <= COALESCE(${fundsSubquery}, 0)`,
    args: claimArgs,
  };

  const claimOkGuard =
    "EXISTS (SELECT 1 FROM city_plots WHERE guild_id = ? AND id = ? AND owner_type = 'company' AND owner_id = ?)";

  const debitStmt = {
    sql: `UPDATE users SET coins = coins - ?
          WHERE user_id = ? AND guild_id = ? AND coins >= ? AND ${claimOkGuard}`,
    args: [price, userId, guildId, price, guildId, plotId, buyerCompanyId],
  };

  const stmts: { sql: string; args: any[] }[] = [claimStmt, debitStmt];

  if (seller) {
    const creditStmt =
      seller.type === "user"
        ? {
            sql: `UPDATE users SET coins = coins + ?
                  WHERE user_id = ? AND guild_id = ? AND ${claimOkGuard}`,
            args: [price, seller.id, guildId, guildId, plotId, buyerCompanyId],
          }
        : {
            sql: `UPDATE companies SET treasury = treasury + ?
                  WHERE id = ? AND ${claimOkGuard}`,
            args: [price, seller.id, guildId, plotId, buyerCompanyId],
          };
    stmts.push(creditStmt);
  }

  const results = await db.batch(stmts, "write");

  if ((results[0].rowsAffected as number) !== 1) {
    return errEmbed("Сделка не состоялась: участок только что был занят кем-то другим или цена изменилась. Попробуйте ещё раз.");
  }
  if ((results[1].rowsAffected as number) !== 1) {
    console.error(`[Plot] Buyer debit failed after claim (plot ${plotId}, guild ${guildId}, buyer ${userId}, company ${buyerCompanyId})`);
  }
  if (seller && (results[2].rowsAffected as number) !== 1) {
    console.error(`[Plot] Seller credit failed (plot ${plotId}, guild ${guildId}, seller ${seller.id})`);
  }

  const lines: string[] = [
    `🗺️ Участок #${plotId} — **${catalog.title}**`,
    `**Новый владелец:** ${buyerLabel}`,
    `👤 Покупатель: <@${userId}> — оплачено лично **${fmt(price)} 🪙**`,
  ];
  if (seller) {
    lines.push(`**Продавец:** ${seller.label} получает **${fmt(price)} 🪙**`);
  } else {
    lines.push(`Участок выкуплен у города за **${fmt(price)} 🪙**`);
  }

  return {
    embeds: [{ title: "✅ Сделка оформлена!", description: lines.join("\n"), color: COLOR_SUCCESS }],
  };
}

// ============================================
// /plot sell
// ============================================

async function plotSell(
  db: any,
  guildId: string,
  userId: string,
  plotId: number,
  price: number
): Promise<Record<string, any>> {
  if (!Number.isInteger(plotId) || plotId < 1 || plotId > 12) {
    return errEmbed("Укажите корректный ID участка (1-12).");
  }
  if (!Number.isInteger(price) || price < 0) {
    return errEmbed("Цена должна быть целым числом >= 0 (0 — снять с продажи).");
  }

  const catalog = PLOTS_CATALOG.find((p) => p.id === plotId);
  if (!catalog) return errEmbed("Участок не найден.");

  const res = await db.execute({
    sql: "SELECT * FROM city_plots WHERE guild_id = ? AND id = ?",
    args: [guildId, plotId],
  });
  const row = (res.rows[0] ?? null) as CityPlotRow | null;
  if (!row || row.owner_id == null) {
    return errEmbed("Участок не имеет владельца — продавать нечего.");
  }

  // Право продажи: владелец-игрок или создатель компании-владельца
  let ownerType: "user" | "company";
  let ownerId: string;
  if (row.owner_type === "company") {
    const comp = await getCompanyById(db, Number(row.owner_id));
    if (!comp) return errEmbed("Компания-владелец участка не найдена.");
    if (String(comp.owner_id) !== String(userId)) {
      return errEmbed("Продавать участок компании может только её создатель.");
    }
    ownerType = "company";
    ownerId = String(comp.id);
  } else {
    if (String(row.owner_id) !== String(userId)) {
      return errEmbed("Вы не являетесь владельцем этого участка.");
    }
    ownerType = "user";
    ownerId = String(row.owner_id);
  }

  const nowMs = Date.now();
  const AUCTION_DURATION_MS = 24 * 60 * 60 * 1000; // аукцион длится 24 часа

  // Активный аукцион на этом участке (expires_at хранится в миллисекундах)
  const activeAuctionRes = await db.execute({
    sql: `SELECT id, highest_bid, highest_bidder_id
          FROM plot_auctions
          WHERE guild_id = ? AND plot_id = ? AND status = 'active' AND expires_at > ?
          ORDER BY id DESC LIMIT 1`,
    args: [guildId, plotId, nowMs],
  });
  const activeAuction = activeAuctionRes.rows[0] as
    | { id: number; highest_bid: number; highest_bidder_id: string | null }
    | undefined;

  if (price > 0) {
    if (activeAuction) {
      return errEmbed(
        `На этом участке уже идёт аукцион (текущая ставка ${fmt(Number(activeAuction.highest_bid) || 0)} 🪙). ` +
          "Дождитесь завершения или снимите участок с продажи (/plot sell plot_id price:0)."
      );
    }

    // Фиксируем стартовую цену за владельцем (guard по владельцу)
    const update = await db.execute({
      sql: "UPDATE city_plots SET for_sale_price = ? WHERE guild_id = ? AND id = ? AND owner_type = ? AND owner_id = ?",
      args: [price, guildId, plotId, ownerType, ownerId],
    });

    if (!update.rowsAffected || update.rowsAffected === 0) {
      return errEmbed("Не удалось запустить аукцион. Попробуйте ещё раз.");
    }

    // Стартовая ставка = цена продавца, перебивать можно только вверх.
    // expires_at и created_at — в МИЛЛИСЕКУНДАХ (Date.now()): в этом формате
    // их читают /auction (list/bid) и processExpiredAuctions в collector.
    await db.execute({
      sql: `INSERT INTO plot_auctions (guild_id, plot_id, highest_bid, status, expires_at, created_at)
            VALUES (?, ?, ?, 'active', ?, ?)`,
      args: [guildId, plotId, price, nowMs + AUCTION_DURATION_MS, nowMs],
    });

    const expiresAtSec = Math.floor((nowMs + AUCTION_DURATION_MS) / 1000);
    const description =
      `🗺️ Участок #${plotId} — **${catalog.title}** выставлен на аукцион.\n` +
      `💰 Стартовая цена: **${fmt(price)} 🪙** (ставки строго выше)\n` +
      `⏳ Аукцион завершится: <t:${expiresAtSec}:R>\n` +
      `🔨 Ставка: /auction bid plot_id:${plotId} amount:<сумма>`;

    return { embeds: [{ title: "🔨 Аукцион запущен", description, color: COLOR_SUCCESS }] };
  }

  // price = 0 — снять с продажи: отменяем активный аукцион и возвращаем ставку лидеру
  if (activeAuction) {
    const leaderId = activeAuction.highest_bidder_id ? String(activeAuction.highest_bidder_id) : null;
    const leaderBid = Number(activeAuction.highest_bid) || 0;

    const stmts: { sql: string; args: any[] }[] = [
      {
        sql: "UPDATE plot_auctions SET status = 'cancelled' WHERE id = ? AND status = 'active'",
        args: [Number(activeAuction.id)],
      },
      {
        sql: "UPDATE city_plots SET for_sale_price = NULL WHERE guild_id = ? AND id = ?",
        args: [guildId, plotId],
      },
    ];
    if (leaderId && leaderBid > 0) {
      // Ставки принимаются только от пользователей — возврат лидеру в users.coins
      stmts.push({
        sql: "UPDATE users SET coins = coins + ? WHERE user_id = ? AND guild_id = ?",
        args: [leaderBid, leaderId, guildId],
      });
    }
    await db.batch(stmts, "write");

    const description =
      `🗺️ Участок #${plotId} — **${catalog.title}** снят с продажи, аукцион отменён.` +
      (leaderId && leaderBid > 0 ? `\n↩️ <@${leaderId}> вернули ставку (**${fmt(leaderBid)} 🪙**).` : "");
    return { embeds: [{ title: "🏷️ Готово", description, color: COLOR_SUCCESS }] };
  }

  const update = await db.execute({
    sql: "UPDATE city_plots SET for_sale_price = NULL WHERE guild_id = ? AND id = ? AND owner_type = ? AND owner_id = ?",
    args: [guildId, plotId, ownerType, ownerId],
  });

  if (!update.rowsAffected || update.rowsAffected === 0) {
    return errEmbed("Не удалось обновить участок. Попробуйте ещё раз.");
  }

  const description = `🗺️ Участок #${plotId} — **${catalog.title}** снят с продажи.`;
  return { embeds: [{ title: "🏷️ Готово", description, color: COLOR_SUCCESS }] };
}

// ============================================
// Главный обработчик /plot
// ============================================

async function processPlotCommand(
  sub: { name: string; options: Record<string, any> },
  inter: CommandInteraction,
  db: any,
  guildId: string,
  userId: string
): Promise<void> {
  let payload: Record<string, any>;

  switch (sub.name) {
    case "info":
      payload = await plotInfo(db, guildId, Number(sub.options.plot_id));
      break;
    case "buy":
      payload = await plotBuy(
        db,
        guildId,
        userId,
        Number(sub.options.plot_id),
        sub.options.company != null ? String(sub.options.company) : undefined
      );
      break;
    case "sell":
      payload = await plotSell(db, guildId, userId, Number(sub.options.plot_id), Number(sub.options.price));
      break;
    default:
      payload = errEmbed("Неизвестная подкоманда. Доступны: info, buy, sell.");
  }

  await sendEphemeralFollowUp(inter, payload);
}

export async function handlePlotCommand(inter: CommandInteraction, env: Env, ctx: ExecutionContext): Promise<Response> {
  const sub = parseSubcommand(inter);
  if (!sub) {
    return Response.json({ type: 4, data: { content: "❌ Укажите подкоманду: info, buy или sell", flags: 64 } });
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
    processPlotCommand(sub, inter, db, guildId, userId).catch((e) => {
      console.error("[Plot] Unhandled error:", e);
      return sendEphemeralFollowUp(inter, {
        content: `❌ Ошибка выполнения команды: ${e instanceof Error && e.message ? e.message : String(e)}`.slice(0, 1800),
      });
    })
  );

  return Response.json({ type: 5, data: { flags: 64 } });
}
