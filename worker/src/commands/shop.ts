// Магазин /shop и кастомизация карточки (/card-customize, card_select_theme).

import { createClient } from "@libsql/client";
import { ButtonInteraction, CommandInteraction, Env, ExecutionContext } from "../types";
import { unlockAchievement } from "../db/queries";

export async function handleCardCustomize(
  inter: CommandInteraction,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const uid = inter.member?.user.id;
  const gid = inter.guild_id;
  if (!uid || !gid) return Response.json({ error: "No user or guild" }, { status: 400 });
  try {
    const db = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });
    // Создаём таблицу user_cosmetics если её нет (на всякий случай)
    await db.execute({
      sql: `CREATE TABLE IF NOT EXISTS user_cosmetics (

              user_id TEXT NOT NULL,

              guild_id TEXT NOT NULL,

              theme_id TEXT DEFAULT 'default',

              title_id TEXT DEFAULT 'Новичок',

              badges TEXT DEFAULT '[]',

              PRIMARY KEY (user_id, guild_id)

            )`,

            args: [],

          });



          // Достаём текущие настройки пользователя

          const cosmetRes = await db.execute({

            sql: "SELECT theme_id, title_id FROM user_cosmetics WHERE user_id = ? AND guild_id = ?",

            args: [uid, gid],

          });



          let currentTheme = "default";

          let currentTitle = "Новичок";



          if (cosmetRes.rows.length > 0) {

            currentTheme = cosmetRes.rows[0].theme_id as string;

            currentTitle = cosmetRes.rows[0].title_id as string;

          }



          // Список тем

          const themeOptions = [

            { label: "🟣 Классическая (Discord Blurple)", value: "default" },

            { label: "🌸 Киберпанк (Неоновый роз / Бирюза)", value: "cyberpunk" },

            { label: "🔥 Магма (Вулканический огонь)", value: "magma" },

            { label: "🌌 Полночь (Глубокий космос / Индиго)", value: "midnight" },

            { label: "🍃 Изумруд (Зелёный нефрит / Золото)", value: "emerald" },

          ];



          const themeLabels: Record<string, string> = {

            default: "Классическая (Discord Blurple)",

            cyberpunk: "Киберпанк (Неоновый роз / Бирюза)",

            magma: "Магма (Вулканический огонь)",

            midnight: "Полночь (Глубокий космос / Индиго)",

            emerald: "Изумруд (Зелёный нефрит / Золото)",

          };



          const result = {

            embeds: [{

              title: "🎨 Кастомизация карточки ранга",

              description: `Текущая тема: **${themeLabels[currentTheme] || currentTheme}** • Текущий титул: **${currentTitle}**\n` +
          "Выберите тему оформления из списка ниже:",
        color: 0x5865f2,
      }],
      components: [{
        type: 1,
        components: [{
          type: 3,
          custom_id: "card_select_theme",
          placeholder: "Выберите тему оформления...",
          options: themeOptions,
        }],
      }],
    };
    return Response.json({ type: 4, data: result });
  } catch (err) {
    console.error("[CardCustomize] Error:", err);
    return Response.json({
      type: 4,
      data: { content: "❌ Ошибка при загрузке настроек карточки. Попробуйте позже.", flags: 64 },
    });
  }
}

export async function handleCardSelectTheme(
  inter: ButtonInteraction,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const uid = inter.member?.user.id;
  const gid = inter.guild_id;
  if (!uid || !gid) return Response.json({ error: "No user or guild" }, { status: 400 });
  const selectedTheme = (inter.data.values as string[])?.[0];
  if (!selectedTheme || !["default", "cyberpunk", "magma", "midnight", "emerald"].includes(selectedTheme)) {
    return Response.json({
      type: 4,
      data: { content: "❌ Неверная тема выбора.", flags: 64 },
    });
  }
  try {
    const db = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });
    // Создаём таблицу user_cosmetics если её нет
    await db.execute({
      sql: `CREATE TABLE IF NOT EXISTS user_cosmetics (

              user_id TEXT NOT NULL,

              guild_id TEXT NOT NULL,

              theme_id TEXT DEFAULT 'default',

              title_id TEXT DEFAULT 'Новичок',

              badges TEXT DEFAULT '[]',

              PRIMARY KEY (user_id, guild_id)

            )`,

            args: [],

          });



          // Платные темы: cyberpunk, magma, midnight, emerald стоят 3500 монет, default бесплатна

          const paidThemes = ['cyberpunk', 'magma', 'midnight', 'emerald'];

          const themeCost = 3500;

          if (paidThemes.includes(selectedTheme)) {

            const themeUserRes = await db.execute({

              sql: 'SELECT coins FROM users WHERE user_id = ? AND guild_id = ?',

              args: [uid, gid],

            });

            const themeCoins = themeUserRes.rows.length > 0 ? ((themeUserRes.rows[0].coins as number) || 0) : 0;

            if (themeCoins < themeCost) {

              return Response.json({

                type: 4,

                data: { content: `❌ Эта тема стоит **${themeCost.toLocaleString()} 🪙**. Ваш баланс: **${themeCoins.toLocaleString()} 🪙**.`, flags: 64 },
        });
      }
      // C6: списание атомарное, с проверкой баланса в самом UPDATE.
      // Двойной клик по кнопке больше не уводит баланс в минус.
      const themePayResult = await db.execute({
        sql: 'UPDATE users SET coins = coins - ? WHERE user_id = ? AND guild_id = ? AND coins >= ?',
        args: [themeCost, uid, gid, themeCost],
      });
      if (!themePayResult.rowsAffected) {
        return Response.json({
          type: 4,
          data: { content: `❌ Недостаточно 🪙 для покупки темы (нужно **${themeCost.toLocaleString()} 🪙**).`, flags: 64 },
        });
      }
    }
    // C6: upsert вместо INSERT OR REPLACE — REPLACE затирал купленный ранее
    // платный титул обратно на «Новичок». title_id при конфликте не трогаем.
    await db.execute({
      sql: "INSERT INTO user_cosmetics (user_id, guild_id, theme_id, title_id) VALUES (?, ?, ?, 'Новичок') ON CONFLICT(user_id, guild_id) DO UPDATE SET theme_id = excluded.theme_id",
      args: [uid, gid, selectedTheme],
    });
    // Проверка достижения vlad_right_hand - тема cyberpunk или magma
    if (selectedTheme === 'cyberpunk' || selectedTheme === 'magma') {
      const webhookUrl = `https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${inter.token}`;
      await unlockAchievement(db, uid, gid, 'vlad_right_hand', webhookUrl, env.DISCORD_APPLICATION_ID);
    }
    const result = {
      embeds: [{
        title: "✅ Тема успешно изменена!",
        description: `Напишите **/rank**, чтобы увидеть обновлённую карточку!`,
        color: 0x2ecc71,
      }],
      components: [],
    };
    return Response.json({ type: 7, data: result });
  } catch (err) {
    console.error("[CardSelectTheme] Error:", err);
    return Response.json({
      type: 4,
      data: { content: "❌ Ошибка при сохранении темы. Попробуйте позже.", flags: 64 },
    });
  }
}

export async function handleShop(
  inter: CommandInteraction,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const uid = inter.member?.user.id;
  const gid = inter.guild_id;
  if (!uid || !gid) return Response.json({ error: "No user or guild" }, { status: 400 });
  const shopItemOption = inter.data?.options?.find((o) => o.name === "item")?.value as string | undefined;
  // Без выбора товара — показываем каталог
  if (!shopItemOption) {
    const catalogResult = {
      embeds: [{
        title: "🏪 Элитный магазин",
        description:
          "🧊 **Заморозка стрика** — `freeze` — **1,800 🪙**\n\n" +
          "**Престижные титулы:**\n" +
          "🟡 **Майонез** — `title_mayonez` — **5,000 🪙**\n" +
          "🟠 **Господин** — `title_gospodin` — **15,000 🪙**\n" +
          "🔴 **Навальный** — `title_navalny` — **30,000 🪙**\n" +
          "👑 **Царь-Батюшка** — `title_tsar` — **50,000 🪙**\n\n" +
          "Используйте `/shop item:<код>`, чтобы купить.",
        color: 0xF1C40F,
      }],
    };
    return Response.json({ type: 4, data: catalogResult });
  }
  ctx.waitUntil(
    (async () => {
      const webhookUrl = `https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${inter.token}/messages/@original`;
      try {
        const db = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });
        const titleShop: Record<string, { title: string; price: number }> = {
          title_mayonez: { title: "Майонез", price: 5000 },
          title_gospodin: { title: "Господин", price: 15000 },
          title_navalny: { title: "Навальный", price: 30000 },
          title_tsar: { title: "Царь-Батюшка", price: 50000 },
        };
        const shopUserRes = await db.execute({
          sql: 'SELECT coins FROM users WHERE user_id = ? AND guild_id = ?',
          args: [uid, gid],
        });
        if (shopUserRes.rows.length === 0) {
          await fetch(webhookUrl, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content: "❌ Данные пользователя не найдены." }),
          });
          return;
        }
        const shopCoins = (shopUserRes.rows[0].coins as number) || 0;
        if (shopItemOption === "freeze") {
          if (shopCoins < 1800) {
            await fetch(webhookUrl, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ content: `❌ Недостаточно монет! Нужно **1,800 🪙**, у вас: **${shopCoins.toLocaleString()} 🪙**.` }),
            });
            return;
          }
          await db.execute({
            sql: 'UPDATE users SET coins = coins - ?, streak_freezes = streak_freezes + 1 WHERE user_id = ? AND guild_id = ?',
            args: [1800, uid, gid],
          });
          await fetch(webhookUrl, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              embeds: [{
                title: "🧊 Заморозка приобретена!",
                description: "Вы купили заморозку стрика! Она спасёт вашу серию активности при пропуске дня.",
                color: 0x3498db,
              }],
            }),
          });
          return;
        }
        const titleData = titleShop[shopItemOption];
        if (!titleData) {
          await fetch(webhookUrl, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content: "❌ Неизвестный товар. Используйте `/shop` без параметров, чтобы увидеть каталог." }),
          });
          return;
        }
        if (shopCoins < titleData.price) {
          await fetch(webhookUrl, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content: `❌ Недостаточно монет! Нужно **${titleData.price.toLocaleString()} 🪙**, у вас: **${shopCoins.toLocaleString()} 🪙**.` }),
          });
          return;
        }
        await db.execute({
          sql: 'UPDATE users SET coins = coins - ? WHERE user_id = ? AND guild_id = ?',
          args: [titleData.price, uid, gid],
        });
        await db.execute({
          sql: `CREATE TABLE IF NOT EXISTS user_cosmetics (

                  user_id TEXT NOT NULL,

                  guild_id TEXT NOT NULL,

                  theme_id TEXT DEFAULT 'default',

                  title_id TEXT DEFAULT 'Новичок',

                  badges TEXT DEFAULT '[]',

                  PRIMARY KEY (user_id, guild_id)

                )`,

                args: [],

              });



              await db.execute({

                sql: `INSERT INTO user_cosmetics (user_id, guild_id, title_id) VALUES (?, ?, ?)

                      ON CONFLICT(user_id, guild_id) DO UPDATE SET title_id = excluded.title_id`,

                args: [uid, gid, titleData.title],

              });



              await fetch(webhookUrl, {

                method: "PATCH",

                headers: { "Content-Type": "application/json" },

                body: JSON.stringify({

                  embeds: [{

                    title: "🎉 Покупка успешна!",

                    description: `Вы приобрели статус **${titleData.title}**! Теперь он отображается на вашей карточке /rank!`,
              color: 0xF1C40F,
            }],
          }),
        });
      } catch (err) {
        console.error("[Shop] Error:", err);
        await fetch(`https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${inter.token}/messages/@original`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: "❌ Ошибка при покупке товара. Попробуйте позже." }),
        });
      }
    })()
  );
  return Response.json({ type: 5 });
}
