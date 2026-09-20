// ============================================
// /auction — аукционы городских участков (Шаг 4)
// ============================================

import { createClient } from "@libsql/client";
import { CommandInteraction, Env, ExecutionContext } from "../types";
import { BUILDINGS_CONFIG, PLOTS_CATALOG } from "../city/catalog";

const fmt = (n: number): string => n.toLocaleString("ru-RU");

export async function handleAuctionCommand(inter: CommandInteraction, env: Env, _ctx: ExecutionContext): Promise<Response> {
  const db = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });

  const guildId = (inter as any).guild_id as string | undefined;
  const userId = (inter as any).member?.user?.id as string | undefined;

  const options = (inter.data?.options || []) as any[];
  const sub = options[0]?.name || "list";

  try {
    if (!guildId) {
      return Response.json({ type: 4, data: { content: "❌ Команда доступна только на сервере.", flags: 64 } });
    }

    if (sub === "bid") {
      return await handleBid(db, inter, guildId, userId || "");
    }
    return await handleList(db, guildId);
  } catch (e: any) {
    const msg = String(e?.message || e || "Неизвестная ошибка");
    return Response.json({ type: 4, data: { content: `❌ Ошибка аукциона: ${msg}`.slice(0, 1900), flags: 64 } });
  }
}

async function handleList(db: any, guildId: string): Promise<Response> {
  const nowSec = Math.floor(Date.now() / 1000);

  const auctionsResult = await db.execute({
    sql: `SELECT id, plot_id, highest_bid, highest_bidder_id, expires_at
          FROM plot_auctions
          WHERE guild_id = ? AND status = 'active' AND expires_at > ?
          ORDER BY expires_at ASC`,
    args: [guildId, nowSec],
  });

  const auctions = auctionsResult.rows || [];
  if (auctions.length === 0) {
    return Response.json({
      type: 4,
      data: { content: "🏛️ Активных аукционов участков сейчас нет.", flags: 64 },
    });
  }

  let description = "";
  for (const a of auctions) {
    const plotId = Number(a.plot_id);
    const expiresAt = Number(a.expires_at);
    const bid = Number(a.highest_bid) || 0;
    const leader = a.highest_bidder_id ? `<@${a.highest_bidder_id}>` : "— ставок нет —";

    const plotRow = await db.execute({
      sql: "SELECT building_type, building_level FROM city_plots WHERE guild_id = ? AND id = ?",
      args: [guildId, plotId],
    });
    const buildingType = plotRow.rows[0]?.building_type as string | null;
    const buildingLevel = Number(plotRow.rows[0]?.building_level) || 0;
    const buildingConfig = buildingType
      ? (BUILDINGS_CONFIG as Record<string, { name: string; emoji: string } | undefined>)[buildingType]
      : undefined;
    const buildingInfo = buildingConfig
      ? `${buildingConfig.emoji} ${buildingConfig.name} (ур. ${buildingLevel})`
      : "🚫 пустой участок";

    const plotTitle = PLOTS_CATALOG.find((p) => p.id === plotId)?.title || "Неизвестный участок";

    description += `**Участок #${plotId}** — ${plotTitle}\n`;
    description += `🏢 ${buildingInfo}\n`;
    description += `💰 Ставка: **${fmt(bid)} 🪙** • Лидер: ${leader}\n`;
    description += `⏳ Завершение: <t:${expiresAt}:R>\n\n`;
  }

  return Response.json({
    type: 4,
    data: {
      embeds: [
        {
          title: "🔨 Аукционы участков",
          description: description.slice(0, 4000),
          color: 0xF1C40F,
          footer: { text: "Ставка: /auction bid plot_id amount • Победитель забирает участок" },
        },
      ],
    },
  });
}

async function handleBid(db: any, inter: CommandInteraction, guildId: string, userId: string): Promise<Response> {
  const options = (inter.data?.options || []) as any[];
  const bidOptions: any[] = options[0]?.options || [];
  const getOpt = (name: string): any => bidOptions.find((o) => o.name === name)?.value;

  const plotId = Number(getOpt("plot_id"));
  const amount = Number(getOpt("amount"));
  const nowSec = Math.floor(Date.now() / 1000);

  if (!userId) {
    return Response.json({ type: 4, data: { content: "❌ Не удалось определить пользователя.", flags: 64 } });
  }
  if (!Number.isInteger(plotId) || plotId < 1 || plotId > 12) {
    return Response.json({ type: 4, data: { content: "❌ Некорректный ID участка (1-12).", flags: 64 } });
  }
  if (!Number.isInteger(amount) || amount <= 0) {
    return Response.json({ type: 4, data: { content: "❌ Размер ставки должен быть целым числом больше нуля.", flags: 64 } });
  }

  const auctionResult = await db.execute({
    sql: `SELECT id, highest_bid, highest_bidder_id, expires_at
          FROM plot_auctions
          WHERE guild_id = ? AND plot_id = ? AND status = 'active'
          ORDER BY id DESC LIMIT 1`,
    args: [guildId, plotId],
  });

  const auction = auctionResult.rows[0];
  if (!auction || Number(auction.expires_at) <= nowSec) {
    return Response.json({ type: 4, data: { content: `❌ Активного аукциона на участок #${plotId} нет.`, flags: 64 } });
  }

  const auctionId = Number(auction.id);
  const currentBid = Number(auction.highest_bid) || 0;
  const prevLeaderId = (auction.highest_bidder_id as string | null) || null;

  if (amount <= currentBid) {
    return Response.json({
      type: 4,
      data: { content: `❌ Ставка должна быть строго больше текущей (${fmt(currentBid)} 🪙).`, flags: 64 },
    });
  }
  if (prevLeaderId === userId) {
    return Response.json({ type: 4, data: { content: "❌ Вы уже лидер этого аукциона — дождитесь завершения.", flags: 64 } });
  }

  const userResult = await db.execute({
    sql: "SELECT coins FROM users WHERE user_id = ? AND guild_id = ?",
    args: [userId, guildId],
  });
  const coins = Number(userResult.rows[0]?.coins) || 0;
  if (coins < amount) {
    return Response.json({
      type: 4,
      data: { content: `❌ Недостаточно монет: нужно **${fmt(amount)} 🪙**, у вас **${fmt(coins)} 🪙**.`, flags: 64 },
    });
  }

  const results = await db.batch(
    [
      {
        sql: "UPDATE users SET coins = coins - ? WHERE user_id = ? AND guild_id = ? AND coins >= ?",
        args: [amount, userId, guildId, amount],
      },
      {
        sql: `UPDATE plot_auctions
              SET highest_bid = ?, highest_bidder_id = ?, highest_bidder_type = 'user'
              WHERE id = ? AND status = 'active' AND highest_bid = ?`,
        args: [amount, userId, auctionId, currentBid],
      },
    ],
    "write"
  );

  const deducted = (results[0].rowsAffected as number) === 1;
  const claimed = (results[1].rowsAffected as number) === 1;

  if (!claimed) {
    if (deducted) {
      await db.execute({
        sql: "UPDATE users SET coins = coins + ? WHERE user_id = ? AND guild_id = ?",
        args: [amount, userId, guildId],
      });
    }
    return Response.json({
      type: 4,
      data: { content: "❌ Ставка не принята: аукцион завершился или текущая ставка изменилась. Монеты возвращены.", flags: 64 },
    });
  }

  if (!deducted) {
    await db.execute({
      sql: "UPDATE plot_auctions SET highest_bid = ?, highest_bidder_id = ?, highest_bidder_type = ? WHERE id = ?",
      args: [currentBid, prevLeaderId, prevLeaderId ? "user" : null, auctionId],
    });
    return Response.json({ type: 4, data: { content: "❌ Недостаточно монет для ставки.", flags: 64 } });
  }

  if (prevLeaderId) {
    await db.execute({
      sql: "UPDATE users SET coins = coins + ? WHERE user_id = ? AND guild_id = ?",
      args: [currentBid, prevLeaderId, guildId],
    });
  }

  const plotTitle = PLOTS_CATALOG.find((p) => p.id === plotId)?.title || `Участок #${plotId}`;
  const expiresAt = Number(auction.expires_at);

  return Response.json({
    type: 4,
    data: {
      embeds: [
        {
          title: "🔨 Новая ставка на аукционе!",
          description:
            `**<@${userId}>** ставит **${fmt(amount)} 🪙** на участок #${plotId} — ${plotTitle}\n\n` +
            `💰 Текущая ставка: **${fmt(amount)} 🪙**\n` +
            (prevLeaderId ? `↩️ <@${prevLeaderId}> вернули его ставку (**${fmt(currentBid)} 🪙**)\n` : "") +
            `⏳ Аукцион завершится: <t:${expiresAt}:R>`,
          color: 0x2ECC71,
        },
      ],
    },
  });
}
