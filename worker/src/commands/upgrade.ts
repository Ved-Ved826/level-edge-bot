import { createClient } from "@libsql/client/web";
import { CommandInteraction, Env, ExecutionContext } from "../types";

const UPGRADE_SUCCESS_CHANCE = 30;

export async function handleUpgrade(
  inter: CommandInteraction,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const uid = inter.member?.user.id;
  const gid = inter.guild_id;
  if (!uid || !gid) return Response.json({ error: "No user or guild" }, { status: 400 });

  const itemRowId = inter.data?.options?.find((o) => o.name === "id")?.value as number;
  if (!itemRowId) {
    return Response.json({
      type: 4,
      data: { content: "❌ Укажите ID предмета из инвентаря (см. /inventory)!", flags: 64 },
    });
  }

  ctx.waitUntil(
    (async () => {
      const webhookUrl = `https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${inter.token}/messages/@original`;
      try {
        const db = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });

        const itemRes = await db.execute({
          sql: 'SELECT * FROM user_inventory WHERE id = ? AND user_id = ? AND guild_id = ?',
          args: [itemRowId, uid, gid],
        });
        if (itemRes.rows.length === 0) {
          await fetch(webhookUrl, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content: "❌ Предмет с таким ID не найден в вашем инвентаре!" }),
          });
          return;
        }

        const item = itemRes.rows[0];
        const oldName = item.item_name as string;
        const oldAtk = (item.atk_bonus as number) || 0;
        const oldDef = (item.def_bonus as number) || 0;

        const roll = Math.floor(Math.random() * 100) + 1;
        const success = roll <= UPGRADE_SUCCESS_CHANCE;

        let resultPayload: object;
        if (success) {
          const newAtk = oldAtk * 2;
          const newDef = oldDef * 2;
          const newName = `${oldName} +1`;
          await db.execute({
            sql: 'UPDATE user_inventory SET atk_bonus = ?, def_bonus = ?, item_name = ? WHERE id = ?',
            args: [newAtk, newDef, newName, itemRowId],
          });
          resultPayload = {
            embeds: [{
              title: "⚡ АПГРЕЙД УСПЕШЕН!",
              description: `🎲 Ролл: **${roll}/100** (нужно ≤ **${UPGRADE_SUCCESS_CHANCE}**)\n\n**${oldName}** → **${newName}**\n\n⚔️ Атака: ${oldAtk} → **${newAtk}**\n🛡️ Защита: ${oldDef} → **${newDef}**`,
              color: 0x2ECC71,
              footer: { text: "Рискнул — и выиграл!" },
            }],
          };
        } else {
          await db.execute({
            sql: 'DELETE FROM user_inventory WHERE id = ?',
            args: [itemRowId],
          });
          resultPayload = {
            embeds: [{
              title: "🔥 ПРЕДМЕТ СГОРЕЛ!",
              description: `🎲 Ролл: **${roll}/100** (нужно было ≤ **${UPGRADE_SUCCESS_CHANCE}**)\n\n**${oldName}** обратился в пепел и удалён из инвентаря **НАВСЕГДА**.\n\n*Риск — благородное дело. Но не в этот раз.*`,
              color: 0xE74C3C,
              footer: { text: "70% — такова цена жадности..." },
            }],
          };
        }

        await fetch(webhookUrl, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(resultPayload),
        });
      } catch (err) {
        console.error("[Upgrade] Error:", err);
      }
    })()
  );
  return Response.json({ type: 5 });
}
