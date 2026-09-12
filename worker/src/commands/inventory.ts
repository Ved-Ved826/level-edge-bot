// Инвентарь и экипировка: /inventory, /gear, /equip, /unequip.

import { createClient } from "@libsql/client";
import { CommandInteraction, Env, ExecutionContext } from "../types";
import { formatInventoryItem } from "../utils/formatters";
import { getInventoryItem, getUserGear, getUserInventory } from "../db/queries";
import { getRarityEmoji } from "../itemsCatalog";

export async function handleInventory(
  inter: CommandInteraction,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const uid = inter.member?.user.id;
  const gid = inter.guild_id;
  if (!uid || !gid) return Response.json({ error: "No user or guild" }, { status: 400 });
  const pageOption = inter.data?.options?.find((o) => o.name === "page")?.value as number;
  const page = pageOption || 1;
  ctx.waitUntil(
    (async () => {
      const webhookUrl = `https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${inter.token}/messages/@original`;
      try {
        const db = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });
        const inventoryData = await getUserInventory(db, uid, gid, page);
        if (inventoryData.items.length === 0) {
          await fetch(webhookUrl, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              content: "🎒 Ваш инвентарь пуст! Купите предметы на рынке или найдите дроп.",
              flags: 64,
            }),
          });
          return;
        }
        let description = "";
        for (const item of inventoryData.items) {
          description += formatInventoryItem(item, item.id as number);
        }
        const result = {
          embeds: [{
            title: `🎒 Инвентарь пользователя`,
            description: description,
            color: 0x5865f2,
            footer: { text: `Страница ${inventoryData.page} из ${inventoryData.maxPages} • Всего предметов: ${inventoryData.total}` },
          }],
          components: inventoryData.maxPages > 1 ? [
            {
              type: 1,
              components: [
                { type: 2, custom_id: `inventory_page_prev_${page}`, style: 2, label: "◀ Назад", disabled: page <= 1 },
                { type: 2, custom_id: `inventory_page_next_${page}`, style: 2, label: "Вперед ▶", disabled: page >= inventoryData.maxPages },
              ],
            },
          ] : [],
        };
        await fetch(webhookUrl, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(result),
        });
      } catch (err) {
        console.error("[Inventory] Error:", err);
        await fetch(webhookUrl, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content: "❌ Ошибка при загрузке инвентаря. Попробуйте позже.",
            flags: 64,
          }),
        });
      }
    })()
  );
  return Response.json({ type: 5 });
}

export async function handleGear(
  inter: CommandInteraction,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const uidOption = inter.data?.options?.find((o) => o.name === "user")?.value as string | undefined;
  const uid = uidOption || inter.member?.user.id;
  const gid = inter.guild_id;
  if (!gid || !uid) return Response.json({ error: "No guild or user" }, { status: 400 });
  ctx.waitUntil(
    (async () => {
      const webhookUrl = `https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${inter.token}/messages/@original`;
      try {
        const db = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });
        const gear = await getUserGear(db, uid, gid);
        let description = "";
        const slotIcons: Record<string, string> = {
          weapon: '🗡️',
          armor: '🛡️',
          ring: '💍',
          amulet: '📿',
        };
        const slotNames: Record<string, string> = {
          weapon: 'Оружие',
          armor: 'Броня',
          ring: 'Кольцо',
          amulet: 'Амулет',
        };
        for (const slot of ['weapon', 'armor', 'ring', 'amulet'] as const) {
          const item = gear[slot];
          if (item) {
            description += `${slotIcons[slot]} **${slotNames[slot]}:** ${getRarityEmoji(item.rarity as string)} **${item.item_name}**\n`;
          } else {
            description += `${slotIcons[slot]} **${slotNames[slot]}:** Нет\n`;
          }
        }
        const result = {
          embeds: [{
            title: `🛡️ Снаряжение пользователя`,
            description: description,
            color: 0x2ecc71,
            fields: [{
              name: "Характеристики",
              value: `⚔️ Атака: **+${gear.totalAtk}** | 🛡️ Защита: **+${gear.totalDef}** | 🎯 Крит: **+${gear.totalCrit}%** | 🪙 Монеты: **+${gear.totalCoin}%**`,
              inline: false,
            }],
          }],
        };
        await fetch(webhookUrl, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(result),
        });
      } catch (err) {
        console.error("[Gear] Error:", err);
        await fetch(webhookUrl, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content: "❌ Ошибка при загрузке снаряжения. Попробуйте позже.",
            flags: 64,
          }),
        });
      }
    })()
  );
  return Response.json({ type: 5 });
}

export async function handleEquip(
  inter: CommandInteraction,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const uid = inter.member?.user.id;
  const gid = inter.guild_id;
  if (!uid || !gid) return Response.json({ error: "No user or guild" }, { status: 400 });
  const idOption = inter.data?.options?.find((o) => o.name === "id")?.value as number;
  if (!idOption) {
    return Response.json({
      type: 4,
      data: { content: "❌ Укажите ID предмета для экипировки!", flags: 64 },
    });
  }
  ctx.waitUntil(
    (async () => {
      const webhookUrl = `https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${inter.token}/messages/@original`;
      try {
        const db = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });
        const item = await getInventoryItem(db, idOption, uid, gid);
        if (!item) {
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
        const slot = item.slot as string;
        if (!['weapon', 'armor', 'ring', 'amulet'].includes(slot)) {
          await fetch(webhookUrl, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              content: `❌ Нельзя экипировать этот предмет в слот ${slot}!`,
              flags: 64,
            }),
          });
          return;
        }
        // Снять старую вещь из этого слота
        await db.execute({
          sql: 'UPDATE user_inventory SET is_equipped = 0 WHERE user_id = ? AND guild_id = ? AND slot = ?',
          args: [uid, gid, slot],
        });
        // Надеть новую вещь
        await db.execute({
          sql: 'UPDATE user_inventory SET is_equipped = 1 WHERE id = ?',
          args: [idOption],
        });
        const result = {
          embeds: [{
            title: "✅ Предмет экипирован!",
            description: `Вы успешно экипировали **${item.item_name}** в слот **${slot}**!`,
            color: 0x2ecc71,
          }],
        };
        await fetch(webhookUrl, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(result),
        });
      } catch (err) {
        console.error("[Equip] Error:", err);
        await fetch(webhookUrl, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content: "❌ Ошибка при экипировке предмета. Попробуйте позже.",
            flags: 64,
          }),
        });
      }
    })()
  );
  return Response.json({ type: 5 });
}

export async function handleUnequip(
  inter: CommandInteraction,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const uid = inter.member?.user.id;
  const gid = inter.guild_id;
  if (!uid || !gid) return Response.json({ error: "No user or guild" }, { status: 400 });
  const slotOption = inter.data?.options?.find((o) => o.name === "slot")?.value as string;
  if (!slotOption || !['weapon', 'armor', 'ring', 'amulet'].includes(slotOption)) {
    return Response.json({
      type: 4,
      data: {
        content: "❌ Укажите правильный слот: weapon, armor, ring или amulet!",
        flags: 64,
      },
    });
  }
  ctx.waitUntil(
    (async () => {
      const webhookUrl = `https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${inter.token}/messages/@original`;
      try {
        const db = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });
        // Проверить, есть ли вещь в этом слоте
        const itemRes = await db.execute({
          sql: 'SELECT item_name FROM user_inventory WHERE user_id = ? AND guild_id = ? AND slot = ? AND is_equipped = 1',
          args: [uid, gid, slotOption],
        });
        if (itemRes.rows.length === 0) {
          await fetch(webhookUrl, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              content: `❌ В слоте **${slotOption}** нет надетого предмета!`,
              flags: 64,
            }),
          });
          return;
        }
        // Снять вещь
        await db.execute({
          sql: 'UPDATE user_inventory SET is_equipped = 0 WHERE user_id = ? AND guild_id = ? AND slot = ?',
          args: [uid, gid, slotOption],
        });
        const result = {
          embeds: [{
            title: "❌ Предмет снят",
            description: `Снаряжение из слота **${slotOption}** снято.`,
            color: 0xe74c3c,
          }],
        };
        await fetch(webhookUrl, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(result),
        });
      } catch (err) {
        console.error("[Unequip] Error:", err);
        await fetch(webhookUrl, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content: "❌ Ошибка при снятии предмета. Попробуйте позже.",
            flags: 64,
          }),
        });
      }
    })()
  );
  return Response.json({ type: 5 });
}
