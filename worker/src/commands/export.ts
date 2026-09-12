// CSV-экспорт аналитики для админов (/export).

import { createClient } from "@libsql/client";
import { CommandInteraction, Env, ExecutionContext } from "../types";

export async function handleExport(
  inter: CommandInteraction,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const uid = inter.member?.user.id;
  const gid = inter.guild_id;
  if (!uid || !gid) return Response.json({ error: "No user or guild" }, { status: 400 });
  // Проверка прав администратора (флаг ADMINISTRATOR = 0x8)
  const perms = (inter.member as any)?.permissions;
  const isAdmin = perms ? (BigInt(perms) & 8n) === 8n : false;
  // Если прав нет — вежливо сообщаем об этом
  if (!isAdmin) {
    return Response.json({
      type: 4,
      data: {
        content: "❌ Эта команда доступна только администраторам сервера!",
        flags: 64, // Скрытое сообщение (видно только вызвавшему)
      },
    });
  }
  // Немедленно отвечаем type: 5 (думает...), чтобы избежать таймаута при генерации файла
  ctx.waitUntil(
    (async () => {
      const webhookUrl = `https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${inter.token}/messages/@original`;
      try {
        const db = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });
        // Выбираем всех участников сервера
        const usersRes = await db.execute({
          sql: "SELECT user_id, xp, level, season_xp, messages_count, voice_seconds, online_seconds, streak_days, max_streak, prestige_count FROM users WHERE guild_id = ? ORDER BY xp DESC",
          args: [gid],
        });
        const rows = usersRes.rows;
        if (!rows || rows.length === 0) {
          await fetch(webhookUrl, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              content: "❌ В базе данных пока нет участников для экспорта.",
            }),
          });
          return;
        }
        // Формируем аккуратную CSV-таблицу
        let csvString = "User ID,Total XP,Level,Season XP,Messages,Voice Hours,Online Hours,Current Streak,Max Streak,Prestige Stars\n";
        for (const r of rows) {
          const uId = r.user_id as string;
          const xp = (r.xp as number) || 0;
          const lvl = (r.level as number) || 0;
          const sXp = (r.season_xp as number) || 0;
          const msgCount = (r.messages_count as number) || 0;
          const voiceHours = (((r.voice_seconds as number) || 0) / 3600).toFixed(1);
          const onlineHours = (((r.online_seconds as number) || 0) / 3600).toFixed(1);
          const streakDays = (r.streak_days as number) || 0;
          const maxStreak = (r.max_streak as number) || 0;
          const prestigeStars = (r.prestige_count as number) || 0;
          csvString += `"${uId}",${xp},${lvl},${sXp},${msgCount},${voiceHours},${onlineHours},${streakDays},${maxStreak},${prestigeStars}\n`;
        }
        // Собираем FormData для отправки бинарного файла
        const formData = new FormData();
        const payload = JSON.stringify({
          embeds: [
            {
              title: "📊 Аналитика сервера выгружена",
              description: `Успешно экспортировано участников: **${rows.length}**.\nФайл аналитики прикреплён ниже.`,
              color: 0x5865f2,
              footer: { text: "LevelEdge Analytics • Полная выгрузка" },
            },
          ],
          attachments: [{ id: 0, filename: "server-analytics.csv" }],
        });
        formData.append("payload_json", payload);
        formData.append(
          "files[0]",
          new Blob([csvString], { type: "text/csv;charset=utf-8;" }),
          "server-analytics.csv"
        );
        // Отправляем файл в чат
        const resp = await fetch(webhookUrl, {
          method: "PATCH",
          body: formData,
        });
        if (!resp.ok) {
          console.error("Export webhook error:", await resp.text());
        }
      } catch (err) {
        console.error("[Export] Error:", err);
        await fetch(webhookUrl, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content: "❌ Произошла ошибка при формировании аналитики.",
          }),
        });
      }
    })()
  );
  return Response.json({ type: 5 });
}

export async function handleExportLegacy(
  inter: CommandInteraction,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const gid = inter.guild_id;
  const uid = inter.member?.user.id;
  if (!gid || !uid) return Response.json({ error: "No guild or user" }, { status: 400 });
  // Проверка прав администратора (флаг ADMINISTRATOR = 8)
  const permissions = inter.member?.permissions;
  if (!permissions || !(BigInt(permissions) & 8n)) {
    return Response.json({
      type: 4,
      data: { content: "❌ Эта команда доступна только администраторам сервера!", flags: 64 },
    });
  }
  // Немедленно ответим DEFERRED, чтобы избежать таймаута
  ctx.waitUntil(
    (async () => {
      try {
        const db = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });
        // Выбираем всех участников гильдии
        const usersRes = await db.execute({
          sql: "SELECT user_id, xp, level, season_xp, messages_count, voice_seconds, online_seconds, streak_days, max_streak, prestige_count FROM users WHERE guild_id = ? ORDER BY xp DESC",
          args: [gid],
        });
        const rows = usersRes.rows;
        if (rows.length === 0) {
          const webhookUrl = `https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${inter.token}/messages/@original`;
          await fetch(webhookUrl, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              content: "❌ На сервере нет участников с данными.",
              flags: 64,
            }),
          });
          return;
        }
        // Формируем CSV-строку
        let csvString = "User ID,Total XP,Level,Season XP,Messages,Voice Hours,Online Hours,Current Streak,Max Streak,Prestige Stars\n";
        for (const r of rows) {
          const userId = r.user_id as string;
          const xp = (r.xp as number) || 0;
          const level = (r.level as number) || 0;
          const seasonXp = (r.season_xp as number) || 0;
          const msgCount = (r.messages_count as number) || 0;
          const voiceHours = ((r.voice_seconds as number) || 0) / 3600;
          const onlineHours = ((r.online_seconds as number) || 0) / 3600;
          const streakDays = (r.streak_days as number) || 0;
          const maxStreak = (r.max_streak as number) || 0;
          const prestigeStars = (r.prestige_count as number) || 0;
          csvString += `"${userId}",${xp},${level},${seasonXp},${msgCount},${voiceHours.toFixed(1)},${onlineHours.toFixed(1)},${streakDays},${maxStreak},${prestigeStars}\n`;
        }
        const webhookUrl = `https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${inter.token}/messages/@original`;
        // Собираем FormData
        const payload = JSON.stringify({
          embeds: [{
            title: "📊 Аналитика сервера выгружена",
            description: `Успешно экспортировано участников: **${rows.length}**.\nФайл прикреплён ниже.`,
            color: 0x5865F2,
            footer: { text: "LevelEdge Analytics" },
          }],
          attachments: [{ id: 0, filename: "server-analytics.csv" }],
        });
        const formData = new FormData();
        formData.append("payload_json", payload);
        formData.append("files[0]", new Blob([csvString], { type: "text/csv;charset=utf-8;" }), "server-analytics.csv");
        // Отправляем через PATCH webhook
        const resp = await fetch(webhookUrl, { method: "PATCH", body: formData });
        if (!resp.ok) {
          console.error("Export error:", await resp.text());
        }
      } catch (err) {
        console.error("[Export] Error:", err);
      }
    })()
  );
  return Response.json({ type: 5 });
}
