// Настройки сервера (/settings).

import { createClient } from "@libsql/client";
import { CommandInteraction, Env, ExecutionContext } from "../types";
import { ensureColumnExists } from "../db/queries";

export async function handleSettings(
  inter: CommandInteraction,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const uid = inter.member?.user.id;
  const gid = inter.guild_id;
  if (!uid || !gid) return Response.json({ error: "No user or guild" }, { status: 400 });
  const stepOption = inter.data?.options?.find((o) => o.name === "step")?.value as number | undefined;
  const validSteps = [0, 1, 5, 10, 20];
  if (stepOption !== undefined && !validSteps.includes(stepOption)) {
    return Response.json({
      type: 4,
      data: { content: "❌ Допустимые значения шага: 0 (выкл), 1, 5, 10, 20.", flags: 64 },
    });
  }
  ctx.waitUntil(
    (async () => {
      const webhookUrl = `https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${inter.token}/messages/@original`;
      try {
        const db = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });
        await ensureColumnExists(db, 'users', 'level_notify_step', 'INTEGER DEFAULT 10');
        if (stepOption === undefined) {
          const settingsUserRes = await db.execute({
            sql: 'SELECT level_notify_step FROM users WHERE user_id = ? AND guild_id = ?',
            args: [uid, gid],
          });
          const currentStep = settingsUserRes.rows.length > 0 ? ((settingsUserRes.rows[0].level_notify_step as number) ?? 10) : 10;
          await fetch(webhookUrl, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              embeds: [{
                title: "⚙️ Настройки уведомлений",
                description: `Текущий шаг уведомлений о новом уровне: **${currentStep === 0 ? "выключены" : `каждые ${currentStep} ур.`}**\n\nИспользуйте \`/settings step:<0|1|5|10|20>\` для изменения.`,
                color: 0x5865f2,
              }],
            }),
          });
          return;
        }
        await db.execute({
          sql: 'UPDATE users SET level_notify_step = ? WHERE user_id = ? AND guild_id = ?',
          args: [stepOption, uid, gid],
        });
        await fetch(webhookUrl, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            embeds: [{
              title: "✅ Настройки сохранены",
              description: stepOption === 0
                ? "Уведомления о новом уровне **выключены**."
                : `Уведомления о новом уровне теперь приходят каждые **${stepOption}** уровней.`,
              color: 0x2ecc71,
            }],
          }),
        });
      } catch (err) {
        console.error("[Settings] Error:", err);
        await fetch(`https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${inter.token}/messages/@original`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: "❌ Ошибка при сохранении настроек. Попробуйте позже." }),
        });
      }
    })()
  );
  return Response.json({ type: 5 });
}
