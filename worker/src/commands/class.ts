// Выбор боевого класса: /class и кнопки class_pick_*.

import { createClient } from "@libsql/client";
import { ButtonInteraction, CommandInteraction, Env, ExecutionContext } from "../types";
import { getClassDisplayName, getClassSkills } from "../data/classes";

export async function handleClassPick(
  inter: ButtonInteraction,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const customId = inter.data.custom_id;
  const classKey = customId.substring(11); // remove "class_pick_"
  const uid = inter.member?.user.id;
  const gid = inter.guild_id;
  if (!uid || !gid) return Response.json({ error: "No user or guild" }, { status: 400 });
  // Валидация выбранного класса
  const validClasses = ["warrior", "berserker", "mage", "necromancer", "ranger", "assassin", "artificer", "bard"];
  if (!validClasses.includes(classKey)) {
    return Response.json({
      type: 4,
      data: { content: "❌ Неверный выбор класса.", flags: 64 },
    });
  }
  try {
    const db = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });
    // Достаём текущие данные пользователя
    const userRes = await db.execute({
      sql: "SELECT level, class_id FROM users WHERE user_id = ? AND guild_id = ?",
      args: [uid, gid],
    });
    if (userRes.rows.length === 0) {
      return Response.json({
        type: 4,
        data: { content: "❌ Данные пользователя не найдены.", flags: 64 },
      });
    }
    const userData = userRes.rows[0];
    const level = (userData.level as number) || 0;
    const classId = userData.class_id as string | null;
    // ПРОВЕРКА СТАТУСА 'stripped' — проклятие дезертира
    if (classId === 'stripped') {
      return Response.json({
        type: 4,
        data: {
          content: '❌ Ваши навыки атрофированы за неактивность! Вы не можете выбрать класс до сброса Престижа.',
          flags: 64,
        },
      });
    }
    // Проверка: уровень >= 5 и class_id еще НЕ выбран
    if (level < 5) {
      return Response.json({
        type: 4,
        data: { content: "⚠️ Ваш уровень изменился. Выбор класса недоступен.", flags: 64 },
      });
    }
    if (userData.class_id !== null) {
      return Response.json({
        type: 4,
        data: { content: "⚠️ Вы уже выбрали класс. Сменить его можно только при сбросе Престижа.", flags: 64 },
      });
    }
    // Атомарно сохраняем выбор класса
    await db.execute({
      sql: "UPDATE users SET class_id = ? WHERE user_id = ? AND guild_id = ? AND class_id IS NULL",
      args: [classKey, uid, gid],
    });
    // Проверяем, был ли успешный update (класс еще не был выбран)
    // Если строк затронуто 0, значит класс уже выбрали (конфликт)
    const classDisplayName = getClassDisplayName(classKey);
    // Праздничный Embed с поздравлением
    const result = {
      embeds: [{
        title: `🎉 Вы выбрали класс: ${classDisplayName}!`,
        description: `**<@${uid}>** теперь состоит в классе **${classDisplayName}**!\n\n` +
          `Ваш скилл **Скилл 1** откроется на 10 уровне, а **Ульта** — на 50 уровне.\n\n` +
          `🔒 *Сменить класс можно только при сбросе Престижа на 100 уровне.*`,
        color: 0x2ecc71,
      }],
      components: [],
    };
    return Response.json({ type: 7, data: result });
  } catch (err) {
    console.error("[ClassPick] Error:", err);
    return Response.json({
      type: 4,
      data: { content: "❌ Ошибка при выборе класса. Попробуйте позже.", flags: 64 },
    });
  }
}

export async function handleClass(
  inter: CommandInteraction,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const uid = inter.member?.user.id;
  const gid = inter.guild_id;
  if (!uid || !gid) return Response.json({ error: "No user or guild" }, { status: 400 });
  ctx.waitUntil(
    (async () => {
      try {
        const db = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });
        // Достаём данные пользователя
        const userRes = await db.execute({
          sql: "SELECT level, class_id, prestige_count FROM users WHERE user_id = ? AND guild_id = ?",
          args: [uid, gid],
        });
        if (userRes.rows.length === 0) {
          await fetch(`https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${inter.token}/messages/@original`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              content: "❌ Данные пользователя не найдены. Напишите первое сообщение, чтобы зарегистрироваться!",
              flags: 64,
            }),
          });
          return;
        }
        const userData = userRes.rows[0];
        const level = (userData.level as number) || 0;
        const classId = userData.class_id as string | null;
        const prestigeCount = (userData.prestige_count as number) || 0;
        // ПРОВЕРКА СТАТУСА 'stripped' — проклятие дезертира
        if (classId === 'stripped') {
          const result = {
            embeds: [{
              title: '🥀 Вы лишены классового звания!',
              description: 'Ваши навыки атрофировались из-за недели неактивности на сервере!\n\n' +
                '❌ Вы не можете использовать классовые скиллы и ульту.\n' +
                '🔒 Выбрать новый класс можно **только после сброса Престижа** на 100 уровне!\n\n' +
                '*Продолжайте общаться и проявлять активность, чтобы вернуть былую славу!*',
              color: 0x747f8d,
            }],
            components: [],
          };
          await fetch(`https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${inter.token}/messages/@original`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(result),
          });
          return;
        }
        // А) Если уровень < 5
        if (level < 5) {
          const result = {
            embeds: [{
              title: "🔒 Выбор класса недоступен",
              description: `Выбор боевого RPG-класса открывается на **5 уровне**!\nВаш текущий уровень: **${level} / 5**.\n\n*Продолжайте общаться в чате и голосовых каналах, чтобы разблокировать классы!*`,
              color: 0x747f8d,
            }],
            components: [],
          };
          await fetch(`https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${inter.token}/messages/@original`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(result),
          });
          return;
        }
        // Б) Если class_id еще НЕ выбран
        if (classId === null) {
          const result = {
            embeds: [{
              title: "⚔️ Выберите свой боевой класс",
              description: `Выберите свой путь! **Внимание:** сменить класс можно будет только после сброса Престижа на 100 уровне!\n\n` +
                "🛡️ **Паладин** — Танк и мощь. Урон масштабируется от защиты.\n" +
                "🪓 **Берсерк** — Массовый урон по области.\n" +
                "🔮 **Архимаг** — Стихийный DoT. Поджигает босса автономным ожогом.\n" +
                "💀 **Некромант** — Призыв орды из костей.\n" +
                "🏹 **Следопыт** — Криты и скорость.\n" +
                "🗡️ **Ассасин** — Мгновенный ядовитый урон.\n" +
                "⚡ **Техномаг** — Сетевые турели и лазеры.\n" +
                "🎵 **Бард** — Душа войса. Баффает друзей в комнате.\n\n" +
                "*Нажмите кнопку ниже, чтобы сделать окончательный выбор:*",
              color: 0x5865f2,
            }],
            components: [
              {
                type: 1,
                components: [
                  { type: 2, custom_id: "class_pick_warrior", style: 1, label: "🛡️ Паладин" },
                  { type: 2, custom_id: "class_pick_berserker", style: 1, label: "🪓 Берсерк" },
                  { type: 2, custom_id: "class_pick_mage", style: 1, label: "🔮 Архимаг" },
                  { type: 2, custom_id: "class_pick_necromancer", style: 1, label: "💀 Некромант" },
                ],
              },
              {
                type: 1,
                components: [
                  { type: 2, custom_id: "class_pick_ranger", style: 1, label: "🏹 Следопыт" },
                  { type: 2, custom_id: "class_pick_assassin", style: 1, label: "🗡️ Ассасин" },
                  { type: 2, custom_id: "class_pick_artificer", style: 1, label: "⚡ Техномаг" },
                  { type: 2, custom_id: "class_pick_bard", style: 1, label: "🎵 Бард" },
                ],
              },
            ],
          };
          await fetch(`https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${inter.token}/messages/@original`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(result),
          });
          return;
        }
        // В) Если class_id УЖЕ выбран
        const className = getClassDisplayName(classId);
        const { skill1Name, skill2Name } = getClassSkills(classId);
        const skill1Status = level >= 10 ? "✅ Доступен" : "🔒 Откроется на 10 ур.";
        const skill2Status = level >= 50 ? "✅ Доступна" : "🔒 Откроется на 50 ур.";
        const colorMap: Record<string, number> = {
          warrior: 0xe74c3c,
          berserker: 0xc0392b,
          mage: 0x3498db,
          necromancer: 0x2c3e50,
          ranger: 0x2ecc71,
          assassin: 0x1abc9c,
          artificer: 0xf39c12,
          bard: 0x9b59b6,
        };
        const result = {
          embeds: [{
            title: `📜 Ваш боевой профиль: ${className}`,
            description: `**Класс:** ${className}\n**Уровень:** ${level}\n\n` +
              `**Скилл 1 (10 ур.):** ${skill1Name} — ${skill1Status}\n` +
              `**Ульта (50 ур.):** ${skill2Name} — ${skill2Status}\n\n` +
              `🔒 *Сменить класс можно только при сбросе Престижа на 100 уровне.*`,
            color: colorMap[classId] || 0x5865f2,
          }],
          components: [],
        };
        await fetch(`https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${inter.token}/messages/@original`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(result),
        });
      } catch (e) {
        console.error("[Class] Error:", e);
      }
    })()
  );
  return Response.json({ type: 5 });
}
