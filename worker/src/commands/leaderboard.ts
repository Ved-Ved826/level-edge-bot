// Команда /leaderboard и кнопки пагинации/режимов (lb_*).

import { createClient } from "@libsql/client";
import { calculateLevel } from "@shared/types";
import { ButtonInteraction, CommandInteraction, Env, ExecutionContext } from "../types";
import { getCurrentSeason } from "../utils/formatters";

export interface LeaderboardEntry {
  user_id: string;
  xp: number;
  season_xp: number;
  messages_count: number;
  voice_seconds: number;
}

export type SortBy = "xp" | "messages_count" | "voice_seconds" | "season_xp";

export async function getLeaderboardData(env: Env, guildId: string, page: number = 1, mode: "season" | "all" = "all", sortBy: SortBy = "xp"): Promise<{ entries: LeaderboardEntry[]; total: number; page: number; maxPages: number }> {
  const db = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });
  const pageSize = 10;
  const tres = await db.execute({ sql: "SELECT COUNT(*) as total FROM users WHERE guild_id = ?", args: [guildId] });
  const total = (tres.rows[0]?.total as number) || 0;
  const maxPages = Math.ceil(total / pageSize) || 1;
  const safePage = Math.max(1, Math.min(page, maxPages));
  const offset = (safePage - 1) * pageSize;
  // Выбираем сортировку и колонки в зависимости от режима
  let orderColumn = sortBy;
  if (mode === "season" && sortBy === "xp") {
    orderColumn = "season_xp";
  }
  const ures = await db.execute({
    sql: `SELECT user_id, xp, season_xp, messages_count, voice_seconds FROM users WHERE guild_id = ? ORDER BY ${orderColumn} DESC LIMIT ? OFFSET ?`,
    args: [guildId, pageSize, offset],
  });
  const entries = ures.rows.map((r) => ({
    user_id: r.user_id as string,
    xp: r.xp as number,
    season_xp: (r.season_xp as number) || 0,
    messages_count: r.messages_count as number,
    voice_seconds: r.voice_seconds as number,
  }));
  return { entries, total, page: safePage, maxPages };
}

export function buildLeaderboardEmbed(entries: LeaderboardEntry[], page: number, maxPages: number, total: number, mode: "season" | "all" = "all") {
  const currentSeason = mode === "season" ? getCurrentSeason() : "За всё время";
  let description = "";
  entries.forEach((entry, idx) => {
    const pos = (page - 1) * 10 + idx + 1;
    const lvl = calculateLevel(entry.xp);
    const msgc = entry.messages_count;
    const voicesec = entry.voice_seconds;
    const vh = Math.floor(voicesec / 3600);
    let line = "";
    if (pos === 1) line += "🥇 ";
    else if (pos === 2) line += "🥈 ";
    else if (pos === 3) line += "🥉 ";
    else line += `${pos}. `;
    if (mode === "season") {
      line += `**<@${entry.user_id}>** — Уровень ${lvl} • ${entry.season_xp.toLocaleString()} сезонного XP (${msgc.toLocaleString()} сообщ. / ${vh} ч.)`;
    } else {
      line += `**<@${entry.user_id}>** — Уровень ${lvl} • ${entry.xp.toLocaleString()} XP (${msgc.toLocaleString()} сообщ. / ${vh} ч.)`;
    }
    description += line + "\n";
  });
  return {
    embeds: [
      {
        title: `🏆 Таблица лидеров • ${currentSeason}`,
        description: description || "Пока нет данных",
        color: 0x5865f2,
        footer: { text: `Страница ${page} из ${maxPages} • Всего участников: ${total}` },
      },
    ],
    components: [
      // Верхний ряд: переключатели режима
      {
        type: 1,
        components: [
          {
            type: 2,
            custom_id: `lb_mode_season_${page}`,
            style: mode === "season" ? 1 : 2, // Primary если активен, Secondary иначе
            label: "🏆 Текущий сезон",
          },
          {
            type: 2,
            custom_id: `lb_mode_all_${page}`,
            style: mode === "all" ? 1 : 2,
            label: "👑 За всё время",
          },
        ],
      },
      // Нижний ряд: пагинация
      {
        type: 1,
        components: [
          { type: 2, custom_id: `lb_page_${mode}_prev_${page}`, style: 2, label: "◀ Назад", disabled: page <= 1 },
          { type: 2, custom_id: `lb_page_${mode}_next_${page}`, style: 2, label: "Вперед ▶", disabled: page >= maxPages },
        ],
      },
    ],
  };
}

export async function handleLeaderboard(
  inter: CommandInteraction,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const pageOption = inter.data?.options?.find((o) => o.name === "page")?.value as number;
  const page = pageOption || 1;
  const gid = inter.guild_id;
  if (!gid) return Response.json({ error: "No guild" }, { status: 400 });
  ctx.waitUntil(
    (async () => {
      try {
        const data = await getLeaderboardData(env, gid, page, "all", "xp");
        const result = buildLeaderboardEmbed(data.entries, data.page, data.maxPages, data.total, "all");
        const resp = await fetch(`https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${inter.token}/messages/@original`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(result),
        });
        if (!resp.ok) console.error("Leaderboard update fail:", await resp.text());
      } catch (e) {
        console.error("Leaderboard error:", e);
      }
    })()
  );
  return Response.json({ type: 5 });
}

export async function handleLeaderboardButtons(
  inter: ButtonInteraction,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const gid = inter.guild_id;
  if (!gid) return Response.json({ error: "No guild" }, { status: 400 });
  const customId = inter.data.custom_id;
  let page = 1;
  let mode: "season" | "all" = "all";
  let action: "page" | "mode" = "page";
  // Обработка переключения режима: lb_mode_season_X или lb_mode_all_X
  if (customId.startsWith("lb_mode_season_")) {
    mode = "season";
    page = parseInt(customId.substring(15), 10) || 1;
    action = "mode";
  } else if (customId.startsWith("lb_mode_all_")) {
    mode = "all";
    page = parseInt(customId.substring(12), 10) || 1;
    action = "mode";
  } else if (customId.startsWith("lb_page_season_prev_")) {
    page = Math.max(1, parseInt(customId.substring(20), 10) - 1);
    mode = "season";
    action = "page";
  } else if (customId.startsWith("lb_page_season_next_")) {
    page = parseInt(customId.substring(20), 10) + 1;
    mode = "season";
    action = "page";
  } else if (customId.startsWith("lb_page_all_prev_")) {
    page = Math.max(1, parseInt(customId.substring(17), 10) - 1);
    mode = "all";
    action = "page";
  } else if (customId.startsWith("lb_page_all_next_")) {
    page = parseInt(customId.substring(17), 10) + 1;
    mode = "all";
    action = "page";
  } else {
    // Старый формат (для обратной совместимости)
    const curPage = parseInt(customId.replace("lb_prev_", "").replace("lb_next_", ""), 10) || 1;
    page = curPage;
    if (customId.startsWith("lb_prev_")) page = Math.max(1, curPage - 1);
    else if (customId.startsWith("lb_next_")) page = curPage + 1;
  }
  const data = await getLeaderboardData(env, gid, page, mode, mode === "season" ? "season_xp" : "xp");
  const result = buildLeaderboardEmbed(data.entries, data.page, data.maxPages, data.total, mode);
  return Response.json({ type: 7, data: result });
}
