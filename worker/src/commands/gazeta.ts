import { CommandInteraction, Env, ExecutionContext } from "../types";
import { createClient } from "@libsql/client/web";

// ============================================
// /test-gazeta — еженедельная AI-газета сервера
// ============================================

const GAZETTA_CHANNEL_ID = "1051085743839260694";

const PROXYAPI_URL = "https://api.proxyapi.ru/v1/chat/completions";
// Ключ LLM берётся ТОЛЬКО из env.PROXYAPI_KEY — никаких захардкоженных fallback'ов
const PRIMARY_MODEL = "z-ai/glm-5.3-flash";
const FALLBACK_MODEL = "google/gemini-2.5-flash-lite";

const DEFAULT_DB_URL = "libsql://disbot-db-zomka.aws-ap-northeast-1.turso.io";
const DEFAULT_DB_AUTH_TOKEN =
  "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3ODg3Nzg0MjIsImlkIjoiMDFhMDdiODAtMTEwMS03YzE5LThjMDEtMDcxZTdhMWYwYjZiIiwia2lkIjoicWRTQWJDRkRlemFtRlFhVFh6aGpyRjM0dTlnV1FVWVdJLWdGVGNtLUJsRSIsInJpZCI6IjQzY2M3MDIwLTJhMTMtNDg3NS1hODliLTg2MjkzNmZlMDVjZSJ9.oHijFr0xv2Y3RoZIulA09s5Whba6hsf6o8I3btCkJypeuXNph5aEvDbVNC5_zSoePMHhylfXC4xCAHz1GdkyBg";

const DISCORD_API = "https://discord.com/api/v10";

const PERMISSION_ADMINISTRATOR = 0x8n;
const PERMISSION_MANAGE_GUILD = 0x20n;

interface CollectedMessage {
  id: string;
  author: string;
  content: string;
  timestamp: number;
  reactionsCount: number;
}

function getDb(env: Env) {
  return createClient({
    url: (env as any).DATABASE_URL || DEFAULT_DB_URL,
    authToken: (env as any).DATABASE_AUTH_TOKEN || DEFAULT_DB_AUTH_TOKEN,
  });
}

// Загрузка накопленного лора из БД
async function loadServerLore(db: any): Promise<string[]> {
  try {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS server_lore (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fact TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);
    const res = await db.execute("SELECT fact FROM server_lore ORDER BY id DESC LIMIT 20");
    return res.rows.map((r: any) => String(r.fact)).reverse();
  } catch (err) {
    console.warn("[Gazeta] Lore load skipped:", err);
    return [];
  }
}

// Сохранение новых фактов в лор
async function saveServerLore(db: any, newFacts: string[]): Promise<void> {
  if (newFacts.length === 0) return;
  for (const fact of newFacts) {
    const clean = fact.replace(/^[-*•\s]+/, "").trim();
    if (!clean || clean.length < 5) continue;
    try {
      await db.execute({
        sql: "INSERT INTO server_lore (fact, created_at) VALUES (?, ?)",
        args: [clean.slice(0, 300), Date.now()],
      });
    } catch (err) {
      console.warn("[Gazeta] Failed to insert lore fact:", err);
    }
  }
}

export async function handleTestGazeta(inter: CommandInteraction, env: Env, ctx: ExecutionContext): Promise<Response> {
  const permissions = BigInt(((inter.member as any)?.permissions as string | number | undefined) ?? "0");
  const isAdmin = (permissions & PERMISSION_ADMINISTRATOR) !== 0n || (permissions & PERMISSION_MANAGE_GUILD) !== 0n;

  if (!isAdmin) {
    return Response.json({
      type: 4,
      data: { content: "?? Эта команда доступна только администрации", flags: 64 },
    });
  }

  const sourceChannelId = (inter as any).channel_id || (inter as any).channel?.id || GAZETTA_CHANNEL_ID;

  // Вся тяжёлая работа (сбор сообщений, запрос к LLM, публикация) — через ctx.waitUntil,
  // вне 3-секундного окна Discord. Финальный статус доставляется PATCH'ем на
  // https://discord.com/api/v10/webhooks/{DISCORD_APPLICATION_ID}/{token}/messages/@original
  ctx.waitUntil(publishWeeklyGazette(env, inter.token, sourceChannelId));

  // Мгновенный deferred-ответ (type 5, ephemeral) — укладываемся в таймаут Discord
  return Response.json({
    type: 5,
    data: { flags: 64 },
  });
}

async function publishWeeklyGazette(env: Env, token: string, sourceChannelId: string): Promise<void> {
  // Только env: никаких захардкоженных fallback'ов для appId / токена / ключа LLM
  const appId = (env as any).DISCORD_APPLICATION_ID || "";
  const botToken = (env as any).DISCORD_TOKEN || (env as any).DISCORD_BOT_TOKEN || "";
  const apiKey = (env as any).PROXYAPI_KEY || "";
  const db = getDb(env);

  try {
    if (!appId) throw new Error("DISCORD_APPLICATION_ID не настроен в окружении воркера");
    if (!botToken) throw new Error("DISCORD_TOKEN/DISCORD_BOT_TOKEN не настроен в окружении воркера");
    if (!apiKey) throw new Error("PROXYAPI_KEY не настроен в окружении воркера");

    const messages = await fetchLastWeekMessages(botToken, sourceChannelId);

    if (messages.length === 0) {
      await editOriginalResponse(appId, token, "?? За последние 7 дней в этом канале не нашлось сообщений участников.");
      return;
    }

    const loreList = await loadServerLore(db);
    const { digestText, newLoreFacts } = await generateGazetteText(apiKey, messages, loreList);

    if (newLoreFacts.length > 0) {
      await saveServerLore(db, newLoreFacts);
    }

    await publishGazetteEmbeds(botToken, digestText);
    await editOriginalResponse(appId, token, "? Свежий выпуск газеты успешно опубликован в канале!");
  } catch (err: any) {
    console.error("[Error] test-gazeta cmd:", err);
    const msg = err?.name === "TimeoutError" ? "Превышено время ожидания LLM" : (err?.message || String(err));
    if (appId) {
      await editOriginalResponse(appId, token, `?? Ошибка выпуска: ${msg.slice(0, 1500)}`);
    }
  }
}

// Сбор до 300 сообщений назад от текущей секунды (охватывает и сегодня, и всю неделю)
async function fetchLastWeekMessages(botToken: string, channelId: string): Promise<CollectedMessage[]> {
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  let beforeId: string | undefined = undefined;
  const all: CollectedMessage[] = [];

  for (let page = 0; page < 3; page++) {
    const url = `${DISCORD_API}/channels/${channelId}/messages?limit=100${beforeId ? `&before=${beforeId}` : ""}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bot ${botToken}` },
      signal: AbortSignal.timeout(4000),
    });

    if (!res.ok) break;

    const batch = (await res.json()) as any[];
    if (!Array.isArray(batch) || batch.length === 0) break;

    let reachedOld = false;
    for (const m of batch) {
      const ts = new Date(m.timestamp).getTime();
      if (ts < sevenDaysAgo) {
        reachedOld = true;
        break;
      }
      if (m.author?.bot) continue;

      const text = (m.content || "").trim();
      // Пропускаем вызовы команд и пустоту
      if (!text || text.startsWith("/") || text.startsWith("!")) continue;

      const reactionsCount = Array.isArray(m.reactions)
        ? m.reactions.reduce((sum: number, r: any) => sum + (r.count || 0), 0)
        : 0;

      all.push({
        id: m.id,
        author: m.author.username,
        content: text,
        timestamp: ts,
        reactionsCount,
      });
    }

    if (reachedOld || batch.length < 100) break;
    beforeId = batch[batch.length - 1].id;
  }

  return all;
}

// Умная группировка по дням недели с приоритетом сообщений с реакциями
function buildWeeklyTranscript(messages: CollectedMessage[]): string {
  // Сортируем от старых к новым для нормальной хронологии
  messages.sort((a, b) => a.timestamp - b.timestamp);

  const daysMap = new Map<string, CollectedMessage[]>();
  const todayStr = new Date().toISOString().slice(0, 10);

  for (const m of messages) {
    const dayKey = new Date(m.timestamp).toISOString().slice(0, 10);
    if (!daysMap.has(dayKey)) daysMap.set(dayKey, []);
    daysMap.get(dayKey)!.push(m);
  }

  const sections: string[] = [];

  for (const [dayKey, dayMsgs] of daysMap.entries()) {
    const isToday = dayKey === todayStr;
    const [, mm, dd] = dayKey.split("-");
    const header = isToday ? `?? ${dd}.${mm} (СЕГОДНЯ / ПОСЛЕДНИЕ СОБЫТИЯ):` : `?? ${dd}.${mm}:`;

    // Выбираем до 20 самых заметных сообщений за каждый день
    let chosen = dayMsgs;
    if (dayMsgs.length > 20) {
      const withReactions = dayMsgs.filter((m) => m.reactionsCount > 0);
      const normal = dayMsgs.filter((m) => m.reactionsCount === 0);
      // Берём сообщения с реакциями + равномерный срез обычных
      const step = Math.max(1, Math.floor(normal.length / 12));
      const sampled = normal.filter((_, idx) => idx % step === 0);
      chosen = [...withReactions, ...sampled].sort((a, b) => a.timestamp - b.timestamp).slice(0, 22);
    }

    const lines = chosen.map((m) => {
      const star = m.reactionsCount > 0 ? ` [??x${m.reactionsCount}]` : "";
      return `${m.author}: ${m.content.replace(/\s+/g, " ").slice(0, 180)}${star}`;
    });

    sections.push(`${header}\n${lines.join("\n")}`);
  }

  return sections.join("\n\n").slice(0, 9500);
}

// Запрос к LLM
async function callProxyApi(apiKey: string, model: string, systemPrompt: string, userPrompt: string, timeoutMs: number): Promise<string> {
  const bodyPayload: any = {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.75,
    max_tokens: 1800,
    reasoning_effort: "minimal",
  };

  const res = await fetch(PROXYAPI_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(bodyPayload),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`API error (${res.status}): ${errText.slice(0, 200)}`);
  }

  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const text = data?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("Пустой ответ от нейросети");

  return text;
}

async function generateGazetteText(
  apiKey: string,
  messages: CollectedMessage[],
  loreList: string[]
): Promise<{ digestText: string; newLoreFacts: string[] }> {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const formatDate = (d: Date) => `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}`;
  const dateRange = `${formatDate(weekAgo)} — ${formatDate(now)}`;

  const transcript = buildWeeklyTranscript(messages);

  const loreBlock =
    loreList.length > 0
      ? `\n\nПАМЯТЬ И ЛОР СЕРВЕРА (что ты уже знаешь о челах из прошлых выпусков, используй для подколов и связности):\n${loreList
          .map((f) => `• ${f}`)
          .join("\n")}`
      : "";

  const systemPrompt = `Ты — циничный, саркастичный летописец Discord-сервера. Твоя задача — написать сочный дайджест событий за неделю (${dateRange}).

КАК ВЫБИРАТЬ, ЧТО ПОПАДЁТ В ВЫПУСК (это главное — не пересказывай подряд, а отбирай):
1. Сначала мысленно оцени КАЖДУЮ тему/переписку в хронике по шкале "это реально смешно, дико, драматично или странно" — и оставляй только то, что набрало высокий балл. Проходной, бытовой трёп (короткие реплики без панча, техническая переписка, "+1", уточнения) — не тема для газеты, пропускай.
2. Пометка [??xN] — сильный сигнал, что тут был движ, но не приговор: если реакция набежала на скучное сообщение (например, все просто соглашаются), не тяни это в номер только из-за цифры. И наоборот — по-настоящему угарная реплика без реакций достойна места, если она реально смешная или абсурдная.
3. Приоритет темам, где есть: конфликт/срач, неожиданный поворот, чей-то провал или победа, забавное совпадение, цитата, которую можно вырвать из контекста и приколоться, продолжение старой темы/мема (сверься с ПАМЯТЬЮ ниже).
4. Если одна и та же шутка/тема всплывает несколько раз за неделю — не пересказывай её трижды в разных секциях, выбери один лучший момент и подай его один раз, при этом можно подсветить, что тема стала мемом недели.
5. Из блока "СЕГОДНЯ / ПОСЛЕДНИЕ СОБЫТИЯ" бери только реально свежий движ, а не всё подряд просто потому что он свежий.

ОХВАТ НЕДЕЛИ: Не застревай на одном дне — газета должна показывать, что происходило и в начале недели, и в середине, и сегодня. Если какой-то день был откровенно пустым и скучным — это нормально, просто не выдумывай туда контент и не трать на него место, лучше отдай больше места дням, где реально что-то было.

СТИЛЬ:
- Никакого кринжа: без "Привет, обитатели уютного уголка", "Пристегните ремни", "Добро пожаловать" и подобных вступлений.
- Без квадратных скобок [Дата] в тексте.
- Начинай сразу с первой громкой темы или жёсткого панча — без разгона.
- Разбивай на разделы с крутыми названиями и эмодзи, доводи каждую мысль до конца.
- Заверши выпуск "Цитатой недели" — должна быть реально лучшая, а не первая попавшаяся реплика.${loreBlock}

ВАЖНО ДЛЯ ОБУЧЕНИЯ:
В самом конце ответа добавь 2-3 новых факта/мема о челах для своей базы знаний (бери только то, что реально войдёт в привычки/лор сервера, а не разовую случайность):
===ПАМЯТЬ===
- мем или черта участника
- еще один факт
===КОНЕЦ_ПАМЯТИ===`;

  const userPrompt = `Хроника сообщений по дням за неделю (${dateRange}):\n\n${transcript}`;

  let rawOutput = "";
  try {
    rawOutput = await callProxyApi(apiKey, PRIMARY_MODEL, systemPrompt, userPrompt, 13000);
  } catch (err) {
    console.warn(`[Gazeta] Primary model failed, falling back to ${FALLBACK_MODEL}:`, err);
    rawOutput = await callProxyApi(apiKey, FALLBACK_MODEL, systemPrompt, userPrompt, 9000);
  }

  const newLoreFacts: string[] = [];
  const memoryMatch = rawOutput.match(/===ПАМЯТЬ===([\s\S]*?)===КОНЕЦ_ПАМЯТИ===/);
  if (memoryMatch) {
    const lines = memoryMatch[1].split("\n").map((l) => l.trim()).filter(Boolean);
    newLoreFacts.push(...lines);
  }

  const digestText = rawOutput.replace(/===ПАМЯТЬ===[\s\S]*?===КОНЕЦ_ПАМЯТИ===/, "").trim();

  return { digestText, newLoreFacts };
}

function splitIntoEmbedChunks(text: string, maxLen = 3800): string[] {
  if (text.length <= maxLen) return [text];

  const paragraphs = text.split("\n\n");
  const chunks: string[] = [];
  let current = "";

  for (const para of paragraphs) {
    if ((current + "\n\n" + para).length > maxLen) {
      if (current.trim()) chunks.push(current.trim());
      current = para;
    } else {
      current = current ? `${current}\n\n${para}` : para;
    }
  }

  if (current.trim()) chunks.push(current.trim());
  return chunks.length > 0 ? chunks : [text.slice(0, maxLen)];
}

async function publishGazetteEmbeds(botToken: string, fullText: string): Promise<void> {
  const chunks = splitIntoEmbedChunks(fullText, 3800);

  for (let i = 0; i < chunks.length; i++) {
    const title =
      chunks.length === 1
        ? "?? Газета сервера • Хроника недели"
        : `?? Газета сервера • Хроника недели (Часть ${i + 1}/${chunks.length})`;

    const res = await fetch(`${DISCORD_API}/channels/${GAZETTA_CHANNEL_ID}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bot ${botToken}`,
      },
      body: JSON.stringify({
        embeds: [
          {
            title,
            description: chunks[i],
            color: 0x5865f2,
            footer: { text: "Еженедельный дайджест" },
            timestamp: new Date().toISOString(),
          },
        ],
      }),
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Ошибка отправки части ${i + 1} (${res.status}): ${errText.slice(0, 200)}`);
    }

    if (i < chunks.length - 1) {
      await new Promise((r) => setTimeout(r, 600));
    }
  }
}

async function editOriginalResponse(appId: string, token: string, content: string): Promise<void> {
  if (!appId || !token) {
    console.error("[Gazeta] Cannot edit original response: нет DISCORD_APPLICATION_ID или interaction token");
    return;
  }
  await fetch(`${DISCORD_API}/webhooks/${appId}/${token}/messages/@original`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
}


