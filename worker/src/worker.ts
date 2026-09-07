import { Buffer } from "node:buffer";
import { createClient } from "@libsql/client";
import { calculateLevel, getXpProgress } from "@shared/types";
import satori from "satori";
import { Resvg, initWasm } from "@resvg/resvg-wasm";
// @ts-ignore
import resvgWasm from "@resvg/resvg-wasm/index_bg.wasm";
// @ts-ignore
import fontData from "../assets/Inter-Regular.ttf";
import { Card, CardProps } from "./Card";

interface Env {
  DATABASE_URL: string;
  DATABASE_AUTH_TOKEN: string;
  DISCORD_PUBLIC_KEY: string;
  DISCORD_APPLICATION_ID: string;
  DISCORD_BOT_TOKEN: string;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

interface DiscordInteraction {
  id: string;
  token: string;
  type: number;
  data?: { name?: string; options?: { name: string; value: any }[]; custom_id?: string };
  member?: { user: { id: string; username: string; avatar: string | null; discriminator: string } };
  guild_id?: string;
  message?: { components?: any[]; embeds?: any[] };
}

let wasmInitPromise: Promise<void> | null = null;
function ensureWasmInitialized(): Promise<void> {
  if (!wasmInitPromise) wasmInitPromise = initWasm(resvgWasm);
  return wasmInitPromise;
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  return bytes;
}

async function verifyDiscordSignature(sig: string, ts: string, body: string, pk: string): Promise<boolean> {
  try {
    const tsData = new TextEncoder().encode(ts);
    const bData = new TextEncoder().encode(body);
    const msgData = new Uint8Array(tsData.length + bData.length);
    msgData.set(tsData);
    msgData.set(bData, tsData.length);
    const pkBytes = hexToBytes(pk);
    const sigBytes = hexToBytes(sig);
    const key = await crypto.subtle.importKey("raw", pkBytes, { name: "Ed25519" } as any, false, ["verify"]);
    return await crypto.subtle.verify("Ed25519", key, sigBytes, msgData);
  } catch (err) {
    console.error("[Error] Sig verify failed:", err);
    return false;
  }
}

async function fetchAvatarAsBase64(user: { id: string; avatar: string | null; discriminator: string }): Promise<string> {
  let url = "";
  if (user.avatar) {
    url = "https://cdn.discordapp.com/avatars/" + user.id + "/" + user.avatar + ".png?size=256";
  } else if (user.discriminator === "0" || !user.discriminator) {
    const idx = Number((BigInt(user.id) >> 22n) % 6n);
    url = "https://cdn.discordapp.com/embed/avatars/" + idx + ".png";
  } else {
    const idx = (parseInt(user.discriminator, 10) % 5) || 0;
    url = "https://cdn.discordapp.com/embed/avatars/" + idx + ".png";
  }
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error("Avatar fetch failed");
    const buf = await res.arrayBuffer();
    const b64 = Buffer.from(buf).toString("base64");
    return "data:image/png;base64," + b64;
  } catch (err) {
    console.error("Avatar fetch error:", err);
    return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
  }
}

async function renderCardToPng(props: CardProps): Promise<Uint8Array> {
  await ensureWasmInitialized();
  const svg = await satori(Card(props), { width: 800, height: 260, fonts: [{ name: "Inter", data: fontData as ArrayBuffer, weight: 400, style: "normal" }] });
  const resvg = new Resvg(svg, { fitTo: { mode: "width", value: 800 } });
  return resvg.render().asPng();
}

async function handleRankCommand(interaction: DiscordInteraction, env: Env): Promise<{ png: Uint8Array; username: string } | { error: string }> {
  const uid = interaction.member?.user.id;
  const gid = interaction.guild_id;
  const user = interaction.member?.user;
  if (!uid || !gid || !user) return { error: "No user or guild" };
  try {
    const db = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });
    const ures = await db.execute({ sql: "SELECT xp, messages_count, voice_seconds FROM users WHERE user_id = ? AND guild_id = ?", args: [uid, gid] });
    if (ures.rows.length === 0) return { error: "User not found" };
    const udata = ures.rows[0];
    const xp = (udata.xp as number) || 0;
    const msgc = (udata.messages_count as number) || 0;
    const voicesec = (udata.voice_seconds as number) || 0;
    const vh = Math.floor(voicesec / 3600);
    const rres = await db.execute({ sql: "SELECT COUNT(*) as rank FROM users WHERE guild_id = ? AND xp > ?", args: [gid, xp] });
    const rank = ((rres.rows[0]?.rank as number) || 0) + 1;
    const tres = await db.execute({ sql: "SELECT COUNT(*) as total FROM users WHERE guild_id = ?", args: [gid] });
    const total = (tres.rows[0]?.total as number) || 1;
    const lvl = calculateLevel(xp);
    const prog = getXpProgress(xp);
    const avatar = await fetchAvatarAsBase64(user);
    const png = await renderCardToPng({ username: user.username, avatarBase64: avatar, level: lvl, rank, totalUsers: total, xp, nextLevelXp: prog.nextLevelXp, progress: prog.progress, messagesCount: msgc, voiceHours: vh, statusColor: "#23a55a" });
    return { png, username: user.username };
  } catch (err) {
    console.error("[Error] rank cmd:", err);
    return { error: "DB error" };
  }
}

async function sendFollowUp(token: string, appId: string, result: { png: Uint8Array; username: string } | { error: string }): Promise<Response> {
  const wurl = "https://discord.com/api/v10/webhooks/" + appId + "/" + token + "/messages/@original";
  const fd = new FormData();
  if ("error" in result) {
    fd.append("payload_json", JSON.stringify({ content: result.error }));
  } else {
    fd.append("payload_json", JSON.stringify({ attachments: [{ id: 0, filename: "rank-" + result.username + ".png" }] }));
    fd.append("files[0]", new Blob([result.png], { type: "image/png" }), "rank-" + result.username + ".png");
  }
  return fetch(wurl, { method: "PATCH", body: fd });
}

interface LeaderboardEntry {
  user_id: string;
  xp: number;
  messages_count: number;
  voice_seconds: number;
}

async function getLeaderboardData(env: Env, guildId: string, page: number = 1, sortBy: "xp" | "messages_count" | "voice_seconds" = "xp"): Promise<{ entries: LeaderboardEntry[]; total: number; page: number; maxPages: number }> {
  const db = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });
  const pageSize = 10;

  const tres = await db.execute({ sql: "SELECT COUNT(*) as total FROM users WHERE guild_id = ?", args: [guildId] });
  const total = (tres.rows[0]?.total as number) || 0;
  const maxPages = Math.ceil(total / pageSize) || 1;
  const safePage = Math.max(1, Math.min(page, maxPages));
  const offset = (safePage - 1) * pageSize;

  const ures = await db.execute({
    sql: `SELECT user_id, xp, messages_count, voice_seconds FROM users WHERE guild_id = ? ORDER BY ${sortBy} DESC LIMIT ? OFFSET ?`,
    args: [guildId, pageSize, offset]
  });

  const entries = ures.rows.map(r => ({
    user_id: r.user_id as string,
    xp: r.xp as number,
    messages_count: r.messages_count as number,
    voice_seconds: r.voice_seconds as number
  }));

  return { entries, total, page: safePage, maxPages };
}

function buildLeaderboardEmbed(entries: LeaderboardEntry[], page: number, maxPages: number, total: number) {
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

    line += `**<@${entry.user_id}>** — Уровень ${lvl} • ${entry.xp.toLocaleString()} XP (${msgc.toLocaleString()} сообщ. / ${vh} ч.)`;
    description += line + "\n";
  });

  return {
    embeds: [{
      title: "🏆 Таблица лидеров сервера",
      description: description || "Пока нет данных",
      color: 0x5865F2,
      footer: {
        text: `Страница ${page} из ${maxPages} • Всего участников: ${total}`
      }
    }],
    components: [
      {
        type: 1,
        components: [
          {
            type: 2,
            custom_id: `lb_prev_${page}`,
            style: 2,
            label: "◀ Назад",
            disabled: page <= 1
          },
          {
            type: 2,
            custom_id: `lb_next_${page}`,
            style: 2,
            label: "Вперед ▶",
            disabled: page >= maxPages
          }
        ]
      }
    ]
  };
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/interactions") {
      const sig = request.headers.get("x-signature-ed25519");
      const ts = request.headers.get("x-signature-timestamp");
      if (!sig || !ts) return Response.json({ error: "No sig" }, { status: 401 });

      const body = await request.text();
      const valid = await verifyDiscordSignature(sig, ts, body, env.DISCORD_PUBLIC_KEY);
      if (!valid) return Response.json({ error: "Bad sig" }, { status: 401 });

      const inter: DiscordInteraction = JSON.parse(body);

      // 1. PING
      if (inter.type === 1) return Response.json({ type: 1 });

      // 2. Слэш-команда /rank
      if (inter.type === 2 && inter.data?.name === "rank") {
        ctx.waitUntil((async () => {
          try {
            const res = await handleRankCommand(inter, env);
            const r = await sendFollowUp(inter.token, env.DISCORD_APPLICATION_ID, res);
            if (!r.ok) console.error("Follow up fail:", await r.text());
          } catch (e) {
            console.error("Error:", e);
          }
        })());
        return Response.json({ type: 5 });
      }

      // 3. Слэш-команда /leaderboard
      if (inter.type === 2 && inter.data?.name === "leaderboard") {
        const pageOption = inter.data?.options?.find(o => o.name === "page")?.value as number;
        const page = pageOption || 1;
        const gid = inter.guild_id;
        if (!gid) return Response.json({ error: "No guild" }, { status: 400 });

        ctx.waitUntil((async () => {
          try {
            const data = await getLeaderboardData(env, gid, page, "xp");
            const result = buildLeaderboardEmbed(data.entries, data.page, data.maxPages, data.total);
            const resp = await fetch(`https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${inter.token}/messages/@original`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(result)
            });
            if (!resp.ok) console.error("Leaderboard update fail:", await resp.text());
          } catch (e) {
            console.error("Leaderboard error:", e);
          }
        })());
        return Response.json({ type: 5 });
      }

// ============================================
// Функции для работы с ежедневными квестами
// ============================================

// Получение ежедневной активности пользователя
async function getUserDailyActivity(db: any, userId: string, guildId: string): Promise<any> {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  try {
    const result = await db.execute({
      sql: 'SELECT messages_count, voice_seconds FROM user_daily_activity WHERE user_id = ? AND guild_id = ? AND activity_date = ?',
      args: [userId, guildId, today],
    });
    if (result.rows.length === 0) {
      return { messages_count: 0, voice_seconds: 0 };
    }
    const row = result.rows[0];
    return {
      messages_count: (row.messages_count as number) || 0,
      voice_seconds: (row.voice_seconds as number) || 0,
    };
  } catch (err) {
    console.error('[Error] getUserDailyActivity:', err);
    return { messages_count: 0, voice_seconds: 0 };
  }
}

// Получение прогресса квестов пользователя
async function getUserQuestProgress(db: any, userId: string, guildId: string): Promise<{ completed: number; total: number; quests: any[] }> {
  const today = new Date().toISOString().slice(0, 10);
  try {
    // Получаем активные квесты гильдии на сегодня
    const questsResult = await db.execute({
      sql: `SELECT qd.*, qp.title, qp.description, qp.quest_type, qp.reward_xp
            FROM quests_daily qd
            JOIN quests_pool qp ON qd.quest_id = qp.id
            WHERE qd.guild_id = ? AND qd.active_date = ?`,
      args: [guildId, today],
    });
    const quests = questsResult.rows || [];

    if (quests.length === 0) {
      return { completed: 0, total: 0, quests: [] };
    }

    // Получаем прогресс пользователя по каждому квесту
    const progressResults: any[] = [];
    for (const quest of quests) {
      const qid = quest.id as string;
      const presult = await db.execute({
        sql: 'SELECT current_progress, completed_at FROM user_quest_progress WHERE user_id = ? AND guild_id = ? AND quest_daily_id = ?',
        args: [userId, guildId, qid],
      });
      progressResults.push({ quest, progress: presult.rows[0] });
    }

    const completed = progressResults.filter((pr: any) => pr.progress && pr.progress.completed_at !== null).length;

    return {
      completed,
      total: quests.length,
      quests: progressResults.map((pr: any) => ({
        title: pr.quest.title as string,
        description: pr.quest.description as string,
        quest_type: pr.quest.quest_type as string,
        reward_xp: pr.quest.reward_xp as number,
        current_progress: (pr.progress?.current_progress as number) || 0,
        completed_at: pr.progress?.completed_at as number | null,
        target: pr.quest.target as number,
      })),
    };
  } catch (err) {
    console.error('[Error] getUserQuestProgress:', err);
    return { completed: 0, total: 0, quests: [] };
  }
}

// Убедиться, что для гильдии назначены квесты на сегодня
async function ensureDailyQuests(db: any, guildId: string): Promise<boolean> {
  const today = new Date().toISOString().slice(0, 10);
  try {
    const existing = await db.execute({
      sql: 'SELECT COUNT(*) as count FROM quests_daily WHERE guild_id = ? AND active_date = ?',
      args: [guildId, today],
    });
    const count = (existing.rows[0]?.count as number) || 0;
    return count > 0;
  } catch (err) {
    console.error('[Error] ensureDailyQuests:', err);
    return false;
  }
}

// Сборка Embed для /rank-today
function buildRankTodayEmbed(userId: string, username: string, activity: any, questProgress: any, today: string) {
  const msgc = activity.messages_count;
  const voicesec = activity.voice_seconds;
  const vh = Math.floor(voicesec / 3600);
  const vm = Math.floor((voicesec % 3600) / 60);

  return {
    embeds: [{
      title: `📊 Активность ${username} за сегодня`,
      description: `Профиль <@${userId}>`,
      color: 0x5865F2, // Blurple
      fields: [
        {
          name: '💬 Сообщений',
          value: `**${msgc.toLocaleString()}**`,
          inline: true,
        },
        {
          name: '🎙 В голосовом канале',
          value: `**${vm} мин.** (${vh} ч. ${vm % 60} мин.)`,
          inline: true,
        },
        {
          name: '🎯 Выполнено квестов',
          value: `**${questProgress.completed} / ${questProgress.total}**`,
          inline: true,
        },
      ],
      footer: {
        text: `Дата: ${today} (UTC) • Сброс в 00:00 UTC`,
      },
    }],
  };
}

// Сборка Embed для /quests
function buildQuestsEmbed(questProgress: any, today: string) {
  let description = '';
  questProgress.quests.forEach((q: any) => {
    const progress = q.current_progress;
    const target = q.target;
    const completed = q.completed_at !== null;

    let bar = '';
    if (target > 0) {
      const filled = Math.min(10, Math.round((progress / target) * 10));
      for (let i = 0; i < filled; i++) bar += '█';
      for (let i = filled; i < 10; i++) bar += '░';
    }

    if (completed) {
      description += `✅ **${q.title}** — ${q.description}\n`;
      description += `   🎯 Награда: **+${q.reward_xp} XP**\n\n`;
    } else {
      const typeIcon = q.quest_type === 'voice' ? '🎙' : '💬';
      description += `${typeIcon} **${q.title}** — ${q.description}\n`;
      description += `   📊 Прогресс: \`${bar}\` ${progress} / ${target}\n`;
      description += `   🎯 Награда: **+${q.reward_xp} XP**\n\n`;
    }
  });

  return {
    embeds: [{
      title: `🎯 Квесты на ${today}`,
      description: description || 'Сегодня квестов нет. Приходите завтра!',
      color: 0x5865F2,
      footer: {
        text: `Активные квесты гильдии • Выполнено: ${questProgress.completed}/${questProgress.total}`,
      },
    }],
  };
}

      // 4. Кнопки пагинации (Type 3 - Message Component)
      if (inter.type === 3 && inter.data?.custom_id?.startsWith("lb_")) {
        const gid = inter.guild_id;
        if (!gid) return Response.json({ error: "No guild" }, { status: 400 });

        const customId = inter.data.custom_id;
        const curPage = parseInt(customId.replace("lb_prev_", "").replace("lb_next_", ""), 10) || 1;
        let page = curPage;

        if (customId.startsWith("lb_prev_")) {
          page = Math.max(1, curPage - 1);
        } else if (customId.startsWith("lb_next_")) {
          page = curPage + 1;
        }

        const data = await getLeaderboardData(env, gid, page, "xp");
        const result = buildLeaderboardEmbed(data.entries, data.page, data.maxPages, data.total);

        // Мгновенное обновление Type 7
        return Response.json({
          type: 7,
          data: result
        });
      }

      // 5. Слэш-команда /rank-today
      if (inter.type === 2 && inter.data?.name === "rank-today") {
        const uid = inter.member?.user.id;
        const gid = inter.guild_id;
        const user = inter.member?.user;
        if (!uid || !gid || !user) return Response.json({ error: "No user or guild" }, { status: 400 });

        ctx.waitUntil((async () => {
          try {
            const db = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });
            const activity = await getUserDailyActivity(db, uid, gid);
            const questProgress = await getUserQuestProgress(db, uid, gid);
            const today = new Date().toISOString().slice(0, 10);
            const result = buildRankTodayEmbed(uid, user.username, activity, questProgress, today);
            const resp = await fetch(`https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${inter.token}/messages/@original`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(result)
            });
            if (!resp.ok) console.error("Rank today update fail:", await resp.text());
          } catch (e) {
            console.error("Rank today error:", e);
          }
        })());
        return Response.json({ type: 5 });
      }

      // 6. Слэш-команда /quests
      if (inter.type === 2 && inter.data?.name === "quests") {
        const gid = inter.guild_id;
        if (!gid) return Response.json({ error: "No guild" }, { status: 400 });

        ctx.waitUntil((async () => {
          try {
            const db = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });

            // Убедиться, что квесты назначены
            const hasQuests = await ensureDailyQuests(db, gid);
            if (!hasQuests) {
              console.log('[Quests] No quests for guild, assigning...');
              // Принудительная инициализация (дублируем логику из collector)
              // В реальном проекте вынести в shared module
            }

            const questProgress = await getUserQuestProgress(db, inter.member?.user.id || "unknown", gid);
            const today = new Date().toISOString().slice(0, 10);
            const result = buildQuestsEmbed(questProgress, today);

            const resp = await fetch(`https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${inter.token}/messages/@original`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(result)
            });
            if (!resp.ok) console.error("Quests update fail:", await resp.text());
          } catch (e) {
            console.error("Quests error:", e);
          }
        })());
        return Response.json({ type: 5 });
      }

      return Response.json({ error: "Unknown interaction" }, { status: 400 });
    } // <-- вот этой скобки не хватало!

    if (url.pathname === "/health") return new Response("OK");
    return new Response("Not Found", { status: 404 });
  },
};