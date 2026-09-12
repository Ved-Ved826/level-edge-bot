// Хелперы запросов к Turso (libSQL): пользователи, монеты, дуэли, инвентарь, рынок, квесты.

import { calculateLevel } from "@shared/types";
import { ACHIEVEMENTS_LIST, Achievement } from "../data/achievements";
import { DEFAULT_QUESTS } from "../data/quests";
import { getVladivostokDate } from "../utils/formatters";

export async function unlockAchievement(
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

export async function ensureColumnExists(db: any, table: string, column: string, definition: string): Promise<void> {
  try {
    await db.execute({ sql: `ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`, args: [] });
  } catch (err) {
    // Колонка уже существует — это нормально, игнорируем ошибку
  }
}

export async function getInventoryItem(db: any, itemId: number, userId: string, guildId: string): Promise<any | null> {
  const res = await db.execute({
    sql: 'SELECT * FROM user_inventory WHERE id = ? AND user_id = ? AND guild_id = ?',
    args: [itemId, userId, guildId],
  });
  return res.rows.length > 0 ? res.rows[0] : null;
}

export async function getInventoryItemByItemId(db: any, itemId: string, guildId: string): Promise<any | null> {
  const res = await db.execute({
    sql: 'SELECT * FROM user_inventory WHERE item_id = ? AND guild_id = ?',
    args: [itemId, guildId],
  });
  return res.rows.length > 0 ? res.rows[0] : null;
}

export async function getUserInventory(db: any, userId: string, guildId: string, page: number = 1, pageSize: number = 6): Promise<{ items: any[]; total: number; page: number; maxPages: number }> {
  const totalRes = await db.execute({
    sql: 'SELECT COUNT(*) as total FROM user_inventory WHERE user_id = ? AND guild_id = ?',
    args: [userId, guildId],
  });
  const total = (totalRes.rows[0]?.total as number) || 0;
  const maxPages = Math.ceil(total / pageSize) || 1;
  const safePage = Math.max(1, Math.min(page, maxPages));
  const offset = (safePage - 1) * pageSize;
  const itemsRes = await db.execute({
    sql: 'SELECT * FROM user_inventory WHERE user_id = ? AND guild_id = ? ORDER BY rarity DESC, atk_bonus + def_bonus + crit_bonus + coin_bonus DESC LIMIT ? OFFSET ?',
    args: [userId, guildId, pageSize, offset],
  });
  return { items: itemsRes.rows, total, page: safePage, maxPages };
}

export async function getUserGear(db: any, userId: string, guildId: string): Promise<{
  weapon: any;
  armor: any;
  ring: any;
  amulet: any;
  totalAtk: number;
  totalDef: number;
  totalCrit: number;
  totalCoin: number;
}> {
  const gear: any = { weapon: null, armor: null, ring: null, amulet: null };
  let totalAtk = 0;
  let totalDef = 0;
  let totalCrit = 0;
  let totalCoin = 0;
  const slots = ['weapon', 'armor', 'ring', 'amulet'] as const;
  const placeholders = slots.map(() => '?').join(', ');
  const res = await db.execute({
    sql: `SELECT * FROM user_inventory WHERE user_id = ? AND guild_id = ? AND slot IN (${placeholders}) AND is_equipped = 1`,
    args: [userId, guildId, ...slots],
  });
  for (const row of res.rows) {
    const slot = row.slot as string;
    if (gear.hasOwnProperty(slot)) {
      gear[slot] = row;
      totalAtk += (row.atk_bonus as number) || 0;
      totalDef += (row.def_bonus as number) || 0;
      totalCrit += (row.crit_bonus as number) || 0;
      totalCoin += (row.coin_bonus as number) || 0;
    }
  }
  return { ...gear, totalAtk, totalDef, totalCrit, totalCoin };
}

export async function getMarketListings(db: any, guildId: string, page: number = 1, pageSize: number = 10): Promise<{ listings: any[]; total: number; page: number; maxPages: number }> {
  const totalRes = await db.execute({
    sql: 'SELECT COUNT(*) as total FROM market_listings WHERE guild_id = ?',
    args: [guildId],
  });
  const total = (totalRes.rows[0]?.total as number) || 0;
  const maxPages = Math.ceil(total / pageSize) || 1;
  const safePage = Math.max(1, Math.min(page, maxPages));
  const offset = (safePage - 1) * pageSize;
  const listingsRes = await db.execute({
    sql: 'SELECT ml.*, ui.item_name, ui.rarity, ui.slot, ui.atk_bonus, ui.def_bonus, ui.crit_bonus, ui.coin_bonus FROM market_listings ml JOIN user_inventory ui ON ml.inventory_id = ui.id WHERE ml.guild_id = ? ORDER BY ml.created_at DESC LIMIT ? OFFSET ?',
    args: [guildId, pageSize, offset],
  });
  return { listings: listingsRes.rows, total, page: safePage, maxPages };
}

export async function addMarketListing(db: any, guildId: string, sellerId: string, inventoryId: number, price: number): Promise<number> {
  const now = Math.floor(Date.now() / 1000);
  await db.execute({
    sql: 'INSERT INTO market_listings (guild_id, seller_id, inventory_id, price, created_at) VALUES (?, ?, ?, ?, ?)',
    args: [guildId, sellerId, inventoryId, price, now],
  });
  // Get last inserted row id using SELECT
  const res = await db.execute({ sql: 'SELECT last_insert_rowid() as id' });
  return (res.rows[0]?.id as number) || 0;
}

export async function isItemUniqueOnServer(db: any, itemId: string, guildId: string): Promise<boolean> {
  const res = await db.execute({
    sql: 'SELECT COUNT(*) as count FROM user_inventory WHERE item_id = ? AND guild_id = ? AND item_id != \'junk\'',
    args: [itemId, guildId],
  });
  const count = (res.rows[0]?.count as number) || 0;
  return count === 0;
}

export async function ensureQuestsPool(db: any): Promise<void> {
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

export async function ensureDailyQuests(db: any, guildId: string): Promise<boolean> {
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

export async function getUserDailyActivity(db: any, userId: string, guildId: string): Promise<{ messages_count: number; voice_seconds: number }> {
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

export async function getUserQuestProgress(db: any, userId: string, guildId: string): Promise<{ completed: number; total: number; quests: any[] }> {
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

export async function checkUserExists(db: any, userId: string, guildId: string): Promise<boolean> {
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

export async function getUserXp(db: any, userId: string, guildId: string): Promise<number> {
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

export async function getUserCoins(db: any, userId: string, guildId: string): Promise<number> {
  try {
    const res = await db.execute({
      sql: "SELECT coins FROM users WHERE user_id = ? AND guild_id = ?",
      args: [userId, guildId],
    });
    if (res.rows.length === 0) return 0;
    return (res.rows[0].coins as number) || 0;
  } catch (err) {
    console.error("[Duel] Error getting coins:", err);
    return 0;
  }
}

export async function updateCoins(db: any, userId: string, guildId: string, coinChange: number): Promise<number> {
  try {
    const res = await db.execute({
      sql: "SELECT coins FROM users WHERE user_id = ? AND guild_id = ?",
      args: [userId, guildId],
    });
    if (res.rows.length === 0) return 0;
    const currentCoins = (res.rows[0].coins as number) || 0;
    const newCoins = currentCoins + coinChange;
    const finalCoins = Math.max(0, newCoins);
    await db.execute({
      sql: "UPDATE users SET coins = ? WHERE user_id = ? AND guild_id = ?",
      args: [finalCoins, userId, guildId],
    });
    return finalCoins;
  } catch (err) {
    console.error("[Duel] Error updating coins:", err);
    return 0;
  }
}

export async function updateXpAndLevel(db: any, userId: string, guildId: string, xpChange: number): Promise<number> {
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

export async function createDuelRecord(db: any, duelId: string, guildId: string, challengerId: string, opponentId: string, betAmount: number): Promise<boolean> {
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

export async function getDuelById(db: any, duelId: string): Promise<any> {
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

export async function updateDuelStatus(db: any, duelId: string, status: "accepted" | "declined" | "completed"): Promise<boolean> {
  try {
    // C3: атомарный перевод статуса — только из 'pending'. Повторный клик по Accept
    // (или параллельный запрос) не пройдёт, значит двойной выплаты winnerProfit не будет.
    const res = await db.execute({
      sql: "UPDATE duels SET status = ? WHERE id = ? AND status = 'pending'",
      args: [status, duelId],
    });
    return ((res.rowsAffected as number) || 0) > 0;
  } catch (err) {
    console.error("[Duel] Error updating status:", err);
    return false;
  }
}
