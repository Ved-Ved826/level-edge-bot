// Зал славы и годовой дайджест: /server-kings, /recap.

import { createClient } from "@libsql/client";
import { CommandInteraction, Env, ExecutionContext } from "../types";

export async function handleServerKings(
  inter: CommandInteraction,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const gid = inter.guild_id;
  if (!gid) return Response.json({ error: "No guild" }, { status: 400 });
  ctx.waitUntil(
    (async () => {
      try {
        const db = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });
        // Chat King
        const chatRes = await db.execute({
          sql: 'SELECT user_id, messages_count FROM users WHERE guild_id = ? ORDER BY messages_count DESC LIMIT 1',
          args: [gid],
        });
        const chatKing = chatRes.rows.length > 0 ? { user_id: chatRes.rows[0].user_id as string, messages_count: chatRes.rows[0].messages_count as number } : null;
        // Voice King
        const voiceRes = await db.execute({
          sql: 'SELECT user_id, voice_seconds FROM users WHERE guild_id = ? ORDER BY voice_seconds DESC LIMIT 1',
          args: [gid],
        });
        const voiceKing = voiceRes.rows.length > 0 ? { user_id: voiceRes.rows[0].user_id as string, voice_seconds: voiceRes.rows[0].voice_seconds as number } : null;
        // Online King
        const onlineRes = await db.execute({
          sql: 'SELECT user_id, online_seconds FROM users WHERE guild_id = ? ORDER BY online_seconds DESC LIMIT 1',
          args: [gid],
        });
        const onlineKing = onlineRes.rows.length > 0 ? { user_id: onlineRes.rows[0].user_id as string, online_seconds: onlineRes.rows[0].online_seconds as number } : null;
        // Streak King
        const streakRes = await db.execute({
          sql: 'SELECT user_id, streak_days FROM users WHERE guild_id = ? ORDER BY streak_days DESC LIMIT 1',
          args: [gid],
        });
        const streakKing = streakRes.rows.length > 0 ? { user_id: streakRes.rows[0].user_id as string, streak_days: streakRes.rows[0].streak_days as number } : null;
        // Quest Master
        const questRes = await db.execute({
          sql: 'SELECT user_id, COUNT(*) as count FROM user_quest_progress WHERE guild_id = ? AND completed_at IS NOT NULL GROUP BY user_id ORDER BY count DESC LIMIT 1',
          args: [gid],
        });
        const questMaster = questRes.rows.length > 0 ? { user_id: questRes.rows[0].user_id as string, count: questRes.rows[0].count as number } : null;
        // Формируем Embed
        const description = `💬 **Chat King:** <@${chatKing?.user_id || '-'}> — **${chatKing?.messages_count.toLocaleString() || 0}** сообщ.

🎙 **Voice King:** <@${voiceKing?.user_id || '-'}> — **${Math.floor((voiceKing?.voice_seconds || 0) / 3600)}** ч. в войсе

🟢 **Online King:** <@${onlineKing?.user_id || '-'}> — **${Math.floor((onlineKing?.online_seconds || 0) / 3600)}** ч. онлайн 🪑

🔥 **Streak King:** <@${streakKing?.user_id || '-'}> — **${streakKing?.streak_days || 0}** дн. стрик

🎯 **Quest Master:** <@${questMaster?.user_id || '-'}> — **${questMaster?.count || 0}** квестов



*Короны обновляются в реальном времени!*

`;



              const result = {

                embeds: [{

                  title: '👑 Зал Королевской Славы Сервера',

                  description: description,

                  color: 0xF1C40F,

                  footer: { text: 'Кто займет трон в конце года? • /recap для личной статистики' },

                }],

                components: [],

              };



              const resp = await fetch(`https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${inter.token}/messages/@original`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(result),
        });
        if (!resp.ok) console.error('Server kings update fail:', await resp.text());
      } catch (e) {
        console.error('Server kings error:', e);
      }
    })()
  );
  return Response.json({ type: 5 });
}

export async function handleRecap(
  inter: CommandInteraction,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const uidOption = inter.data?.options?.find((o: any) => o.name === 'user')?.value as string | undefined;
  const targetId = uidOption || inter.member?.user.id;
  const gid = inter.guild_id;
  if (!gid || !targetId) return Response.json({ error: 'No guild or user' }, { status: 400 });
  ctx.waitUntil(
    (async () => {
      try {
        const db = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });
        // Достаём имя пользователя
        const targetUser = inter.data?.resolved?.users?.[targetId];
        const username = targetUser ? targetUser.username : inter.member?.user.username || 'Unknown';
        // Достаём данные пользователя
        const userRes = await db.execute({
          sql: 'SELECT messages_count, voice_seconds, online_seconds, xp, level, max_streak FROM users WHERE user_id = ? AND guild_id = ?',
          args: [targetId, gid],
        });
        if (userRes.rows.length === 0) {
          return Response.json({
            type: 4,
            data: { content: '❌ Данные пользователя не найдены. Напишите первое сообщение, чтобы зарегистрироваться!', flags: 64 },
          });
        }
        const userData = userRes.rows[0];
        const messages = userData.messages_count as number || 0;
        const voiceSeconds = userData.voice_seconds as number || 0;
        const onlineSeconds = userData.online_seconds as number || 0;
        const totalXp = userData.xp as number || 0;
        const level = userData.level as number || 0;
        const maxStreak = userData.max_streak as number || 0;
        // Считаем выполненные квесты
        const questRes = await db.execute({
          sql: 'SELECT COUNT(*) as count FROM user_quest_progress WHERE user_id = ? AND guild_id = ? AND completed_at IS NOT NULL',
          args: [targetId, gid],
        });
        const completedQuests = (questRes.rows[0]?.count as number) || 0;
        // Считаем позицию в топе
        const rankRes = await db.execute({
          sql: 'SELECT COUNT(*) as rank FROM users WHERE guild_id = ? AND xp > ?',
          args: [gid, totalXp],
        });
        const rank = ((rankRes.rows[0]?.rank as number) || 0) + 1;
        const totalRes = await db.execute({
          sql: 'SELECT COUNT(*) as total FROM users WHERE guild_id = ?',
          args: [gid],
        });
        const totalUsers = (totalRes.rows[0]?.total as number) || 1;
        // Вычисляем архетип игрока
        let persona = '⭐ Восходящая Звезда';
        const voiceHours = voiceSeconds / 3600;
        const onlineHours = onlineSeconds / 3600;
        if (voiceHours > 20) {
          persona = '🎙 Повелитель Микрофона';
        } else if (messages > 500) {
          persona = '💬 Текстовый Пулемётчик';
        } else if (onlineHours > 50) {
          persona = '🟢 Призрак Сервера (Онлайн 24/7)';
        } else if (maxStreak >= 14) {
          persona = '🔥 Неугасимое Пламя';
        }
        const description = (
          `🎭 Ваш архетип: **${persona}**\n` +
          `🏆 Место на сервере: **#${rank}** из **${totalUsers}**\n\n` +
          `📊 **Ваша статистика за год:**\n` +
          `• 💬 Сообщений отправлено: **${messages.toLocaleString()}**\n` +
          `• 🎙 Времени в войсе: **${Math.floor(voiceSeconds / 3600)} ч. ${Math.floor((voiceSeconds % 3600) / 60)} мин.**\n` +
          `• 🟢 Времени онлайн на сервере: **${Math.floor(onlineSeconds / 3600)} ч.**\n` +
          `• 🎯 Заданий выполнено: **${completedQuests}**\n` +
          `• 🔥 Лучший стрик года: **${maxStreak} дн.**`
        );
        const result = {
          embeds: [{
            title: `✨ Discord Wrapped: Итоги года для ${username}`,
            description: description,
            color: 0x9B59B6,
            footer: { text: 'LevelEdge Wrapped • Спасибо, что вы с нами!' },
          }],
          components: [],
        };
        const resp = await fetch(`https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${inter.token}/messages/@original`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(result),
        });
        if (!resp.ok) console.error('Recap update fail:', await resp.text());
      } catch (e) {
        console.error('Recap error:', e);
      }
    })()
  );
  return Response.json({ type: 5 });
}
