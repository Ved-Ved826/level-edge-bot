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

// ============================================
// Система достижений (Этап 6 - 27 секретных пасхалок)
// ============================================

interface Achievement {
  id: string;
  title: string;
  description: string;
  quote: string;
  reward: number;
}

// 27 достижений из CLAUDE.md
const ACHIEVEMENTS_LIST: Achievement[] = [
  // --- Ведьмак 3 ---
  {
    id: 'witcher_plod',
    title: '🐺 Шевелись, Плотва!',
    description: 'Отправить сообщение ровно через 30-35 сек после предыдущего',
    quote: 'Лютик, бл#ть...',
    reward: 150,
  },
  {
    id: 'witcher_gwent',
    title: '🃏 В Гвинт не сыграешь?',
    description: 'Сыграть 3 дуэли за один день',
    quote: 'Кивает молча и достаёт колоду Королевств Севера.',
    reward: 200,
  },
  {
    id: 'witcher_damn',
    title: '🐺 Зараза...',
    description: 'Проиграть дуэль с броском кубика меньше 10',
    quote: 'Ветер воет...',
    reward: 100,
  },
  {
    id: 'witcher_blaviken',
    title: '⚔️ Мясник из Блавикена',
    description: 'Выиграть 3 дуэли подряд без поражений',
    quote: 'Если приходится выбирать между злом и злом...',
    reward: 350,
  },
  {
    id: 'witcher_coin',
    title: '🪙 Чеканная монета',
    description: 'Зафиксировать ровно 1000, 2000, 3000 или 5000 XP',
    quote: 'Зачтётся всё это вам!',
    reward: 250,
  },
  // --- Red Dead Redemption 2 ---
  {
    id: 'rdr_plan',
    title: '🤠 У меня есть ПЛАН!',
    description: 'Накопить 3000+ XP, ни разу не проиграв в дуэлях',
    quote: 'Нам просто нужно больше денег, Артур!',
    reward: 300,
  },
  {
    id: 'rdr_lenny',
    title: '🍻 ЛИИИННИИИИ!',
    description: 'Отправить капс-сообщение 10+ букв ночью с 02:00 до 05:00',
    quote: 'YNNEL?! ГДЕ ТЫ, ЛЕННИ?!',
    reward: 150,
  },
  {
    id: 'rdr_quickdraw',
    title: '🎯 Быстрая рука',
    description: 'Выиграть дуэль с броском 95+',
    quote: 'На этом сервере место только для одного.',
    reward: 250,
  },
  {
    id: 'rdr_tahiti',
    title: '🥭 Билет на Таити',
    description: 'Провести более 5 часов в войсе за день',
    quote: 'Мы будем выращивать манго и жить припеваючи.',
    reward: 300,
  },
  {
    id: 'rdr_tax',
    title: '💰 Капитализм, Артур',
    description: 'Сжечь более 200 XP на налоге с дуэлей',
    quote: 'Мы воры в мире, которому мы больше не нужны.',
    reward: 200,
  },
  // --- Владивосток и ДВ ---
  {
    id: 'vlad_2000',
    title: '🌊 Владивосток 2000',
    description: 'Оказаться ровно с 2000 XP на балансе',
    quote: 'Уходим, уходим, уходят кометы...',
    reward: 200,
  },
  {
    id: 'vlad_midnight',
    title: '⚓ Полночь на Эгершельде',
    description: 'Отправить сообщение ровно в 00:00 (Владивосток)',
    quote: 'Маяк светит, квесты сбросились.',
    reward: 200,
  },
  {
    id: 'vlad_pyanse',
    title: '🥟 Пян-се на Луговой',
    description: 'Быть активным в чате во время обеда с 12:00 до 13:00 (Владивосток)',
    quote: 'С пылу с жару, с перцем и капустой.',
    reward: 120,
  },
  {
    id: 'vlad_typhoon',
    title: '🌪️ Тайфун прошёл стороной',
    description: 'Спасти стрик с помощью заморозки',
    quote: 'Опять передавали штормовое, но обошлось.',
    reward: 250,
  },
  {
    id: 'vlad_right_hand',
    title: '🚗 Истинный праворульщик',
    description: 'Сменить тему на Киберпанк или Магму',
    quote: 'Руль в бардачке, едем боком.',
    reward: 100,
  },
  {
    id: 'vlad_golden_horn',
    title: '🌉 Хозяин Золотого Рога',
    description: 'Занять 1-е место в лидерборде сервера',
    quote: 'Мост построили, сервер держим.',
    reward: 500,
  },
  // --- Half-Life 2 ---
  {
    id: 'hl_wakeup',
    title: '🚆 Проснитесь и попойте',
    description: 'Отправить сообщение с 06:00 до 07:00 утра (Владивосток)',
    quote: 'Нужный человек не в том месте...',
    reward: 150,
  },
  {
    id: 'hl_can',
    title: '🥫 Подними эту банку',
    description: 'Выполнить свой первый ежедневный квест',
    quote: 'А теперь брось её в урну.',
    reward: 100,
  },
  {
    id: 'hl_water',
    title: '💧 Не пейте воду',
    description: 'Провести 2 часа непрерывно в войсе',
    quote: 'Они туда что-то подмешивают...',
    reward: 250,
  },
  {
    id: 'hl_crowbar',
    title: '🪓 Монтировка против страйдера',
    description: 'Победить в дуэли оппонента, у которого уровень выше твоего на 2+',
    quote: 'Физика Source на твоей стороне.',
    reward: 300,
  },
  {
    id: 'hl_airdrop',
    title: '📦 Ящик сопротивления',
    description: 'Первым забрать контейнер войс-дропа',
    quote: 'Сигнальная ракета сработала.',
    reward: 150,
  },
  // --- Мемы / Навальный ---
  {
    id: 'fbk_hello',
    title: '📣 Привет, это Навальный',
    description: 'Написать сообщение после 3+ дней отсутствия на сервере',
    quote: 'Я не молчал, я просто был в оффлайне!',
    reward: 150,
  },
  {
    id: 'fbk_sandwich',
    title: '🥪 Не бутерброд',
    description: 'Удержать стрик активности ровно 14 дней',
    quote: 'Стрик — он что, бутерброд, чтобы его сбрасывать?',
    reward: 250,
  },
  {
    id: 'fbk_final_battle',
    title: '⚔️ Финальная битва',
    description: 'Сыграть дуэль со ставкой от 1000 XP',
    quote: 'Финальная битва добра с нейтралитетом!',
    reward: 300,
  },
  {
    id: 'fbk_investigation',
    title: '🕵️ Команда расследователей',
    description: 'Посмотреть карточ  и /rank 5 разных людей за день',
    quote: 'Мы нашли у него незадекларированный уровень.',
    reward: 150,
  },
  {
    id: 'fbk_prb',
    title: '☀️ Прекрасный Сервер Будущего',
    description: 'Закрыть все 3 дейлика за один день',
    quote: 'Россия будет счастливой, а опыт нафармлен.',
    reward: 250,
  },
  // --- Классика ---
  {
    id: 'lucky_777',
    title: '🎰 Три топора',
    description: 'Зафиксировать ровно 777 XP на балансе',
    quote: 'Поднял бабла, теперь в топе.',
    reward: 250,
  },
  {
    id: 'casino_house',
    title: '🎲 Казино всегда в плюсе',
    description: 'Сжечь более 100 XP налога в одной дуэли',
    quote: 'Карты с самого начала были краплеными.',
    reward: 150,
  },
];

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
  data?: {
    name?: string;
    options?: { name: string; value: any }[];
    custom_id?: string;
    values?: string[];
  } | {
    name: string;
    options?: { name: string; value: any }[];
    custom_id?: string;
    values?: string[];
  };
  member?: {
    user: { id: string; username: string; avatar: string | null; discriminator: string };
    id: string;
    permissions?: string;
  };
  guild_id?: string;
  message?: { components?: any[]; embeds?: any[] };
  resolved?: { users?: { [id: string]: { username: string; discriminator: string } }; members?: { [id: string]: any } };
}

// ============================================
// Вспомогательные утилиты (WASM, Дата, Бары)
// ============================================

async function unlockAchievement(
  db: any,
  userId: string,
  guildId: string,
  achievementId: string,
  webhookUrl: string,
  appId: string
): Promise<void> {
  try {
    const achievement = ACHIEVEMENTS_LIST.find((a) => a.id === achievementId);
    if (!achievement) return;

    // Проверяем, не открыто ли уже достижение
    const existing = await db.execute({
      sql: "SELECT 1 FROM user_achievements WHERE user_id = ? AND guild_id = ? AND achievement_id = ?",
      args: [userId, guildId, achievementId],
    });

    if (existing.rows.length > 0) return;

    // Вставляем запись о достижении
    const now = Math.floor(Date.now() / 1000);
    await db.execute({
      sql: "INSERT INTO user_achievements (user_id, guild_id, achievement_id, unlocked_at) VALUES (?, ?, ?, ?)",
      args: [userId, guildId, achievementId, now],
    });

    // Отправляем уведомление в Discord через webhook
    const embed = {
      embeds: [
        {
          title: `🎉 Достижение разблокировано!`,
          description: `<@${userId}> открыл **"${achievement.title}"**!`,
          color: 0xF1C40F,
          fields: [
            { name: "Награда", value: `+${achievement.reward} XP`, inline: true },
            { name: "Цитата", value: `"${achievement.quote}"`, inline: false },
          ],
          footer: { text: achievement.description },
        },
      ],
    };

    // Асинхронная отправка без блокировки
    fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(embed),
    }).catch(() => {});
  } catch (err) {
    console.error(`[Achievement] Error unlocking ${achievementId}:`, err);
  }
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

    // Достаём xp, messages_count, voice_seconds, streak_days, prestige_count
    const ures = await db.execute({ sql: "SELECT xp, messages_count, voice_seconds, streak_days, prestige_count FROM users WHERE user_id = ? AND guild_id = ?", args: [uid, gid] });
    if (ures.rows.length === 0) return { error: "User not found" };
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
      args: [uid, gid],
    });
    const themeId = cosmetRes.rows.length > 0 ? (cosmetRes.rows[0].theme_id as string) : "default";
    const customTitle = cosmetRes.rows.length > 0 ? (cosmetRes.rows[0].title_id as string) : "Новичок";

    const rres = await db.execute({ sql: "SELECT COUNT(*) as rank FROM users WHERE guild_id = ? AND xp > ?", args: [gid, xp] });
    const rank = ((rres.rows[0]?.rank as number) || 0) + 1;
    const tres = await db.execute({ sql: "SELECT COUNT(*) as total FROM users WHERE guild_id = ?", args: [gid] });
    const total = (tres.rows[0]?.total as number) || 1;
    const lvl = calculateLevel(xp);
    const prog = getXpProgress(xp);
    const avatar = await fetchAvatarAsBase64(user);
    const png = await renderCardToPng({ username: user.username, avatarBase64: avatar, level: lvl, rank, totalUsers: total, xp, nextLevelXp: prog.nextLevelXp, progress: prog.progress, messagesCount: msgc, voiceHours: vh, streakDays, prestigeCount, statusColor: "#23a55a", themeId, customTitle });
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
  season_xp: number;
  messages_count: number;
  voice_seconds: number;
}

// Объединённый тип для сортировки
type SortBy = "xp" | "messages_count" | "voice_seconds" | "season_xp";

async function getLeaderboardData(env: Env, guildId: string, page: number = 1, mode: "season" | "all" = "all", sortBy: SortBy = "xp"): Promise<{ entries: LeaderboardEntry[]; total: number; page: number; maxPages: number }> {
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

function buildLeaderboardEmbed(entries: LeaderboardEntry[], page: number, maxPages: number, total: number, mode: "season" | "all" = "all") {
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

// Получение текущего сезона (для лидерборда)
function getCurrentSeason(): string {
  const month = new Date().getUTCMonth() + 1;
  if (month >= 3 && month <= 5) return "🌸 Весенний кубок";
  if (month >= 6 && month <= 8) return "☀️ Летний драйв";
  if (month >= 9 && month <= 11) return "🍂 Осенний марафон";
  return "❄️ Зимняя битва";
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

function buildRankTodayEmbed(userId: string, username: string, activity: any, questProgress: any, today: string, streakData: { streakDays: number; streakFreezes: number }) {
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
// Система дуэлей (/duel) - Этап 3
// ============================================

async function checkUserExists(db: any, userId: string, guildId: string): Promise<boolean> {
  try {
    const res = await db.execute({
      sql: "SELECT 1 FROM users WHERE user_id = ? AND guild_id = ?",
      args: [userId, guildId],
    });
    return res.rows.length > 0;
  } catch (err) {
    console.error("[Duel] Error checking user:", err);
    return false;
  }
}

async function getUserXp(db: any, userId: string, guildId: string): Promise<number> {
  try {
    const res = await db.execute({
      sql: "SELECT xp FROM users WHERE user_id = ? AND guild_id = ?",
      args: [userId, guildId],
    });
    if (res.rows.length === 0) return 0;
    return (res.rows[0].xp as number) || 0;
  } catch (err) {
    console.error("[Duel] Error getting XP:", err);
    return 0;
  }
}

async function updateXpAndLevel(db: any, userId: string, guildId: string, xpChange: number): Promise<number> {
  try {
    const res = await db.execute({
      sql: "SELECT xp FROM users WHERE user_id = ? AND guild_id = ?",
      args: [userId, guildId],
    });
    if (res.rows.length === 0) return 0;
    const currentXp = (res.rows[0].xp as number) || 0;
    const newXp = currentXp + xpChange;
    const newLevel = calculateLevel(newXp);
    await db.execute({
      sql: "UPDATE users SET xp = ?, level = ? WHERE user_id = ? AND guild_id = ?",
      args: [newXp, newLevel, userId, guildId],
    });
    return newXp;
  } catch (err) {
    console.error("[Duel] Error updating XP:", err);
    return 0;
  }
}

async function createDuelRecord(db: any, duelId: string, guildId: string, challengerId: string, opponentId: string, betAmount: number): Promise<boolean> {
  try {
    const now = Math.floor(Date.now() / 1000);
    await db.execute({
      sql: "INSERT INTO duels (id, guild_id, challenger_id, opponent_id, bet_amount, status, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?)",
      args: [duelId, guildId, challengerId, opponentId, betAmount, now],
    });
    return true;
  } catch (err) {
    console.error("[Duel] Error creating record:", err);
    return false;
  }
}

async function getDuelById(db: any, duelId: string): Promise<any> {
  try {
    const res = await db.execute({
      sql: "SELECT * FROM duels WHERE id = ?",
      args: [duelId],
    });
    return res.rows.length > 0 ? res.rows[0] : null;
  } catch (err) {
    console.error("[Duel] Error getting duel:", err);
    return null;
  }
}

async function updateDuelStatus(db: any, duelId: string, status: "accepted" | "declined" | "completed"): Promise<boolean> {
  try {
    await db.execute({
      sql: "UPDATE duels SET status = ? WHERE id = ?",
      args: [status, duelId],
    });
    return true;
  } catch (err) {
    console.error("[Duel] Error updating status:", err);
    return false;
  }
}

function buildDuelEmbed(challengerId: string, opponentId: string, bet: number, duelId: string) {
  const totalPot = bet * 2;
  const tax = Math.round(totalPot * 0.26);
  const winPot = totalPot - tax;
  const winnerProfit = winPot - bet;

  return {
    embeds: [
      {
        title: "⚔️ Дуэль на опыт!",
        description: `**<@${challengerId}>** бросает вызов **<@${opponentId}>**!\n\n` +
          `💰 Ставка: **${bet.toLocaleString()} XP**\n` +
          `🏆 Чистый выигрыш победителя: **+${winnerProfit.toLocaleString()} XP**\n` +
          `🔥 Сгораемый налог сервера (26%): **${tax.toLocaleString()} XP**\n\n` +
          `*У оппонента есть 60 секунд, чтобы принять вызов.*`,
        color: 0xFF8800,
        footer: { text: "Дуэль отменится автоматически через 60 секунд" },
      },
    ],
    components: [
      {
        type: 1,
        components: [
          {
            type: 2,
            custom_id: `duel_accept_${duelId}`,
            style: 3,
            label: "⚔️ Принять вызов",
          },
          {
            type: 2,
            custom_id: `duel_decline_${duelId}`,
            style: 4,
            label: "🏳️ Отклонить",
          },
        ],
      },
    ],
  };
}

function buildDuelDeclineEmbed(challengerId: string, opponentId: string) {
  return {
    embeds: [
      {
        title: "🏳️ Дуэль отменена",
        description: `**<@${opponentId}>** отклонил(а) вызов от **<@${challengerId}>**. Опыт сохранён.`,
        color: 0x747f8d,
      },
    ],
    components: [],
  };
}

function buildDuelResultEmbed(challengerId: string, opponentId: string, winnerId: string, loserId: string, roll1: number, roll2: number, bet: number, tax: number, winnerProfit: number) {
  return {
    embeds: [
      {
        title: "🏆 Победитель дуэли!",
        description: `**<@${winnerId}>** победил(а) в дуэли!\n\n` +
          `🎲 Бросок кубиков:\n` +
          `• <@${challengerId}>: выбросил **${roll1}** 🎲\n` +
          `• <@${opponentId}>: выбросил **${roll2}** 🎲\n\n` +
          `💰 Результат:\n` +
          `• <@${winnerId}> получает: **+${winnerProfit.toLocaleString()} XP**\n` +
          `• <@${loserId}> теряет: **-${bet.toLocaleString()} XP**\n` +
          `• Сервер сжёг налог 26%: **${tax.toLocaleString()} XP**`,
        color: 0xFEE75C,
      },
    ],
    components: [],
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

      // 4. Кнопки пагинации и режимов лидерборда (Type 3)
      if (inter.type === 3 && inter.data?.custom_id?.startsWith("lb_")) {
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

              // Достаём данные о стрике
              const streakRes = await db.execute({
                sql: "SELECT streak_days, streak_freezes FROM users WHERE user_id = ? AND guild_id = ?",
                args: [uid, gid],
              });
              const streakData = {
                streakDays: (streakRes.rows[0]?.streak_days as number) || 0,
                streakFreezes: (streakRes.rows[0]?.streak_freezes as number) || 0,
              };

              const today = getVladivostokDate();
              const result = buildRankTodayEmbed(uid, user.username, activity, questProgress, today, streakData);

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

      // 7. Слэш-команда /duel
      if (inter.type === 2 && inter.data?.name === "duel") {
        const gid = inter.guild_id;
        const challengerId = inter.member?.user.id;
        if (!gid || !challengerId) return Response.json({ error: "No guild or user" }, { status: 400 });

        // Извлекаем опции команды
        const opponentOption = inter.data?.options?.find((o) => o.name === "opponent")?.value as string;
        const betOption = inter.data?.options?.find((o) => o.name === "bet")?.value as number;

        if (!opponentOption) {
          return Response.json({
            type: 4,
            data: { content: "❌ Укажите пользователя, которому хотите бросить вызов!", flags: 64 },
          });
        }

        if (!betOption || betOption < 50 || betOption > 2000) {
          return Response.json({
            type: 4,
            data: { content: "❌ Ставка должна быть от 50 до 2000 XP!", flags: 64 },
          });
        }

        // Проверка: оппонент не должен быть ботом или самим собой
        if (opponentOption === challengerId) {
          return Response.json({
            type: 4,
            data: { content: "❌ Нельзя дуэлиться с самим собой!", flags: 64 },
          });
        }

        if (inter.resolved?.users?.[opponentOption]) {
          const opponentUser = inter.resolved.users[opponentOption];
          // Проверка бота по discriminator или флагу (если будет добавлен)
          // В текущей схеме боты имеют discriminator "0000" - но это не надёжно
          // Поэтому просто проверяем, что пользователь есть в resolved
        }

        const db = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });

        // Проверка существования пользователей
        const challengerExists = await checkUserExists(db, challengerId, gid);
        const opponentExists = await checkUserExists(db, opponentOption, gid);

        if (!challengerExists) {
          return Response.json({
            type: 4,
            data: { content: "❌ Вы не найдены в базе данных. Напишите сообщение, чтобы зарегистрироваться!", flags: 64 },
          });
        }

        if (!opponentExists) {
          return Response.json({
            type: 4,
            data: { content: "❌ Оппонент не найден в базе данных. Пользователь должен отправить хотя бы одно сообщение!", flags: 64 },
          });
        }

        // Проверка баланса
        const challengerXp = await getUserXp(db, challengerId, gid);
        const opponentXp = await getUserXp(db, opponentOption, gid);

        if (challengerXp < betOption) {
          return Response.json({
            type: 4,
            data: { content: `❌ У вас недостаточно XP для этой ставки! Текущий баланс: **${challengerXp.toLocaleString()} XP**`, flags: 64 },
          });
        }

        if (opponentXp < betOption) {
          return Response.json({
            type: 4,
            data: { content: `❌ У оппонента недостаточно XP для этой ставки! Текущий баланс: **${opponentXp.toLocaleString()} XP**`, flags: 64 },
          });
        }

        // Создаём запись дуэли
        const duelId = `duel_${Date.now()}_${challengerId.slice(-4)}`;
        const created = await createDuelRecord(db, duelId, gid, challengerId, opponentOption, betOption);

        if (!created) {
          return Response.json({
            type: 4,
            data: { content: "❌ Ошибка при создании дуэли. Попробуйте ещё раз.", flags: 64 },
          });
        }

        // Отправляем Embed с кнопками
        const result = buildDuelEmbed(challengerId, opponentOption, betOption, duelId);

        return Response.json({ type: 4, data: result });
      }

      // 8. Обработка кнопок дуэли (Type 3)
      if (inter.type === 3 && inter.data?.custom_id?.startsWith("duel_accept_") || inter.data?.custom_id?.startsWith("duel_decline_")) {
        const customId = inter.data.custom_id;
        const duelId = customId.startsWith("duel_accept_") ? customId.substring(14) : customId.substring(16);

        const db = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });
        const duel = await getDuelById(db, duelId);

        if (!duel) {
          return Response.json({
            type: 4,
            data: { content: "⚠️ Эта дуэль не найдена или уже завершена.", flags: 64 },
          });
        }

        const challengerId = duel.challenger_id as string;
        const opponentId = duel.opponent_id as string;
        const guildId = duel.guild_id as string;
        const bet = duel.bet_amount as number;
        const status = duel.status as string;

        // Проверка: только оппонент может нажимать кнопки
        const clickedUserId = inter.member?.user.id;
        if (!clickedUserId || clickedUserId !== opponentId) {
          return Response.json({
            type: 4,
            data: { content: "❌ Вы не можете отвечать на чужой вызов дуэли!", flags: 64 },
          });
        }

        // Проверка статуса дуэли
        if (status !== "pending") {
          return Response.json({
            type: 4,
            data: { content: "⚠️ Эта дуэль уже завершена или недействительна.", flags: 64 },
          });
        }

        if (customId.startsWith("duel_decline_")) {
          // Дуэль отклонена
          await updateDuelStatus(db, duelId, "declined");

          const result = buildDuelDeclineEmbed(challengerId, opponentId);
          return Response.json({ type: 7, data: result });
        }

        if (customId.startsWith("duel_accept_")) {
          // Дуэль принята - проводим бросок кубиков
          const roll1 = Math.floor(Math.random() * 100) + 1;
          let roll2 = Math.floor(Math.random() * 100) + 1;

          // Если ничья - перебрасываем для оппонента
          if (roll1 === roll2) {
            roll2 = (roll1 % 100) + 1;
          }

          // Определяем победителя и проигравшего
          let winnerId: string, loserId: string;
          if (roll1 > roll2) {
            winnerId = challengerId;
            loserId = opponentId;
          } else {
            winnerId = opponentId;
            loserId = challengerId;
          }

          // Расчёт экономики
          const totalPot = bet * 2;
          const tax = Math.round(totalPot * 0.26);
          const winnerProfit = (totalPot - tax) - bet;

          // Повторная проверка баланса перед начислением
          const currentChallengerXp = await getUserXp(db, challengerId, guildId);
          const currentOpponentXp = await getUserXp(db, opponentId, guildId);

          if (currentChallengerXp < bet || currentOpponentXp < bet) {
            await updateDuelStatus(db, duelId, "declined");
            return Response.json({
              type: 4,
              data: { content: "⚠️ У одного из участников больше недостаточно XP для дуэли. Дуэль отменена.", flags: 64 },
            });
          }

          // Начисление/списание XP
          await updateXpAndLevel(db, winnerId, guildId, winnerProfit);
          await updateXpAndLevel(db, loserId, guildId, -bet);

          // Обновляем статус дуэли
          await updateDuelStatus(db, duelId, "completed");

          const result = buildDuelResultEmbed(challengerId, opponentId, winnerId, loserId, roll1, roll2, bet, tax, winnerProfit);

          // Проверка достижений дуэли (Этап 6)
          const winnerLevel = calculateLevel((await getUserXp(db, winnerId, guildId)));
          const loserLevel = calculateLevel((await getUserXp(db, loserId, guildId)));

          // Формируем webhook URL для уведомлений
          const webhookUrl = `https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${inter.token}`;

          // hl_crowbar: победил оппонента на 2+ уровня выше
          if (loserLevel - winnerLevel >= 2) {
            await unlockAchievement(db, winnerId, guildId, 'hl_crowbar', webhookUrl, env.DISCORD_APPLICATION_ID);
          }

          // fbk_final_battle: ставка >= 1000 XP
          if (bet >= 1000) {
            await unlockAchievement(db, challengerId, guildId, 'fbk_final_battle', webhookUrl, env.DISCORD_APPLICATION_ID);
          }

          // casino_house: налог с дуэли > 100 XP
          if (tax > 100) {
            await unlockAchievement(db, loserId, guildId, 'casino_house', webhookUrl, env.DISCORD_APPLICATION_ID);
          }

          // rdr_quickdraw: победил с roll >= 95
          if (winnerId === challengerId && roll1 >= 95) {
            await unlockAchievement(db, challengerId, guildId, 'rdr_quickdraw', webhookUrl, env.DISCORD_APPLICATION_ID);
          } else if (winnerId === opponentId && roll2 >= 95) {
            await unlockAchievement(db, opponentId, guildId, 'rdr_quickdraw', webhookUrl, env.DISCORD_APPLICATION_ID);
          }

          //witcher_damn: проиграл с roll < 10
          if (loserId === challengerId && roll1 < 10) {
            await unlockAchievement(db, challengerId, guildId, 'witcher_damn', webhookUrl, env.DISCORD_APPLICATION_ID);
          } else if (loserId === opponentId && roll2 < 10) {
            await unlockAchievement(db, opponentId, guildId, 'witcher_damn', webhookUrl, env.DISCORD_APPLICATION_ID);
          }

          return Response.json({ type: 7, data: result });
        }
      }

      // 10. Обработка кнопок сброса престижа (Type 3 - Этап 9)
      if (inter.type === 3 && (inter.data?.custom_id?.startsWith("prestige_confirm_") || inter.data?.custom_id?.startsWith("prestige_cancel_"))) {
        const customId = inter.data.custom_id;
        const uid = customId.startsWith("prestige_confirm_") ? customId.substring(19) : customId.substring(18);
        if (!inter.guild_id) return Response.json({ error: "No guild" }, { status: 400 });

        const db = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });

        // Проверка: только автор может нажимать кнопки
        const clickedUserId = inter.member?.user.id;
        if (!clickedUserId || clickedUserId !== uid) {
          return Response.json({
            type: 4,
            data: { content: "❌ Вы не можете управлять чужим сбросом престижа!", flags: 64 },
          });
        }

        // Достаём актуальные данные пользователя
        const userRes = await db.execute({
          sql: 'SELECT xp, level, prestige_count FROM users WHERE user_id = ? AND guild_id = ?',
          args: [uid, inter.guild_id as string],
        });

        if (userRes.rows.length === 0) {
          return Response.json({
            type: 4,
            data: { content: "❌ Данные пользователя не найдены.", flags: 64 },
          });
        }

        const userData = userRes.rows[0];
        const level = userData.level as number || 0;

        // Перепроверка: уровень должен быть >= 100
        if (level < 100) {
          return Response.json({
            type: 4,
            data: { content: "⚠️ Ваш уровень изменился. Сброс престижа недоступен.", flags: 64 },
          });
        }

        const prestigeCount = (userData.prestige_count as number) || 0;

        if (customId.startsWith("prestige_cancel_")) {
          // Сброс отменён
          const result = {
            embeds: [{
              title: 'Сброс престижа отменён',
              description: 'Ваш 100 уровень в безопасности.',
              color: 0x747f8d,
            }],
            components: [],
          };
          return Response.json({ type: 7, data: result });
        }

        if (customId.startsWith("prestige_confirm_")) {
          // Подтверждение сброса
          const guildId = inter.guild_id as string;
          await db.execute({
            sql: 'UPDATE users SET prestige_count = prestige_count + 1, xp = 0, level = 0 WHERE user_id = ? AND guild_id = ?',
            args: [uid, guildId],
          });

          const result = {
            embeds: [{
              title: '🎉 ПОЗДРАВЛЯЕМ СО СБРОСОМ ПРЕСТИЖА!',
              description: `**<@${uid}>** успешно сбросил уровень и получил **Престиж ★ ${prestigeCount + 1}**!\n\n` +
                'Золотая звезда престижа теперь сияет на вашей карточке **/rank**!',
              color: 0xFFD700,
            }],
            components: [],
          };
          return Response.json({ type: 7, data: result });
        }
      }

      // 11. Обработка кнопок Войс-дропов (Type 3)
      if (inter.type === 3 && inter.data?.custom_id?.startsWith("airdrop_claim_")) {
        const customId = inter.data.custom_id;
        const dropId = customId.substring(14); // remove "airdrop_claim_"

        const db = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });
        const dropResult = await db.execute({
          sql: 'SELECT * FROM air_drops WHERE id = ?',
          args: [dropId],
        });

        if (dropResult.rows.length === 0) {
          return Response.json({
            type: 4,
            data: { content: "❌ Дроп не найден или устарел.", flags: 64 },
          });
        }

        const drop = dropResult.rows[0];
        const claimedBy = drop.claimed_by as string | null;
        const rewardXp = drop.reward_xp as number;
        const rewardType = drop.reward_type as string;

        // Проверяем, не забрали ли уже дроп
        if (claimedBy !== null) {
          return Response.json({
            type: 4,
            data: { content: `❌ Этот дроп уже успел забрать <@${claimedBy}>!`, flags: 64 },
          });
        }

        const guildId = drop.guild_id as string;
        const clickedUserId = inter.member?.user.id;

        if (!clickedUserId) {
          return Response.json({
            type: 4,
            data: { content: "❌ Не удалось определить пользователя.", flags: 64 },
          });
        }

        // Помечаем дроп как забранный
        const now = Math.floor(Date.now() / 1000);
        await db.execute({
          sql: 'UPDATE air_drops SET claimed_by = ?, claimed_at = ? WHERE id = ?',
          args: [clickedUserId, now, dropId],
        });

        // Выдаём награду
        if (rewardType === 'freeze') {
          // Заморозка стрика
          await db.execute({
            sql: 'UPDATE users SET streak_freezes = streak_freezes + 1 WHERE user_id = ? AND guild_id = ?',
            args: [clickedUserId, guildId],
          });
          console.log(`[AirDrop] User ${clickedUserId} claimed freeze reward from ${dropId}`);
        } else if (rewardType === 'xp') {
          // XP награда
          await db.execute({
            sql: 'UPDATE users SET xp = xp + ? WHERE user_id = ? AND guild_id = ?',
            args: [rewardXp, clickedUserId, guildId],
          });
          // Обновляем уровень
          const userResult = await db.execute({
            sql: 'SELECT xp FROM users WHERE user_id = ? AND guild_id = ?',
            args: [clickedUserId, guildId],
          });
          if (userResult.rows.length > 0) {
            const newXp = userResult.rows[0].xp as number;
            const newLevel = calculateLevel(newXp);
            await db.execute({
              sql: 'UPDATE users SET level = ? WHERE user_id = ? AND guild_id = ?',
              args: [newLevel, clickedUserId, guildId],
            });
          }
          console.log(`[AirDrop] User ${clickedUserId} claimed ${rewardXp} XP from ${dropId}`);
        }

        // Проверка достижения hl_airdrop - первый кто забрал дроп (проверяем, что claimed_by был null)
        if (claimedBy === null) {
          const webhookUrl = `https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${inter.token}`;
          await unlockAchievement(db, clickedUserId, guildId, 'hl_airdrop', webhookUrl, env.DISCORD_APPLICATION_ID);
        }

        // Ответ обновлением сообщения (Type 7)
        const result = {
          embeds: [{
            title: '🎉 Контейнер вскрыт!',
            description: `**<@${clickedUserId}>** первым открыл ящик и забрал награду:`,
            color: 0x2ECC71,
            fields: rewardType === 'freeze' ? [
              { name: 'Награда', value: '🧊 **1 Заморозка стрика!**', inline: true },
            ] : [
              { name: 'Награда', value: `💰 **+${rewardXp} XP**`, inline: true },
            ],
          }],
          components: [],
        };

        return Response.json({ type: 7, data: result });
      }

      // 10. Слэш-команда /card-customize (Этап 5 - Кастомизация карточки)
      if (inter.type === 2 && inter.data?.name === "card-customize") {
        const uid = inter.member?.user.id;
        const gid = inter.guild_id;
        if (!uid || !gid) return Response.json({ error: "No user or guild" }, { status: 400 });

        try {
          const db = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });

          // Создаём таблицу user_cosmetics если её нет (на всякий случай)
          await db.execute({
            sql: `CREATE TABLE IF NOT EXISTS user_cosmetics (
              user_id TEXT NOT NULL,
              guild_id TEXT NOT NULL,
              theme_id TEXT DEFAULT 'default',
              title_id TEXT DEFAULT 'Новичок',
              badges TEXT DEFAULT '[]',
              PRIMARY KEY (user_id, guild_id)
            )`,
            args: [],
          });

          // Достаём текущие настройки пользователя
          const cosmetRes = await db.execute({
            sql: "SELECT theme_id, title_id FROM user_cosmetics WHERE user_id = ? AND guild_id = ?",
            args: [uid, gid],
          });

          let currentTheme = "default";
          let currentTitle = "Новичок";

          if (cosmetRes.rows.length > 0) {
            currentTheme = cosmetRes.rows[0].theme_id as string;
            currentTitle = cosmetRes.rows[0].title_id as string;
          }

          // Список тем
          const themeOptions = [
            { label: "🟣 Классическая (Discord Blurple)", value: "default" },
            { label: "🌸 Киберпанк (Неоновый роз / Бирюза)", value: "cyberpunk" },
            { label: "🔥 Магма (Вулканический огонь)", value: "magma" },
            { label: "🌌 Полночь (Глубокий космос / Индиго)", value: "midnight" },
            { label: "🍃 Изумруд (Зелёный нефрит / Золото)", value: "emerald" },
          ];

          const themeLabels: Record<string, string> = {
            default: "Классическая (Discord Blurple)",
            cyberpunk: "Киберпанк (Неоновый роз / Бирюза)",
            magma: "Магма (Вулканический огонь)",
            midnight: "Полночь (Глубокий космос / Индиго)",
            emerald: "Изумруд (Зелёный нефрит / Золото)",
          };

          const result = {
            embeds: [{
              title: "🎨 Кастомизация карточки ранга",
              description: `Текущая тема: **${themeLabels[currentTheme] || currentTheme}** • Текущий титул: **${currentTitle}**\n` +
                "Выберите тему оформления из списка ниже:",
              color: 0x5865f2,
            }],
            components: [{
              type: 1,
              components: [{
                type: 3,
                custom_id: "card_select_theme",
                placeholder: "Выберите тему оформления...",
                options: themeOptions,
              }],
            }],
          };

          return Response.json({ type: 4, data: result });
        } catch (err) {
          console.error("[CardCustomize] Error:", err);
          return Response.json({
            type: 4,
            data: { content: "❌ Ошибка при загрузке настроек карточки. Попробуйте позже.", flags: 64 },
          });
        }
      }

      // 11. Обработка Select Menu для смены темы (Type 3)
      if (inter.type === 3 && inter.data?.custom_id === "card_select_theme") {
        const uid = inter.member?.user.id;
        const gid = inter.guild_id;
        if (!uid || !gid) return Response.json({ error: "No user or guild" }, { status: 400 });

        const selectedTheme = (inter.data.values as string[])?.[0];

        if (!selectedTheme || !["default", "cyberpunk", "magma", "midnight", "emerald"].includes(selectedTheme)) {
          return Response.json({
            type: 4,
            data: { content: "❌ Неверная тема выбора.", flags: 64 },
          });
        }

        try {
          const db = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });

          // Создаём таблицу user_cosmetics если её нет
          await db.execute({
            sql: `CREATE TABLE IF NOT EXISTS user_cosmetics (
              user_id TEXT NOT NULL,
              guild_id TEXT NOT NULL,
              theme_id TEXT DEFAULT 'default',
              title_id TEXT DEFAULT 'Новичок',
              badges TEXT DEFAULT '[]',
              PRIMARY KEY (user_id, guild_id)
            )`,
            args: [],
          });

          // Сохраняем выбранную тему (INSERT OR REPLACE)
          await db.execute({
            sql: "INSERT OR REPLACE INTO user_cosmetics (user_id, guild_id, theme_id, title_id) VALUES (?, ?, ?, 'Новичок')",
            args: [uid, gid, selectedTheme],
          });

          // Проверка достижения vlad_right_hand - тема cyberpunk или magma
          if (selectedTheme === 'cyberpunk' || selectedTheme === 'magma') {
            const webhookUrl = `https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${inter.token}`;
            await unlockAchievement(db, uid, gid, 'vlad_right_hand', webhookUrl, env.DISCORD_APPLICATION_ID);
          }

          const result = {
            embeds: [{
              title: "✅ Тема успешно изменена!",
              description: `Напишите **/rank**, чтобы увидеть обновлённую карточку!`,
              color: 0x2ecc71,
            }],
            components: [],
          };

          return Response.json({ type: 7, data: result });
        } catch (err) {
          console.error("[CardSelectTheme] Error:", err);
          return Response.json({
            type: 4,
            data: { content: "❌ Ошибка при сохранении темы. Попробуйте позже.", flags: 64 },
          });
        }
      }

      // 12. Слэш-команда /achievements (Этап 6 - Система достижений)
      if (inter.type === 2 && inter.data?.name === "achievements") {
        const uidOption = inter.data?.options?.find((o: any) => o.name === "user")?.value as string | undefined;
        const targetId = uidOption || inter.member?.user.id;
        const gid = inter.guild_id;
        if (!gid || !targetId) return Response.json({ error: "No guild or user" }, { status: 400 });

        ctx.waitUntil(
          (async () => {
            try {
              const db = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });

              // Достаём имя пользователя
              const targetUser = inter.resolved?.users?.[targetId];
              const username = targetUser ? targetUser.username : inter.member?.user.username || "Unknown";

              // Достаём все открытые ачивки из БД
              const achievementsRes = await db.execute({
                sql: 'SELECT achievement_id, unlocked_at FROM user_achievements WHERE user_id = ? AND guild_id = ? ORDER BY unlocked_at DESC',
                args: [targetId, gid],
              });

              const unlockedAchievements = achievementsRes.rows || [];

              // Создаём словарь открытых ачивок для быстрого поиска
              const unlockedMap = new Map<string, number>();
              unlockedAchievements.forEach((row: any) => {
                unlockedMap.set(row.achievement_id as string, row.unlocked_at as number);
              });

              // Получаем полный список достижений из константы
              const totalAchievements = ACHIEVEMENTS_LIST.length;
              const unlockedCount = unlockedAchievements.length;

              // Формируем Embed
              let description = "";
              if (unlockedAchievements.length === 0) {
                description = "*Пока нет открытых достижений. Исследуйте сервер, чтобы разгадать секреты!*";
              } else {
                // Сортируем открытые ачивки по дате открытия (descending)
                const sortedUnlocked = unlockedAchievements
                  .map((row: any) => ({
                    id: row.achievement_id as string,
                    unlockedAt: row.unlocked_at as number,
                  }))
                  .sort((a: any, b: any) => b.unlockedAt - a.unlockedAt);

                sortedUnlocked.forEach((item: any) => {
                  const ach = ACHIEVEMENTS_LIST.find(a => a.id === item.id);
                  if (ach) {
                    description += `✅ **${ach.title}** — *${ach.description}* • <t:${item.unlockedAt}:d>\n`;
                  }
                });
              }

              description += `\n🔒 Секретных пасхалок осталось найти: **${totalAchievements - unlockedCount}**`;

              const result = {
                embeds: [{
                  title: `🏆 Достижения: ${username}`,
                  description: description,
                  color: 0xF1C40F,
                  footer: { text: `Прогресс: ${unlockedCount} / ${totalAchievements} достижений` },
                }],
                components: [],
              };

              const resp = await fetch(`https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${inter.token}/messages/@original`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(result),
              });
              if (!resp.ok) console.error("Achievements update fail:", await resp.text());
            } catch (e) {
              console.error("Achievements error:", e);
            }
          })()
        );
        return Response.json({ type: 5 });
      }

      // 13. Слэш-команда /server-kings (Этап 8 - Короли сервера)
      if (inter.type === 2 && inter.data?.name === 'server-kings') {
        const gid = inter.guild_id;
        if (!gid) return Response.json({ error: "No guild" }, { status: 400 });

        ctx.waitUntil(
          (async () => {
            try {
              const db = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });

              // Chat King
              const chatRes = await db.execute({
                sql: 'SELECT user_id, messages_count FROM users WHERE guild_id = ? ORDER BY messages_count DESC LIMIT 1',
                args: [gid],
              });
              const chatKing = chatRes.rows.length > 0 ? { user_id: chatRes.rows[0].user_id as string, messages_count: chatRes.rows[0].messages_count as number } : null;

              // Voice King
              const voiceRes = await db.execute({
                sql: 'SELECT user_id, voice_seconds FROM users WHERE guild_id = ? ORDER BY voice_seconds DESC LIMIT 1',
                args: [gid],
              });
              const voiceKing = voiceRes.rows.length > 0 ? { user_id: voiceRes.rows[0].user_id as string, voice_seconds: voiceRes.rows[0].voice_seconds as number } : null;

              // Online King
              const onlineRes = await db.execute({
                sql: 'SELECT user_id, online_seconds FROM users WHERE guild_id = ? ORDER BY online_seconds DESC LIMIT 1',
                args: [gid],
              });
              const onlineKing = onlineRes.rows.length > 0 ? { user_id: onlineRes.rows[0].user_id as string, online_seconds: onlineRes.rows[0].online_seconds as number } : null;

              // Streak King
              const streakRes = await db.execute({
                sql: 'SELECT user_id, streak_days FROM users WHERE guild_id = ? ORDER BY streak_days DESC LIMIT 1',
                args: [gid],
              });
              const streakKing = streakRes.rows.length > 0 ? { user_id: streakRes.rows[0].user_id as string, streak_days: streakRes.rows[0].streak_days as number } : null;

              // Quest Master
              const questRes = await db.execute({
                sql: 'SELECT user_id, COUNT(*) as count FROM user_quest_progress WHERE guild_id = ? AND completed_at IS NOT NULL GROUP BY user_id ORDER BY count DESC LIMIT 1',
                args: [gid],
              });
              const questMaster = questRes.rows.length > 0 ? { user_id: questRes.rows[0].user_id as string, count: questRes.rows[0].count as number } : null;

              // Формируем Embed
              const description = `💬 **Chat King:** <@${chatKing?.user_id || '-'}> — **${chatKing?.messages_count.toLocaleString() || 0}** сообщ.
🎙 **Voice King:** <@${voiceKing?.user_id || '-'}> — **${Math.floor((voiceKing?.voice_seconds || 0) / 3600)}** ч. в войсе
🟢 **Online King:** <@${onlineKing?.user_id || '-'}> — **${Math.floor((onlineKing?.online_seconds || 0) / 3600)}** ч. онлайн 🪑
🔥 **Streak King:** <@${streakKing?.user_id || '-'}> — **${streakKing?.streak_days || 0}** дн. стрик
🎯 **Quest Master:** <@${questMaster?.user_id || '-'}> — **${questMaster?.count || 0}** квестов

*Короны обновляются в реальном времени!*
`;

              const result = {
                embeds: [{
                  title: '👑 Зал Королевской Славы Сервера',
                  description: description,
                  color: 0xF1C40F,
                  footer: { text: 'Кто займет трон в конце года? • /recap для личной статистики' },
                }],
                components: [],
              };

              const resp = await fetch(`https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${inter.token}/messages/@original`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(result),
              });
              if (!resp.ok) console.error('Server kings update fail:', await resp.text());
            } catch (e) {
              console.error('Server kings error:', e);
            }
          })()
        );
        return Response.json({ type: 5 });
      }

      // 14. Слэш-команда /recap (Этап 8 - Discord Wrapped)
      if (inter.type === 2 && inter.data?.name === 'recap') {
        const uidOption = inter.data?.options?.find((o: any) => o.name === 'user')?.value as string | undefined;
        const targetId = uidOption || inter.member?.user.id;
        const gid = inter.guild_id;
        if (!gid || !targetId) return Response.json({ error: 'No guild or user' }, { status: 400 });

        ctx.waitUntil(
          (async () => {
            try {
              const db = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });

              // Достаём имя пользователя
              const targetUser = inter.resolved?.users?.[targetId];
              const username = targetUser ? targetUser.username : inter.member?.user.username || 'Unknown';

              // Достаём данные пользователя
              const userRes = await db.execute({
                sql: 'SELECT messages_count, voice_seconds, online_seconds, xp, level, max_streak FROM users WHERE user_id = ? AND guild_id = ?',
                args: [targetId, gid],
              });

              if (userRes.rows.length === 0) {
                return Response.json({
                  type: 4,
                  data: { content: '❌ Данные пользователя не найдены. Напишите первое сообщение, чтобы зарегистрироваться!', flags: 64 },
                });
              }

              const userData = userRes.rows[0];
              const messages = userData.messages_count as number || 0;
              const voiceSeconds = userData.voice_seconds as number || 0;
              const onlineSeconds = userData.online_seconds as number || 0;
              const totalXp = userData.xp as number || 0;
              const level = userData.level as number || 0;
              const maxStreak = userData.max_streak as number || 0;

              // Считаем выполненные квесты
              const questRes = await db.execute({
                sql: 'SELECT COUNT(*) as count FROM user_quest_progress WHERE user_id = ? AND guild_id = ? AND completed_at IS NOT NULL',
                args: [targetId, gid],
              });
              const completedQuests = (questRes.rows[0]?.count as number) || 0;

              // Считаем позицию в топе
              const rankRes = await db.execute({
                sql: 'SELECT COUNT(*) as rank FROM users WHERE guild_id = ? AND xp > ?',
                args: [gid, totalXp],
              });
              const rank = ((rankRes.rows[0]?.rank as number) || 0) + 1;

              const totalRes = await db.execute({
                sql: 'SELECT COUNT(*) as total FROM users WHERE guild_id = ?',
                args: [gid],
              });
              const totalUsers = (totalRes.rows[0]?.total as number) || 1;

              // Вычисляем архетип игрока
              let persona = '⭐ Восходящая Звезда';
              const voiceHours = voiceSeconds / 3600;
              const onlineHours = onlineSeconds / 3600;

              if (voiceHours > 20) {
                persona = '🎙 Повелитель Микрофона';
              } else if (messages > 500) {
                persona = '💬 Текстовый Пулемётчик';
              } else if (onlineHours > 50) {
                persona = '🟢 Призрак Сервера (Онлайн 24/7)';
              } else if (maxStreak >= 14) {
                persona = '🔥 Неугасимое Пламя';
              }

              const description = (
                `🎭 Ваш архетип: **${persona}**\n` +
                `🏆 Место на сервере: **#${rank}** из **${totalUsers}**\n\n` +
                `📊 **Ваша статистика за год:**\n` +
                `• 💬 Сообщений отправлено: **${messages.toLocaleString()}**\n` +
                `• 🎙 Времени в войсе: **${Math.floor(voiceSeconds / 3600)} ч. ${Math.floor((voiceSeconds % 3600) / 60)} мин.**\n` +
                `• 🟢 Времени онлайн на сервере: **${Math.floor(onlineSeconds / 3600)} ч.**\n` +
                `• 🎯 Заданий выполнено: **${completedQuests}**\n` +
                `• 🔥 Лучший стрик года: **${maxStreak} дн.**`
              );

              const result = {
                embeds: [{
                  title: `✨ Discord Wrapped: Итоги года для ${username}`,
                  description: description,
                  color: 0x9B59B6,
                  footer: { text: 'LevelEdge Wrapped • Спасибо, что вы с нами!' },
                }],
                components: [],
              };

              const resp = await fetch(`https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${inter.token}/messages/@original`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(result),
              });
              if (!resp.ok) console.error('Recap update fail:', await resp.text());
            } catch (e) {
              console.error('Recap error:', e);
            }
          })()
        );
        return Response.json({ type: 5 });
      }

      // 15. Слэш-команда /export (Этап 10 - CSV-экспорт аналитики)
      if (inter.type === 2 && inter.data?.name === "export") {
        const gid = inter.guild_id;
        const uid = inter.member?.user.id;
        if (!gid || !uid) return Response.json({ error: "No guild or user" }, { status: 400 });

        // Проверка прав администратора (флаг ADMINISTRATOR = 8)
        const permissions = inter.member?.permissions;
        if (!permissions || !(BigInt(permissions) & 8n)) {
          return Response.json({
            type: 4,
            data: { content: "❌ Эта команда доступна только администраторам сервера!", flags: 64 },
          });
        }

        // Немедленно ответим DEFERRED, чтобы избежать таймаута
        ctx.waitUntil(
          (async () => {
            try {
              const db = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });

              // Выбираем всех участников гильдии
              const usersRes = await db.execute({
                sql: "SELECT user_id, xp, level, season_xp, messages_count, voice_seconds, online_seconds, streak_days, max_streak, prestige_count FROM users WHERE guild_id = ? ORDER BY xp DESC",
                args: [gid],
              });

              const rows = usersRes.rows;
              if (rows.length === 0) {
                const webhookUrl = `https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${inter.token}/messages/@original`;
                await fetch(webhookUrl, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    content: "❌ На сервере нет участников с данными.",
                    flags: 64,
                  }),
                });
                return;
              }

              // Формируем CSV-строку
              let csvString = "User ID,Total XP,Level,Season XP,Messages,Voice Hours,Online Hours,Current Streak,Max Streak,Prestige Stars\n";
              for (const r of rows) {
                const userId = r.user_id as string;
                const xp = (r.xp as number) || 0;
                const level = (r.level as number) || 0;
                const seasonXp = (r.season_xp as number) || 0;
                const msgCount = (r.messages_count as number) || 0;
                const voiceHours = ((r.voice_seconds as number) || 0) / 3600;
                const onlineHours = ((r.online_seconds as number) || 0) / 3600;
                const streakDays = (r.streak_days as number) || 0;
                const maxStreak = (r.max_streak as number) || 0;
                const prestigeStars = (r.prestige_count as number) || 0;

                csvString += `"${userId}",${xp},${level},${seasonXp},${msgCount},${voiceHours.toFixed(1)},${onlineHours.toFixed(1)},${streakDays},${maxStreak},${prestigeStars}\n`;
              }

              const webhookUrl = `https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${inter.token}/messages/@original`;

              // Собираем FormData
              const payload = JSON.stringify({
                embeds: [{
                  title: "📊 Аналитика сервера выгружена",
                  description: `Успешно экспортировано участников: **${rows.length}**.\nФайл прикреплён ниже.`,
                  color: 0x5865F2,
                  footer: { text: "LevelEdge Analytics" },
                }],
                attachments: [{ id: 0, filename: "server-analytics.csv" }],
              });

              const formData = new FormData();
              formData.append("payload_json", payload);
              formData.append("files[0]", new Blob([csvString], { type: "text/csv;charset=utf-8;" }), "server-analytics.csv");

              // Отправляем через PATCH webhook
              const resp = await fetch(webhookUrl, { method: "PATCH", body: formData });
              if (!resp.ok) {
                console.error("Export error:", await resp.text());
              }
            } catch (err) {
              console.error("[Export] Error:", err);
            }
          })()
        );

        return Response.json({ type: 5 });
      }

      // 16. Слэш-команда /prestige (Этап 9 - Система престижа)
      // 16. Слэш-команда /prestige (Этап 9 - Система престижа)
      if (inter.type === 2 && inter.data?.name === "prestige") {
        const uid = inter.member?.user.id;
        const gid = inter.guild_id;
        if (!uid || !gid) return Response.json({ error: "No user or guild" }, { status: 400 });

        ctx.waitUntil(
          (async () => {
            const webhookUrl = `https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${inter.token}/messages/@original`;
            try {
              const db = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });

              // Достаём данные пользователя
              const userRes = await db.execute({
                sql: "SELECT xp, level, prestige_count FROM users WHERE user_id = ? AND guild_id = ?",
                args: [uid, gid],
              });

              if (userRes.rows.length === 0) {
                await fetch(webhookUrl, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    content: "❌ Данные пользователя не найдены. Напишите первое сообщение, чтобы зарегистрироваться!",
                  }),
                });
                return;
              }

              const userData = userRes.rows[0];
              const level = (userData.level as number) || 0;
              const xp = (userData.xp as number) || 0;
              const prestigeCount = (userData.prestige_count as number) || 0;

              let result: any;

              // Если уровень меньше 100
              if (level < 100) {
                result = {
                  embeds: [
                    {
                      title: "🔒 Сброс престижа недоступен",
                      description:
                        `Для совершения сброса престижа требуется **100 уровень**.\n` +
                        `Ваш текущий уровень: **${level} / 100** (${xp.toLocaleString()} XP).\n\n` +
                        `*Продолжайте проявлять активность в чате и войсе, чтобы достичь вершины!*`,
                      color: 0x747f8d,
                    },
                  ],
                  components: [],
                };
              } else {
                // Если уровень >= 100
                result = {
                  embeds: [
                    {
                      title: "⭐ Доступен сброс престижа!",
                      description:
                        `Вы достигли максимального 100 уровня! Вы можете сбросить опыт до 0 и получить постоянную **Звезду Престижа**.\n\n` +
                        `• Текущий престиж: **★ ${prestigeCount}** ➔ станет: **★ ${prestigeCount + 1}**\n` +
                        `• Ваш уровень вернётся на 0, но звезда останется на вашей карточке навсегда!\n\n` +
                        `Вы уверены, что хотите совершить сброс?`,
                      color: 0xffd700,
                    },
                  ],
                  components: [
                    {
                      type: 1,
                      components: [
                        {
                          type: 2,
                          custom_id: `prestige_confirm_${uid}`,
                          style: 3,
                          label: "⭐ Подтвердить сброс",
                        },
                        {
                          type: 2,
                          custom_id: `prestige_cancel_${uid}`,
                          style: 2,
                          label: "❌ Отмена",
                        },
                      ],
                    },
                  ],
                };
              }

              // Отправляем готовый ответ в Discord через webhook
              await fetch(webhookUrl, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(result),
              });
            } catch (e) {
              console.error("Prestige error:", e);
              await fetch(webhookUrl, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  content: "❌ Ошибка при обработке команды. Попробуйте позже.",
                }),
              });
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
