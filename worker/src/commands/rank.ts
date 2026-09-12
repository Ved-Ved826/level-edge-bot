// Команды /rank и /rank-today: Satori-карточка и дневная активность.

import { Buffer } from "node:buffer";
import satori from "satori";
import { Resvg, initWasm } from "@resvg/resvg-wasm";
// @ts-ignore
import resvgWasm from "@resvg/resvg-wasm/index_bg.wasm";
import { createClient } from "@libsql/client";
import { calculateLevel, getXpProgress } from "@shared/types";
import { Card, CardProps } from "../Card";
// @ts-ignore
import fontData from "../../assets/Inter-Regular.ttf";
import { CommandInteraction, DiscordInteraction, Env, ExecutionContext } from "../types";
import { getUserDailyActivity, getUserQuestProgress } from "../db/queries";
import { getVladivostokDate } from "../utils/formatters";
import { sendFollowUp } from "../utils/discord";

let wasmInitPromise: Promise<void> | null = null;

export function ensureWasmInitialized(): Promise<void> {
  if (!wasmInitPromise) wasmInitPromise = initWasm(resvgWasm);
  return wasmInitPromise;
}

export async function fetchAvatarAsBase64(user: { id: string; avatar: string | null; discriminator?: string }): Promise<string> {
  let url = "";
  if (user.avatar) {
    url = "https://cdn.discordapp.com/avatars/" + user.id + "/" + user.avatar + ".png?size=256";
  } else {
    // Для новых пользователей (discriminator === "0") используем default avatar index
    const idx = Number((BigInt(user.id) >> 22n) % 6n);
    url = "https://cdn.discordapp.com/embed/avatars/" + idx + ".png?size=256";
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

export async function renderCardToPng(props: CardProps): Promise<Uint8Array> {
  await ensureWasmInitialized();
  const svg = await satori(Card(props), { width: 800, height: 260, fonts: [{ name: "Inter", data: fontData as ArrayBuffer, weight: 400, style: "normal" }] });
  const resvg = new Resvg(svg, { fitTo: { mode: "width", value: 800 } });
  return resvg.render().asPng();
}

export async function handleRankCommand(interaction: DiscordInteraction, env: Env): Promise<{ png: Uint8Array; username: string } | { error: string }> {
  const gid = interaction.guild_id;
  if (!gid) return { error: "No guild" };
  // Получаем ID целевого пользователя из опции 'user' или используем ID автора команды
  const userOption = interaction.data?.options?.find((o: any) => o.name === 'user')?.value as string | undefined;
  const callerUser = interaction.member?.user;
  if (!callerUser) return { error: "No caller user" };
  const isSelf = !userOption || userOption === callerUser.id;
  const targetId = isSelf ? callerUser.id : userOption;
  let targetUser: { id: string; username: string; avatar: string | null; discriminator?: string };
  if (isSelf) {
    targetUser = {
      id: callerUser.id,
      username: callerUser.username,
      avatar: callerUser.avatar ?? null,
      discriminator: callerUser.discriminator || "0",
    };
  } else {
    const resolvedUser = interaction.data?.resolved?.users?.[targetId];
    if (!resolvedUser) {
      return { error: "User not found in resolved" };
    }
    targetUser = {
      id: targetId,
      username: resolvedUser.username || "Unknown",
      avatar: resolvedUser.avatar ?? null,
      discriminator: resolvedUser.discriminator || "0",
    };
  }
  try {
    const db = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });
    // Ищем данные по user_id = targetId в текущей гильдии
    const ures = await db.execute({ sql: "SELECT xp, messages_count, voice_seconds, streak_days, prestige_count FROM users WHERE user_id = ? AND guild_id = ?", args: [targetId, gid] });
    if (ures.rows.length === 0) return { error: "User not found in database" };
    const udata = ures.rows[0];
    const xp = (udata.xp as number) || 0;
    const msgc = (udata.messages_count as number) || 0;
    const voicesec = (udata.voice_seconds as number) || 0;
    const vh = Math.floor(voicesec / 3600);
    const streakDays = (udata.streak_days as number) || 0;
    const prestigeCount = (udata.prestige_count as number) || 0;
    // Достаём тему и титул из user_cosmetics
    const cosmetRes = await db.execute({
      sql: "SELECT theme_id, title_id FROM user_cosmetics WHERE user_id = ? AND guild_id = ?",
      args: [targetId, gid],
    });
    const themeId = cosmetRes.rows.length > 0 ? (cosmetRes.rows[0].theme_id as string) : "default";
    const customTitle = cosmetRes.rows.length > 0 ? (cosmetRes.rows[0].title_id as string) : "Новичок";
    const rres = await db.execute({ sql: "SELECT COUNT(*) as rank FROM users WHERE guild_id = ? AND xp > ?", args: [gid, xp] });
    const rank = ((rres.rows[0]?.rank as number) || 0) + 1;
    const tres = await db.execute({ sql: "SELECT COUNT(*) as total FROM users WHERE guild_id = ?", args: [gid] });
    const total = (tres.rows[0]?.total as number) || 1;
    const lvl = calculateLevel(xp);
    const prog = getXpProgress(xp);
    const avatar = await fetchAvatarAsBase64(targetUser);
    const png = await renderCardToPng({ username: targetUser.username, avatarBase64: avatar, level: lvl, rank, totalUsers: total, xp, nextLevelXp: prog.nextLevelXp, progress: prog.progress, messagesCount: msgc, voiceHours: vh, streakDays, prestigeCount, statusColor: "#23a55a", themeId, customTitle });
    return { png, username: targetUser.username };
  } catch (err) {
    console.error("[Error] rank cmd:", err);
    return { error: "DB error" };
  }
}

export function buildRankTodayEmbed(userId: string, username: string, activity: any, questProgress: any, today: string, streakData: { streakDays: number; streakFreezes: number }, coins: number) {
  const msgc = activity.messages_count;
  const voicesec = activity.voice_seconds;
  const vh = Math.floor(voicesec / 3600);
  const vm = Math.floor(voicesec / 60);
  const streakDays = streakData.streakDays;
  const streakFreezes = streakData.streakFreezes;
  // Формирование текста множителя XP
  let multiplierText = "1.0x";
  if (streakDays >= 30) multiplierText = "1.25x (+25%)";
  else if (streakDays >= 14) multiplierText = "1.15x (+15%)";
  else if (streakDays >= 7) multiplierText = "1.10x (+10%)";
  else if (streakDays >= 3) multiplierText = "1.05x (+5%)";
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
          { name: "🔥 Стрик активности", value: `**${streakDays} дн.** (${multiplierText}) | 🧊 Заморозок: **${streakFreezes}**`, inline: true },
          { name: "🪙 Баланс монет", value: `**${(coins || 0).toLocaleString()}**`, inline: true },
        ],
        footer: { text: `Дата: ${today} • Сброс в 00:00 (Владивосток, UTC+10)` },
      },
    ],
  };
}

export async function handleRank(
  inter: CommandInteraction,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  ctx.waitUntil(
    (async () => {
      try {
        const res = await handleRankCommand(inter, env);
        // Если пользователь не найден в БД - отправляем ephemeral-сообщение
        if ("error" in res && res.error === "User not found in database") {
          const resp = await fetch(`https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${inter.token}/messages/@original`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content: "❌ Этот пользователь ещё не проявлял активность на сервере!", flags: 64 }),
          });
          if (!resp.ok) console.error("Rank not found response fail:", await resp.text());
          return;
        }
        const r = await sendFollowUp(inter.token, env.DISCORD_APPLICATION_ID, res);
        if (!r.ok) console.error("Follow up fail:", await r.text());
      } catch (e) {
        console.error("Error:", e);
      }
    })()
  );
  return Response.json({ type: 5 });
}

export async function handleRankToday(
  inter: CommandInteraction,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
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
        // Достаём данные о стрике и монетах
        const streakRes = await db.execute({
          sql: "SELECT streak_days, streak_freezes, coins FROM users WHERE user_id = ? AND guild_id = ?",
          args: [uid, gid],
        });
        const streakData = {
          streakDays: (streakRes.rows[0]?.streak_days as number) || 0,
          streakFreezes: (streakRes.rows[0]?.streak_freezes as number) || 0,
        };
        const coins = (streakRes.rows[0]?.coins as number) || 0;
        const today = getVladivostokDate();
        const result = buildRankTodayEmbed(uid, user.username, activity, questProgress, today, streakData, coins);
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
