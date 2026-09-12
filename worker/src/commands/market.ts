// Рынок друзей (/market) и быстрый автобай хлама (/sell-junk).

import { createClient } from "@libsql/client";
import { CommandInteraction, Env, ExecutionContext } from "../types";
import { addMarketListing, getMarketListings } from "../db/queries";
import { getRarityEmoji } from "../itemsCatalog";

export async function handleSellJunk(
  inter: CommandInteraction,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const uid = inter.member?.user.id;
  const gid = inter.guild_id;
  if (!uid || !gid) return Response.json({ error: "No user or guild" }, { status: 400 });
          const junkItemIdOption = (inter.data?.options as any[])?.find((o: any) => o.name === "item_id")?.value as number | undefined;
ctx.waitUntil(
    (async () => {
      const webhookUrl = `https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${inter.token}/messages/@original`;
      try {
        const db = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });
        // Выбираем все предметы типа 'junk' пользователя
        const junkRes = junkItemIdOption
          ? await db.execute({
              sql: "SELECT id, item_name, sell_price FROM user_inventory WHERE user_id = ? AND guild_id = ? AND item_type = 'junk' AND id = ?",
              args: [uid, gid, junkItemIdOption],
            })
          : await db.execute({
              sql: "SELECT id, item_name, sell_price FROM user_inventory WHERE user_id = ? AND guild_id = ? AND item_type = 'junk'",
              args: [uid, gid],
            });
        const junkItems = junkRes.rows;
        if (junkItems.length === 0) {
          await fetch(webhookUrl, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              content: junkItemIdOption
                ? `❌ Предмет с ID **${junkItemIdOption}** не найден среди вашего хлама!`
                : "❌ У вас нет хлама для быстрой продажи!",
              flags: 64, // Скрытое сообщение
            }),
          });
          return;
        }
        // Достаём class_id для проверки бонуса техномага
        const classRes = await db.execute({
          sql: "SELECT class_id FROM users WHERE user_id = ? AND guild_id = ?",
          args: [uid, gid],
        });
        const classId = classRes.rows.length > 0 ? (classRes.rows[0].class_id as string | null) : null;
        const isArtificer = classId === 'artificer';
        // Считаем сумму и количество
        let totalCoins = 0;
        const itemIds: number[] = [];
        for (const item of junkItems) {
          totalCoins += (item.sell_price as number) || 10;
          itemIds.push(item.id as number);
        }
        // Бонус Техномага (+25% монет)
        if (isArtificer) {
          totalCoins = Math.round(totalCoins * 1.25);
        }
        // Атомарно начисляем монеты
        await db.execute({
          sql: "UPDATE users SET coins = coins + ? WHERE user_id = ? AND guild_id = ?",
          args: [totalCoins, uid, gid],
        });
        // Удаляем проданные предметы
        const placeholders = itemIds.map(() => '?').join(', ');
        await db.execute({
          sql: `DELETE FROM user_inventory WHERE user_id = ? AND guild_id = ? AND item_type = 'junk' AND id IN (${placeholders})`,
          args: [uid, gid, ...itemIds],
        });
        // Отправляем красивый Embed
        await fetch(webhookUrl, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            embeds: [{
              title: "💰 Хлам успешно продан Скупщику!",
              description: `Продано предметов: **${junkItems.length} шт.**\nПолучено: **+${totalCoins.toLocaleString()} 🪙**${isArtificer ? '\n\n⚡ Бонус Техномага (+25%): активирован!' : ''}`,
              color: 0xF1C40F,
              footer: { text: isArtificer ? "LevelEdge Marketplace (Техномаг)" : "LevelEdge Marketplace" },
            }],
            components: [],
          }),
        });
      } catch (err) {
        console.error("[SellJunk] Error:", err);
        await fetch(webhookUrl, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content: "❌ Произошла ошибка при продаже хлама.",
            flags: 64,
          }),
        });
      }
    })()
  );
  return Response.json({ type: 5 });
}

export async function handleMarket(
  inter: CommandInteraction,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const uid = inter.member?.user.id;
  const gid = inter.guild_id;
  if (!uid || !gid) return Response.json({ error: "No user or guild" }, { status: 400 });
  const actionOption = inter.data?.options?.find((o) => o.name === "action")?.value as string | undefined;
  const action = actionOption || "browse";
  ctx.waitUntil(
    (async () => {
      const webhookUrl = `https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${inter.token}/messages/@original`;
      try {
        const db = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });
        if (action === "browse") {
          const pageOption = inter.data?.options?.find((o) => o.name === "page")?.value as number;
          const page = pageOption || 1;
          const marketData = await getMarketListings(db, gid, page);
          if (marketData.listings.length === 0) {
            await fetch(webhookUrl, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                content: "🛒 Рынок пуст! Начните торговлю с помощью `/market sell`.",
                flags: 64,
              }),
            });
            return;
          }
          let description = "";
          for (const listing of marketData.listings) {
            description += `📦 **${listing.item_name}** (${getRarityEmoji(listing.rarity as string)} ${listing.rarity})\n` +
              `└ ⚔️ +${listing.atk_bonus} | 🛡️ +${listing.def_bonus} | 🎯 +${listing.crit_bonus}% | 🪙 +${listing.coin_bonus}%\n` +
              `└ 🛍️ Продавец: <@${listing.seller_id}> | 💰 Цена: **${listing.price.toLocaleString()} 🪙**\n\n`;
          }
          const result = {
            embeds: [{
              title: "🛒 Рынок",
              description: description,
              color: 0x3498db,
              footer: { text: `Страница ${marketData.page} из ${marketData.maxPages} • Всего лотов: ${marketData.total}` },
            }],
            components: marketData.maxPages > 1 ? [
              {
                type: 1,
                components: [
                  { type: 2, custom_id: `market_page_prev_${page}`, style: 2, label: "◀ Назад", disabled: page <= 1 },
                  { type: 2, custom_id: `market_page_next_${page}`, style: 2, label: "Вперед ▶", disabled: page >= marketData.maxPages },
                ],
              },
            ] : [],
          };
          await fetch(webhookUrl, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(result),
          });
        } else if (action === "sell") {
          const itemOption = inter.data?.options?.find((o) => o.name === "item_id")?.value as number;
          const priceOption = inter.data?.options?.find((o) => o.name === "price")?.value as number;
          if (!itemOption || !priceOption) {
            await fetch(webhookUrl, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                content: "❌ Используйте: `/market sell item_id:ID price:ЦЕНА`",
                flags: 64,
              }),
            });
            return;
          }
          // C13: цена должна быть строго положительной. Лот с отрицательной ценой
          // = печать монет (покупатель получал деньги вместо списания).
          if (priceOption <= 0) {
            await fetch(webhookUrl, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                content: "❌ Цена должна быть больше 0 🪙!",
                flags: 64,
              }),
            });
            return;
          }
          // Проверить предмет
          const itemRes = await db.execute({
            sql: 'SELECT * FROM user_inventory WHERE id = ? AND user_id = ? AND guild_id = ?',
            args: [itemOption, uid, gid],
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
          if ((itemRes.rows[0].is_equipped as number) === 1) {
            await fetch(webhookUrl, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                content: "❌ Нельзя выставить на продажу надетый предмет! Сначала снимите его через /unequip.",
                flags: 64,
              }),
            });
            return;
          }
          // Добавить лот
          const listingId = await addMarketListing(db, gid, uid, itemOption, priceOption);
          const item = itemRes.rows[0];
          const result = {
            embeds: [{
              title: "✅ Лот выставлен на рынок!",
              description: `Вы выставили на продажу:\n\n` +
                `📦 **${item.item_name}** (${getRarityEmoji(item.rarity as string)} ${item.rarity})\n` +
                `💰 Цена: **${priceOption.toLocaleString()} 🪙**`,
              color: 0x2ecc71,
            }],
          };
          await fetch(webhookUrl, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(result),
          });
        } else if (action === "buy") {
          const itemOption = inter.data?.options?.find((o) => o.name === "item_id")?.value as number;
          if (!itemOption) {
            await fetch(webhookUrl, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                content: "❌ Используйте: `/market buy item_id:ID`",
                flags: 64,
              }),
            });
            return;
          }
          const listingRes = await db.execute({
            // C13: фильтр по guild_id — иначе покупатель гильдии A мог купить лот гильдии B
            sql: 'SELECT * FROM market_listings WHERE id = ? AND guild_id = ?',
            args: [itemOption, gid],
          });
          if (listingRes.rows.length === 0) {
            await fetch(webhookUrl, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                content: "❌ Лот не найден!",
                flags: 64,
              }),
            });
            return;
          }
          const listing = listingRes.rows[0];
          const sellerId = listing.seller_id as string;
          const inventoryId = listing.inventory_id as number;
          const price = listing.price as number;
          // Проверить баланс покупателя
          const buyerRes = await db.execute({
            sql: 'SELECT coins FROM users WHERE user_id = ? AND guild_id = ?',
            args: [uid, gid],
          });
          if (buyerRes.rows.length === 0) {
            await fetch(webhookUrl, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                content: "❌ У вас нет данных в базе! Напишите сообщение, чтобы зарегистрироваться.",
                flags: 64,
              }),
            });
            return;
          }
          const buyerCoins = (buyerRes.rows[0].coins as number) || 0;
          if (buyerCoins < price) {
            await fetch(webhookUrl, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                content: `❌ У вас недостаточно монет для этой сделки! Текущий баланс: **${buyerCoins.toLocaleString()} 🪙**`,
                flags: 64,
              }),
            });
            return;
          }
          // Проверить, что предмет всё ещё у продавца
          const itemRes = await db.execute({
            // C13: фильтр по guild_id — предмет чужой гильдии недоступен
            sql: 'SELECT * FROM user_inventory WHERE id = ? AND guild_id = ?',
            args: [inventoryId, gid],
          });
          if (itemRes.rows.length === 0) {
            await fetch(webhookUrl, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                content: "⚠️ Предмет уже продан или удалён!",
                flags: 64,
              }),
            });
            return;
          }
          const currentItem = itemRes.rows[0];
          if (currentItem.user_id as string !== sellerId) {
            await fetch(webhookUrl, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                content: "⚠️ Предмет уже продан или удалён!",
                flags: 64,
              }),
            });
            return;
          }
          // Передача монет и предмета
          // C13: списание покупателя атомарное — с проверкой баланса в самом UPDATE.
          // Два параллельных покупателя больше не могут оба пройти проверку выше.
          const buyerDeduct = await db.execute({
            sql: 'UPDATE users SET coins = coins - ? WHERE user_id = ? AND guild_id = ? AND coins >= ?',
            args: [price, uid, gid, price],
          });
          if (!buyerDeduct.rowsAffected) {
            await fetch(webhookUrl, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                content: "❌ Недостаточно монет для покупки — возможно, баланс уже изменился. Попробуйте снова.",
                flags: 64,
              }),
            });
            return;
          }
          await db.execute({
            sql: 'UPDATE users SET coins = coins + ? WHERE user_id = ? AND guild_id = ?',
            args: [price, sellerId, gid],
          });
          await db.execute({
            sql: 'UPDATE user_inventory SET user_id = ? WHERE id = ? AND guild_id = ?',
            args: [uid, inventoryId, gid],
          });
          // Удалить лот
          await db.execute({
            sql: 'DELETE FROM market_listings WHERE id = ? AND guild_id = ?',
            args: [itemOption, gid],
          });
          const result = {
            embeds: [{
              title: "🎉 Сделка успешна!",
              description: `Вы купили **${currentItem.item_name}** за **${price.toLocaleString()} 🪙**!\n\n` +
                `💰 <@${sellerId}> получил свои монеты.`,
              color: 0x2ecc71,
            }],
          };
          await fetch(webhookUrl, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(result),
          });
        } else {
          await fetch(webhookUrl, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              content: "❌ Используйте: /market browse, /market sell item_id:X price:Y, /market buy item_id:X",
              flags: 64,
            }),
          });
        }
      } catch (err) {
        console.error("[Market] Error:", err);
        await fetch(webhookUrl, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content: "❌ Ошибка при работе с рынком. Попробуйте позже.",
            flags: 64,
          }),
        });
      }
    })()
  );
  return Response.json({ type: 5 });
}
