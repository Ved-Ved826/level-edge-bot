// Войс-дропы: кнопка airdrop_claim_*.

import { createClient } from "@libsql/client";
import { calculateLevel } from "@shared/types";
import { ButtonInteraction, Env, ExecutionContext } from "../types";
import { unlockAchievement } from "../db/queries";

export async function handleAirdropClaim(
  inter: ButtonInteraction,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
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
  // C5: помечаем дроп как забранный АТОМАРНО — только если claimed_by ещё NULL.
  // Иначе два одновременных клика оба проходят проверку выше (TOCTOU) и оба
  // получают награду; награда выдаётся ТОЛЬКО при успешном клейме.
  const now = Math.floor(Date.now() / 1000);
  const claimResult = await db.execute({
    sql: 'UPDATE air_drops SET claimed_by = ?, claimed_at = ? WHERE id = ? AND claimed_by IS NULL',
    args: [clickedUserId, now, dropId],
  });
  if (!claimResult.rowsAffected) {
    return Response.json({
      type: 4,
      data: { content: "❌ Этот дроп уже успел забрать кто-то другой!", flags: 64 },
    });
  }
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
