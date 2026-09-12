// Кузница /forge: перековка и улучшение экипировки.

import { createClient } from "@libsql/client";
import { CommandInteraction, Env, ExecutionContext } from "../types";
import { ensureColumnExists } from "../db/queries";

export async function handleForge(
  inter: CommandInteraction,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const uid = inter.member?.user.id;
  const gid = inter.guild_id;
  if (!uid || !gid) return Response.json({ error: "No user or guild" }, { status: 400 });
  const forgeIdOption = inter.data?.options?.find((o) => o.name === "id")?.value as number;
  if (!forgeIdOption) {
    return Response.json({
      type: 4,
      data: { content: "❌ Укажите ID предмета для заточки!", flags: 64 },
    });
  }
  ctx.waitUntil(
    (async () => {
      const webhookUrl = `https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${inter.token}/messages/@original`;
      try {
        const db = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });
        await ensureColumnExists(db, 'users', 'last_forge_at', 'INTEGER DEFAULT 0');
        const userRes = await db.execute({
          sql: 'SELECT coins, last_forge_at FROM users WHERE user_id = ? AND guild_id = ?',
          args: [uid, gid],
        });
        if (userRes.rows.length === 0) {
          await fetch(webhookUrl, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content: "❌ Данные пользователя не найдены." }),
          });
          return;
        }
        const forgeCoins = (userRes.rows[0].coins as number) || 0;
        const lastForgeAt = (userRes.rows[0].last_forge_at as number) || 0;
        const forgeNow = Date.now();
        const forgeCooldownMs = 12 * 60 * 60 * 1000;
        const timeSinceForge = forgeNow - lastForgeAt;
        if (timeSinceForge < forgeCooldownMs) {
          const remainingMs = forgeCooldownMs - timeSinceForge;
          const remH = Math.floor(remainingMs / 3600000);
          const remM = Math.floor((remainingMs % 3600000) / 60000);
          await fetch(webhookUrl, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content: `⏳ Кузнец отдыхает! Следующая попытка заточки будет доступна через **${remH} ч. ${remM} мин.**` }),
          });
          return;
        }
        if (forgeCoins < 1500) {
          await fetch(webhookUrl, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content: `❌ Для заточки требуется **1,500 🪙**. Ваш баланс: **${forgeCoins.toLocaleString()} 🪙**.` }),
          });
          return;
        }
        const forgeItemRes = await db.execute({
          sql: 'SELECT * FROM user_inventory WHERE id = ? AND user_id = ? AND guild_id = ?',
          args: [forgeIdOption, uid, gid],
        });
        if (forgeItemRes.rows.length === 0) {
          await fetch(webhookUrl, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content: "❌ Предмет не найден в вашем инвентаре!" }),
          });
          return;
        }
        const forgeItem = forgeItemRes.rows[0];
        // Списываем монеты и обновляем кулдаун сразу (плата берётся за попытку)
        await db.execute({
          sql: 'UPDATE users SET coins = coins - ?, last_forge_at = ? WHERE user_id = ? AND guild_id = ?',
          args: [1500, forgeNow, uid, gid],
        });
        const forgeSuccess = Math.random() < 0.6;
        if (forgeSuccess) {
          const newAtk = ((forgeItem.atk_bonus as number) || 0) + 15;
          const newDef = ((forgeItem.def_bonus as number) || 0) + 10;
          const newName = `${forgeItem.item_name} [+1]`;
          await db.execute({
            sql: 'UPDATE user_inventory SET atk_bonus = ?, def_bonus = ?, item_name = ? WHERE id = ?',
            args: [newAtk, newDef, newName, forgeIdOption],
          });
          await fetch(webhookUrl, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              embeds: [{
                title: "🔨 Заточка успешна!",
                description: `Кузнец превзошёл себя! **${newName}** теперь мощнее:\n⚔️ +15 атаки | 🛡️ +10 защиты`,
                color: 0x2ecc71,
              }],
            }),
          });
        } else {
          await fetch(webhookUrl, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              content: "💥 Кузнец оплошал! Заточка сорвалась, 1,500 монет улетели в трубу.",
            }),
          });
        }
      } catch (err) {
        console.error("[Forge] Error:", err);
        await fetch(`https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${inter.token}/messages/@original`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: "❌ Ошибка при заточке предмета. Попробуйте позже." }),
        });
      }
    })()
  );
  return Response.json({ type: 5 });
}
