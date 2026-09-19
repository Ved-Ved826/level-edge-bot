import { CommandInteraction, Env, ExecutionContext } from "../types";
import { createClient } from "@libsql/client/web";

// ============================================
// /test-gazeta Ч еженедельна€ AI-газета сервера
// ============================================

const GAZETTA_CHANNEL_ID = "1051085743839260694";

const PROXYAPI_URL = "https://api.proxyapi.ru/v1/chat/completions";
const PROXYAPI_API_KEY = "sk-7vNVmFz9SukzwvLQ7VEfd8ZLXG4O76iE";
const PRIMARY_MODEL = "z-ai/glm-5.3-flash";
const FALLBACK_MODEL = "google/gemini-2.5-flash-lite";

let DEFAULT_DISCORD_TOKEN = "";
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

// «агрузка накопленного лора из Ѕƒ
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

// —охранение новых фактов в лор
async function saveServerLore(db: any, newFacts: string[]): Promise<void> {
  if (newFacts.length === 0) return;
  for (const fact of newFacts) {
    const clean = fact.replace(/^[-*Х\s]+/, "").trim();
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
  const DISCORD_BOT_TOKEN = env.DISCORD_BOT_TOKEN || env.DISCORD_TOKEN || "";
  const BOT_TOKEN = env.DISCORD_BOT_TOKEN || env.DISCORD_TOKEN || "";
  const permissions = BigInt(((inter.member as any)?.permissions as string | number | undefined) ?? "0");
  const isAdmin = (permissions & PERMISSION_ADMINISTRATOR) !== 0n || (permissions & PERMISSION_MANAGE_GUILD) !== 0n;

  if (!isAdmin) {
    return Response.json({
      type: 4,
      data: { content: "?? Ёта команда доступна только администрации", flags: 64 },
    });
  }

  const sourceChannelId = (inter as any).channel_id || (inter as any).channel?.id || GAZETTA_CHANNEL_ID;

  ctx.waitUntil(publishWeeklyGazette(env, inter.token, sourceChannelId));

  return Response.json({
    type: 5,
    data: { flags: 64 },
  });
}

async function publishWeeklyGazette(env: Env, token: string, sourceChannelId: string): Promise<void> {
  const botToken = (env as any).DISCORD_TOKEN || (env as any).DISCORD_BOT_TOKEN || DEFAULT_DISCORD_TOKEN;
  const appId = (env as any).DISCORD_APPLICATION_ID || "939777923320283176";
  const db = getDb(env);

  try {
    const messages = await fetchLastWeekMessages(botToken, sourceChannelId);

    if (messages.length === 0) {
      await editOriginalResponse(appId, token, "?? «а последние 7 дней в этом канале не нашлось сообщений участников.");
      return;
    }

    const loreList = await loadServerLore(db);
    const { digestText, newLoreFacts } = await generateGazetteText(messages, loreList);

    if (newLoreFacts.length > 0) {
      await saveServerLore(db, newLoreFacts);
    }

    await publishGazetteEmbeds(botToken, digestText);
    await editOriginalResponse(appId, token, "? —вежий выпуск газеты успешно опубликован в канале!");
  } catch (err: any) {
    console.error("[Error] test-gazeta cmd:", err);
    const msg = err?.name === "TimeoutError" ? "ѕревышено врем€ ожидани€ LLM" : (err?.message || String(err));
    await editOriginalResponse(appId, token, `?? ќшибка выпуска: ${msg.slice(0, 1500)}`);
  }
}

// —бор до 300 сообщений назад от текущей секунды (охватывает и сегодн€, и всю неделю)
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
      // ѕропускаем вызовы команд и пустоту
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

// ”мна€ группировка по дн€м недели с приоритетом сообщений с реакци€ми
function buildWeeklyTranscript(messages: CollectedMessage[]): string {
  // —ортируем от старых к новым дл€ нормальной хронологии
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
    const header = isToday ? `?? ${dd}.${mm} (—≈√ќƒЌя / ѕќ—Ћ≈ƒЌ»≈ —ќЅџ“»я):` : `?? ${dd}.${mm}:`;

    // ¬ыбираем до 20 самых заметных сообщений за каждый день
    let chosen = dayMsgs;
    if (dayMsgs.length > 20) {
      const withReactions = dayMsgs.filter((m) => m.reactionsCount > 0);
      const normal = dayMsgs.filter((m) => m.reactionsCount === 0);
      // ЅерЄм сообщени€ с реакци€ми + равномерный срез обычных
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

// «апрос к LLM
async function callProxyApi(model: string, systemPrompt: string, userPrompt: string, timeoutMs: number): Promise<string> {
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
      Authorization: `Bearer ${PROXYAPI_API_KEY}`,
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
  if (!text) throw new Error("ѕустой ответ от нейросети");

  return text;
}

async function generateGazetteText(
  messages: CollectedMessage[],
  loreList: string[]
): Promise<{ digestText: string; newLoreFacts: string[] }> {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const formatDate = (d: Date) => `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}`;
  const dateRange = `${formatDate(weekAgo)} Ч ${formatDate(now)}`;

  const transcript = buildWeeklyTranscript(messages);

  const loreBlock =
    loreList.length > 0
      ? `\n\nѕјћя“№ » Ћќ– —≈–¬≈–ј (что ты уже знаешь о челах из прошлых выпусков, используй дл€ подколов и св€зности):\n${loreList
          .map((f) => `Х ${f}`)
          .join("\n")}`
      : "";

  const systemPrompt = `“ы Ч циничный, саркастичный летописец Discord-сервера. “во€ задача Ч написать сочный дайджест событий за неделю (${dateRange}).

 ј  ¬џЅ»–ј“№, „“ќ ѕќѕјƒ®“ ¬ ¬џѕ”—  (это главное Ч не пересказывай подр€д, а отбирай):
1. —начала мысленно оцени  ј∆ƒ”ё тему/переписку в хронике по шкале "это реально смешно, дико, драматично или странно" Ч и оставл€й только то, что набрало высокий балл. ѕроходной, бытовой трЄп (короткие реплики без панча, техническа€ переписка, "+1", уточнени€) Ч не тема дл€ газеты, пропускай.
2. ѕометка [??xN] Ч сильный сигнал, что тут был движ, но не приговор: если реакци€ набежала на скучное сообщение (например, все просто соглашаютс€), не т€ни это в номер только из-за цифры. » наоборот Ч по-насто€щему угарна€ реплика без реакций достойна места, если она реально смешна€ или абсурдна€.
3. ѕриоритет темам, где есть: конфликт/срач, неожиданный поворот, чей-то провал или победа, забавное совпадение, цитата, которую можно вырвать из контекста и приколотьс€, продолжение старой темы/мема (сверьс€ с ѕјћя“№ё ниже).
4. ≈сли одна и та же шутка/тема всплывает несколько раз за неделю Ч не пересказывай еЄ трижды в разных секци€х, выбери один лучший момент и подай его один раз, при этом можно подсветить, что тема стала мемом недели.
5. »з блока "—≈√ќƒЌя / ѕќ—Ћ≈ƒЌ»≈ —ќЅџ“»я" бери только реально свежий движ, а не всЄ подр€д просто потому что он свежий.

ќ’¬ј“ Ќ≈ƒ≈Ћ»: Ќе застревай на одном дне Ч газета должна показывать, что происходило и в начале недели, и в середине, и сегодн€. ≈сли какой-то день был откровенно пустым и скучным Ч это нормально, просто не выдумывай туда контент и не трать на него место, лучше отдай больше места дн€м, где реально что-то было.

—“»Ћ№:
- Ќикакого кринжа: без "ѕривет, обитатели уютного уголка", "ѕристегните ремни", "ƒобро пожаловать" и подобных вступлений.
- Ѕез квадратных скобок [ƒата] в тексте.
- Ќачинай сразу с первой громкой темы или жЄсткого панча Ч без разгона.
- –азбивай на разделы с крутыми названи€ми и эмодзи, доводи каждую мысль до конца.
- «аверши выпуск "÷итатой недели" Ч должна быть реально лучша€, а не перва€ попавша€с€ реплика.${loreBlock}

¬ј∆Ќќ ƒЋя ќЅ”„≈Ќ»я:
¬ самом конце ответа добавь 2-3 новых факта/мема о челах дл€ своей базы знаний (бери только то, что реально войдЄт в привычки/лор сервера, а не разовую случайность):
===ѕјћя“№===
- мем или черта участника
- еще один факт
=== ќЌ≈÷_ѕјћя“»===`;

  const userPrompt = `’роника сообщений по дн€м за неделю (${dateRange}):\n\n${transcript}`;

  let rawOutput = "";
  try {
    rawOutput = await callProxyApi(PRIMARY_MODEL, systemPrompt, userPrompt, 13000);
  } catch (err) {
    console.warn(`[Gazeta] Primary model failed, falling back to ${FALLBACK_MODEL}:`, err);
    rawOutput = await callProxyApi(FALLBACK_MODEL, systemPrompt, userPrompt, 9000);
  }

  const newLoreFacts: string[] = [];
  const memoryMatch = rawOutput.match(/===ѕјћя“№===([\s\S]*?)=== ќЌ≈÷_ѕјћя“»===/);
  if (memoryMatch) {
    const lines = memoryMatch[1].split("\n").map((l) => l.trim()).filter(Boolean);
    newLoreFacts.push(...lines);
  }

  const digestText = rawOutput.replace(/===ѕјћя“№===[\s\S]*?=== ќЌ≈÷_ѕјћя“»===/, "").trim();

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
        ? "?? √азета сервера Х ’роника недели"
        : `?? √азета сервера Х ’роника недели („асть ${i + 1}/${chunks.length})`;

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
            footer: { text: "≈женедельный дайджест" },
            timestamp: new Date().toISOString(),
          },
        ],
      }),
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`ќшибка отправки части ${i + 1} (${res.status}): ${errText.slice(0, 200)}`);
    }

    if (i < chunks.length - 1) {
      await new Promise((r) => setTimeout(r, 600));
    }
  }
}

async function editOriginalResponse(appId: string, token: string, content: string): Promise<void> {
  await fetch(`${DISCORD_API}/webhooks/${appId}/${token}/messages/@original`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
}


