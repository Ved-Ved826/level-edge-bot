import { createClient } from "@libsql/client";

import { CommandInteraction, Env, ExecutionContext } from "../types";

// База знаний и характер судьи: содержимое lore.md из корня репозитория.
// Для импорта .md в воркер нужно правило в wrangler-конфиге:
// rules = [{ type = "Text", globs = ["**/*.md"], fallthrough = true }]
// @ts-ignore
import loreMd from "../../../lore.md";

// ============================================
// /court — ИИ-трибунал по последним сообщениям канала
// Истец подаёт иск на ответчика, ИИ разбирает переписку и выносит вердикт.
// ============================================

const COURT_COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000; // строгий кулдаун: 3 дня
const DEFAULT_FINE = 25; // стандартный штраф, если ИИ не указал сумму
const MIN_FINE = 10;
const MAX_FINE = 50;
const MESSAGES_TO_FETCH = 150;
const MIN_MESSAGES_FOR_TRIAL = 5;
const MAX_REASON_LENGTH = 1000;
const PROXYAPI_URL = "https://api.proxyapi.ru/openai/v1/chat/completions";
const PROXYAPI_MODEL = "openai/gpt-4o-mini";

// PROXYAPI_KEY добавляем локально, не трогая общий Env
type CourtEnv = Env & { PROXYAPI_KEY?: string };

type LibsqlClient = ReturnType<typeof createClient>;

interface CourtMessage {
  username: string;
  content: string;
}

type VerdictKind = "target" | "plaintiff" | "both" | "nobody";

interface CourtVerdict {
  verdict: VerdictKind;
  fine: number;
  evidence: { author: string; quote: string }[];
  analysis: string;
  apology: string;
}

// Дефолтный характер судьи, если lore.md пуст
const DEFAULT_LORE = `Ты — Судья Пруф, верховный арбитр Discord-сервера.
Ты театральный, язвительный, но абсолютно беспристрастный служитель закона.
Говоришь образно, любишь юридический пафос и сарказм, однако решения принимаешь строго по фактам.`;

const VERDICT_LABELS: Record<VerdictKind, string> = {
  target: "🔴 Виновен ответчик",
  plaintiff: "🟡 Виновен истец — ложный донос",
  both: "🟠 Виновны оба",
  nobody: "⚪ Оба невиновны",
};

const VERDICT_COLORS: Record<VerdictKind, number> = {
  target: 0xed4245,
  plaintiff: 0xfee75c,
  both: 0xe67e22,
  nobody: 0x57f287,
};

function ephemeral(content: string): Response {
  return Response.json({ type: 4, data: { content, flags: 64 } });
}

async function patchOriginal(interaction: CommandInteraction, env: Env, payload: Record<string, unknown>): Promise<void> {
  const url = `https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${interaction.token}/messages/@original`;
  await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function formatRemaining(ms: number): string {
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  return `${days} дн. ${hours} ч. ${minutes} мин.`;
}

// Выгрузка последних сообщений канала: первая страница 100, вторая 50 (итого 150)
async function fetchRecentMessages(channelId: string, botToken: string, total: number): Promise<CourtMessage[]> {
  const collected: CourtMessage[] = [];
  let before: string | undefined;

  while (collected.length < total) {
    const limit = Math.min(100, total - collected.length);
    const url = new URL(`https://discord.com/api/v10/channels/${channelId}/messages`);
    url.searchParams.set("limit", String(limit));
    if (before) url.searchParams.set("before", before);

    const res = await fetch(url, { headers: { Authorization: `Bot ${botToken}` } });
    if (!res.ok) throw new Error(`Discord messages fetch failed: ${res.status}`);

    const batch = (await res.json()) as any[];
    if (!Array.isArray(batch) || batch.length === 0) break;

    for (const m of batch) {
      if (m.author?.bot) continue; // ботов в протокол не записываем
      const content = String(m.content ?? "").trim();
      if (!content) continue;
      collected.push({ username: String(m.author?.username ?? "Неизвестный"), content: content.slice(0, 300) });
    }

    before = String(batch[batch.length - 1].id);
    if (batch.length < limit) break;
  }

  // Discord отдаёт сообщения от новых к старым — разворачиваем в хронологию
  return collected.reverse();
}

function buildJudgePrompt(lore: string, reason: string, plaintiffName: string, targetName: string, transcript: string): { system: string; user: string } {
  const system = [
    lore,
    "",
    "Ты рассматриваешь иск в канале Discord. Действуй беспристрастно:",
    "1. Выясни, кто первый спровоцировал конфликт или нарушил правила.",
    "2. Оцени, были ли пруфы (логи, ссылки, конкретные цитаты) или только пустой базар.",
    "3. Определи виновного: target (ответчик), plaintiff (истец — ложный донос), both (оба) или nobody (никто).",
    "",
    "Ответ верни СТРОГО валидным JSON без markdown-обёртки, по схеме:",
    '{"verdict": "target|plaintiff|both|nobody",',
    ' "fine": <целое число от 10 до 50 — штраф в монетах, соразмерный тяжкости конфликта>,',
    ' "analysis": "<подробный разбор спора, 2-5 предложений>",',
    ' "evidence": [{"author": "<имя автора>", "quote": "<точная цитата из переписки>"}],',
    ' "apology": "<позорное публичное извинение от лица проигравшего, едкий юмор, 1-3 предложения; если nobody — едкое замечание судьи в адрес обоих за потраченное время>"}',
  ].join("\n");

  const user = [
    `ИСТЕЦ: ${plaintiffName}`,
    `ОТВЕТЧИК: ${targetName}`,
    `СУТЬ ИСКА: ${reason}`,
    "",
    "ПРОТОКОЛ — последние сообщения канала в хронологическом порядке (сверху старые):",
    transcript,
  ].join("\n");

  return { system, user };
}

async function askJudge(env: CourtEnv, reason: string, plaintiffName: string, targetName: string, transcript: string): Promise<CourtVerdict> {
  const apiKey = env.PROXYAPI_KEY;
  if (!apiKey) throw new Error("PROXYAPI_KEY не настроен");

  const lore = (typeof loreMd === "string" ? loreMd : "").trim() || DEFAULT_LORE;
  const { system, user } = buildJudgePrompt(lore, reason, plaintiffName, targetName, transcript);

  const res = await fetch(PROXYAPI_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: PROXYAPI_MODEL,
      max_tokens: 1200,
      temperature: 0.75,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`ProxyAPI error ${res.status}: ${detail.slice(0, 200)}`);
  }

  const data = (await res.json()) as any;
  const raw = data?.choices?.[0]?.message?.content ?? "";
  return parseVerdict(String(raw));
}

function parseVerdict(raw: string): CourtVerdict {
  let text = raw.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) text = fenced[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) text = text.slice(start, end + 1);

  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Судья вернул ответ не в JSON");
  }

  const allowed: VerdictKind[] = ["target", "plaintiff", "both", "nobody"];
  const verdict: VerdictKind = allowed.includes(parsed.verdict) ? parsed.verdict : "nobody";

  let fine = Number(parsed.fine);
  if (!Number.isFinite(fine)) fine = DEFAULT_FINE;
  fine = Math.max(MIN_FINE, Math.min(MAX_FINE, Math.round(fine)));

  const evidence = Array.isArray(parsed.evidence)
    ? parsed.evidence
        .slice(0, 6)
        .map((e: any) => ({ author: String(e?.author ?? "—").slice(0, 80), quote: String(e?.quote ?? "").trim().slice(0, 200) }))
        .filter((e: { quote: string }) => e.quote.length > 0)
    : [];

  return {
    verdict,
    fine,
    evidence,
    analysis: String(parsed.analysis ?? "").trim().slice(0, 900) || "Судья воздержался от комментариев.",
    apology: String(parsed.apology ?? "").trim().slice(0, 900) || "Проигравший отказался извиняться. Позор ему.",
  };
}

async function transferCoins(db: LibsqlClient, guildId: string, fromId: string, toId: string, amount: number): Promise<void> {
  await db.batch([
    { sql: "UPDATE users SET coins = MAX(COALESCE(coins, 0) - ?, 0) WHERE user_id = ? AND guild_id = ?", args: [amount, fromId, guildId] },
    { sql: "UPDATE users SET coins = COALESCE(coins, 0) + ? WHERE user_id = ? AND guild_id = ?", args: [amount, toId, guildId] },
  ]);
}

async function burnCoins(db: LibsqlClient, guildId: string, userId: string, amount: number): Promise<void> {
  await db.execute({ sql: "UPDATE users SET coins = MAX(COALESCE(coins, 0) - ?, 0) WHERE user_id = ? AND guild_id = ?", args: [amount, userId, guildId] });
}

function buildVerdictEmbed(opts: { plaintiffName: string; targetName: string; reason: string; verdict: CourtVerdict; transferLine: string }): Record<string, unknown> {
  const { verdict } = opts;

  const evidence = verdict.evidence.length > 0
    ? verdict.evidence.map((e) => `**${e.author}:** «${e.quote}»`).join("\n")
    : "Весомых улик в протоколе не обнаружено — только пустой базар.";

  const apology = verdict.verdict === "nobody" ? verdict.apology : `> ${verdict.apology}`;

  return {
    embeds: [
      {
        title: `⚖️ СУДЕБНЫЙ ВЕРДИКТ: ${opts.plaintiffName} против ${opts.targetName}`,
        description: verdict.analysis,
        color: VERDICT_COLORS[verdict.verdict],
        fields: [
          { name: "📋 Суть иска", value: opts.reason.slice(0, 1024) },
          { name: "🔍 Разбор улик", value: evidence.slice(0, 1024) },
          { name: `📜 Итог: ${VERDICT_LABELS[verdict.verdict]}`, value: opts.transferLine.slice(0, 1024) },
          { name: "🙏 Публичное извинение", value: apology.slice(0, 1024) },
        ],
        footer: { text: "Дело рассмотрено ИИ-судом • Решение обжалованию не подлежит" },
      },
    ],
  };
}

interface TrialContext {
  interaction: CommandInteraction;
  env: CourtEnv;
  db: LibsqlClient;
  guildId: string;
  channelId: string;
  reason: string;
  plaintiff: { id: string; username: string };
  target: { id: string; username: string };
}

async function runTrial(t: TrialContext): Promise<void> {
  try {
    const messages = await fetchRecentMessages(t.channelId, t.env.DISCORD_BOT_TOKEN, MESSAGES_TO_FETCH);
    if (messages.length < MIN_MESSAGES_FOR_TRIAL) {
      await patchOriginal(t.interaction, t.env, { content: "⚖️ В канале слишком мало сообщений для судебного разбирательства. Дело закрыто за отсутствием события." });
      return;
    }

    const transcript = messages.map((m) => `${m.username}: ${m.content}`).join("\n");
    const verdict = await askJudge(t.env, t.reason, t.plaintiff.username, t.target.username, transcript);

    let transferLine: string;
    if (verdict.verdict === "target") {
      await transferCoins(t.db, t.guildId, t.target.id, t.plaintiff.id, verdict.fine);
      transferLine = `💸 С ответчика **${t.target.username}** списано **${verdict.fine} 🪙** и переведено истцу **${t.plaintiff.username}**.`;
    } else if (verdict.verdict === "plaintiff") {
      await transferCoins(t.db, t.guildId, t.plaintiff.id, t.target.id, verdict.fine);
      transferLine = `💸 Истец **${t.plaintiff.username}** уличён(а) в ложном доносе: **${verdict.fine} 🪙** переведено ответчику **${t.target.username}**.`;
    } else if (verdict.verdict === "both") {
      await burnCoins(t.db, t.guildId, t.plaintiff.id, verdict.fine);
      await burnCoins(t.db, t.guildId, t.target.id, verdict.fine);
      transferLine = `🔥 Оба виновных оштрафованы на **${verdict.fine} 🪙** каждый. Монеты отправлены в печь сервера.`;
    } else {
      transferLine = "⚖️ Виновные не установлены. Монеты остались у своих владельцев.";
    }

    await patchOriginal(t.interaction, t.env, buildVerdictEmbed({ plaintiffName: t.plaintiff.username, targetName: t.target.username, reason: t.reason, verdict, transferLine }));
  } catch (err) {
    console.error("[Error] court cmd:", err);
    await patchOriginal(t.interaction, t.env, { content: "⚖️ Заседание сорвалось из-за технической ошибки. Кулдаун всё равно засчитан — готовьте пруфы к следующему разу." }).catch(() => {});
  }
}

export async function handleCourt(interaction: CommandInteraction, env: Env, ctx: ExecutionContext): Promise<Response> {
  const courtEnv = env as CourtEnv;
  const gid = interaction.guild_id;
  const channelId = interaction.channel_id;
  if (!gid || !channelId) return ephemeral("⚖️ Суд доступен только внутри сервера.");

  const opts = interaction.data?.options ?? [];
  const targetId = opts.find((o) => o.name === "target")?.value as string | undefined;
  const reasonRaw = opts.find((o) => o.name === "reason")?.value as string | undefined;
  const reason = (reasonRaw ?? "").trim().slice(0, MAX_REASON_LENGTH);

  const plaintiff = interaction.member?.user;
  if (!plaintiff) return ephemeral("⚖️ Не удалось определить истца.");
  if (!targetId || !reason) return ephemeral("⚖️ Укажите ответчика и суть иска: `/court target:@user reason:text`.");
  if (targetId === plaintiff.id) return ephemeral("⚖️ Судить самого себя — это уже самообвинение. Отказано.");

  const target = interaction.data?.resolved?.users?.[targetId];
  if (!target) return ephemeral("⚖️ Не удалось распознать ответчика.");
  if ((target as any)?.bot) return ephemeral("⚖️ Ботов судить нельзя — у них нет ни чести, ни кошелька.");

  const db = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });

  // Гарантируем наличие колонки кулдауна (fallback для старых БД)
  try {
    await db.execute("ALTER TABLE users ADD COLUMN last_court_at TEXT");
  } catch {
    // колонка уже существует
  }

  // Профиль истца
  const pres = await db.execute({ sql: "SELECT last_court_at FROM users WHERE user_id = ? AND guild_id = ?", args: [plaintiff.id, gid] });
  if (pres.rows.length === 0) return ephemeral("⚖️ Ваш профиль не найден в базе. Поболтайте в чате, чтобы попасть в реестр граждан.");

  // Строгий кулдаун 3 дня
  const lastAt = pres.rows[0].last_court_at as string | null;
  if (lastAt) {
    const elapsed = Date.now() - new Date(lastAt).getTime();
    if (Number.isFinite(elapsed) && elapsed >= 0 && elapsed < COURT_COOLDOWN_MS) {
      return ephemeral(`⚖️ Иск подавать пока рано. До конца кулдауна осталось: **${formatRemaining(COURT_COOLDOWN_MS - elapsed)}**.`);
    }
  }

  // Профиль ответчика
  const tres = await db.execute({ sql: "SELECT user_id FROM users WHERE user_id = ? AND guild_id = ?", args: [targetId, gid] });
  if (tres.rows.length === 0) return ephemeral("⚖️ Профиль ответчика не найден в базе — судить некого.");

  // Фиксируем кулдаун сразу, чтобы параллельные иски не прошли дважды
  await db.execute({ sql: "UPDATE users SET last_court_at = ? WHERE user_id = ? AND guild_id = ?", args: [new Date().toISOString(), plaintiff.id, gid] });

  ctx.waitUntil(
    runTrial({
      interaction,
      env: courtEnv,
      db,
      guildId: gid,
      channelId,
      reason,
      plaintiff: { id: plaintiff.id, username: plaintiff.username },
      target: { id: targetId, username: String(target.username || targetId) },
    })
  );

  // Отложенный публичный ответ: разбирательство может занять до минуты
  return Response.json({ type: 5 });
}
