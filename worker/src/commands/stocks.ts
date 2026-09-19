// Команды /stocks и /portfolio: read-only просмотр биржи компаний сервера.

import { createClient } from "@libsql/client";
import { CommandInteraction, Env, ExecutionContext } from "../types";

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

        if (res.rows.length === 0) {
          const resp = await patchOriginal(env, inter.token, {
            content: "📉 На бирже этого сервера ещё нет компаний. Основайте первую через /company-create!",
          });
          if (!resp.ok) console.error("[Stocks] Empty followUp fail:", await resp.text());
          return;
        }

        // Защита от лимитов Embed: ровно 1 поле на компанию (максимум 15 полей при лимите 25)
        const fields = res.rows.map((r) => {
          const circulating = 100 - Number(r.available_shares);
          const nav = circulating > 0 ? Math.floor((Number(r.treasury) * 100) / circulating) / 100 : 0;
          const navDisplay = nav.toFixed(2);

          let statusTag = "";
          if (Number(r.frozen) === 1) statusTag = " • ТОРГИ ПРИОСТАНОВЛЕНЫ";
          else if (Number(r.treasury) < 1 && nav < 0.01) statusTag = " • БАНКРОТ";

          return {
            name: `${r.name} (${r.ticker})${statusTag}`.slice(0, 256),
            value: `NAV: ${navDisplay} 🪙 • Казна: ${Number(r.treasury).toLocaleString()} 🪙 • Доступно: ${r.available_shares}/49 акций`.slice(0, 1024),
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
          sql: `SELECT c.name, c.ticker, c.treasury, c.available_shares, s.shares_count
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

        // Оценка позиции строго целочисленно от казны (не через округлённый NAV!)
        const positions = res.rows.map((r) => {
          const circulating = 100 - Number(r.available_shares);
          const treasury = Math.max(0, Number(r.treasury) || 0);
          const shares = Math.max(0, Number(r.shares_count) || 0);
          const positionValue = circulating > 0 ? Math.floor((shares * treasury) / circulating) : 0;
          const navDisplay = circulating > 0 ? (Math.floor((treasury * 100) / circulating) / 100).toFixed(2) : "0.00";
          return { name: String(r.name || ""), ticker: String(r.ticker || ""), shares, navDisplay, positionValue };
        });

        const totalValue = positions.reduce((sum, p) => sum + p.positionValue, 0);

        const fields = positions.map((p) => ({
          name: `${p.name} (${p.ticker})`.slice(0, 256),
          value: `Акций: **${p.shares}** • NAV: ${p.navDisplay} 🪙 *(справочно)* • Оценка доли: **${p.positionValue.toLocaleString()} 🪙**`.slice(0, 1024),
        }));

        const embed = {
          title: "💼 Ваш портфель акций",
          description: `Инвестор: <@${userId}>`,
          color: 0x57f287,
          fields,
          footer: { text: `Суммарная оценка портфеля: ${totalValue.toLocaleString()} 🪙` },
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
