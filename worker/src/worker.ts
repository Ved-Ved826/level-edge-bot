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

// ============================================
// Вспомогательные утилиты (WASM, Дата, Бары)
// ============================================

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

function getVladivostokDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Vladivostok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function renderProgressBar(current: number, target: number, length: number = 10): string {
  const ratio = Math.min(Math.max(current / target, 0), 1);
  const filled = Math.round(ratio * length);
  const empty = length - filled;
  return "█".repeat(filled) + "░".repeat(empty);
}

// ============================================
// Генерация карточки ранга (/rank)
// ============================================

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

// ============================================
// Лидерборд (/leaderboard)
// ============================================

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
    args: [guildId, pageSize, offset],
  });

  const entries = ures.rows.map((r) => ({
    user_id: r.user_id as string,
    xp: r.xp as number,
    messages_count: r.messages_count as number,
    voice_seconds: r.voice_seconds as number,
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
    embeds: [
      {
        title: "🏆 Таблица лидеров сервера",
        description: description || "Пока нет данных",
        color: 0x5865f2,
        footer: { text: `Страница ${page} из ${maxPages} • Всего участников: ${total}` },
      },
    ],
    components: [
      {
        type: 1,
        components: [
          { type: 2, custom_id: `lb_prev_${page}`, style: 2, label: "◀ Назад", disabled: page <= 1 },
          { type: 2, custom_id: `lb_next_${page}`, style: 2, label: "Вперед ▶", disabled: page >= maxPages },
        ],
      },
    ],
  };
}

// ============================================
// Квесты и Дейли-активность
// ============================================

const DEFAULT_QUESTS = [
  { id: "msg_1", title: "Разминка пальцев", desc: "Отправьте 10 сообщений в чат", type: "messages", target: 10, xp: 50 },
  { id: "msg_2", title: "Активный спикер", desc: "Отправьте 30 сообщений в чат", type: "messages", target: 30, xp: 150 },
  { id: "msg_3", title: "Гроза чата", desc: "Отправьте 60 сообщений в чат", type: "messages", target: 60, xp: 300 },
  { id: "msg_4", title: "Стена текста", desc: "Отправьте 100 сообщений в чат", type: "messages", target: 100, xp: 500 },
  { id: "vc_1", title: "Заглянул на огонёк", desc: "Проведите 15 минут в голосовом канале", type: "voice", target: 15, xp: 100 },
  { id: "vc_2", title: "Душевный разговор", desc: "Проведите 45 минут в голосовом канале", type: "voice", target: 45, xp: 250 },
  { id: "vc_3", title: "Войс-марафон", desc: "Проведите 90 минут в голосовом канале", type: "voice", target: 90, xp: 450 },
  { id: "sp_1", title: "Двойной удар", desc: "Отправьте 25 сообщений в чат", type: "messages", target: 25, xp: 120 },
  { id: "sp_2", title: "Ночной дозор", desc: "Проведите 30 минут в войсе", type: "voice", target: 30, xp: 200 },
];

async function ensureQuestsPool(db: any): Promise<void> {
  try {
    const result = await db.execute({ sql: "SELECT COUNT(*) as count FROM quests_pool", args: [] });
    if (((result.rows[0]?.count as number) || 0) === 0) {
      for (const q of DEFAULT_QUESTS) {
        await db.execute({
          sql: "INSERT OR IGNORE INTO quests_pool (id, title, description, quest_type, target, reward_xp) VALUES (?, ?, ?, ?, ?, ?)",
          args: [q.id, q.title, q.desc, q.type, q.target, q.xp],
        });
      }
    }
  } catch (err) {
    console.error("[Quests] Error ensuring pool:", err);
  }
}

async function ensureDailyQuests(db: any, guildId: string): Promise<boolean> {
  const today = getVladivostokDate();
  try {
    await ensureQuestsPool(db);

    const existing = await db.execute({
      sql: "SELECT COUNT(*) as count FROM quests_daily WHERE guild_id = ? AND active_date = ?",
      args: [guildId, today],
    });

    if (((existing.rows[0]?.count as number) || 0) > 0) return true;

    const poolRes = await db.execute({ sql: "SELECT * FROM quests_pool", args: [] });
    const pool = poolRes.rows;
    if (pool.length === 0) return false;

    const msgQuests = pool.filter((q: any) => q.quest_type === "messages");
    const voiceQuests = pool.filter((q: any) => q.quest_type === "voice");
    const pickRandom = (arr: any[]) => arr[Math.floor(Math.random() * arr.length)];

    const selected: any[] = [];
    if (msgQuests.length > 0) selected.push(pickRandom(msgQuests));
    if (voiceQuests.length > 0) selected.push(pickRandom(voiceQuests));

    const remaining = pool.filter((q: any) => !selected.some((s) => s.id === q.id));
    if (remaining.length > 0) selected.push(pickRandom(remaining));

    for (let idx = 0; idx < selected.length; idx++) {
      const q = selected[idx];
      const dailyId = `${guildId}_${today}_${idx + 1}`;
      await db.execute({
        sql: "INSERT OR IGNORE INTO quests_daily (id, guild_id, quest_id, active_date, target, reward_xp) VALUES (?, ?, ?, ?, ?, ?)",
        args: [dailyId, guildId, q.id, today, q.target || q.target_value, q.reward_xp || q.xp],
      });
    }

    return true;
  } catch (err) {
    console.error("[Quests] Error ensuring daily quests:", err);
    return false;
  }
}

async function getUserDailyActivity(db: any, userId: string, guildId: string): Promise<{ messages_count: number; voice_seconds: number }> {
  const today = getVladivostokDate();
  try {
    const result = await db.execute({
      sql: "SELECT messages_count, voice_seconds FROM user_daily_activity WHERE user_id = ? AND guild_id = ? AND activity_date = ?",
      args: [userId, guildId, today],
    });
    if (result.rows.length === 0) return { messages_count: 0, voice_seconds: 0 };
    const row = result.rows[0];
    return {
      messages_count: (row.messages_count as number) || 0,
      voice_seconds: (row.voice_seconds as number) || 0,
    };
  } catch (err) {
    console.error("[Error] getUserDailyActivity:", err);
    return { messages_count: 0, voice_seconds: 0 };
  }
}

async function getUserQuestProgress(db: any, userId: string, guildId: string): Promise<{ completed: number; total: number; quests: any[] }> {
  const today = getVladivostokDate();
  try {
    const questsResult = await db.execute({
      sql: `SELECT qd.id as daily_id, qd.target, qd.reward_xp, qp.title, qp.description, qp.quest_type
            FROM quests_daily qd
            JOIN quests_pool qp ON qd.quest_id = qp.id
            WHERE qd.guild_id = ? AND qd.active_date = ?`,
      args: [guildId, today],
    });

    const quests = questsResult.rows || [];
    if (quests.length === 0) return { completed: 0, total: 0, quests: [] };

    const progressResults: any[] = [];
    for (const quest of quests) {
      const dailyId = quest.daily_id as string;
      const presult = await db.execute({
        sql: "SELECT current_progress, completed_at FROM user_quest_progress WHERE user_id = ? AND guild_id = ? AND quest_daily_id = ?",
        args: [userId, guildId, dailyId],
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
        completed_at: pr.progress?.completed_at ? (pr.progress.completed_at as number) : null,
        target: pr.quest.target as number,
      })),
    };
  } catch (err) {
    console.error("[Error] getUserQuestProgress:", err);
    return { completed: 0, total: 0, quests: [] };
  }
}

function buildRankTodayEmbed(userId: string, username: string, activity: any, questProgress: any, today: string) {
  const msgc = activity.messages_count;
  const voicesec = activity.voice_seconds;
  const vh = Math.floor(voicesec / 3600);
  const vm = Math.floor(voicesec / 60);

  return {
    embeds: [
      {
        title: `📊 Активность ${username} за сегодня`,
        description: `Профиль: <@${userId}>`,
        color: 0x5865f2,
        fields: [
          { name: "💬 Сообщений", value: `**${msgc.toLocaleString()}**`, inline: true },
          { name: "🎙 В голосовом канале", value: `**${vm} мин.** (${vh} ч. ${vm % 60} мин.)`, inline: true },
          { name: "🎯 Выполнено квестов", value: `**${questProgress.completed} / ${questProgress.total}**`, inline: true },
        ],
        footer: { text: `Дата: ${today} • Сброс в 00:00 (Владивосток, UTC+10)` },
      },
    ],
  };
}

function buildQuestsEmbed(questProgress: any, today: string) {
  let description = "";

  if (questProgress.quests.length === 0) {
    description = "Сегодня квестов нет. Приходите завтра!";
  } else {
    questProgress.quests.forEach((q: any) => {
      const progress = q.current_progress;
      const target = q.target;
      const completed = q.completed_at !== null;

      if (completed) {
        description += `✅ **${q.title}** — ${q.description}\n`;
        description += `\`[██████████]\` **${target} / ${target}** • **Выполнено! (+${q.reward_xp} XP)**\n\n`;
      } else {
        const bar = renderProgressBar(progress, target, 10);
        const percent = target > 0 ? Math.round((progress / target) * 100) : 0;
        const typeIcon = q.quest_type === "voice" ? "🎙" : "💬";

        description += `${typeIcon} **${q.title}** — *${q.description}*\n`;
        description += `\`[${bar}]\` **${progress} / ${target}** (${percent}%) • Награда: **+${q.reward_xp} XP**\n\n`;
      }
    });
  }

  return {
    embeds: [
      {
        title: `🎯 Ежедневные квесты на ${today}`,
        description: description,
        color: 0x5865f2,
        footer: { text: `Сброс квестов каждый день в 00:00 (Владивосток, UTC+10)` },
      },
    ],
  };
}

// ============================================
// Главный Interaction Handler
// ============================================

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
        ctx.waitUntil(
          (async () => {
            try {
              const res = await handleRankCommand(inter, env);
              const r = await sendFollowUp(inter.token, env.DISCORD_APPLICATION_ID, res);
              if (!r.ok) console.error("Follow up fail:", await r.text());
            } catch (e) {
              console.error("Error:", e);
            }
          })()
        );
        return Response.json({ type: 5 });
      }

      // 3. Слэш-команда /leaderboard
      if (inter.type === 2 && inter.data?.name === "leaderboard") {
        const pageOption = inter.data?.options?.find((o) => o.name === "page")?.value as number;
        const page = pageOption || 1;
        const gid = inter.guild_id;
        if (!gid) return Response.json({ error: "No guild" }, { status: 400 });

        ctx.waitUntil(
          (async () => {
            try {
              const data = await getLeaderboardData(env, gid, page, "xp");
              const result = buildLeaderboardEmbed(data.entries, data.page, data.maxPages, data.total);
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

      // 4. Кнопки пагинации лидерборда (Type 3)
      if (inter.type === 3 && inter.data?.custom_id?.startsWith("lb_")) {
        const gid = inter.guild_id;
        if (!gid) return Response.json({ error: "No guild" }, { status: 400 });

        const customId = inter.data.custom_id;
        const curPage = parseInt(customId.replace("lb_prev_", "").replace("lb_next_", ""), 10) || 1;
        let page = curPage;

        if (customId.startsWith("lb_prev_")) page = Math.max(1, curPage - 1);
        else if (customId.startsWith("lb_next_")) page = curPage + 1;

        const data = await getLeaderboardData(env, gid, page, "xp");
        const result = buildLeaderboardEmbed(data.entries, data.page, data.maxPages, data.total);

        return Response.json({ type: 7, data: result });
      }

      // 5. Слэш-команда /rank-today
      if (inter.type === 2 && inter.data?.name === "rank-today") {
        const uid = inter.member?.user.id;
        const gid = inter.guild_id;
        const user = inter.member?.user;
        if (!uid || !gid || !user) return Response.json({ error: "No user or guild" }, { status: 400 });

        ctx.waitUntil(
          (async () => {
            try {
              const db = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });
              const activity = await getUserDailyActivity(db, uid, gid);
              const questProgress = await getUserQuestProgress(db, uid, gid);
              const today = getVladivostokDate();
              const result = buildRankTodayEmbed(uid, user.username, activity, questProgress, today);

              const resp = await fetch(`https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${inter.token}/messages/@original`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(result),
              });
              if (!resp.ok) console.error("Rank today update fail:", await resp.text());
            } catch (e) {
              console.error("Rank today error:", e);
            }
          })()
        );
        return Response.json({ type: 5 });
      }

      // 6. Слэш-команда /quests
      if (inter.type === 2 && inter.data?.name === "quests") {
        const gid = inter.guild_id;
        const uid = inter.member?.user.id;
        if (!gid || !uid) return Response.json({ error: "No guild or user" }, { status: 400 });

        ctx.waitUntil(
          (async () => {
            try {
              const db = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });
              await ensureDailyQuests(db, gid);

              const questProgress = await getUserQuestProgress(db, uid, gid);
              const today = getVladivostokDate();
              const result = buildQuestsEmbed(questProgress, today);

              const resp = await fetch(`https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${inter.token}/messages/@original`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(result),
              });
              if (!resp.ok) console.error("Quests update fail:", await resp.text());
            } catch (e) {
              console.error("Quests error:", e);
            }
          })()
        );
        return Response.json({ type: 5 });
      }

      return Response.json({ error: "Unknown interaction" }, { status: 400 });
    }

    if (url.pathname === "/health") return new Response("OK");
    return new Response("Not Found", { status: 404 });
  },
};
