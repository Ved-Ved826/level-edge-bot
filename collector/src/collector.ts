import { Client, GatewayIntentBits, Message, VoiceState } from 'discord.js';
import { createClient } from '@libsql/client';
import 'dotenv/config';

import http from 'node:http';

// Микро-сервер для прохождения Healthcheck на Koyeb
const PORT = process.env.PORT || 8000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Collector is running!');
}).listen(PORT, () => {
  console.log(`[Healthcheck] Listening on port ${PORT}`);
});

// ============================================
// Пул квестов (дублировано для collector, избегаем tsconfig issues)
// ============================================
interface QuestTemplate {
  id: string;
  title: string;
  desc: string;
  type: 'messages' | 'voice' | 'combo';
  target: number;
  xp: number;
}

const QUESTS_POOL: QuestTemplate[] = [
  // Текстовые квесты
  { id: 'messages_warmup_10_50xp', title: 'Разминка пальцев', desc: '10 сообщений', type: 'messages', target: 10, xp: 50 },
  { id: 'messages_active_30_150xp', title: 'Активный спикер', desc: '30 сообщений', type: 'messages', target: 30, xp: 150 },
  { id: 'messages_god_60_300xp', title: 'Гроза чата', desc: '60 сообщений', type: 'messages', target: 60, xp: 300 },
  { id: 'messages_wall_100_500xp', title: 'Стена текста', desc: '100 сообщений', type: 'messages', target: 100, xp: 500 },
  { id: 'messages_long_20_100xp', title: 'Философ', desc: '20 сообщений > 100 символов', type: 'messages', target: 20, xp: 100 },
  // Голосовые квесты
  { id: 'voice_peep_15_100xp', title: 'Заглянул на огонек', desc: '15 минут в войсе', type: 'voice', target: 15, xp: 100 },
  { id: 'voice_deep_45_250xp', title: 'Душевный разговор', desc: '45 минут в войсе', type: 'voice', target: 45, xp: 250 },
  { id: 'voice_marathon_90_450xp', title: 'Войс-марафон', desc: '90 минут в войсе', type: 'voice', target: 90, xp: 450 },
  { id: 'voice_host_150_750xp', title: 'Хозяин эфира', desc: '150 минут в войсе', type: 'voice', target: 150, xp: 750 },
  { id: 'voice_night_30_200xp', title: 'Ночной дозор', desc: '30 минут после 00:00 UTC', type: 'voice', target: 30, xp: 200 },
  // Комбо и особые
  { id: 'combo_double_25_25_300xp', title: 'Двойной удар', desc: '25 сообщ. + 25 мин войса', type: 'combo', target: 25, xp: 300 },
  { id: 'combo_morning_15_100xp', title: 'Утренний кофе', desc: '15 сообщений (06:00-12:00)', type: 'messages', target: 15, xp: 100 },
  { id: 'combo_night_10_20_150xp', title: 'Совместное усилие', desc: '10 сообщ. + 20 мин войса', type: 'combo', target: 10, xp: 150 },
  { id: 'combo_balance_50_50_400xp', title: 'Баланс', desc: '50 сообщ. + 50 мин войса', type: 'combo', target: 50, xp: 400 },
  { id: 'combo_super_100_100_800xp', title: 'Ирония судьбы', desc: '100 сообщ. + 100 мин войса', type: 'combo', target: 100, xp: 800 },
];

// Re-export from shared types (duplicate for collector to avoid tsconfig issues)
const calculateLevel = (xp: number): number => {
  return Math.floor(0.1 * Math.sqrt(xp));
};

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers,
  ],
});

const db = createClient({
  url: process.env.DATABASE_URL || 'libsql://localhost',
  authToken: process.env.DATABASE_AUTH_TOKEN,
});

// Проверка и обновление схемы БД при старте
async function migrateSchema() {
  try {
    // Проверка наличия колонки level (в старых версиях её могло не быть)
    const levelCheck = await db.execute({
      sql: "PRAGMA table_info(users)",
      args: [],
    });

    const columns = (levelCheck.rows || []).map((row: any) => row.name as string);

    if (!columns.includes('level')) {
      await db.execute({
        sql: 'ALTER TABLE users ADD COLUMN level INTEGER NOT NULL DEFAULT 0',
        args: [],
      });
      console.log('[Migrate] Added column: level');
    }

    if (!columns.includes('last_message_at')) {
      await db.execute({
        sql: 'ALTER TABLE users ADD COLUMN last_message_at INTEGER DEFAULT 0',
        args: [],
      });
      console.log('[Migrate] Added column: last_message_at');
    }

    if (!columns.includes('voice_joined_at')) {
      await db.execute({
        sql: 'ALTER TABLE users ADD COLUMN voice_joined_at INTEGER',
        args: [],
      });
      console.log('[Migrate] Added column: voice_joined_at');
    }

    if (!columns.includes('voice_segment_muted')) {
      await db.execute({
        sql: 'ALTER TABLE users ADD COLUMN voice_segment_muted INTEGER NOT NULL DEFAULT 0',
        args: [],
      });
      console.log('[Migrate] Added column: voice_segment_muted');
    }

    // ============================================
    // Миграция 003: Колонки для стриков активности (Этап 2)
    // ============================================
    if (!columns.includes('streak_days')) {
      await db.execute({
        sql: 'ALTER TABLE users ADD COLUMN streak_days INTEGER NOT NULL DEFAULT 0',
        args: [],
      });
      console.log('[Migrate] Added column: streak_days');
    }

    if (!columns.includes('last_streak_date')) {
      await db.execute({
        sql: 'ALTER TABLE users ADD COLUMN last_streak_date TEXT DEFAULT NULL',
        args: [],
      });
      console.log('[Migrate] Added column: last_streak_date');
    }

    if (!columns.includes('streak_freezes')) {
      await db.execute({
        sql: 'ALTER TABLE users ADD COLUMN streak_freezes INTEGER NOT NULL DEFAULT 0',
        args: [],
      });
      console.log('[Migrate] Added column: streak_freezes');
    }

    // ============================================
    // Миграция 002: Таблицы ежедневной активности и квестов
    // ============================================
    const dailyActivityCheck = await db.execute({
      sql: "SELECT name FROM sqlite_master WHERE type='table' AND name='user_daily_activity'",
      args: [],
    });

    if (dailyActivityCheck.rows.length === 0) {
      await db.execute({
        sql: `CREATE TABLE user_daily_activity (
          user_id TEXT NOT NULL,
          guild_id TEXT NOT NULL,
          activity_date TEXT NOT NULL,
          messages_count INTEGER NOT NULL DEFAULT 0,
          voice_seconds INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (user_id, guild_id, activity_date)
        )`,
        args: [],
      });
      console.log('[Migrate] Created table: user_daily_activity');
    }

    const questsPoolCheck = await db.execute({
      sql: "SELECT name FROM sqlite_master WHERE type='table' AND name='quests_pool'",
      args: [],
    });

    if (questsPoolCheck.rows.length === 0) {
      await db.execute({
        sql: `CREATE TABLE quests_pool (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          description TEXT NOT NULL,
          quest_type TEXT NOT NULL,
          target_value INTEGER NOT NULL,
          reward_xp INTEGER NOT NULL,
          is_active INTEGER NOT NULL DEFAULT 1
        )`,
        args: [],
      });
      console.log('[Migrate] Created table: quests_pool');
    }

    const questsDailyCheck = await db.execute({
      sql: "SELECT name FROM sqlite_master WHERE type='table' AND name='quests_daily'",
      args: [],
    });

    if (questsDailyCheck.rows.length === 0) {
      await db.execute({
        sql: `CREATE TABLE quests_daily (
          id TEXT PRIMARY KEY,
          guild_id TEXT NOT NULL,
          quest_id TEXT NOT NULL,
          active_date TEXT NOT NULL,
          target INTEGER NOT NULL,
          reward_xp INTEGER NOT NULL
        )`,
        args: [],
      });
      console.log('[Migrate] Created table: quests_daily');
    }

    const userQuestProgressCheck = await db.execute({
      sql: "SELECT name FROM sqlite_master WHERE type='table' AND name='user_quest_progress'",
      args: [],
    });

    if (userQuestProgressCheck.rows.length === 0) {
      await db.execute({
        sql: `CREATE TABLE user_quest_progress (
          user_id TEXT NOT NULL,
          guild_id TEXT NOT NULL,
          quest_daily_id TEXT NOT NULL,
          current_progress INTEGER NOT NULL DEFAULT 0,
          completed_at INTEGER DEFAULT NULL,
          PRIMARY KEY (user_id, guild_id, quest_daily_id)
        )`,
        args: [],
      });
      console.log('[Migrate] Created table: user_quest_progress');
    }

    // Проверка таблицы guild_settings
    const settingsCheck = await db.execute({
      sql: "SELECT name FROM sqlite_master WHERE type='table' AND name='guild_settings'",
      args: [],
    });

    if (settingsCheck.rows.length === 0) {
      await db.execute({
        sql: `CREATE TABLE guild_settings (
          guild_id TEXT PRIMARY KEY,
          xp_per_message INTEGER NOT NULL DEFAULT 15,
          message_cooldown_seconds INTEGER NOT NULL DEFAULT 30
        )`,
        args: [],
      });
      console.log('[Migrate] Created table: guild_settings');
    }
  } catch (err) {
    console.error('[Migrate] Error during schema migration:', err);
  }
}

// ============================================
// Функции для работы с квестами и ежедневной активностью
// ============================================

// Получение текущей даты по времени Владивостока (UTC+10, 00:00 сброс)
function getVladivostokDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Vladivostok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

// ============================================
// Функции для работы со стриками активности (Этап 2)
// ============================================

// Вычисление множителя XP от длины стрика
function getXpMultiplier(streakDays: number): number {
  if (streakDays >= 30) return 1.25;  // +25%
  if (streakDays >= 14) return 1.15;  // +15%
  if (streakDays >= 7) return 1.10;   // +10%
  if (streakDays >= 3) return 1.05;   // +5%
  return 1.0;
}

// Проверка условий для активности пользователя (для стрика)
function checkActivityCondition(activity: { messages_count: number; voice_seconds: number }, questCompleted: boolean): boolean {
  // Условия: 20+ сообщений ИЛИ 15+ минут (900 секунд) в войсе ИЛИ закрыт хотя бы 1 квест
  return activity.messages_count >= 20 || activity.voice_seconds >= 900 || questCompleted;
}

// Получение данных для проверки стрика (активность + квесты)
async function getUserStreakData(db: any, userId: string, guildId: string): Promise<{ activity: any; questCompleted: boolean }> {
  const today = getVladivostokDate();

  // Получаем ежедневную активность
  const activityResult = await db.execute({
    sql: 'SELECT messages_count, voice_seconds FROM user_daily_activity WHERE user_id = ? AND guild_id = ? AND activity_date = ?',
    args: [userId, guildId, today],
  });

  const activity = activityResult.rows.length > 0
    ? { messages_count: (activityResult.rows[0].messages_count as number) || 0, voice_seconds: (activityResult.rows[0].voice_seconds as number) || 0 }
    : { messages_count: 0, voice_seconds: 0 };

  // Проверяем, закрыт ли хотя бы 1 квест сегодня
  const questResult = await db.execute({
    sql: 'SELECT COUNT(*) as completed FROM user_quest_progress WHERE user_id = ? AND guild_id = ? AND completed_at IS NOT NULL',
    args: [userId, guildId],
  });

  const questCompleted = (questResult.rows[0]?.completed as number) > 0;

  return { activity, questCompleted };
}

// Обновление стрика пользователя
async function updateUserStreak(db: any, userId: string, guildId: string): Promise<{ streakDays: number; streakFreezes: number; updated: boolean }> {
  const today = getVladivostokDate();

  try {
    // Получаем текущие данные пользователя
    const userResult = await db.execute({
      sql: 'SELECT streak_days, last_streak_date, streak_freezes FROM users WHERE user_id = ? AND guild_id = ?',
      args: [userId, guildId],
    });

    if (userResult.rows.length === 0) {
      // Пользователь не найден - создаём запись с дефолтными значениями
      await db.execute({
        sql: 'UPDATE users SET streak_days = 1, last_streak_date = ? WHERE user_id = ? AND guild_id = ?',
        args: [today, userId, guildId],
      });
      return { streakDays: 1, streakFreezes: 0, updated: true };
    }

    const userRow = userResult.rows[0];
    let streakDays = (userRow.streak_days as number) || 0;
    const lastStreakDate = userRow.last_streak_date as string | null;
    let streakFreezes = (userRow.streak_freezes as number) || 0;

    // Если сегодня уже обновляли стрик - ничего не делаем
    if (lastStreakDate === today) {
      return { streakDays, streakFreezes, updated: false };
    }

    // Получаем данные для проверки активности
    const { activity, questCompleted } = await getUserStreakData(db, userId, guildId);

    // Проверяем условие активности
    if (!checkActivityCondition(activity, questCompleted)) {
      // Условие не выполнено - сброс стрика
      await db.execute({
        sql: 'UPDATE users SET streak_days = 1, last_streak_date = ? WHERE user_id = ? AND guild_id = ?',
        args: [today, userId, guildId],
      });
      return { streakDays: 1, streakFreezes, updated: true };
    }

    // Пользователь активен - проверяем разницу с вчерашним днём
    let newStreakDays = streakDays;
    let needUpdate = false;

    if (lastStreakDate === null) {
      // Первый день активности
      newStreakDays = 1;
      needUpdate = true;
    } else {
      // Вычисляем разницу в днях между today и last_streak_date
      // Формат даты: YYYY-MM-DD
      const todayParts = today.split('-').map(Number);
      const lastParts = lastStreakDate.split('-').map(Number);

      const todayDate = new Date(todayParts[0], todayParts[1] - 1, todayParts[2]);
      const lastDate = new Date(lastParts[0], lastParts[1] - 1, lastParts[2]);

      const diffTime = todayDate.getTime() - lastDate.getTime();
      const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

      if (diffDays === 1) {
        // Вчера был последний день стрика - продолжаем
        newStreakDays = streakDays + 1;
        needUpdate = true;
      } else if (diffDays > 1) {
        // Прошло 2+ дня - проверяем заморозки
        if (streakFreezes > 0) {
          // Есть заморозка - тратим её и сохраняем стрик
          streakFreezes -= 1;
          needUpdate = true;
          console.log(`[Streak] User ${userId} used freeze to preserve streak`);
        } else {
          // Нет заморозки - сброс
          newStreakDays = 1;
          needUpdate = true;
        }
      }
      // Если diffDays === 0 (уже обновляли сегодня) - ничего не делаем
    }

    if (needUpdate) {
      await db.execute({
        sql: 'UPDATE users SET streak_days = ?, last_streak_date = ?, streak_freezes = ? WHERE user_id = ? AND guild_id = ?',
        args: [newStreakDays, today, streakFreezes, userId, guildId],
      });
    }

    return { streakDays: newStreakDays, streakFreezes, updated: needUpdate };
  } catch (err) {
    console.error('[Streak] Error updating streak:', err);
    return { streakDays: 0, streakFreezes: 0, updated: false };
  }
}

// Начисление XP с множителем стрика
async function awardXpWithStreak(db: any, userId: string, guildId: string, baseXp: number): Promise<number> {
  // Сначала обновляем стрик
  const { streakDays } = await updateUserStreak(db, userId, guildId);

  // Применяем множитель
  const multiplier = getXpMultiplier(streakDays);
  const finalXp = Math.round(baseXp * multiplier);

  await db.execute({
    sql: 'UPDATE users SET xp = xp + ? WHERE user_id = ? AND guild_id = ?',
    args: [finalXp, userId, guildId],
  });

  console.log(`[Streak] User ${userId} received ${baseXp} XP x${multiplier} = ${finalXp} XP (streak: ${streakDays} days)`);

  return finalXp;
}

// Инициализация пула квестов в БД
async function ensureQuestsPool(db: any): Promise<void> {
  try {
    const checkResult = await db.execute({
      sql: 'SELECT COUNT(*) as count FROM quests_pool',
      args: [],
    });
    const count = (checkResult.rows[0]?.count as number) || 0;

    if (count === 0) {
      console.log('[Quests] Pool is empty, initializing...');
      const placeholders = QUESTS_POOL.map(() => '(?, ?, ?, ?, ?, ?, ?)').join(', ');
      const values = QUESTS_POOL.flatMap(q => [
        q.id,
        q.title,
        q.desc,
        q.type === 'combo' ? 'messages' : q.type, // Для combo используем messages как базовый тип
        q.target,
        q.xp,
        1
      ]);

      await db.execute({
        sql: `INSERT INTO quests_pool (id, title, description, quest_type, target_value, reward_xp, is_active) VALUES ${placeholders}`,
        args: values,
      });
      console.log(`[Quests] Initialized ${QUESTS_POOL.length} quests in pool`);
    }
  } catch (err) {
    console.error('[Quests] Error ensuring pool:', err);
  }
}

// Получение активных квестов гильдии на сегодня
async function getDailyQuests(db: any, guildId: string): Promise<any[]> {
  const today = getVladivostokDate();
  try {
    const result = await db.execute({
      sql: `SELECT qd.*, qp.title, qp.description, qp.quest_type, qp.reward_xp
            FROM quests_daily qd
            JOIN quests_pool qp ON qd.quest_id = qp.id
            WHERE qd.guild_id = ? AND qd.active_date = ?`,
      args: [guildId, today],
    });
    return result.rows || [];
  } catch (err) {
    console.error('[Quests] Error getting daily quests:', err);
    return [];
  }
}

// Генерация ID для daily quest записи
function generateDailyQuestId(guildId: string, questId: string, index: number): string {
  return `${guildId}_${getVladivostokDate()}_${index}`;
}

// Назначение квестов гильдии на сегодня (если не назначены)
async function ensureDailyQuests(db: any, guildId: string): Promise<any[]> {
  const today = getVladivostokDate();
  try {
    // Проверяем, есть ли уже квесты на сегодня
    const existing = await db.execute({
      sql: 'SELECT COUNT(*) as count FROM quests_daily WHERE guild_id = ? AND active_date = ?',
      args: [guildId, today],
    });
    const count = (existing.rows[0]?.count as number) || 0;

    if (count > 0) {
      return getDailyQuests(db, guildId);
    }

    console.log(`[Quests] Assigning daily quests for guild ${guildId}...`);

    // Получаем доступные квесты из пула
    const poolResult = await db.execute({
      sql: 'SELECT * FROM quests_pool WHERE is_active = 1',
      args: [],
    });
    const pool = poolResult.rows || [];

    if (pool.length === 0) {
      console.warn('[Quests] No quests in pool!');
      return [];
    }

    // Выбираем 3-4 случайных квеста:
    // 1 текстовый (messages), 1 голосовой (voice), 1 сложный/комбо
    const messagesQuests = pool.filter((q: any) => q.quest_type === 'messages' && q.quest_type !== 'voice');
    const voiceQuests = pool.filter((q: any) => q.quest_type === 'voice');
    const otherQuests = pool.filter((q: any) => q.quest_type === 'combo' || (q.quest_type !== 'messages' && q.quest_type !== 'voice'));

    const selected: any[] = [];

    // 1 текстовый квест (легкий)
    if (messagesQuests.length > 0) {
      const msg = messagesQuests[Math.floor(Math.random() * messagesQuests.length)];
      selected.push({ ...msg, quest_type: 'messages' });
    }

    // 1 голосовой квест
    if (voiceQuests.length > 0) {
      const vo = voiceQuests[Math.floor(Math.random() * voiceQuests.length)];
      selected.push({ ...vo, quest_type: 'voice' });
    }

    // 1 сложный/комбо квест
    if (otherQuests.length > 0) {
      const oth = otherQuests[Math.floor(Math.random() * otherQuests.length)];
      selected.push({ ...oth, quest_type: oth.quest_type });
    }

    // Вставляем daily quests
    const insertValues: any[] = [];
    const insertPlaceholders: string[] = [];
    selected.forEach((quest, idx) => {
      insertPlaceholders.push('(?, ?, ?, ?, ?)');
      insertValues.push(
        generateDailyQuestId(guildId, quest.id, idx),
        guildId,
        quest.id,
        today,
        quest.target_value || quest.target,
        quest.reward_xp || quest.xp
      );
    });

    if (insertPlaceholders.length > 0) {
      await db.execute({
        sql: `INSERT INTO quests_daily (id, guild_id, quest_id, active_date, target, reward_xp) VALUES ${insertPlaceholders.join(', ')}`,
        args: insertValues,
      });
      console.log(`[Quests] Assigned ${insertPlaceholders.length} quests for guild ${guildId}`);
    }

    return getDailyQuests(db, guildId);
  } catch (err) {
    console.error('[Quests] Error ensuring daily quests:', err);
    return [];
  }
}

// Обновление прогресса квеста пользователя
async function updateQuestProgress(db: any, userId: string, guildId: string, questDailyId: string, increment: number, questType: string): Promise<void> {
  try {
    // UPSERT в прогресс
    const upsertResult = await db.execute({
      sql: `INSERT INTO user_quest_progress (user_id, guild_id, quest_daily_id, current_progress)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(user_id, guild_id, quest_daily_id)
            DO UPDATE SET current_progress = current_progress + ?`,
      args: [userId, guildId, questDailyId, increment, increment],
    });

    // Получаем текущий прогресс и цель
    const progressResult = await db.execute({
      sql: `SELECT uqp.current_progress, uqp.completed_at, qd.target, qd.reward_xp
            FROM user_quest_progress uqp
            JOIN quests_daily qd ON uqp.quest_daily_id = qd.id
            WHERE uqp.user_id = ? AND uqp.guild_id = ? AND uqp.quest_daily_id = ?`,
      args: [userId, guildId, questDailyId],
    });

    if (progressResult.rows.length === 0) return;

    const row = progressResult.rows[0];
    const current = (row.current_progress as number) || 0;
    const completedAt = row.completed_at as number | null;
    const target = (row.target as number) || 0;
    const rewardXp = (row.reward_xp as number) || 0;

    // Если завершен - пропускаем
    if (completedAt !== null) return;

    // Проверяем достижение цели
    if (current >= target) {
      // Начисляем XP
      await db.execute({
        sql: `UPDATE users SET xp = xp + ? WHERE user_id = ? AND guild_id = ?`,
        args: [rewardXp, userId, guildId],
      });

      // Помечаем как выполненный
      await db.execute({
        sql: `UPDATE user_quest_progress SET completed_at = ? WHERE user_id = ? AND guild_id = ? AND quest_daily_id = ?`,
        args: [Date.now(), userId, guildId, questDailyId],
      });

      console.log(`[Quest] User ${userId} completed quest ${questDailyId} - +${rewardXp} XP`);
    }
  } catch (err) {
    console.error('[Quest] Error updating progress:', err);
  }
}

// Обновление ежедневной активности пользователя
async function updateDailyActivity(db: any, userId: string, guildId: string, messages: number, voiceSeconds: number): Promise<void> {
  const today = getVladivostokDate();
  try {
    await db.execute({
      sql: `INSERT INTO user_daily_activity (user_id, guild_id, activity_date, messages_count, voice_seconds)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(user_id, guild_id, activity_date)
            DO UPDATE SET
              messages_count = messages_count + excluded.messages_count,
              voice_seconds = voice_seconds + excluded.voice_seconds`,
      args: [userId, guildId, today, messages, voiceSeconds],
    });
  } catch (err) {
    console.error('[Activity] Error updating daily activity:', err);
  }
}

// Проверка квестов типа messages при создании сообщения
async function checkQuestsForMessage(db: any, userId: string, guildId: string, message: Message): Promise<void> {
  const today = getVladivostokDate();

  try {
    // Получаем активные квесты гильдии на сегодня типа messages
    const questsResult = await db.execute({
      sql: `SELECT qd.*, qp.quest_type
            FROM quests_daily qd
            JOIN quests_pool qp ON qd.quest_id = qp.id
            WHERE qd.guild_id = ? AND qd.active_date = ? AND qp.quest_type IN ('messages', 'combo')`,
      args: [guildId, today],
    });

    const quests = questsResult.rows || [];
    if (quests.length === 0) return;

    // Для квестов типа combo проверяем и голос
    for (const quest of quests) {
      const questDailyId = quest.id as string;
      const questType = quest.quest_type as string;

      if (questType === 'messages') {
        // Обычный текстовый квест - инкремент на 1
        await updateQuestProgress(db, userId, guildId, questDailyId, 1, 'messages');
      } else if (questType === 'combo') {
        // Комбо квест - проверяем текущий прогресс
        // Для combo нужна специальная логика - обновляем на 1, но цель выше
        await updateQuestProgress(db, userId, guildId, questDailyId, 1, 'combo');
      }
    }

    // Проверка квеста "Философ" (сообщения > 100 символов)
    const longTextQuestResult = await db.execute({
      sql: `SELECT qd.id
            FROM quests_daily qd
            JOIN quests_pool qp ON qd.quest_id = qp.id
            WHERE qd.guild_id = ? AND qd.active_date = ? AND qp.id = 'messages_long_20_100xp'`,
      args: [guildId, today],
    });

    if (longTextQuestResult.rows.length > 0 && (message.content?.length || 0) > 100) {
      const questDailyId = longTextQuestResult.rows[0].id as string;
      await updateQuestProgress(db, userId, guildId, questDailyId, 1, 'messages');
    }
  } catch (err) {
    console.error('[Quests] Error checking quests for message:', err);
  }
}

// Проверка квестов типа voice при изменении голосового статуса
async function checkQuestsForVoice(db: any, userId: string, guildId: string, voiceSeconds: number, now: Date): Promise<void> {
  const today = getVladivostokDate();

  try {
    // Получаем активные квесты гильдии на сегодня типа voice
    const questsResult = await db.execute({
      sql: `SELECT qd.*, qp.quest_type
            FROM quests_daily qd
            JOIN quests_pool qp ON qd.quest_id = qp.id
            WHERE qd.guild_id = ? AND qd.active_date = ? AND qp.quest_type IN ('voice', 'combo')`,
      args: [guildId, today],
    });

    const quests = questsResult.rows || [];
    if (quests.length === 0) return;

    // Переводим секунды в минуты
    const voiceMinutes = Math.floor(voiceSeconds / 60);
    if (voiceMinutes === 0) return;

    // Для квестов типа voice и combo инкрементируем по минутам
    for (const quest of quests) {
      const questDailyId = quest.id as string;
      const questType = quest.quest_type as string;

      if (questType === 'voice') {
        // Голосовой квест - инкрементируем по минутам
        await updateQuestProgress(db, userId, guildId, questDailyId, voiceMinutes, 'voice');
      } else if (questType === 'combo') {
        // Комбо квест - инкрементируем по минутам
        await updateQuestProgress(db, userId, guildId, questDailyId, voiceMinutes, 'combo');
      }
    }

    // Проверка квеста "Ночной дозор" (после 00:00 UTC)
    const hour = now.getUTCHours();
    if (hour >= 0 && hour < 6) {
      const nightQuestResult = await db.execute({
        sql: `SELECT qd.id
              FROM quests_daily qd
              JOIN quests_pool qp ON qd.quest_id = qp.id
              WHERE qd.guild_id = ? AND qd.active_date = ? AND qp.id = 'voice_night_30_200xp'`,
        args: [guildId, today],
      });

      if (nightQuestResult.rows.length > 0) {
        const questDailyId = nightQuestResult.rows[0].id as string;
        await updateQuestProgress(db, userId, guildId, questDailyId, voiceMinutes, 'voice');
      }
    }
  } catch (err) {
    console.error('[Quests] Error checking quests for voice:', err);
  }
}

client.on('ready', async () => {
  console.log(`[Collector] Starting migration...`);
  await migrateSchema();

  // Инициализация пула квестов
  await ensureQuestsPool(db);

  console.log(`[Collector] Ready as ${client.user?.tag}`);
  const memUsage = Math.round(process.memoryUsage().rss / 1024 / 1024);
  console.log(`[Memory] RSS: ${memUsage}MB`);
});

client.on('messageCreate', async (message: Message) => {
  if (message.author.bot) return;
  if (!message.guild) return;

  const { author, guild } = message;
  const guildId = guild.id;
  const userId = author.id;
  const today = getVladivostokDate();

  try {
    const now = Date.now();

    // Get user and guild settings
    const userResult = await db.execute({
      sql: 'SELECT * FROM users WHERE user_id = ? AND guild_id = ?',
      args: [userId, guildId],
    });

    const settingsResult = await db.execute({
      sql: 'SELECT * FROM guild_settings WHERE guild_id = ?',
      args: [guildId],
    });

    const xpPerMessage = (settingsResult.rows[0]?.xp_per_message as number) || 15;
    const cooldown = (settingsResult.rows[0]?.message_cooldown_seconds as number) || 30;

    if (userResult.rows.length === 0) {
      // First message from this user
      const newXp = xpPerMessage;
      const newLevel = calculateLevel(newXp);

      await db.execute({
        sql: `INSERT INTO users (user_id, guild_id, xp, level, messages_count, last_message_at)
              VALUES (?, ?, ?, ?, 1, ?)`,
        args: [userId, guildId, newXp, newLevel, Math.floor(now / 1000)],
      });
      console.log(`[Message] New user: ${author.username} (${userId}) in ${guild.name} - XP: ${newXp}, Level: ${newLevel}`);

      // Инициализация ежедневной активности для нового пользователя
      await db.execute({
        sql: `INSERT INTO user_daily_activity (user_id, guild_id, activity_date, messages_count)
              VALUES (?, ?, ?, 1)`,
        args: [userId, guildId, today],
      });
    } else {
      const row = userResult.rows[0];
      const lastMessageAt = (row.last_message_at as number) || 0;
      const timeSinceLastMessage = (now - lastMessageAt * 1000) / 1000;

      let xpToAdd = 0;
      if (timeSinceLastMessage >= cooldown) {
        xpToAdd = xpPerMessage;
      }

      const oldXp = (row.xp as number) || 0;
      const newXp = oldXp + xpToAdd;
      const newLevel = calculateLevel(newXp);

      await db.execute({
        sql: `UPDATE users
              SET xp = ?, level = ?, messages_count = messages_count + 1, last_message_at = ?
              WHERE user_id = ? AND guild_id = ?`,
        args: [newXp, newLevel, Math.floor(now / 1000), userId, guildId],
      });

      // Обновление ежедневной активности
      await db.execute({
        sql: `INSERT INTO user_daily_activity (user_id, guild_id, activity_date, messages_count)
              VALUES (?, ?, ?, 1)
              ON CONFLICT(user_id, guild_id, activity_date)
              DO UPDATE SET messages_count = messages_count + 1`,
        args: [userId, guildId, today],
      });

      if (xpToAdd > 0) {
        console.log(`[Message] ${author.username} - ${xpToAdd} XP (total: ${newXp}, level: ${newLevel})`);
      } else {
        console.log(`[Message] ${author.username} - Cooldown (total messages: ${(row.messages_count as number) + 1})`);
      }

      // Проверка квестов типа messages
      await checkQuestsForMessage(db, userId, guildId, message);
    }

    // Обновление квестов (проверка ежедневных квестов каждые 10 сообщений для оптимизации)
    if (Math.random() < 0.1) {
      await ensureDailyQuests(db, guildId);
    }
  } catch (err) {
    console.error('[Error] messageCreate:', err);
  }
});

client.on('voiceStateUpdate', async (oldState: VoiceState, newState: VoiceState) => {
  const userId = newState.member?.id;
  const { guild } = newState;
  if (!guild || !userId) return;

  const today = getVladivostokDate();

  try {
    const now = Date.now();
    const userResult = await db.execute({
      sql: 'SELECT * FROM users WHERE user_id = ? AND guild_id = ?',
      args: [userId, guild.id],
    });

    if (userResult.rows.length === 0) {
      // Create user entry if doesn't exist
      await db.execute({
        sql: `INSERT INTO users (user_id, guild_id) VALUES (?, ?)`,
        args: [userId, guild.id],
      });
      // Инициализация ежедневной активности для нового пользователя
      await db.execute({
        sql: `INSERT INTO user_daily_activity (user_id, guild_id, activity_date, voice_seconds)
              VALUES (?, ?, ?, 0)`,
        args: [userId, guild.id, today],
      });
    }

    const joinedAtRow = await db.execute({
      sql: 'SELECT voice_joined_at, voice_segment_muted FROM users WHERE user_id = ? AND guild_id = ?',
      args: [userId, guild.id],
    });

    // VOICE JOIN (вход в голосовой канал)
    if (!oldState.channelId && newState.channelId) {
      const isMuted = newState.selfDeaf && newState.selfMute;
      await db.execute({
        sql: `UPDATE users
              SET voice_joined_at = ?, voice_segment_muted = ?
              WHERE user_id = ? AND guild_id = ?`,
        args: [Math.floor(now / 1000), isMuted ? 1 : 0, userId, guild.id],
      });
      console.log(`[Voice] ${newState.member?.displayName} joined voice - muted: ${isMuted}`);
      return;
    }

    // VOICE EXIT or MUTE/DEAF CHANGE
    // Проверяем: выход из канала ИЛИ смена mute/deaf статуса
    const oldChannelId = oldState.channelId;
    const newChannelId = newState.channelId;
    const muteChanged = oldState.selfDeaf !== newState.selfDeaf || oldState.selfMute !== newState.selfMute;

    if (oldChannelId && (!newChannelId || muteChanged)) {
      if (joinedAtRow.rows[0]?.voice_joined_at) {
        const joinedAt = joinedAtRow.rows[0].voice_joined_at as number;
        const elapsed = Math.floor((now / 1000) - joinedAt);
        const wasMuted = joinedAtRow.rows[0].voice_segment_muted as number;

        let voiceSecondsToAdd = 0;
        if (wasMuted === 0) {
          voiceSecondsToAdd = elapsed;
        }

        // Обновление ежедневной активности
        if (voiceSecondsToAdd > 0) {
          await db.execute({
            sql: `INSERT INTO user_daily_activity (user_id, guild_id, activity_date, voice_seconds)
                  VALUES (?, ?, ?, ?)
                  ON CONFLICT(user_id, guild_id, activity_date)
                  DO UPDATE SET voice_seconds = voice_seconds + ?`,
            args: [userId, guild.id, today, voiceSecondsToAdd, voiceSecondsToAdd],
          });
        }

        if (!newChannelId) {
          // Exiting voice completely
          await db.execute({
            sql: `UPDATE users
                  SET voice_seconds = voice_seconds + ?, voice_joined_at = NULL, voice_segment_muted = 0
                  WHERE user_id = ? AND guild_id = ?`,
            args: [voiceSecondsToAdd, userId, guild.id],
          });
          console.log(`[Voice] ${newState.member?.displayName} exited voice - added ${voiceSecondsToAdd}s (was muted: ${!!wasMuted})`);

          // Проверка квестов типа voice
          if (voiceSecondsToAdd > 0) {
            await checkQuestsForVoice(db, userId, guild.id, voiceSecondsToAdd, new Date(now));
          }
        } else {
          // Mute/deaf change, staying in voice
          const newMuteState = (newState.selfDeaf && newState.selfMute) ? 1 : 0;
          await db.execute({
            sql: `UPDATE users
                  SET voice_seconds = voice_seconds + ?, voice_joined_at = ?, voice_segment_muted = ?
                  WHERE user_id = ? AND guild_id = ?`,
            args: [voiceSecondsToAdd, Math.floor(now / 1000), newMuteState, userId, guild.id],
          });
          console.log(`[Voice] ${newState.member?.displayName} mute changed - added ${voiceSecondsToAdd}s, new state: ${newMuteState}`);

          // Проверка квестов типа voice
          if (voiceSecondsToAdd > 0) {
            await checkQuestsForVoice(db, userId, guild.id, voiceSecondsToAdd, new Date(now));
          }
        }
      }
    }
  } catch (err) {
    console.error('[Error] voiceStateUpdate:', err);
  }
});

const token = process.env.DISCORD_BOT_TOKEN || process.env.DISCORD_TOKEN;
client.login(token);
