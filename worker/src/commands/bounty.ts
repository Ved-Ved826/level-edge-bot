import { createClient } from "@libsql/client/web";
import { CommandInteraction, Env, ExecutionContext } from "../types";

const BOUNTY_MIN_AMOUNT = 10;
const BOUNTY_MAX_AMOUNT = 10000;

async function ensureBountiesTable(db: any): Promise<void> {
  await db.execute({
    sql: `CREATE TABLE IF NOT EXISTS bounties (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target_id TEXT NOT NULL,
      guild_id TEXT NOT NULL,
      reward INTEGER NOT NULL,
      hunter_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at INTEGER NOT NULL
    )`,
    args: [],
  });
}

export async function handleBounty(
  inter: CommandInteraction,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const uid = inter.member?.user.id;
  const gid = inter.guild_id;
  if (!uid || !gid) return Response.json({ error: "No user or guild" }, { status: 400 });

  const targetOption = inter.data?.options?.find((o) => o.name === "target")?.value as string | undefined;
  const amountOption = inter.data?.options?.find((o) => o.name === "amount")?.value as number | undefined;
  const amount = Math.floor(amountOption || 0);

  if (!targetOption) {
    return Response.json({
      type: 4,
      data: { content: "❌ Укажите цель награды (@упоминание)!", flags: 64 },
    });
  }
  if (targetOption === uid) {
    return Response.json({
      type: 4,
      data: { content: "❌ Нельзя назначить награду за самого себя!", flags: 64 },
    });
  }
  if (amount < BOUNTY_MIN_AMOUNT || amount > BOUNTY_MAX_AMOUNT) {
    return Response.json({
      type: 4,
      data: { content: `❌ Награда должна быть от **${BOUNTY_MIN_AMOUNT}** до **${BOUNTY_MAX_AMOUNT}** монет!`, flags: 64 },
    });
  }

  ctx.waitUntil(
    (async () => {
      const webhookUrl = `https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${inter.token}/messages/@original`;
      try {
        const db = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });
        await ensureBountiesTable(db);

        const deduct = await db.execute({
          sql: 'UPDATE users SET coins = coins - ? WHERE user_id = ? AND guild_id = ? AND coins >= ?',
          args: [amount, uid, gid, amount],
        });
        if (!deduct.rowsAffected) {
          await fetch(webhookUrl, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content: `❌ Недостаточно монет! Нужно **${amount} 🪙**.` }),
          });
          return;
        }

        await db.execute({
          sql: `INSERT INTO bounties (target_id, guild_id, reward, hunter_id, status, created_at) VALUES (?, ?, ?, ?, 'active', ?)`,
          args: [targetOption, gid, amount, uid, Date.now()],
        });

        const bankRes = await db.execute({
          sql: "SELECT COALESCE(SUM(reward), 0) as total FROM bounties WHERE guild_id = ? AND target_id = ? AND status = 'active'",
          args: [gid, targetOption],
        });
        const totalBank = (bankRes.rows[0]?.total as number) || amount;

        const embed = {
          embeds: [{
            title: "🎯 НАГРАДА ЗА ГОЛОВУ!",
            description: `**<@${uid}>** назначает награду за голову **<@${targetOption}>**!\n\n💰 Награда: **${amount} 🪙**\n🏦 Общий банк за цель: **${totalBank} 🪙**\n\n*Победи цель в дуэли (/duel) — и весь банк твой!*`,
            color: 0xE67E22,
            footer: { text: "Охота открыта. Дуэлянты, за дело!" },
          }],
        };

        await fetch(webhookUrl, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(embed),
        });
      } catch (err) {
        console.error("[Bounty] Error:", err);
      }
    })()
  );
  return Response.json({ type: 5 });
}

export async function claimBounties(db: any, gid: string, killerId: string, victimId: string): Promise<{ total: number; count: number }> {
  try {
    const sumRes = await db.execute({
      sql: "SELECT COALESCE(SUM(reward), 0) as total, COUNT(*) as cnt FROM bounties WHERE guild_id = ? AND target_id = ? AND status = 'active'",
      args: [gid, victimId],
    });
    const total = (sumRes.rows[0]?.total as number) || 0;
    if (total <= 0) return { total: 0, count: 0 };

    const upd = await db.execute({
      sql: "UPDATE bounties SET status = 'claimed', hunter_id = ? WHERE guild_id = ? AND target_id = ? AND status = 'active'",
      args: [killerId, gid, victimId],
    });
    if (!upd.rowsAffected) return { total: 0, count: 0 };

    await db.execute({
      sql: 'UPDATE users SET coins = coins + ? WHERE user_id = ? AND guild_id = ?',
      args: [total, killerId, gid],
    });

    return { total, count: upd.rowsAffected || 0 };
  } catch (err) {
    console.error('[Bounty] Error claiming bounties:', err);
    return { total: 0, count: 0 };
  }
}
