// Престиж: /prestige и кнопки подтверждения/отмены.

import { createClient } from "@libsql/client";
import { ButtonInteraction, CommandInteraction, Env, ExecutionContext } from "../types";

export async function handlePrestigeButtons(
  inter: ButtonInteraction,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const customId = inter.data.custom_id;
  const uid = customId.startsWith("prestige_confirm_") ? customId.substring(19) : customId.substring(18);
  if (!inter.guild_id) return Response.json({ error: "No guild" }, { status: 400 });
  const db = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });
  // Проверка: только автор может нажимать кнопки
  const clickedUserId = inter.member?.user.id;
  if (!clickedUserId || clickedUserId !== uid) {
    return Response.json({
      type: 4,
      data: { content: "❌ Вы не можете управлять чужим сбросом престижа!", flags: 64 },
    });
  }
  // Достаём актуальные данные пользователя
  const userRes = await db.execute({
    sql: 'SELECT xp, level, prestige_count FROM users WHERE user_id = ? AND guild_id = ?',
    args: [uid, inter.guild_id as string],
  });
  if (userRes.rows.length === 0) {
    return Response.json({
      type: 4,
      data: { content: "❌ Данные пользователя не найдены.", flags: 64 },
    });
  }
  const userData = userRes.rows[0];
  const level = userData.level as number || 0;
  // Перепроверка: уровень должен быть >= 100
  if (level < 100) {
    return Response.json({
      type: 4,
      data: { content: "⚠️ Ваш уровень изменился. Сброс престижа недоступен.", flags: 64 },
    });
  }
  const prestigeCount = (userData.prestige_count as number) || 0;
  if (customId.startsWith("prestige_cancel_")) {
    // Сброс отменён
    const result = {
      embeds: [{
        title: 'Сброс престижа отменён',
        description: 'Ваш 100 уровень в безопасности.',
        color: 0x747f8d,
      }],
      components: [],
    };
    return Response.json({ type: 7, data: result });
  }
  if (customId.startsWith("prestige_confirm_")) {
    // Подтверждение сброса
    const guildId = inter.guild_id as string;
    await db.execute({
      sql: 'UPDATE users SET prestige_count = prestige_count + 1, xp = 0, level = 0, class_id = NULL WHERE user_id = ? AND guild_id = ?',
      args: [uid, guildId],
    });
    const result = {
      embeds: [{
        title: '🎉 ПОЗДРАВЛЯЕМ СО СБРОСОМ ПРЕСТИЖА!',
        description: `**<@${uid}>** успешно сбросил уровень и получил **Престиж ★ ${prestigeCount + 1}**!\n\n` +
          '✨ Ваш класс сброшен! Вы можете выбрать новый боевой путь через **/class**!\n\n' +
          'Золотая звезда престижа теперь сияет на вашей карточке **/rank**!',
        color: 0xFFD700,
      }],
      components: [],
    };
    return Response.json({ type: 7, data: result });
  }
  // Недостижимо: роутер вызывает этот обработчик только при совпадении custom_id.
  // Ветка нужна лишь для полноты типизации возвращаемого значения.
  return Response.json({ type: 4, data: { content: "❌ Неизвестная кнопка престижа.", flags: 64 } });
}

export async function handlePrestige(
  inter: CommandInteraction,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const uid = inter.member?.user.id;
  const gid = inter.guild_id;
  if (!uid || !gid) return Response.json({ error: "No user or guild" }, { status: 400 });
  ctx.waitUntil(
    (async () => {
      const webhookUrl = `https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${inter.token}/messages/@original`;
      try {
        const db = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });
        // Достаём данные пользователя
        const userRes = await db.execute({
          sql: "SELECT xp, level, prestige_count FROM users WHERE user_id = ? AND guild_id = ?",
          args: [uid, gid],
        });
        if (userRes.rows.length === 0) {
          await fetch(webhookUrl, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              content: "❌ Данные пользователя не найдены. Напишите первое сообщение, чтобы зарегистрироваться!",
            }),
          });
          return;
        }
        const userData = userRes.rows[0];
        const level = (userData.level as number) || 0;
        const xp = (userData.xp as number) || 0;
        const prestigeCount = (userData.prestige_count as number) || 0;
        let result: any;
        // Если уровень меньше 100
        if (level < 100) {
          result = {
            embeds: [
              {
                title: "🔒 Сброс престижа недоступен",
                description:
                  `Для совершения сброса престижа требуется **100 уровень**.\n` +
                  `Ваш текущий уровень: **${level} / 100** (${xp.toLocaleString()} XP).\n\n` +
                  `*Продолжайте проявлять активность в чате и войсе, чтобы достичь вершины!*`,
                color: 0x747f8d,
              },
            ],
            components: [],
          };
        } else {
          // Если уровень >= 100
          result = {
            embeds: [
              {
                title: "⭐ Доступен сброс престижа!",
                description:
                  `Вы достигли максимального 100 уровня! Вы можете сбросить опыт до 0 и получить постоянную **Звезду Престижа**.\n\n` +
                  `• Текущий престиж: **★ ${prestigeCount}** ➔ станет: **★ ${prestigeCount + 1}**\n` +
                  `• Ваш уровень вернётся на 0, но звезда останется на вашей карточке навсегда!\n\n` +
                  `Вы уверены, что хотите совершить сброс?`,
                color: 0xffd700,
              },
            ],
            components: [
              {
                type: 1,
                components: [
                  {
                    type: 2,
                    custom_id: `prestige_confirm_${uid}`,
                    style: 3,
                    label: "⭐ Подтвердить сброс",
                  },
                  {
                    type: 2,
                    custom_id: `prestige_cancel_${uid}`,
                    style: 2,
                    label: "❌ Отмена",
                  },
                ],
              },
            ],
          };
        }
        // Отправляем готовый ответ в Discord через webhook
        await fetch(webhookUrl, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(result),
        });
      } catch (e) {
        console.error("Prestige error:", e);
        await fetch(webhookUrl, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content: "❌ Ошибка при обработке команды. Попробуйте позже.",
          }),
        });
      }
    })()
  );
  return Response.json({ type: 5 });
}
