import { CommandInteraction, Env, ExecutionContext } from "../types";

// ============================================
// /test-gazeta — еженедельная газета канала
// ============================================

const GAZETTA_CHANNEL_ID = "1051085743839260694";

const PROXYAPI_URL = "https://api.proxyapi.ru/v1/chat/completions";
const PROXYAPI_API_KEY = "sk-7vNVmFz9SukzwvLQ7VEfd8ZLXG4O76iE";
const PROXYAPI_MODEL = "z-ai/glm-5.3-flash";

const DISCORD_API = "https://discord.com/api/v10";
const DISCORD_EPOCH = 1420070400000n;

const PERMISSION_ADMINISTRATOR = 0x8n;
const PERMISSION_MANAGE_GUILD = 0x20n;

interface GazetteMessage {
  id: string;
  author?: { username?: string };
  content?: string;
}

// Snowflake по дате (для фильтра after в Discord API)
function snowflakeFromDate(ms: number): string {
  return ((BigInt(ms) - DISCORD_EPOCH) << 22n).toString();
}

export async function handleTestGazeta(inter: CommandInteraction, env: Env, ctx: ExecutionContext): Promise<Response> {
  // 1. Проверка прав: Administrator или ManageGuild
  const permissions = BigInt(((inter.member as any)?.permissions as string | number | undefined) ?? "0");
  const isAdmin = (permissions & PERMISSION_ADMINISTRATOR) !== 0n || (permissions & PERMISSION_MANAGE_GUILD) !== 0n;

  if (!isAdmin) {
    return Response.json({
      type: 4,
      data: { content: "🚫 Эта команда доступна только администрации", flags: 64 },
    });
  }

  // 2. Тяжёлая работа (сбор сообщений + LLM + публикация Embed) в фоне
  ctx.waitUntil(publishWeeklyGazette(env, inter.token));

  // Откладываем ответ, финальный текст придёт через редактирование исходного ответа
  return Response.json({ type: 5 });
}

async function publishWeeklyGazette(env: Env, token: string): Promise<void> {
  const botToken = (env as any).DISCORD_TOKEN ?? (env as any).DISCORD_BOT_TOKEN;
  const appId = (env as any).DISCORD_APPLICATION_ID;

  try {
    if (!botToken || !appId) throw new Error("Missing DISCORD_TOKEN / DISCORD_APPLICATION_ID in env");

    const messages = await fetchLastWeekMessages(botToken);
    if (messages.length === 0) {
      await editOriginalResponse(appId, token, "📰 За последние 7 дней в канале не нашлось сообщений для выпуска газеты.");
      return;
    }

    const digest = await generateGazetteText(messages);
    await publishGazetteEmbed(botToken, digest);
    await editOriginalResponse(appId, token, "📰 Выпуск газеты за неделю успешно опубликован в канале!");
  } catch (err) {
    console.error("[Error] test-gazeta cmd:", err);
    await editOriginalResponse(appId, token, "🚫 Не удалось собрать выпуск газеты. Попробуйте позже.");
  }
}

// Сообщения канала за последние 7 дней (до 500 штук)
async function fetchLastWeekMessages(botToken: string): Promise<{ author: string; content: string }[]> {
  let after = snowflakeFromDate(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const all: { author: string; content: string }[] = [];

  for (let page = 0; page < 5; page++) {
    const res = await fetch(`${DISCORD_API}/channels/${GAZETTA_CHANNEL_ID}/messages?limit=100&after=${after}`, {
      headers: { Authorization: `Bot ${botToken}` },
    });
    if (!res.ok) throw new Error(`Failed to fetch channel messages: ${res.status}`);

    const batch = (await res.json()) as GazetteMessage[];
    if (batch.length === 0) break;

    for (const m of batch) {
      if (m.content && m.author?.username) all.push({ author: m.author.username, content: m.content });
    }
    if (batch.length < 100) break;

    // Пагинация вперёд: максимальный id становится новым after
    after = batch.reduce((max, m) => (BigInt(m.id) > BigInt(max.id) ? m : max)).id;
  }

  return all;
}

// Запрос в ProxyAPI: превращаем лог сообщений в текст газеты
async function generateGazetteText(messages: { author: string; content: string }[]): Promise<string> {
  const transcript = messages
    .map((m) => `${m.author}: ${m.content.replace(/\s+/g, " ").slice(0, 300)}`)
    .join("\n")
    .slice(0, 60000);

  const res = await fetch(PROXYAPI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${PROXYAPI_API_KEY}` },
    body: JSON.stringify({
      model: PROXYAPI_MODEL,
      messages: [
        {
          role: "system",
          content: "Ты — редактор еженедельной газеты Discord-сервера. По логу сообщений напиши живой дайджест: главные темы недели, яркие цитаты, мемы и самых активных участников. Пиши по-русски, с юмором, короткими абзацами.",
        },
        { role: "user", content: "Сообщения участников за последние 7 дней:\n\n" + transcript },
      ],
      temperature: 0.7,
      max_tokens: 1200,
    }),
  });

  if (!res.ok) throw new Error(`ProxyAPI error: ${res.status} ${await res.text()}`);

  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("ProxyAPI returned empty content");

  return text.slice(0, 4000);
}

// Публикация Embed в канал газеты
async function publishGazetteEmbed(botToken: string, digest: string): Promise<void> {
  const res = await fetch(`${DISCORD_API}/channels/${GAZETTA_CHANNEL_ID}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bot ${botToken}` },
    body: JSON.stringify({
      embeds: [
        {
          title: "📰 Газета сервера • Итоги недели",
          description: digest,
          color: 0x5865f2,
          footer: { text: "Сгенерировано автоматически по сообщениям за 7 дней" },
          timestamp: new Date().toISOString(),
        },
      ],
    }),
  });

  if (!res.ok) throw new Error(`Failed to publish gazette: ${res.status} ${await res.text()}`);
}

// Редактируем отложенный ответ на команду
async function editOriginalResponse(appId: string, token: string, content: string): Promise<void> {
  await fetch(`${DISCORD_API}/webhooks/${appId}/${token}/messages/@original`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
}
