import { createClient } from "@libsql/client";
import satori from "satori";
import { Resvg, initWasm } from "@resvg/resvg-wasm";
// @ts-ignore
import resvgWasm from "@resvg/resvg-wasm/index_bg.wasm";
// @ts-ignore
import fontData from "../../assets/Inter-Regular.ttf";

import { ButtonInteraction, CommandInteraction, Env, ExecutionContext } from "../types";
import { BUILDINGS_CONFIG, PLOTS_CATALOG } from "../city/catalog";
import { CityMapCard, PlotCardData } from "../CityMapCard";

let isWasmInitialized = false;
let wasmInitPromise: Promise<void> | null = null;
function ensureWasmInitialized(): Promise<void> {
  if (isWasmInitialized) return Promise.resolve();
  if (!wasmInitPromise) {
    wasmInitPromise = (async () => {
      try {
        await initWasm(resvgWasm);
      } catch (e: any) {
        const msg = String(e?.message || e);
        // Повторный вызов initWasm в том же изоляте бросает
        // "Already initialized" — это не ошибка, WASM уже готов.
        if (msg.includes("Already initialized")) {
          // глотаем и считаем инициализацию успешной
        } else {
          wasmInitPromise = null; // позволяем повторную попытку при следующем вызове
          throw e;
        }
      }
      isWasmInitialized = true;
    })();
  }
  return wasmInitPromise;
}

const ZONE_EMOJIS: Record<string, string> = {
  mountain: "🏔️",
  suburb: "🌾",
  highway: "🛣️",
  center: "🏙️",
  coast: "🌊",
};

const ZONE_LABELS: Record<string, string> = {
  mountain: "Горный склон",
  suburb: "Пригородная долина",
  highway: "Шоссе / Проспект",
  center: "Деловой центр",
  coast: "Морская гавань",
};

function fmtCoins(value: number): string {
  return Math.round(value).toLocaleString("ru-RU");
}

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
        const b = plot?.building_type ? BUILDINGS_CONFIG[plot.building_type as keyof typeof BUILDINGS_CONFIG] : null;
        const level = Number(plot?.building_level) || 0;
        description =
          b && level > 0
            ? `${b.emoji} ${b.name} • ур. ${level}`
            : `🕊️ Свободен • от ${fmtCoins(Number(p.base_price))} 🪙`;
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
        type: 3,
        custom_id: "city_map_select",
        placeholder: "🔍 Выберите участок для осмотра",
        options,
      },
    ],
  };
}

export async function handleMapCommand(inter: CommandInteraction, env: Env, _ctx: ExecutionContext): Promise<Response> {
  const guildId = String((inter as any).guild_id || "");
  if (!guildId) {
    return Response.json({ type: 4, data: { content: "❌ Команда доступна только на сервере.", flags: 64 } });
  }

  try {
    const db = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });

    // Параллельный запрос всех данных
    const [plotsRes, auctionsRes, reserveRes, companiesRes] = await Promise.all([
      db.execute({
        sql: `SELECT id, owner_type, owner_id, building_type, building_level, price, for_sale_price, unpaid_taxes_count
              FROM city_plots WHERE guild_id = ? ORDER BY id`,
        args: [guildId],
      }),
      db.execute({
        sql: `SELECT plot_id, highest_bid, highest_bidder_id, expires_at
              FROM plot_auctions WHERE guild_id = ? AND status = 'active'`,
        args: [guildId],
      }),
      db.execute({
        sql: "SELECT balance FROM server_reserve WHERE guild_id = ?",
        args: [guildId],
      }),
      db.execute({
        sql: "SELECT id, name, ticker FROM companies WHERE guild_id = ?",
        args: [guildId],
      }),
    ]);

    const plotsMap = new Map<number, any>();
    for (const row of plotsRes.rows || []) plotsMap.set(Number(row.id), row);

    const auctionsMap = new Map<number, any>();
    for (const row of auctionsRes.rows || []) auctionsMap.set(Number(row.plot_id), row);

    const treasury = Number(reserveRes.rows[0]?.balance) || 0;

    const companies = new Map<number, string>();
    for (const row of companiesRes.rows || []) {
      // Без эмодзи: Inter не содержит глифов эмодзи — Satori рисует «тофу».
      companies.set(Number(row.id), String(row.ticker || row.name));
    }

    let occupiedCount = 0;

    // Подготавливаем данные 12 участков для Satori карточки
    const cardPlots: PlotCardData[] = PLOTS_CATALOG.map((cat) => {
      const p = plotsMap.get(cat.id);
      const auction = auctionsMap.get(cat.id);
      const isFree = !p || p.owner_id == null;
      if (!isFree) occupiedCount++;

      let ownerLabel = isFree ? "Город" : "Игрок";
      if (p?.owner_type === "company" && p?.owner_id) {
        ownerLabel = companies.get(Number(p.owner_id)) || "Компания";
      } else if (p?.owner_type === "user" && p?.owner_id) {
        ownerLabel = `ID:${String(p.owner_id).slice(-4)}`;
      }

      const bType = p?.building_type as keyof typeof BUILDINGS_CONFIG | undefined;
      const bCfg = bType ? BUILDINGS_CONFIG[bType] : null;
      const bLevel = Number(p?.building_level) || 0;
      const lvlIdx = Math.min(Math.max(bLevel, 1), 3) - 1;

      return {
        id: cat.id,
        zone: cat.zone,
        zoneTitle: ZONE_LABELS[cat.zone] || cat.zone,
        zoneEmoji: ZONE_EMOJIS[cat.zone] || "📍",
        title: cat.title,
        ownerLabel,
        isFree,
        basePrice: Number(cat.base_price) || 3000,
        forSalePrice: p?.for_sale_price != null ? Number(p.for_sale_price) : null,
        buildingType: bType || null,
        buildingName: bCfg ? bCfg.name : null,
        buildingEmoji: bCfg ? bCfg.emoji : null,
        buildingLevel: bLevel,
        dailyRevenue: bCfg ? bCfg.daily_revenue[lvlIdx] : 0,
        weeklyTax: bCfg ? bCfg.weekly_tax[lvlIdx] : 0,
        isAuction: Boolean(auction),
        auctionBid: Number(auction?.highest_bid) || 0,
        hasUnpaidTaxes: Number(p?.unpaid_taxes_count) > 0,
      };
    });

    // Инициализация WASM и генерация PNG через Satori + Resvg
    await ensureWasmInitialized();

    const svg = await satori(
      CityMapCard({
        guildName: "Город сервера",
        treasury,
        occupiedCount,
        totalCount: PLOTS_CATALOG.length,
        plots: cardPlots,
      }),
      {
        width: 1200, height: 840,
        fonts: [{ name: "Inter", data: fontData as ArrayBuffer, weight: 400, style: "normal" }],
      }
    );

    const resvg = new Resvg(svg, { fitTo: { mode: "width", value: 1200 } });
    const pngBuffer = resvg.render().asPng();

    // Отправляем картинку как attachment (в точности как /rank!)
    const fd = new FormData();
    fd.append(
      "payload_json",
      JSON.stringify({
        type: 4,
        data: {
          embeds: [
            {
              title: "🗺️ Карта города",
              image: { url: "attachment://city-map.png" },
              color: 0x5865f2,
              footer: { text: "Выберите участок в меню ниже для осмотра или покупки" },
            },
          ],
          components: [buildMapSelectRow(plotsMap, auctionsMap)],
        },
      })
    );
    fd.append("files[0]", new Blob([pngBuffer as any], { type: "image/png" }), "city-map.png");

    return new Response(fd);
  } catch (e: any) {
    console.error("[Map] Error generating map card:", e);
    return Response.json({
      type: 4,
      data: { content: `❌ Ошибка генерации карты города: ${e.message}`, flags: 64 },
    });
  }
}

export async function handleMapSelect(inter: ButtonInteraction, env: Env, _ctx: ExecutionContext): Promise<Response> {
  const guildId = String((inter as any).guild_id || "");
  const values = inter.data?.values || [];
  const plotId = Number(values[0]);

  if (!guildId || !plotId) {
    return Response.json({ type: 4, data: { content: "❌ Участок не выбран.", flags: 64 } });
  }

  try {
    const db = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });

    const [plotRes, auctionRes] = await Promise.all([
      db.execute({
        sql: `SELECT id, owner_type, owner_id, building_type, building_level, price, for_sale_price, unpaid_taxes_count
              FROM city_plots WHERE guild_id = ? AND id = ?`,
        args: [guildId, plotId],
      }),
      db.execute({
        sql: `SELECT highest_bid, highest_bidder_id, expires_at
              FROM plot_auctions WHERE guild_id = ? AND plot_id = ? AND status = 'active'
              ORDER BY id DESC LIMIT 1`,
        args: [guildId, plotId],
      }),
    ]);

    const plot = plotRes.rows[0];
    const template = PLOTS_CATALOG.find((p) => Number(p.id) === plotId);

    if (!plot || !template) {
      return Response.json({ type: 4, data: { content: "❌ Участок не найден в базе.", flags: 64 } });
    }

    const auction = auctionRes.rows[0];

    let ownerLabel = "🕊️ Свободен";
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

    const bType = plot.building_type as keyof typeof BUILDINGS_CONFIG | undefined;
    const bCfg = bType ? BUILDINGS_CONFIG[bType] : null;
    const level = Number(plot.building_level) || 0;
    const lvlIdx = Math.min(Math.max(level, 1), 3) - 1;

    const fields: { name: string; value: string; inline?: boolean }[] = [
      { name: "📍 Зона", value: ZONE_LABELS[String(template.zone)] || String(template.zone), inline: true },
      { name: "👤 Владелец", value: ownerLabel, inline: true },
      { name: "💰 Цена покупки", value: `${fmtCoins(Number(plot.price) || 0)} 🪙`, inline: true },
    ];

    if (bCfg && level > 0) {
      fields.push({
        name: "🏗️ Постройка",
        value: `${bCfg.emoji} **${bCfg.name}** — уровень **${level}/3**`,
        inline: false,
      });
      fields.push({
        name: "📈 Экономика",
        value: `Доход: **${fmtCoins(bCfg.daily_revenue[lvlIdx])} 🪙/сут** • Налог: **${fmtCoins(bCfg.weekly_tax[lvlIdx])} 🪙/нед**`,
        inline: false,
      });
    } else {
      fields.push({ name: "🏗️ Постройка", value: "Нет — участок пуст", inline: false });
    }

    if (auction) {
      const expiresSec = Math.floor((Number(auction.expires_at) || Date.now()) / 1000);
      const bidder = auction.highest_bidder_id ? `<@${auction.highest_bidder_id}>` : "—";
      fields.push({
        name: "🔨 Аукцион активен",
        value: `Ставка: **${fmtCoins(Number(auction.highest_bid) || 0)} 🪙** — ${bidder}\nЗавершение: <t:${expiresSec}:R>`,
        inline: false,
      });
    } else if (plot.for_sale_price != null) {
      fields.push({
        name: "🏷️ Выставлен на продажу",
        value: `Цена: **${fmtCoins(Number(plot.for_sale_price))} 🪙**`,
        inline: false,
      });
    }

    const unpaidTaxes = Number(plot.unpaid_taxes_count) || 0;
    if (unpaidTaxes > 0) {
      fields.push({
        name: "⚠️ Задолженность по налогам",
        value: `Не оплачено недель: **${unpaidTaxes}**`,
        inline: false,
      });
    }

    const allowed = template.allowed_buildings;
    if (allowed && allowed.length > 0) {
      const allowedLabel = allowed
        .map((t) => {
          const b = BUILDINGS_CONFIG[t as keyof typeof BUILDINGS_CONFIG];
          return b ? `${b.emoji} ${b.name}` : String(t);
        })
        .join(", ");
      fields.push({ name: "✅ Разрешённые постройки", value: allowedLabel, inline: false });
    }

    return Response.json({
      type: 4,
      data: {
        flags: 64,
        embeds: [
          {
            title: `🗺️ Участок #${plotId} — ${template.title}`,
            color: 0x5865F2,
            fields,
            footer: { text: "Карта города • /map" },
          },
        ],
      },
    });
  } catch (e: any) {
    console.error("[MapSelect] Error:", e);
    return Response.json({
      type: 4,
      data: { content: `❌ Ошибка осмотра участка: ${e.message}`, flags: 64 },
    });
  }
}
