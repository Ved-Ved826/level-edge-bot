// Команда /company-create: основание компании на бирже сервера.

import { createClient } from "@libsql/client";
import { CommandInteraction, Env, ExecutionContext } from "../types";

/** PATCH @original — обновление отложенного ephemeral-ответа. */
async function patchOriginal(env: Env, token: string, content: string): Promise<Response> {
  return fetch(`https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${token}/messages/@original`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, flags: 64 }),
  });
}

/** Очистка текста от спецсимволов Discord-разметки, переводов строк и табуляций. */
function sanitizeText(input: string): string {
  return input.replace(/[@<>`*_~|[\](#\r\n\t]/g, "");
}

export async function handleCompanyCreate(
  inter: CommandInteraction,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  ctx.waitUntil(
    (async () => {
      try {
        const gid = inter.guild_id;
        const callerUser = inter.member?.user;
        if (!gid || !callerUser) throw new Error("Команда доступна только на сервере");
        const ownerId = callerUser.id;

        // Чтение опций команды
        const tickerRaw = (inter.data?.options?.find((o: any) => o.name === "ticker")?.value as string) || "";
        const nameRaw = (inter.data?.options?.find((o: any) => o.name === "name")?.value as string) || "";
        const descRaw = inter.data?.options?.find((o: any) => o.name === "description")?.value as string | undefined;

        // Валидация тикера: 2-5 латинских букв
        const ticker = tickerRaw.trim().toUpperCase();
        if (!/^[A-Z]{2,5}$/.test(ticker)) throw new Error("Тикер должен состоять из 2-5 латинских букв (A-Z)");

        // Валидация имени: сначала очистка, только потом проверка длины (3-32)
        const name = sanitizeText(nameRaw).trim();
        if (name.length < 3 || name.length > 32) throw new Error("Название компании должно быть от 3 до 32 символов");

        // Описание: очистка + обрезка до 200 символов
        const description = descRaw ? sanitizeText(descRaw).trim().slice(0, 200) : "";

        const db = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });

        // Интерактивная транзакция
        const tx = await db.transaction("write");
        let cost = 0;
        try {
          // У игрока ещё нет основанной компании в этой гильдии
          const ownerRes = await tx.execute({
            sql: "SELECT id FROM companies WHERE guild_id = ? AND owner_id = ?",
            args: [gid, ownerId],
          });
          if (ownerRes.rows.length > 0) throw new Error("У вас уже есть основанная компания на этом сервере");

          // Тикер уникален в гильдии
          const tickerRes = await tx.execute({
            sql: "SELECT id FROM companies WHERE guild_id = ? AND ticker = ?",
            args: [gid, ticker],
          });
          if (tickerRes.rows.length > 0) throw new Error("Тикер занят");

          // Имя уникально в гильдии без учета регистра (сравнение в JS)
          const namesRes = await tx.execute({
            sql: "SELECT name FROM companies WHERE guild_id = ?",
            args: [gid],
          });
          const lowerName = name.toLowerCase();
          for (const row of namesRes.rows) {
            if (String(row.name || "").toLowerCase() === lowerName) {
              throw new Error("Компания с таким названием уже существует");
            }
          }

          // Стоимость: первая компания 1000, далее 1000 + count * 30000
          const countRes = await tx.execute({
            sql: "SELECT COUNT(*) as count FROM companies WHERE guild_id = ?",
            args: [gid],
          });
          const count = (countRes.rows[0]?.count as number) || 0;
          cost = count === 0 ? 1000 : 1000 + count * 30000;

          // Атомарное списание монет (только при достаточном балансе)
          const spendRes = await tx.execute({
            sql: "UPDATE users SET coins = coins - ? WHERE user_id = ? AND guild_id = ? AND coins >= ?",
            args: [cost, ownerId, gid, cost],
          });
          if (!spendRes.rowsAffected || spendRes.rowsAffected === 0) {
            throw new Error("Недостаточно монет для основания компании");
          }

          // Пополнение серверного резерва на сумму (cost - 500)
          const reserveDelta = cost - 500;
          await tx.execute({
            sql: `INSERT INTO server_reserve (guild_id, balance) VALUES (?, ?)
                  ON CONFLICT(guild_id) DO UPDATE SET balance = balance + ?`,
            args: [gid, reserveDelta, reserveDelta],
          });

          // Создание компании
          const now = Math.floor(Date.now() / 1000);
          const insertRes = await tx.execute({
            sql: `INSERT INTO companies (guild_id, owner_id, name, ticker, description, treasury, total_shares, available_shares, last_growth_day, frozen, created_at)
                  VALUES (?, ?, ?, ?, ?, 500, 100, 49, NULL, 0, ?)`,
            args: [gid, ownerId, name, ticker, description, now],
          });
          const companyId = Number(insertRes.lastInsertRowid);

          // 51 акция уходит основателю, 49 остаются в свободной продаже
          await tx.execute({
            sql: "INSERT INTO company_shares (user_id, guild_id, company_id, shares_count) VALUES (?, ?, ?, 51)",
            args: [ownerId, gid, companyId],
          });

          await tx.commit();
        } catch (err) {
          await tx.rollback().catch(() => {});
          throw err;
        } finally {
          tx.close();
        }

        // Сообщение об успехе — строго после завершения транзакции (после finally)
        const successMsg =
          `🏢 Компания **${name}** (\`${ticker}\`) успешно основана!\n` +
          `💸 Списано: **${cost.toLocaleString()} 🪙**\n` +
          `🏦 Стартовая казна: **500 🪙**\n` +
          `📜 Вам принадлежит **51** акция (всего 100, в свободной продаже 49).`;
        const resp = await patchOriginal(env, inter.token, successMsg);
        if (!resp.ok) console.error("[Company] Success followUp fail:", await resp.text());
      } catch (e) {
        console.error("[Company] create error:", e);
        try {
          const errText = e instanceof Error && e.message ? `❌ ${e.message}` : "❌ Ошибка создания компании.";
          const resp = await patchOriginal(env, inter.token, errText);
          if (!resp.ok) console.error("[Company] Error followUp fail:", await resp.text());
        } catch (patchErr) {
          console.error("[Company] Failed to patch @original:", patchErr);
        }
      }
    })()
  );
  return Response.json({ type: 5, data: { flags: 64 } });
}
