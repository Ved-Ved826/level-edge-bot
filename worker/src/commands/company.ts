// Команда /company-create: основание компании на бирже сервера.
// Команда /company dividend: выплата дивидендов акционерам из казны компании.

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

/** PATCH @original — обновление отложенного ответа произвольным payload (флаги задаёт вызывающий). */
async function patchOriginalBody(env: Env, token: string, body: Record<string, unknown>): Promise<Response> {
  return fetch(`https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${token}/messages/@original`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
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

        // Валидация имени: сначала очистка, только потом проверка длины (3-32).
        // Выполняется раньше тикера: автогенерация тикера зависит от названия.
        const name = sanitizeText(nameRaw).trim();
        if (name.length < 3 || name.length > 32) throw new Error("Название компании должно быть от 3 до 32 символов");

        // Тикер: если не передан или пустой — автогенерация из названия
        // (только латинские буквы, верхний регистр, максимум 4 символа);
        // если латинских букв меньше 2 (например, название на кириллице) — дефолтный "CORP".
        let ticker = tickerRaw.trim().toUpperCase();
        if (!ticker) {
          ticker = (name.match(/[A-Za-z]/g) || []).join("").toUpperCase().slice(0, 4);
          if (ticker.length < 2) ticker = "CORP";
        }

        // Валидация тикера: 2-5 латинских букв
        if (!/^[A-Z]{2,5}$/.test(ticker)) throw new Error("Тикер должен состоять из 2-5 латинских букв (A-Z)");

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

          // История NAV: стартовый снимок компании (reason='create') — в той же
          // транзакции, что и создание. circulating = 100 - 49 = 51 (акции
          // основателя уже в обращении), казна стартовая 500, настроение 0.
          await tx.execute({
            sql: `INSERT INTO company_nav_history (guild_id, company_id, ts, treasury, circulating, mood_bps, reason)
                  VALUES (?, ?, ?, 500, 51, 0, 'create')`,
            args: [gid, companyId, now],
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

/** Формат монет: целое с разделителями разрядов. */
function fmtCoins(n: number): string {
  return Math.round(n).toLocaleString("ru-RU");
}

/** /company dividend amount — глава компании распределяет часть казны между акционерами. */
export async function handleCompanyDividend(
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
        const userId = callerUser.id;

        // Разбор подкоманды: Discord присылает один option типа 1 (SUB_COMMAND)
        const top = (inter.data?.options?.[0] ?? null) as any;
        if (!top || top.type !== 1 || String(top.name) !== "dividend") {
          throw new Error("Неизвестная подкоманда команды /company");
        }
        const amount = Number((top.options ?? []).find((o: any) => o.name === "amount")?.value ?? 0);
        if (!Number.isInteger(amount) || amount <= 0) {
          throw new Error("Сумма дивидендов должна быть целым числом больше 0");
        }

        const db = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });

        // Выплачивать дивиденды может только глава компании
        const compRes = await db.execute({
          sql: "SELECT id, name, ticker, treasury FROM companies WHERE guild_id = ? AND owner_id = ?",
          args: [gid, userId],
        });
        const comp = compRes.rows[0];
        if (!comp) throw new Error("Вы не являетесь главой компании на этом сервере. Глава объявляется при создании (/company-create).");

        const companyId = Number(comp.id);
        const treasury = Math.max(0, Number(comp.treasury) || 0);
        if (amount > treasury) {
          throw new Error(`В казне компании недостаточно средств: **${fmtCoins(treasury)} 🪙** из запрошенных **${fmtCoins(amount)} 🪙**. Пополните казну или укажите меньшую сумму.`);
        }

        // Акционеры компании: только фактические держатели в обращении
        const holdersRes = await db.execute({
          sql: "SELECT user_id, shares_count FROM company_shares WHERE company_id = ? AND guild_id = ? AND shares_count > 0",
          args: [companyId, gid],
        });
        let totalShares = 0;
        for (const r of holdersRes.rows) totalShares += Number(r.shares_count) || 0;
        if (totalShares <= 0) throw new Error("В обращении нет акций этой компании — выплачивать некому");

        // Расчет выплат: floor по доле акций; выплаты <= 0 отсекаются,
        // неделимый остаток от округления остается в казне (списывается только реальная сумма)
        const payouts = holdersRes.rows
          .map((r) => ({
            userId: String(r.user_id),
            shares: Number(r.shares_count) || 0,
            payout: Math.floor((amount * (Number(r.shares_count) || 0)) / totalShares),
          }))
          .filter((p) => p.payout > 0);
        const realTotal = payouts.reduce((sum, p) => sum + p.payout, 0);
        if (realTotal <= 0) throw new Error("Расчетная выплата каждому акционеру — 0 🪙. Укажите большую сумму.");

        // Атомарная выплата: один batch = одна транзакция.
        // CAS по казне: списание только при treasury = treasuryBefore (защита от гонок),
        // начисления акционерам выполняются только если списание прошло
        // (guard: казна стала ровно treasuryBefore - realTotal).
        const expectedAfter = treasury - realTotal;
        const payoutOkGuard = "EXISTS (SELECT 1 FROM companies WHERE id = ? AND guild_id = ? AND treasury = ?)";
        const guardArgs = [companyId, gid, expectedAfter];
        const stmts: { sql: string; args: any[] }[] = [
          {
            sql: "UPDATE companies SET treasury = treasury - ? WHERE id = ? AND guild_id = ? AND treasury = ?",
            args: [realTotal, companyId, gid, treasury],
          },
          ...payouts.map((p) => ({
            sql: `UPDATE users SET coins = coins + ? WHERE user_id = ? AND guild_id = ? AND ${payoutOkGuard}`,
            args: [p.payout, p.userId, gid, ...guardArgs],
          })),
        ];
        const results = await db.batch(stmts, "write");

        if ((results[0].rowsAffected as number) !== 1) {
          throw new Error("Казна компании только что изменилась — попробуйте ещё раз");
        }

        // Топ-5 получателей по сумме выплаты
        const top5 = [...payouts].sort((a, b) => b.payout - a.payout || b.shares - a.shares).slice(0, 5);
        const fields = top5.map((p) => ({
          name: `<@${p.userId}>`,
          value: `Акций: **${p.shares}** • Выплата: **${fmtCoins(p.payout)} 🪙**`,
          inline: true,
        }));

        const embed = {
          title: `💰 Дивиденды — ${comp.name} (\`${comp.ticker}\`)`,
          description: `Глава <@${userId}> распределил **${fmtCoins(amount)} 🪙** из казны между **${payouts.length}** акционером(ами) (в обращении ${totalShares} акций).`,
          color: 0x57f287,
          fields,
          footer: { text: `Выплачено: ${fmtCoins(realTotal)} 🪙 • Остаток в казне: ${fmtCoins(expectedAfter)} 🪙` },
        };
        const resp = await patchOriginalBody(env, inter.token, { embeds: [embed] });
        if (!resp.ok) console.error("[Company] Dividend followUp fail:", await resp.text());
      } catch (e) {
        console.error("[Company] dividend error:", e);
        try {
          const errText = e instanceof Error && e.message ? `❌ ${e.message}` : "❌ Не удалось выплатить дивиденды.";
          const resp = await patchOriginalBody(env, inter.token, { content: errText, flags: 64 });
          if (!resp.ok) console.error("[Company] Error followUp fail:", await resp.text());
        } catch (patchErr) {
          console.error("[Company] Failed to patch @original:", patchErr);
        }
      }
    })()
  );
  return Response.json({ type: 5 });
}
