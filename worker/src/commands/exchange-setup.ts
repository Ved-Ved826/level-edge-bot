// Команда /exchange-setup: привязка канала событий биржи (Этап 4.1).
// Сохраняет market_channel_id в exchange_guild_state. Доступно только с правом Manage Guild.

import { createClient } from "@libsql/client";
import { CommandInteraction, Env, ExecutionContext } from "../types";

/** PATCH @original — обновление отложенного ephemeral-ответа. */
async function patchOriginal(env: Env, token: string, content: string): Promise<Response> {
  return fetch(`https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${token}/messages/@original`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, flags: 64 }),
  });
}

/** Право Discord "Manage Server" (MANAGE_GUILD) = 1 << 5. */
const MANAGE_GUILD = BigInt(32);

/** Проверка права Manage Guild у вызвавшего участника. */
function hasManageGuild(inter: CommandInteraction): boolean {
  const raw = (inter.member as any)?.permissions as string | number | undefined;
  if (raw === undefined) return false;
  return (BigInt(raw) & MANAGE_GUILD) !== BigInt(0);
}

export async function handleExchangeSetup(
  inter: CommandInteraction,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  ctx.waitUntil(
    (async () => {
      try {
        const gid = inter.guild_id;
        if (!gid) throw new Error("Команда доступна только на сервере");

        if (!hasManageGuild(inter)) {
          const resp = await patchOriginal(env, inter.token, "⛔ Настройка биржи доступна только участникам с правом «Управление сервером».");
          if (!resp.ok) console.error("[ExchangeSetup] Perm followUp fail:", await resp.text());
          return;
        }

        const channelRaw = inter.data?.options?.find((o: any) => o.name === "channel")?.value as string | undefined;
        if (!channelRaw) throw new Error("Не указан канал");

        const db = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });

        await db.execute({
          sql: `INSERT INTO exchange_guild_state (guild_id, market_channel_id) VALUES (?, ?)
                ON CONFLICT(guild_id) DO UPDATE SET market_channel_id = excluded.market_channel_id`,
          args: [gid, channelRaw],
        });

        const resp = await patchOriginal(env, inter.token, `✅ Канал событий биржи сохранён: <#${channelRaw}>`);
        if (!resp.ok) console.error("[ExchangeSetup] followUp fail:", await resp.text());
      } catch (e) {
        console.error("[ExchangeSetup] error:", e);
        try {
          const errText = e instanceof Error && e.message ? `❌ ${e.message}` : "❌ Не удалось сохранить канал биржи.";
          const resp = await patchOriginal(env, inter.token, errText);
          if (!resp.ok) console.error("[ExchangeSetup] Error followUp fail:", await resp.text());
        } catch (patchErr) {
          console.error("[ExchangeSetup] Failed to patch @original:", patchErr);
        }
      }
    })()
  );
  return Response.json({ type: 5, data: { flags: 64 } });
}
