// Команды /invest и /divest: покупка и продажа акций компаний на бирже сервера.
// Строгая целочисленная математика: казна + роялти + резерв всегда сходятся без инфляции.
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

/** Строгая валидация amount: строго целое число >= 1. */
function parseAmount(raw: string | number | undefined): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new Error("Количество акций должно быть целым числом >= 1");
  return n;
}

/** Чтение опций ticker и amount из взаимодействия. */
function readOptions(inter: CommandInteraction): { ticker: string; amount: number } {
  const tickerRaw = (inter.data?.options?.find((o: any) => o.name === "ticker")?.value as string) || "";
  const amountRaw = inter.data?.options?.find((o: any) => o.name === "amount")?.value as string | number | undefined;
  return { ticker: tickerRaw.trim().toUpperCase(), amount: parseAmount(amountRaw) };
}

export async function handleInvest(
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
        const buyerId = callerUser.id;

        const { ticker, amount } = readOptions(inter);

        const db = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });

        const tx = await db.transaction("write");
        let totalCost = 0;
        let companyName = "";
        try {
          // Компания по guild_id и ticker
          const cRes = await tx.execute({
            sql: "SELECT id, owner_id, name, treasury, available_shares, frozen FROM companies WHERE guild_id = ? AND ticker = ?",
            args: [gid, ticker],
          });
          if (cRes.rows.length === 0) throw new Error("Компания с таким тикером не найдена");
          const c = cRes.rows[0];
          const companyId = Number(c.id);
          companyName = String(c.name || ticker);

          if (Number(c.frozen) !== 0) throw new Error("Компания заморожена — торги приостановлены");

          const available = Number(c.available_shares);
          if (available < amount) throw new Error("В свободной продаже нет столько акций");

          const treasury = Number(c.treasury);
          const circulating = 100 - available;
          if (treasury < 1 || circulating <= 0) throw new Error("Компания банкрот");

          // Целочисленные формулы (без дробей и инфляции)
          const baseCost = Math.floor((amount * treasury + circulating - 1) / circulating);
          if (baseCost < 1) throw new Error("Расчетная стоимость меньше 1");
          totalCost = Math.floor((baseCost * 106 + 99) / 100);
          const founderFee = Math.floor((baseCost * 3) / 100);
          let reserveFee = totalCost - baseCost - founderFee;

          // Атомарное списание totalCost с покупателя
          const spendRes = await tx.execute({
            sql: "UPDATE users SET coins = coins - ? WHERE user_id = ? AND guild_id = ? AND coins >= ?",
            args: [totalCost, buyerId, gid, totalCost],
          });
          if (!spendRes.rowsAffected || spendRes.rowsAffected === 0) throw new Error("Недостаточно монет");

          // Пополнение казны и уменьшение свободных акций
          const updRes = await tx.execute({
            sql: "UPDATE companies SET treasury = treasury + ?, available_shares = available_shares - ? WHERE id = ? AND available_shares >= ?",
            args: [baseCost, amount, companyId, amount],
          });
          if (!updRes.rowsAffected || updRes.rowsAffected === 0) throw new Error("Ошибка обновления акций компании");

          // Роялти основателю; если не начислилось — уходит в резерв
          const royaltyRes = await tx.execute({
            sql: "UPDATE users SET coins = coins + ? WHERE user_id = ? AND guild_id = ?",
            args: [founderFee, String(c.owner_id), gid],
          });
          if (!royaltyRes.rowsAffected || royaltyRes.rowsAffected === 0) reserveFee += founderFee;

          // Резерв сервера
          await tx.execute({
            sql: `INSERT INTO server_reserve (guild_id, balance) VALUES (?, ?)
                  ON CONFLICT(guild_id) DO UPDATE SET balance = balance + ?`,
            args: [gid, reserveFee, reserveFee],
          });

          // Акции покупателю (upsert по user_id + company_id)
          await tx.execute({
            sql: `INSERT INTO company_shares (user_id, guild_id, company_id, shares_count) VALUES (?, ?, ?, ?)
                  ON CONFLICT(user_id, company_id) DO UPDATE SET shares_count = shares_count + ?`,
            args: [buyerId, gid, companyId, amount, amount],
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
          `📈 Куплено **${amount}** акций компании **${companyName}** (\`${ticker}\`)!\n` +
          `💸 Списано: **${totalCost.toLocaleString()} 🪙**`;
        const resp = await patchOriginal(env, inter.token, successMsg);
        if (!resp.ok) console.error("[Invest] Success followUp fail:", await resp.text());
      } catch (e) {
        console.error("[Invest] error:", e);
        try {
          const errText = e instanceof Error && e.message ? `❌ ${e.message}` : "❌ Ошибка покупки акций.";
          const resp = await patchOriginal(env, inter.token, errText);
          if (!resp.ok) console.error("[Invest] Error followUp fail:", await resp.text());
        } catch (patchErr) {
          console.error("[Invest] Failed to patch @original:", patchErr);
        }
      }
    })()
  );
  return Response.json({ type: 5, data: { flags: 64 } });
}

export async function handleDivest(
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
        const sellerId = callerUser.id;

        const { ticker, amount } = readOptions(inter);

        const db = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });

        const tx = await db.transaction("write");
        let netPayout = 0;
        let companyName = "";
        try {
          // Компания по guild_id и ticker
          const cRes = await tx.execute({
            sql: "SELECT id, owner_id, name, treasury, available_shares, frozen FROM companies WHERE guild_id = ? AND ticker = ?",
            args: [gid, ticker],
          });
          if (cRes.rows.length === 0) throw new Error("Компания с таким тикером не найдена");
          const c = cRes.rows[0];
          const companyId = Number(c.id);
          companyName = String(c.name || ticker);

          if (Number(c.frozen) !== 0) throw new Error("Компания заморожена — торги приостановлены");

          // Акции продавца
          const sRes = await tx.execute({
            sql: "SELECT shares_count FROM company_shares WHERE user_id = ? AND company_id = ?",
            args: [sellerId, companyId],
          });
          if (sRes.rows.length === 0) throw new Error("У вас нет акций этой компании");
          const sharesCount = Number(sRes.rows[0].shares_count);
          if (sharesCount < amount) throw new Error("У вас нет столько акций");


          const treasury = Number(c.treasury);
          const circulating = 100 - Number(c.available_shares);

          // Целочисленные формулы (без дробей и инфляции)
          const basePayout = circulating > 0 ? Math.floor((amount * treasury) / circulating) : 0;
          if (basePayout < 1) throw new Error("Сумма выкупа составляет 0 монет");
          netPayout = Math.floor((basePayout * 95) / 100);
          const reserveCut = basePayout - netPayout;

          // Проверка обеспечения казны
          if (treasury < basePayout) throw new Error("Недостаточно средств в казне");

          // B-1: контрольный пакет владельца защищён условием прямо в UPDATE —
          // для владельца списание допустимо только если останется минимум 51 акция.
          // Проверка и списание атомарны, гонки между параллельными /divest исключены.
          const isOwner = String(c.owner_id) === String(sellerId);
          const decRes = await tx.execute({
            sql: `UPDATE company_shares
                  SET shares_count = shares_count - ?
                  WHERE user_id = ? AND company_id = ? AND shares_count >= ?
                    AND (shares_count - ? >= 51 OR ? = 0)`,
            args: [amount, sellerId, companyId, amount, amount, isOwner ? 0 : 1],
          });
          if (!decRes.rowsAffected || decRes.rowsAffected === 0) {
            throw new Error(isOwner
              ? "Владелец не может размыть контрольный пакет: должно остаться минимум 51 акция"
              : "Не удалось списать акции");
          }

          // Удаление пустой записи
          await tx.execute({
            sql: "DELETE FROM company_shares WHERE user_id = ? AND company_id = ? AND shares_count <= 0",
            args: [sellerId, companyId],
          });

          // Возврат акций в свободную продажу и списание из казны
          const updRes = await tx.execute({
            sql: "UPDATE companies SET treasury = treasury - ?, available_shares = available_shares + ? WHERE id = ? AND treasury >= ?",
            args: [basePayout, amount, companyId, basePayout],
          });
          if (!updRes.rowsAffected || updRes.rowsAffected === 0) throw new Error("Не удалось обновить казну");

          // Начисление продавцу
          const payRes = await tx.execute({
            sql: "UPDATE users SET coins = coins + ? WHERE user_id = ? AND guild_id = ?",
            args: [netPayout, sellerId, gid],
          });
          if (!payRes.rowsAffected || payRes.rowsAffected === 0) throw new Error("Не удалось начислить монеты продавцу");

          // Резерв сервера (5% от выкупа)
          await tx.execute({
            sql: `INSERT INTO server_reserve (guild_id, balance) VALUES (?, ?)
                  ON CONFLICT(guild_id) DO UPDATE SET balance = balance + ?`,
            args: [gid, reserveCut, reserveCut],
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
          `📉 Продано **${amount}** акций компании **${companyName}** (\`${ticker}\`)!\n` +
          `💰 Начислено: **${netPayout.toLocaleString()} 🪙**`;
        const resp = await patchOriginal(env, inter.token, successMsg);
        if (!resp.ok) console.error("[Divest] Success followUp fail:", await resp.text());
      } catch (e) {
        console.error("[Divest] error:", e);
        try {
          const errText = e instanceof Error && e.message ? `❌ ${e.message}` : "❌ Ошибка продажи акций.";
          const resp = await patchOriginal(env, inter.token, errText);
          if (!resp.ok) console.error("[Divest] Error followUp fail:", await resp.text());
        } catch (patchErr) {
          console.error("[Divest] Failed to patch @original:", patchErr);
        }
      }
    })()
  );
  return Response.json({ type: 5, data: { flags: 64 } });
}
