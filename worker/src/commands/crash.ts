import { createClient } from "@libsql/client/web";
import { ButtonInteraction, CommandInteraction, Env, ExecutionContext } from "../types";
import { ensureColumnExists } from "../db/queries";

const CRASH_MIN_BET = 5;
const CRASH_MAX_BET = 30;
const CRASH_COOLDOWN_MS = 60 * 60 * 1000;
const MULT_PER_SECOND = 0.2;

export async function handleCrash(
  inter: CommandInteraction,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const uid = inter.member?.user.id;
  const gid = inter.guild_id;
  if (!uid || !gid) return Response.json({ error: "No user or guild" }, { status: 400 });

  const betOption = inter.data?.options?.find((o) => o.name === "bet")?.value as number;
  const bet = Math.floor(betOption || 0);
  if (bet < CRASH_MIN_BET || bet > CRASH_MAX_BET) {
    return Response.json({
      type: 4,
      data: { content: `❌ Ставка должна быть от **${CRASH_MIN_BET}** до **${CRASH_MAX_BET}** монет!`, flags: 64 },
    });
  }

  const db = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });
  await ensureColumnExists(db, 'users', 'last_crash_at', 'INTEGER DEFAULT 0');

  const userRes = await db.execute({
    sql: 'SELECT coins, last_crash_at FROM users WHERE user_id = ? AND guild_id = ?',
    args: [uid, gid],
  });
  if (userRes.rows.length === 0) {
    return Response.json({
      type: 4,
      data: { content: "❌ Данные пользователя не найдены.", flags: 64 },
    });
  }
  const coins = (userRes.rows[0].coins as number) || 0;
  const lastCrashAt = (userRes.rows[0].last_crash_at as number) || 0;
  const now = Date.now();
  const timeSinceCrash = now - lastCrashAt;
  if (lastCrashAt > 0 && timeSinceCrash < CRASH_COOLDOWN_MS) {
    const remainingMs = CRASH_COOLDOWN_MS - timeSinceCrash;
    const remM = Math.floor(remainingMs / 60000);
    const remS = Math.floor((remainingMs % 60000) / 1000);
    return Response.json({
      type: 4,
      data: { content: `⏳ Ракета на заправке! Следующий запуск через **${remM} мин. ${remS} сек.**`, flags: 64 },
    });
  }
  if (coins < bet) {
    return Response.json({
      type: 4,
      data: { content: `❌ Недостаточно монет! Ставка: **${bet} 🪙**, баланс: **${coins} 🪙**.`, flags: 64 },
    });
  }

  await db.execute({
    sql: `CREATE TABLE IF NOT EXISTS crash_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      guild_id TEXT NOT NULL,
      bet INTEGER NOT NULL,
      crash_point REAL NOT NULL,
      started_at INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'open'
    )`,
    args: [],
  });

  const crashPoint = Math.round((1.1 + Math.random() * 3.9) * 100) / 100;

  await db.execute({
    sql: 'UPDATE users SET coins = coins - ?, last_crash_at = ? WHERE user_id = ? AND guild_id = ?',
    args: [bet, now, uid, gid],
  });

  await db.execute({
    sql: `INSERT INTO crash_sessions (user_id, guild_id, bet, crash_point, started_at, status) VALUES (?, ?, ?, ?, ?, 'open')`,
    args: [uid, gid, bet, crashPoint, now],
  });
  const idResult = await db.execute({ sql: 'SELECT last_insert_rowid() as id', args: [] });
  const sessionId = (idResult.rows[0]?.id as number) || 0;

  ctx.waitUntil(
    (async () => {
      const webhookUrl = `https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${inter.token}/messages/@original`;
      try {
        const embed = {
          embeds: [{
            title: "🚀 КРАШ-РАКЕТА ЗАПУЩЕНА!",
            description: `Пилот: **<@${uid}>** | Ставка: **${bet} 🪙**\n\n📈 Множитель растёт: **+0.20x в секунду** (старт с 1.00x)\n💥 Точка взрыва: засекречена (от **1.10x** до **5.00x**)\n\nУспей нажать «💸 Забрать выигрыш» ДО взрыва — иначе ставка сгорит!`,
            color: 0xE67E22,
            footer: { text: `Сессия #${sessionId} • Взлёт: ${new Date(now).toLocaleTimeString("ru-RU")}` },
          }],
          components: [
            {
              type: 1,
              components: [
                { type: 2, custom_id: `crash_cash_${sessionId}_${uid}`, style: 3, label: "💸 Забрать выигрыш" },
              ],
            },
          ],
        };
        await fetch(webhookUrl, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(embed),
        });
      } catch (err) {
        console.error("[Crash] Error:", err);
      }
    })()
  );
  return Response.json({ type: 5 });
}

export async function handleCrashCashout(
  inter: ButtonInteraction,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const clickerId = inter.member?.user.id;
  const gid = inter.guild_id;
  if (!clickerId || !gid) return Response.json({ error: "No user or guild" }, { status: 400 });

  const parts = inter.data.custom_id.split("_");
  if (parts.length < 4 || parts[0] !== "crash" || parts[1] !== "cash") {
    return Response.json({ error: "Bad custom_id" }, { status: 400 });
  }
  const sessionId = Number(parts[2]);
  const ownerId = parts[3];
  if (!sessionId || Number.isNaN(sessionId)) {
    return Response.json({
      type: 4,
      data: { content: "❌ Сессия краша не найдена.", flags: 64 },
    });
  }
  if (clickerId !== ownerId) {
    return Response.json({
      type: 4,
      data: { content: "🚫 Это чужая ракета! Запусти свою: /crash", flags: 64 },
    });
  }

  const db = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });

  const sessionRes = await db.execute({
    sql: 'SELECT * FROM crash_sessions WHERE id = ?',
    args: [sessionId],
  });
  if (sessionRes.rows.length === 0 || (sessionRes.rows[0].status as string) !== 'open') {
    return Response.json({
      type: 4,
      data: { content: "💥 Эта ракета уже разыграна!", flags: 64 },
    });
  }

  const session = sessionRes.rows[0];
  const bet = (session.bet as number) || 0;
  const crashPoint = (session.crash_point as number) || 1.1;
  const startedAt = (session.started_at as number) || Date.now();

  const elapsedSec = Math.max(0, (Date.now() - startedAt) / 1000);
  const multiplier = Math.floor((1 + elapsedSec * MULT_PER_SECOND) * 100) / 100;
  const exploded = multiplier >= crashPoint;
  const payout = exploded ? 0 : Math.round(bet * multiplier);

  const claim = await db.execute({
    sql: "UPDATE crash_sessions SET status = ? WHERE id = ? AND status = 'open'",
    args: [exploded ? 'lost' : 'won', sessionId],
  });
  if (!claim.rowsAffected) {
    return Response.json({
      type: 4,
      data: { content: "💥 Эта ракета уже разыграна!", flags: 64 },
    });
  }

  if (payout > 0) {
    await db.execute({
      sql: 'UPDATE users SET coins = coins + ? WHERE user_id = ? AND guild_id = ?',
      args: [payout, clickerId, gid],
    });
  }

  const resultText = exploded
    ? `💥 **ВЗРЫВ НА ${crashPoint.toFixed(2)}x!**\nВы не успели — ставка **${bet} 🪙** сгорела в пламени ракеты.`
    : `✅ **Забрано на ${multiplier.toFixed(2)}x!**\nВыплата: **+${payout} 🪙** (прибыль: **+${payout - bet} 🪙**).`;

  ctx.waitUntil(
    (async () => {
      try {
        const channelId = inter.channel_id;
        const messageId = (inter as any).message?.id;
        if (!channelId || !messageId || !env.DISCORD_BOT_TOKEN) return;

        const finalEmbed = exploded
          ? {
              embeds: [{
                title: "💥 РАКЕТА ВЗОРВАЛАСЬ!",
                description: `Пилот **<@${clickerId}>** не успел — взрыв на **${crashPoint.toFixed(2)}x**.\nСтавка **${bet} 🪙** сгорела.`,
                color: 0xE74C3C,
              }],
              components: [],
            }
          : {
              embeds: [{
                title: "🏁 УСПЕШНАЯ ПОСАДКА!",
                description: `Пилот **<@${clickerId}>** забрал на **${multiplier.toFixed(2)}x**: **+${payout} 🪙** (ставка ${bet} 🪙).\nВзрыв случился бы на ${crashPoint.toFixed(2)}x.`,
                color: 0x2ECC71,
              }],
              components: [],
            };

        await fetch(`https://discord.com/api/v10/channels/${channelId}/messages/${messageId}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bot ${env.DISCORD_BOT_TOKEN}`,
          },
          body: JSON.stringify(finalEmbed),
        });
      } catch (err) {
        console.error("[Crash] Finalize error:", err);
      }
    })()
  );

  return Response.json({
    type: 4,
    data: { content: resultText, flags: 64 },
  });
}
