// Команды /stocks и /portfolio: read-only просмотр биржи компаний сервера.

import { createClient } from "@libsql/client";
import { CommandInteraction, Env, ExecutionContext } from "../types";
import { SPARKLINE_POINTS } from "../exchange/constants";
import { buildHourlyNavSeries, navChangePct } from "../exchange/nav";
import { sparkline } from "../exchange/sparkline";
import { computeEffectiveMood, quoteBuy, quoteSell } from "../exchange/math";

/** PATCH @original — обновление отложенного ответа (флаги задаёт вызывающий). */
async function patchOriginal(env: Env, token: string, body: Record<string, unknown>): Promise<Response> {
  return fetch(`https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${token}/messages/@original`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** /stocks: публичный список компаний биржи (топ-15 по казне). */
export async function handleStocks(
  inter: CommandInteraction,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  ctx.waitUntil(
    (async () => {
      try {
        const gid = inter.guild_id;
        if (!gid) throw new Error("Команда доступна только на сервере");

        const db = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });

        // TODO: пагинация для списка компаний
        const res = await db.execute({
          sql: "SELECT * FROM companies WHERE guild_id = ? ORDER BY treasury DESC LIMIT 15",
          args: [gid],
        });

        // История NAV за 25 часов: 24 точки + запас на выравнивание по часам
        const nowSec = Math.floor(Date.now() / 1000);
        const navRes = await db.execute({
          sql: "SELECT company_id, ts, treasury, circulating FROM company_nav_history WHERE guild_id = ? AND ts >= ? ORDER BY ts ASC",
          args: [gid, nowSec - 25 * 3600],
        });

        // Группируем снимки по компаниям: nav = казна / обращение (монет на акцию)
        const navByCompany = new Map<number, { ts: number; nav: number }[]>();
        for (const row of navRes.rows) {
          const companyId = Number(row.company_id);
          const treasury = Number(row.treasury) || 0;
          const circulating = Number(row.circulating) || 0;
          const nav = circulating > 0 ? treasury / circulating : 0;
          const list = navByCompany.get(companyId) ?? [];
          list.push({ ts: Number(row.ts), nav });
          navByCompany.set(companyId, list);
        }

        if (res.rows.length === 0) {
          const resp = await patchOriginal(env, inter.token, {
            content: "📉 На бирже этого сервера ещё нет компаний. Основайте первую через /company-create!",
          });
          if (!resp.ok) console.error("[Stocks] Empty followUp fail:", await resp.text());
          return;
        }

        // Защита от лимитов Embed: ровно 1 поле на компанию (максимум 15 полей при лимите 25)
        const fields = res.rows.map((r) => {
          const treasury = Number(r.treasury) || 0;
          const available = Number(r.available_shares) || 0;
          const circulating = 100 - available;
          const nav = circulating > 0 ? Math.floor((treasury * 100) / circulating) / 100 : 0;
          const navDisplay = nav.toFixed(2);

          let statusTag = "";
          if (Number(r.frozen) === 1) statusTag = " • ТОРГИ ПРИОСТАНОВЛЕНЫ";
          else if (treasury < 1 && nav < 0.01) statusTag = " • БАНКРОТ";

          // Эффективное настроение с ленивым затуханием и его метка
          const moodBps = computeEffectiveMood(Number(r.mood_bps) || 0, Number(r.mood_updated_at) || 0, nowSec);
          let moodLabel: string;
          if (moodBps >= 500) moodLabel = `🔥 Ажиотаж +${(moodBps / 100).toFixed(1)}%`;
          else if (moodBps <= -500) moodLabel = `🧊 Паника ${(moodBps / 100).toFixed(1)}%`;
          else moodLabel = `😐 Спокойно ${(moodBps / 100).toFixed(1)}%`;

          // Котировки на 1 акцию: покупка платит totalCost, продажа получает netPayout
          const buyPrice = circulating > 0 ? quoteBuy(treasury, circulating, 1, moodBps).totalCost : 0;
          const sellPrice = circulating > 0 ? quoteSell(treasury, circulating, 1, moodBps).netPayout : 0;

          // 24ч дельта NAV и спарклайн из почасового ряда (fill-forward)
          const history = navByCompany.get(Number(r.id)) ?? [];
          let changeStr = "н/д";
          let spark = "";
          if (history.length > 0) {
            const series = buildHourlyNavSeries(history, nowSec, SPARKLINE_POINTS);
            const change = navChangePct(series[series.length - 1], series[0]);
            const sign = change >= 0 ? "+" : "";
            changeStr = `${sign}${change.toFixed(1)}%`;
            spark = sparkline(series);
          }

          return {
            name: `${r.name} (${r.ticker})${statusTag}`.slice(0, 256),
            value: [
              `NAV: ${navDisplay} 🪙 • Казна: ${treasury.toLocaleString()} 🪙 • Свободно: ${available} • В обращении: ${circulating}/100`,
              `Покупка: ${buyPrice} 🪙 • Продажа: ${sellPrice} 🪙`,
              `${moodLabel} • 24ч: ${changeStr}${spark ? ` ${spark}` : ""}`,
            ]
              .join("\n")
              .slice(0, 1024),
          };
        });

        const embed = {
          title: "📈 Биржа компаний сервера",
          description: "Топ компаний по размеру казны. Оценка своей доли — /portfolio.",
          color: 0x5865f2,
          fields,
          footer: { text: `Показано компаний: ${fields.length}` },
        };

        const resp = await patchOriginal(env, inter.token, { embeds: [embed] });
        if (!resp.ok) console.error("[Stocks] followUp fail:", await resp.text());
      } catch (e) {
        console.error("[Stocks] error:", e);
        try {
          const errText = e instanceof Error && e.message ? `❌ ${e.message}` : "❌ Не удалось загрузить список компаний.";
          const resp = await patchOriginal(env, inter.token, { content: errText });
          if (!resp.ok) console.error("[Stocks] Error followUp fail:", await resp.text());
        } catch (patchErr) {
          console.error("[Stocks] Failed to patch @original:", patchErr);
        }
      }
    })()
  );
  return Response.json({ type: 5 });
}

/** /portfolio: ephemeral-портфель акций игрока (оценка доли строго целочисленно от казны). */
export async function handlePortfolio(
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

        const db = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });

        const res = await db.execute({
          sql: `SELECT c.name, c.ticker, c.treasury, c.available_shares, c.owner_id, c.mood_bps, c.mood_updated_at, s.shares_count
                FROM company_shares s
                JOIN companies c ON c.id = s.company_id
                WHERE s.guild_id = ? AND s.user_id = ? AND s.shares_count > 0
                ORDER BY s.shares_count DESC`,
          args: [gid, userId],
        });

        if (res.rows.length === 0) {
          const resp = await patchOriginal(env, inter.token, {
            content: "📭 У вас пока нет акций компаний этого сервера.",
            flags: 64,
          });
          if (!resp.ok) console.error("[Portfolio] Empty followUp fail:", await resp.text());
          return;
        }

        const nowSec = Math.floor(Date.now() / 1000);
        // Оценка позиции строго целочисленно от казны (не через округлённый NAV!)
        const positions = res.rows.map((r) => {
          const circulating = 100 - Number(r.available_shares);
          const treasury = Math.max(0, Number(r.treasury) || 0);
          const shares = Math.max(0, Number(r.shares_count) || 0);
          const positionValue = circulating > 0 ? Math.floor((shares * treasury) / circulating) : 0;
          const navDisplay = circulating > 0 ? (Math.floor((treasury * 100) / circulating) / 100).toFixed(2) : "0.00";

          // У основателя контрольный пакет 51 акция — продать можно только остаток
          const sellableShares = String(r.owner_id) === userId ? Math.max(0, shares - 51) : shares;

          // Реальный выход по котировке продажи (скидка паники + комиссия резерва)
          const moodBps = computeEffectiveMood(Number(r.mood_bps) || 0, Number(r.mood_updated_at) || 0, nowSec);
          const exitValue = circulating > 0 ? quoteSell(treasury, circulating, sellableShares, moodBps).netPayout : 0;

          return { name: String(r.name || ""), ticker: String(r.ticker || ""), shares, sellableShares, navDisplay, positionValue, exitValue };
        });

        const totalValue = positions.reduce((sum, p) => sum + p.positionValue, 0);
        const totalExit = positions.reduce((sum, p) => sum + p.exitValue, 0);

        const fields = positions.map((p) => ({
          name: `${p.name} (${p.ticker})`.slice(0, 256),
          value: `Акций: **${p.shares}** • NAV: ${p.navDisplay} 🪙 *(справочно)* • Оценка доли: **${p.positionValue.toLocaleString()} 🪙** • Выход сейчас: **~${p.exitValue.toLocaleString()} 🪙**`.slice(0, 1024),
        }));

        const embed = {
          title: "💼 Ваш портфель акций",
          description: `Инвестор: <@${userId}>`,
          color: 0x57f287,
          fields,
          footer: { text: `Оценка по NAV: ${totalValue.toLocaleString()} 🪙 • Выход сейчас: ~${totalExit.toLocaleString()} 🪙` },
        };

        const resp = await patchOriginal(env, inter.token, { embeds: [embed], flags: 64 });
        if (!resp.ok) console.error("[Portfolio] followUp fail:", await resp.text());
      } catch (e) {
        console.error("[Portfolio] error:", e);
        try {
          const errText = e instanceof Error && e.message ? `❌ ${e.message}` : "❌ Не удалось загрузить портфель.";
          const resp = await patchOriginal(env, inter.token, { content: errText, flags: 64 });
          if (!resp.ok) console.error("[Portfolio] Error followUp fail:", await resp.text());
        } catch (patchErr) {
          console.error("[Portfolio] Failed to patch @original:", patchErr);
        }
      }
    })()
  );
  return Response.json({ type: 5, data: { flags: 64 } });
}
