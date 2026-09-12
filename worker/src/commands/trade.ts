// Обмен предметами между игроками (/trade) и передача реликвий (/give-relic).

import { createClient } from "@libsql/client";
import { CommandInteraction, Env, ExecutionContext } from "../types";
import { UNIQUE_ITEMS, getRarityEmoji } from "../itemsCatalog";
import { getInventoryItemByItemId } from "../db/queries";

export async function handleTrade(
  inter: CommandInteraction,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const uid = inter.member?.user.id;
  const gid = inter.guild_id;
  if (!uid || !gid) return Response.json({ error: "No user or guild" }, { status: 400 });
  const targetOption = inter.data?.options?.find((o) => o.name === "user")?.value as string;
  const itemIdOption = inter.data?.options?.find((o) => o.name === "item_id")?.value as number;
  const priceOption = inter.data?.options?.find((o) => o.name === "price")?.value as number;
  if (!targetOption) {
    return Response.json({
      type: 4,
      data: { content: "❌ Укажите пользователя, с которым хотите совершить сделку!", flags: 64 },
    });
  }
  if (!itemIdOption) {
    return Response.json({
      type: 4,
      data: { content: "❌ Укажите ID предмета для продажи!", flags: 64 },
    });
  }
  if (priceOption === undefined || priceOption === null) {
    return Response.json({
      type: 4,
      data: { content: "❌ Укажите цену в монетах! (0 для подарка)", flags: 64 },
    });
  }
  ctx.waitUntil(
    (async () => {
      const webhookUrl = `https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${inter.token}/messages/@original`;
      try {
        const db = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });
        // Проверить, что предмет существует и принад��ежит отправителю
        const itemRes = await db.execute({
          sql: 'SELECT * FROM user_inventory WHERE id = ? AND user_id = ? AND guild_id = ?',
          args: [itemIdOption, uid, gid],
        });
        if (itemRes.rows.length === 0) {
          await fetch(webhookUrl, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              content: "❌ Предмет не найден в вашем инвентаре!",
              flags: 64,
            }),
          });
          return;
        }
        const item = itemRes.rows[0];
        if ((item.is_equipped as number) === 1) {
          await fetch(webhookUrl, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              content: "❌ Нельзя продать надетый предмет! Сначала снимите его через /unequip.",
              flags: 64,
            }),
          });
          return;
        }
        // Создать запись сделки
        const now = Math.floor(Date.now() / 1000);
        await db.execute({
          sql: 'INSERT INTO direct_trades (guild_id, sender_id, target_id, inventory_id, price, status, created_at) VALUES (?, ?, ?, ?, ?, \'pending\', ?)',
          args: [gid, uid, targetOption, itemIdOption, priceOption, now],
        });
        // Получить ID вставленной записи
        const tradeRes = await db.execute({ sql: 'SELECT last_insert_rowid() as id', args: [] });
        const tradeId = (tradeRes.rows[0]?.id as number) || 0;
        // Создать Embed с предложением
        const result = {
          embeds: [{
            title: "🤝 Предложение сделки!",
            description: `<@${uid}> предлагает <@${targetOption}> приобрести предмет:\n\n` +
              `📦 **${item.item_name}** (${getRarityEmoji(item.rarity as string)} ${item.rarity})\n` +
              `💰 Цена: **${priceOption.toLocaleString()} 🪙**`,
            color: 0x3498db,
          }],
          components: [
            {
              type: 1,
              components: [
                {
                  type: 2,
                  custom_id: `trade_accept_${tradeId}`,
                  style: 3,
                  label: "✅ Принять сделку",
                },
                {
                  type: 2,
                  custom_id: `trade_decline_${tradeId}`,
                  style: 4,
                  label: "❌ Отклонить",
                },
              ],
            },
          ],
        };
        await fetch(webhookUrl, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(result),
        });
      } catch (err) {
        console.error("[Trade] Error:", err);
        await fetch(webhookUrl, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content: "❌ Ошибка при создании сделки. Попробуйте позже.",
            flags: 64,
          }),
        });
      }
    })()
  );
  return Response.json({ type: 5 });
}

export async function handleGiveRelic(
  inter: CommandInteraction,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const uid = inter.member?.user.id;
  const gid = inter.guild_id;
  if (!uid || !gid) return Response.json({ error: "No user or guild" }, { status: 400 });
  // Проверка прав администратора
  const perms = (inter.member as any)?.permissions;
  const isAdmin = perms ? (BigInt(perms) & 8n) === 8n : false;
  if (!isAdmin) {
    return Response.json({
      type: 4,
      data: { content: "❌ Эта команда доступна только администраторам сервера!", flags: 64 },
    });
  }
  const itemIdOption = inter.data?.options?.find((o) => o.name === "item_id")?.value as string;
  const targetOption = inter.data?.options?.find((o) => o.name === "user")?.value as string;
  if (!itemIdOption) {
    return Response.json({
      type: 4,
      data: { content: "❌ Укажите item_id реликвии!", flags: 64 },
    });
  }
  if (!targetOption) {
    return Response.json({
      type: 4,
      data: { content: "❌ Укажите пользователя для выдачи реликвии!", flags: 64 },
    });
  }
  ctx.waitUntil(
    (async () => {
      const webhookUrl = `https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${inter.token}/messages/@original`;
      try {
        const db = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });
        // Проверить, есть ли такая реликвия в каталоге
        const relic = UNIQUE_ITEMS.find((r) => r.item_id === itemIdOption);
        if (!relic) {
          await fetch(webhookUrl, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              content: `❌ Реликвия с item_id **${itemIdOption}** не найдена в каталоге!`,
              flags: 64,
            }),
          });
          return;
        }
        // Проверить уникальность на сервере
        const existing = await getInventoryItemByItemId(db, itemIdOption, gid);
        if (existing) {
          const owner = existing.user_id as string;
          await fetch(webhookUrl, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              content: `❌ Этот артефакт уже существует на сервере у <@${owner}>!`,
              flags: 64,
            }),
          });
          return;
        }
        // Создать предмет
        const now = Math.floor(Date.now() / 1000);
        await db.execute({
          sql: 'INSERT INTO user_inventory (user_id, guild_id, item_name, item_id, item_type, rarity, slot, atk_bonus, def_bonus, crit_bonus, coin_bonus, is_equipped, description, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)',
          args: [targetOption, gid, relic.name, relic.item_id, 'relic', relic.rarity, relic.slot, relic.atk, relic.def, relic.crit, relic.coin, relic.description, now],
        });
        const result = {
          embeds: [{
            title: "🎁 Реликвия выдана!",
            description: `Администратор <@${uid}> выдал <@${targetOption}> реликвию:\n\n` +
              `📦 **${relic.name}** (${getRarityEmoji(relic.rarity)} ${relic.rarity})\n` +
              `⚔️ +${relic.atk} | 🛡️ +${relic.def} | 🎯 +${relic.crit}% | 🪙 +${relic.coin}%\n` +
              `💰 Цена: **${relic.price.toLocaleString()} 🪙**`,
            color: 0xf1c40f,
          }],
        };
        await fetch(webhookUrl, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(result),
        });
      } catch (err) {
        console.error("[GiveRelic] Error:", err);
        await fetch(webhookUrl, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content: "❌ Ошибка при выдаче реликвии. Попробуйте позже.",
            flags: 64,
          }),
        });
      }
    })()
  );
  return Response.json({ type: 5 });
}
