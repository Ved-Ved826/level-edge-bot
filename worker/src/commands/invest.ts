// Команды /invest и /divest: покупка и продажа акций компаний на бирже сервера.
// Строгая целочисленная математика: казна + роялти + резерв всегда сходятся без инфляции.
import { createClient } from "@libsql/client";
import { CommandInteraction, Env, ExecutionContext } from "../types";
import { getSeasonId } from "../exchange/season";
import { WHALE_MIN_COINS, WHALE_MIN_SHARES } from "../exchange/constants";
import { enqueueMarketEventStatement } from "../exchange/events";
import {
  applyMoodShift,
  computeEffectiveMood,
  quoteBuy,
  quoteSell,
  StaleStateError,
  tradeMoodShift,
} from "../exchange/math";
import type { BuyQuote, SellQuote } from "../exchange/math";

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
  const tickerOption = inter.data?.options?.find((o: any) => o.name === 'ticker' || o.name === 'company')?.value as string | undefined;
  const tickerRaw = tickerOption || "";
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

        // Промах guard (параллельная сделка изменила казну/акции/настроение) —
        // пересчитываем котировку на свежем состоянии: до 2 повторов, затем
        // пользователю уходит «Рынок слишком активен».
        const MAX_GUARD_RETRIES = 2;
        let result: { quote: BuyQuote; effectiveMood: number } | null = null;
        let companyName = "";

        const runAttempt = async (): Promise<{ quote: BuyQuote; effectiveMood: number }> => {
          const tx = await db.transaction("write");
          try {
            // Компания по guild_id и ticker (mood_bps, mood_updated_at — состояние настроения)
            const cRes = await tx.execute({
              sql: "SELECT id, owner_id, name, treasury, available_shares, frozen, mood_bps, mood_updated_at FROM companies WHERE guild_id = ? AND ticker = ?",
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

            // Настроение с ленивым затуханием на момент расчёта котировки
            const nowSec = Math.floor(Date.now() / 1000);
            const effectiveMood = computeEffectiveMood(Number(c.mood_bps) || 0, Number(c.mood_updated_at) || 0, nowSec);

            // Целочисленная котировка: база по NAV + надбавка ажиотажа (в казну) + комиссии
            const quote = quoteBuy(treasury, circulating, amount, effectiveMood);
            if (quote.baseCost < 1) throw new Error("Расчетная стоимость меньше 1");

            // Покупка разогревает рынок: сдвиг пропорционален доле сделки в обращении
            const newMoodBps = applyMoodShift(effectiveMood, tradeMoodShift(amount, circulating));

            // Атомарное списание totalCost с покупателя
            const spendRes = await tx.execute({
              sql: "UPDATE users SET coins = coins - ? WHERE user_id = ? AND guild_id = ? AND coins >= ?",
              args: [quote.totalCost, buyerId, gid, quote.totalCost],
            });
            if (!spendRes.rowsAffected || spendRes.rowsAffected === 0) throw new Error("Недостаточно монет");

            // Guard: казна, акции и настроение не изменились с момента расчёта.
            // В казну уходит baseCost + premium (премия ажиотажа растит NAV держателей),
            // новое настроение и метку времени пишем той же командой.
            // `IS` — NULL-безопасное сравнение; сравниваем с сырыми значениями строки.
            const updRes = await tx.execute({
              sql: `UPDATE companies
                    SET treasury = treasury + ?, available_shares = available_shares - ?, mood_bps = ?, mood_updated_at = ?
                    WHERE id = ? AND available_shares >= ?
                      AND treasury = ? AND available_shares = ? AND mood_bps IS ? AND mood_updated_at IS ?`,
              args: [quote.treasuryDelta, amount, newMoodBps, nowSec, companyId, amount,
                     treasury, available, c.mood_bps ?? null, c.mood_updated_at ?? null],
            });
            if (!updRes.rowsAffected || updRes.rowsAffected === 0) throw new StaleStateError();

            // Состояние компании после сделки: казна выросла на treasuryDelta (база + премия),
            // circulating вырос на amount (акции ушли из свободной продажи в обращение).
            const treasuryAfter = treasury + quote.treasuryDelta;
            const circulatingAfter = circulating + amount;

            // История сделки — в той же транзакции; сюда попадаем только после
            // успешного guard-UPDATE выше. mood_bps_after — настроение сразу после сделки.
            await tx.execute({
              sql: `INSERT INTO company_trades (guild_id, company_id, user_id, season_id, side, shares, base_amount, coins, treasury_after, circulating_after, mood_bps_after, created_at)
                    VALUES (?, ?, ?, ?, 'buy', ?, ?, ?, ?, ?, ?, ?)`,
              args: [gid, companyId, buyerId, getSeasonId(), amount, quote.baseCost, quote.totalCost, treasuryAfter, circulatingAfter, newMoodBps, nowSec],
            });

            // История NAV: снимок казны/обращения/настроения после сделки
            await tx.execute({
              sql: `INSERT INTO company_nav_history (guild_id, company_id, ts, treasury, circulating, mood_bps, reason)
                    VALUES (?, ?, ?, ?, ?, ?, 'buy')`,
              args: [gid, companyId, nowSec, treasuryAfter, circulatingAfter, newMoodBps],
            });

            // Кит-сделка: событие в очередь рынка атомарно со сделкой
            if (amount >= WHALE_MIN_SHARES || quote.totalCost >= WHALE_MIN_COINS) {
              await tx.execute(enqueueMarketEventStatement(gid, "whale_trade", {
                side: "buy",
                ticker,
                company_id: companyId,
                company_name: companyName,
                user_id: buyerId,
                shares: amount,
                coins: quote.totalCost,
              }));
            }

            // Роялти основателю; если не начислилось — уходит в резерв
            let reserveFee = quote.reserveFee;
            const royaltyRes = await tx.execute({
              sql: "UPDATE users SET coins = coins + ? WHERE user_id = ? AND guild_id = ?",
              args: [quote.founderFee, String(c.owner_id), gid],
            });
            if (!royaltyRes.rowsAffected || royaltyRes.rowsAffected === 0) reserveFee += quote.founderFee;

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
            return { quote, effectiveMood };
          } catch (err) {
            await tx.rollback().catch(() => {});
            throw err;
          } finally {
            tx.close();
          }
        };

        // Повтор расчёта при промахе guard (максимум MAX_GUARD_RETRIES раз)
        for (let guardAttempt = 0; ; guardAttempt++) {
          try {
            result = await runAttempt();
            break;
          } catch (err) {
            if (err instanceof StaleStateError) {
              if (guardAttempt >= MAX_GUARD_RETRIES) throw new Error("Рынок слишком активен, попробуйте ещё раз");
              continue;
            }
            throw err;
          }
        }

        // Сообщение об успехе — строго после завершения транзакции (после finally).
        // Разбивка цены: база по NAV, надбавка настроения в монетах и %, комиссии.
        const r = result!;
        const successMsg =
          `📈 Куплено **${amount}** акций компании **${companyName}** (\`${ticker}\`)!\n` +
          `🧮 База: **${r.quote.baseCost}** 🪙 · Настроение **${(r.effectiveMood / 100).toFixed(2)}%** → **${r.quote.premium > 0 ? "+" : ""}${r.quote.premium}** 🪙 · ` +
          `Роялти: **${r.quote.founderFee}** 🪙 · Резерв: **${r.quote.reserveFee}** 🪙\n` +
          `💸 Итого списано: **${r.quote.totalCost.toLocaleString()} 🪙**`;
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

        // Промах guard (параллельная сделка изменила казну/акции/настроение) —
        // пересчитываем котировку на свежем состоянии: до 2 повторов, затем
        // пользователю уходит «Рынок слишком активен».
        const MAX_GUARD_RETRIES = 2;
        let result: { quote: SellQuote; effectiveMood: number } | null = null;
        let companyName = "";

        const runAttempt = async (): Promise<{ quote: SellQuote; effectiveMood: number }> => {
          const tx = await db.transaction("write");
          try {
            // Компания по guild_id и ticker (mood_bps, mood_updated_at — состояние настроения)
            const cRes = await tx.execute({
              sql: "SELECT id, owner_id, name, treasury, available_shares, frozen, mood_bps, mood_updated_at FROM companies WHERE guild_id = ? AND ticker = ?",
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

            const available = Number(c.available_shares);
            const treasury = Number(c.treasury);
            const circulating = 100 - available;

            // Настроение с ленивым затуханием на момент расчёта котировки
            const nowSec = Math.floor(Date.now() / 1000);
            const effectiveMood = computeEffectiveMood(Number(c.mood_bps) || 0, Number(c.mood_updated_at) || 0, nowSec);

            // Целочисленная котировка: база по NAV; при панике (mood < 0) продавец
            // получает NAV * (1 + mood), скидка остаётся в казне оставшимся держателям.
            const quote = quoteSell(treasury, circulating, amount, effectiveMood);
            if (quote.netPayout < 1) throw new Error("Сумма выкупа составляет 0 монет");

            // Проверка обеспечения казны
            if (quote.treasuryDelta > treasury) throw new Error("Недостаточно средств в казне");

            // Продажа нагнетает панику: сдвиг вниз, пропорционален доле сделки в обращении
            const newMoodBps = applyMoodShift(effectiveMood, -tradeMoodShift(amount, circulating));

            // B-1: контрольный пакет владельца защищён условием прямо в UPDATE —
            // для владельца списание допустимо только если останется минимум 51 акция.
            // Проверка и списание атомарны, гонки между параллельными /divest исключены.
            const isOwner = String(c.owner_id) === String(sellerId);
            const decRes = await tx.execute({
              sql: `UPDATE company_shares
                    SET shares_count = shares_count - ?
                    WHERE user_id = ? AND company_id = ? AND shares_count >= ?
                      AND (shares_count - ? >= 51 OR ? = 0)`,
              args: [amount, sellerId, companyId, amount, amount, isOwner ? 1 : 0],
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

            // Guard: казна, акции и настроение не изменились с момента расчёта.
            // Из казны уходит только treasuryDelta = basePayout - discount (скидка
            // паники остаётся держателям); настроение и метку времени пишем той же
            // командой. `IS` — NULL-безопасное сравнение с сырыми значениями строки.
            const updRes = await tx.execute({
              sql: `UPDATE companies
                    SET treasury = treasury - ?, available_shares = available_shares + ?, mood_bps = ?, mood_updated_at = ?
                    WHERE id = ? AND treasury >= ?
                      AND treasury = ? AND available_shares = ? AND mood_bps IS ? AND mood_updated_at IS ?`,
              args: [quote.treasuryDelta, amount, newMoodBps, nowSec, companyId, quote.treasuryDelta,
                     treasury, available, c.mood_bps ?? null, c.mood_updated_at ?? null],
            });
            if (!updRes.rowsAffected || updRes.rowsAffected === 0) throw new StaleStateError();

            // Состояние компании после сделки: казна уменьшилась на treasuryDelta,
            // circulating уменьшился на amount (акции вернулись в свободную продажу).
            const treasuryAfter = treasury - quote.treasuryDelta;
            const circulatingAfter = circulating - amount;

            // История сделки — в той же транзакции; сюда попадаем только после
            // успешного guard-UPDATE выше. mood_bps_after — настроение сразу после сделки.
            await tx.execute({
              sql: `INSERT INTO company_trades (guild_id, company_id, user_id, season_id, side, shares, base_amount, coins, treasury_after, circulating_after, mood_bps_after, created_at)
                    VALUES (?, ?, ?, ?, 'sell', ?, ?, ?, ?, ?, ?, ?)`,
              args: [gid, companyId, sellerId, getSeasonId(), amount, quote.basePayout, quote.netPayout, treasuryAfter, circulatingAfter, newMoodBps, nowSec],
            });

            // История NAV: снимок казны/обращения/настроения после сделки
            await tx.execute({
              sql: `INSERT INTO company_nav_history (guild_id, company_id, ts, treasury, circulating, mood_bps, reason)
                    VALUES (?, ?, ?, ?, ?, ?, 'sell')`,
              args: [gid, companyId, nowSec, treasuryAfter, circulatingAfter, newMoodBps],
            });

            // Кит-сделка: событие в очередь рынка атомарно со сделкой
            if (amount >= WHALE_MIN_SHARES || quote.netPayout >= WHALE_MIN_COINS) {
              await tx.execute(enqueueMarketEventStatement(gid, "whale_trade", {
                side: "sell",
                ticker,
                company_id: companyId,
                company_name: companyName,
                user_id: sellerId,
                shares: amount,
                coins: quote.netPayout,
              }));
            }

            // Начисление продавцу
            const payRes = await tx.execute({
              sql: "UPDATE users SET coins = coins + ? WHERE user_id = ? AND guild_id = ?",
              args: [quote.netPayout, sellerId, gid],
            });
            if (!payRes.rowsAffected || payRes.rowsAffected === 0) throw new Error("Не удалось начислить монеты продавцу");

            // Резерв сервера (комиссия с выплаты)
            await tx.execute({
              sql: `INSERT INTO server_reserve (guild_id, balance) VALUES (?, ?)
                    ON CONFLICT(guild_id) DO UPDATE SET balance = balance + ?`,
              args: [gid, quote.reserveCut, quote.reserveCut],
            });

            await tx.commit();
            return { quote, effectiveMood };
          } catch (err) {
            await tx.rollback().catch(() => {});
            throw err;
          } finally {
            tx.close();
          }
        };

        // Повтор расчёта при промахе guard (максимум MAX_GUARD_RETRIES раз)
        for (let guardAttempt = 0; ; guardAttempt++) {
          try {
            result = await runAttempt();
            break;
          } catch (err) {
            if (err instanceof StaleStateError) {
              if (guardAttempt >= MAX_GUARD_RETRIES) throw new Error("Рынок слишком активен, попробуйте ещё раз");
              continue;
            }
            throw err;
          }
        }

        // Сообщение об успехе — строго после завершения транзакции (после finally).
        // Разбивка цены: база по NAV, скидка настроения в монетах и %, комиссия резерва.
        const r = result!;
        const successMsg =
          `📉 Продано **${amount}** акций компании **${companyName}** (\`${ticker}\`)!\n` +
          `🧮 База: **${r.quote.basePayout}** 🪙 · Настроение **${(r.effectiveMood / 100).toFixed(2)}%** → **−${r.quote.discount}** 🪙 · ` +
          `Комиссия резерва: **${r.quote.reserveCut}** 🪙\n` +
          `💰 Итого начислено: **${r.quote.netPayout.toLocaleString()} 🪙**`;
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
