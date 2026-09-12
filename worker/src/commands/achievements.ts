// Команда /achievements: список секретных достижений.

import { createClient } from "@libsql/client";
import { ACHIEVEMENTS_LIST } from "../data/achievements";
import { CommandInteraction, Env, ExecutionContext } from "../types";

export async function handleAchievements(
  inter: CommandInteraction,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const uidOption = inter.data?.options?.find((o: any) => o.name === "user")?.value as string | undefined;
  const targetId = uidOption || inter.member?.user.id;
  const gid = inter.guild_id;
  if (!gid || !targetId) return Response.json({ error: "No guild or user" }, { status: 400 });
  ctx.waitUntil(
    (async () => {
      try {
        const db = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });
        // Достаём имя пользователя
        const targetUser = inter.data?.resolved?.users?.[targetId];
        const username = targetUser ? targetUser.username : inter.member?.user.username || "Unknown";
        // Достаём все открытые ачивки из БД
        const achievementsRes = await db.execute({
          sql: 'SELECT achievement_id, unlocked_at FROM user_achievements WHERE user_id = ? AND guild_id = ? ORDER BY unlocked_at DESC',
          args: [targetId, gid],
        });
        const unlockedAchievements = achievementsRes.rows || [];
        // Создаём словарь открытых ачивок для быстрого поиска
        const unlockedMap = new Map<string, number>();
        unlockedAchievements.forEach((row: any) => {
          unlockedMap.set(row.achievement_id as string, row.unlocked_at as number);
        });
        // Получаем полный список достижений из константы
        const totalAchievements = ACHIEVEMENTS_LIST.length;
        const unlockedCount = unlockedAchievements.length;
        // Формируем Embed
        let description = "";
        if (unlockedAchievements.length === 0) {
          description = "*Пока нет открытых достижений. Исследуйте сервер, чтобы разгадать секреты!*";
        } else {
          // Сортируем открытые ачивки по дате открытия (descending)
          const sortedUnlocked = unlockedAchievements
            .map((row: any) => ({
              id: row.achievement_id as string,
              unlockedAt: row.unlocked_at as number,
            }))
            .sort((a: any, b: any) => b.unlockedAt - a.unlockedAt);
          sortedUnlocked.forEach((item: any) => {
            const ach = ACHIEVEMENTS_LIST.find(a => a.id === item.id);
            if (ach) {
              description += `✅ **${ach.title}** — *${ach.description}* • <t:${item.unlockedAt}:d>\n`;
            }
          });
        }
        description += `\n🔒 Секретных пасхалок осталось найти: **${totalAchievements - unlockedCount}**`;
        const result = {
          embeds: [{
            title: `🏆 Достижения: ${username}`,
            description: description,
            color: 0xF1C40F,
            footer: { text: `Прогресс: ${unlockedCount} / ${totalAchievements} достижений` },
          }],
          components: [],
        };
        const resp = await fetch(`https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${inter.token}/messages/@original`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(result),
        });
        if (!resp.ok) console.error("Achievements update fail:", await resp.text());
      } catch (e) {
        console.error("Achievements error:", e);
      }
    })()
  );
  return Response.json({ type: 5 });
}
