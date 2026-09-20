import { createClient } from "@libsql/client";

import { ButtonInteraction, CommandInteraction, Env, ExecutionContext } from "../types";

// Каталог города (Шаг 1): участки и экономика построек
import { BUILDINGS_CONFIG, PLOTS_CATALOG } from "../city/catalog";

// ============================================
// Интерактивная карта города (/map) — Шаг 5
// ============================================

const DISCORD_API = "https://discord.com/api/v10";

// Группировка участков по 5 зонам города
const CITY_ZONES: { emoji: string; title: string; plotIds: number[] }[] = [
  { emoji: "🏔️", title: "Горный склон", plotIds: [1, 2] },
  { emoji: "🌾", title: "Пригородная долина", plotIds: [3, 4] },
  { emoji: "🛣️", title: "Шоссе и Торговый проспект", plotIds: [5, 6, 9, 10] },
  { emoji: "🏙️", title: "Деловой центр", plotIds: [7, 8] },
  { emoji: "🌊", title: "Морская гавань", plotIds: [11, 12] },
];

// Подписи зон для карточки участка
const ZONE_LABELS: Record<string, string> = {
  mountain: "🏔️ Горный склон",
  suburb: "🌾 Пригородная долина",
  highway: "🛣️ Шоссе / Торговый проспект",
  center: "🏙️ Деловой центр",
  coast: "🌊 Морская гавань",
};

const FREE_EMOJI = "🕊️";
const SALE_EMOJI = "🏷️";
const AUCTION_EMOJI = "🔨";
const OWNED_EMPTY_EMOJI = "🏠";

function fmtCoins(value: number): string {
  return Math.round(value).toLocaleString("ru-RU");
}

/** Экономика постройки по типу (null — тип неизвестен или участок пуст). */
function getBuilding(type: string | null): { name: string; emoji: string } | null {
  if (!type) return null;
  const b = BUILDINGS_CONFIG[type as keyof typeof BUILDINGS_CONFIG];
  if (!b) return null;
  return { name: b.name, emoji: b.emoji };
}

/** Значение по уровню постройки (1-3) с защитой от выхода за границы массива. */
function valueByLevel(values: readonly number[], level: number): number {
  const idx = Math.min(Math.max(level, 1), values.length) - 1;
  return values[idx] || 0;
}

// ============================================
// Хелперы ответа на interaction (defer + followup)
// ============================================

async function deferInteraction(inter: { id: string; token: string }, ephemeral: boolean): Promise<Response> {
  try {
    return await fetch(`${DISCORD_API}/interactions/${inter.id}/${inter.token}/callback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: 5, data: ephemeral ? { flags: 64 } : {} }),
    });
  } catch (e) {
    console.error("[Map] Failed to defer interaction:", e);
    return new Response("defer failed", { status: 500 });
  }
}

async function sendFollowUp(inter: { id: string; token: string }, payload: Record<string, any>): Promise<boolean> {
  try {
    const res = await fetch(`${DISCORD_API}/webhooks/${inter.id}/${inter.token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.error("[Map] Followup failed:", res.status, await res.text().catch(() => ""));
    }
    return res.ok;
  } catch (e) {
    console.error("[Map] Followup error:", e);
    return false;
  }
}

// ============================================
// Состояние участка: символ для сетки и краткая подпись
// ============================================

/** Символ участка для сетки 4x3. */
function plotGridCell(plot: any, auction: any): string {
  if (auction) return AUCTION_EMOJI;
  if (plot && plot.for_sale_price != null) return SALE_EMOJI;
  const building = getBuilding(plot?.building_type ?? null);
  const level = Number(plot?.building_level) || 0;
  if (building && level > 0) return `${building.emoji}${level}`;
  if (plot && plot.owner_type && plot.owner_id) return OWNED_EMPTY_EMOJI;
  return FREE_EMOJI;
}

/** Краткий текст состояния участка для списка зон. */
function plotShortStatus(plot: any, auction: any, ownerLabel: string | null): string {
  if (auction) return `${AUCTION_EMOJI} аукцион — ставка ${fmtCoins(Number(auction.highest_bid) || 0)} 🪙`;
  if (plot && plot.for_sale_price != null) return `${SALE_EMOJI} продажа — ${fmtCoins(Number(plot.for_sale_price))} 🪙`;
  const building = getBuilding(plot?.building_type ?? null);
  const level = Number(plot?.building_level) || 0;
  const owner = ownerLabel ? ` • ${ownerLabel}` : "";
  if (building && level > 0) return `${building.emoji} ${building.name} (ур. ${level})${owner}`;
  if (plot && plot.owner_type && plot.owner_id) return `${OWNED_EMPTY_EMOJI} без застройки${owner}`;
  return `${FREE_EMOJI} свободен`;
}

/** ActionRow со String Select Menu выбора участка (custom_id: city_map_select). */
function buildMapSelectRow(plots: Map<number, any>, auctions: Map<number, any>) {
  const options = [...PLOTS_CATALOG]
    .sort((a, b) => Number(a.id) - Number(b.id))
    .map((p) => {
      const id = Number(p.id);
      const plot = plots.get(id);
      const auction = auctions.get(id);
      let description: string;
      if (auction) {
        description = `🔨 Аукцион • ставка ${fmtCoins(Number(auction.highest_bid) || 0)} 🪙`;
      } else if (plot && plot.for_sale_price != null) {
        description = `🏷️ Продажа за ${fmtCoins(Number(plot.for_sale_price))} 🪙`;
      } else {
        const building = getBuilding(plot?.building_type ?? null);
        const level = Number(plot?.building_level) || 0;
        description =
          building && level > 0
            ? `${building.emoji} ${building.name} • ур. ${level}`
            : `${FREE_EMOJI} Свободен • от ${fmtCoins(Number(p.base_price))} 🪙`;
      }
      return {
        label: `#${id} — ${p.title}`.slice(0, 100),
        value: String(id),
        description: description.slice(0, 100),
      };
    });

  return {
    type: 1,
    components: [
      {
        type: 3, // String Select
        custom_id: "city_map_select",
        placeholder: "🔍 Выберите участок для осмотра",
        options,
      },
    ],
  };
}

// ============================================
// /map — карта города (слэш-команда)
// ============================================

export async function handleMapCommand(inter: CommandInteraction, env: Env, _ctx: ExecutionContext): Promise<Response> {
  const guildId = String((inter as any).guild_id || "");
  if (!guildId) {
    return Response.json({ type: 4, data: { content: "❌ Команда доступна только на сервере.", flags: 64 } });
  }

  const ack = await deferInteraction(inter, false);
  if (!ack.ok) {
    return new Response("Failed to defer interaction", { status: 500 });
  }

  try {
    const db = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });

    // Участки гильдии
    const plotsRes = await db.execute({
      sql: `SELECT id, owner_type, owner_id, building_type, building_level, price, for_sale_price, unpaid_taxes_count
            FROM city_plots
            WHERE guild_id = ?
            ORDER BY id`,
      args: [guildId],
    });
    const plots = new Map<number, any>();
    for (const row of plotsRes.rows || []) {
      plots.set(Number(row.id), row);
    }

    // Активные аукционы участков
    const auctionsRes = await db.execute({
      sql: `SELECT plot_id, highest_bid, highest_bidder_id, expires_at
            FROM plot_auctions
            WHERE guild_id = ? AND status = 'active'`,
      args: [guildId],
    });
    const auctions = new Map<number, any>();
    for (const row of auctionsRes.rows || []) {
      auctions.set(Number(row.plot_id), row);
    }

    // Казна города (server_reserve)
    const reserveRes = await db.execute({
      sql: "SELECT balance FROM server_reserve WHERE guild_id = ?",
      args: [guildId],
    });
    const treasury = Number(reserveRes.rows[0]?.balance) || 0;

    // Компании гильдии (для владельцев-компаний)
    const companiesRes = await db.execute({
      sql: "SELECT id, name, ticker FROM companies WHERE guild_id = ?",
      args: [guildId],
    });
    const companies = new Map<number, string>();
    for (const row of companiesRes.rows || []) {
      companies.set(Number(row.id), `🏢 ${row.name} (\`${row.ticker}\`)`);
    }

    // Подписи владельцев: упоминание пользователя или название компании
    const ownerLabels = new Map<number, string>();
    plots.forEach((plot, id) => {
      const ownerType = plot.owner_type as string | null;
      const ownerId = plot.owner_id as string | null;
      if (ownerType === "user" && ownerId) {
        ownerLabels.set(id, `<@${ownerId}>`);
      } else if (ownerType === "company" && ownerId) {
        const label = companies.get(Number(ownerId));
        if (label) ownerLabels.set(id, label);
      }
    });

    // Сетка 4x3: #01..#12
    const sortedIds = PLOTS_CATALOG.map((p) => Number(p.id)).sort((a, b) => a - b);
    const gridLines: string[] = [];
    for (let i = 0; i < sortedIds.length; i += 4) {
      const cells = sortedIds.slice(i, i + 4).map((id) => {
        const status = plotGridCell(plots.get(id), auctions.get(id));
        return `#${String(id).padStart(2, "0")}${status}`;
      });
      gridLines.push(cells.join("  "));
    }

    // Группировка по зонам
    const zoneLines = CITY_ZONES.map((zone) => {
      const parts = zone.plotIds.map((id) =>
        `#${id} ${plotShortStatus(plots.get(id), auctions.get(id), ownerLabels.get(id) || null)}`
      );
      return `${zone.emoji} **${zone.title}** — ${parts.join(" • ")}`;
    });

    let ownedCount = 0;
    plots.forEach((plot) => {
      if (plot.owner_type && plot.owner_id) ownedCount++;
    });

    const description = [
      "**Схема участков (4×3):**",
      "```",
      ...gridLines,
      "```",
      "",
      ...zoneLines,
    ].join("\n");

    const payload = {
      embeds: [
        {
          title: "🗺️ Карта города",
          description: description.slice(0, 4000),
          color: 0x5865F2,
          fields: [
            { name: "🏛️ Казна города", value: `${fmtCoins(treasury)} 🪙`, inline: true },
            { name: "📊 Занято участков", value: `${ownedCount} / ${PLOTS_CATALOG.length}`, inline: true },
          ],
          footer: { text: "Выберите участок в меню ниже, чтобы осмотреть его" },
        },
      ],
      components: [buildMapSelectRow(plots, auctions)],
    };

    await sendFollowUp(inter, payload);
    return ack;
  } catch (e) {
    console.error("[Map] Error in handleMapCommand:", e);
    await sendFollowUp(inter, { content: "❌ Ошибка загрузки карты города. Попробуйте позже.", flags: 64 });
    return ack;
  }
}

// ============================================
// city_map_select — выбор участка в меню карты
// ============================================

export async function handleMapSelect(inter: ButtonInteraction, env: Env, _ctx: ExecutionContext): Promise<Response> {
  const guildId = String((inter as any).guild_id || "");
  const values = inter.data?.values || [];
  const plotId = Number(values[0]);

  if (!guildId || !plotId) {
    return Response.json({ type: 4, data: { content: "❌ Участок не выбран.", flags: 64 } });
  }

  const ack = await deferInteraction(inter, true);
  if (!ack.ok) {
    return new Response("Failed to defer interaction", { status: 500 });
  }

  try {
    const db = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });

    // Данные участка
    const plotRes = await db.execute({
      sql: `SELECT id, owner_type, owner_id, building_type, building_level, price, for_sale_price, unpaid_taxes_count
            FROM city_plots
            WHERE guild_id = ? AND id = ?`,
      args: [guildId, plotId],
    });
    const plot = plotRes.rows[0];

    // Шаблон участка из каталога (название, зона, разрешённые постройки)
    const template = PLOTS_CATALOG.find((p) => Number(p.id) === plotId);

    if (!plot || !template) {
      await sendFollowUp(inter, { content: "❌ Участок не найден. Возможно, карта города ещё не создана.", flags: 64 });
      return ack;
    }

    // Активный аукцион по участку (если есть)
    const auctionRes = await db.execute({
      sql: `SELECT highest_bid, highest_bidder_id, expires_at
            FROM plot_auctions
            WHERE guild_id = ? AND plot_id = ? AND status = 'active'
            ORDER BY id DESC
            LIMIT 1`,
      args: [guildId, plotId],
    });
    const auction = auctionRes.rows[0];

    // Владелец: пользователь или компания
    let ownerLabel = `${FREE_EMOJI} Свободен`;
    const ownerType = plot.owner_type as string | null;
    const ownerId = plot.owner_id as string | null;
    if (ownerType === "user" && ownerId) {
      ownerLabel = `<@${ownerId}>`;
    } else if (ownerType === "company" && ownerId) {
      const compRes = await db.execute({
        sql: "SELECT name, ticker FROM companies WHERE id = ? AND guild_id = ?",
        args: [Number(ownerId), guildId],
      });
      const comp = compRes.rows[0];
      ownerLabel = comp ? `🏢 **${comp.name}** (\`${comp.ticker}\`)` : `🏢 Компания #${ownerId}`;
    }

    const building = getBuilding(plot.building_type as string | null);
    const level = Number(plot.building_level) || 0;

    const fields: { name: string; value: string; inline?: boolean }[] = [
      { name: "📍 Зона", value: ZONE_LABELS[String(template.zone)] || String(template.zone), inline: true },
      { name: "👤 Владелец", value: ownerLabel, inline: true },
      { name: "💰 Цена участка", value: `${fmtCoins(Number(plot.price) || 0)} 🪙`, inline: true },
    ];

    if (building && level > 0) {
      fields.push({
        name: "🏗️ Постройка",
        value: `${building.emoji} **${building.name}** — уровень **${level}/3**`,
        inline: false,
      });
      const econ = BUILDINGS_CONFIG[plot.building_type as keyof typeof BUILDINGS_CONFIG];
      if (econ) {
        fields.push({
          name: "📈 Экономика",
          value: `Доход: **${fmtCoins(valueByLevel(econ.daily_revenue, level))} 🪙/сут** • Налог: **${fmtCoins(valueByLevel(econ.weekly_tax, level))} 🪙/нед**`,
          inline: false,
        });
      }
    } else {
      fields.push({ name: "🏗️ Постройка", value: "Нет — участок пуст", inline: false });
    }

    // Статус: аукцион или продажа
    if (auction) {
      const expiresSec = Math.floor((Number(auction.expires_at) || Date.now()) / 1000);
      const bidder = auction.highest_bidder_id ? `<@${auction.highest_bidder_id}>` : "—";
      fields.push({
        name: `${AUCTION_EMOJI} Аукцион активен`,
        value: `Ставка: **${fmtCoins(Number(auction.highest_bid) || 0)} 🪙** — ${bidder}\nЗавершение: <t:${expiresSec}:R>`,
        inline: false,
      });
    } else if (plot.for_sale_price != null) {
      fields.push({
        name: `${SALE_EMOJI} Выставлен на продажу`,
        value: `Цена: **${fmtCoins(Number(plot.for_sale_price))} 🪙**`,
        inline: false,
      });
    }

    // Задолженность по налогам
    const unpaidTaxes = Number(plot.unpaid_taxes_count) || 0;
    if (unpaidTaxes > 0) {
      fields.push({
        name: "⚠️ Задолженность по налогам",
        value: `Не оплачено недель: **${unpaidTaxes}**`,
        inline: false,
      });
    }

    // Разрешённые постройки из каталога
    const allowed = template.allowed_buildings;
    if (allowed.length > 0) {
      const allowedLabel = allowed
        .map((t) => {
          const b = BUILDINGS_CONFIG[t as keyof typeof BUILDINGS_CONFIG];
          return b ? `${b.emoji} ${b.name}` : String(t);
        })
        .join(", ");
      fields.push({ name: "✅ Разрешённые постройки", value: allowedLabel, inline: false });
    }

    await sendFollowUp(inter, {
      flags: 64,
      embeds: [
        {
          title: `🗺️ Участок #${plotId} — ${template.title}`,
          color: 0x5865F2,
          fields,
          footer: { text: "Карта города • /map" },
        },
      ],
    });
    return ack;
  } catch (e) {
    console.error("[Map] Error in handleMapSelect:", e);
    await sendFollowUp(inter, { content: "❌ Ошибка загрузки участка. Попробуйте позже.", flags: 64 });
    return ack;
  }
}
