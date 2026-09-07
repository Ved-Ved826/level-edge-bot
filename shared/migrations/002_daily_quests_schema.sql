-- ============================================
-- Миграция 002: Ежедневная активность и квесты
-- ============================================

-- Таблица для отслеживания активности пользователя за каждый день (UTC)
CREATE TABLE IF NOT EXISTS user_daily_activity (
  user_id TEXT NOT NULL,
  guild_id TEXT NOT NULL,
  activity_date TEXT NOT NULL, -- Формат YYYY-MM-DD в UTC
  messages_count INTEGER NOT NULL DEFAULT 0,
  voice_seconds INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, guild_id, activity_date)
);

-- Индексы для запросов по дате и гильдии
CREATE INDEX IF NOT EXISTS idx_daily_activity_date ON user_daily_activity(activity_date);
CREATE INDEX IF NOT EXISTS idx_daily_activity_guild ON user_daily_activity(guild_id, activity_date);

-- Таблица пула квестов (шаблоны, которые могут назначаться ежедневно)
CREATE TABLE IF NOT EXISTS quests_pool (
  id TEXT PRIMARY KEY, -- Уникальный ID квеста (например, "messages_10_50xp")
  title TEXT NOT NULL, -- Название на русском
  description TEXT NOT NULL, -- Описание квеста
  quest_type TEXT NOT NULL, -- "messages" или "voice_minutes"
  target_value INTEGER NOT NULL, -- Целевое значение (10 сообщений, 15 минут и т.д.)
  reward_xp INTEGER NOT NULL, -- Награда в XP
  is_active INTEGER NOT NULL DEFAULT 1 -- 1 = активен, 0 = отключен
);

-- Таблица активных квестов гильдии на сегодня
CREATE TABLE IF NOT EXISTS quests_daily (
  id TEXT PRIMARY KEY, -- Формат: {guild_id}_{date}_{quest_index}
  guild_id TEXT NOT NULL,
  quest_id TEXT NOT NULL, -- Ссылка на quests_pool.id
  active_date TEXT NOT NULL, -- Дата в UTC (YYYY-MM-DD)
  target INTEGER NOT NULL, -- Копия target_value из quests_pool
  reward_xp INTEGER NOT NULL, -- Копия reward_xp из quests_pool
  FOREIGN KEY (quest_id) REFERENCES quests_pool(id)
);

-- Индекс для быстрого поиска квестов гильдии на дату
CREATE INDEX IF NOT EXISTS idx_quests_daily_guild_date ON quests_daily(guild_id, active_date);

-- Таблица прогресса пользователя по квестам
CREATE TABLE IF NOT EXISTS user_quest_progress (
  user_id TEXT NOT NULL,
  guild_id TEXT NOT NULL,
  quest_daily_id TEXT NOT NULL, -- Ссылка на quests_daily.id
  current_progress INTEGER NOT NULL DEFAULT 0,
  completed_at INTEGER DEFAULT NULL, -- Timestamp выполнения (или NULL если не выполнено)
  PRIMARY KEY (user_id, guild_id, quest_daily_id),
  FOREIGN KEY (quest_daily_id) REFERENCES quests_daily(id)
);

-- Индексы для прогресса
CREATE INDEX IF NOT EXISTS idx_user_quest_user ON user_quest_progress(user_id, guild_id);
CREATE INDEX IF NOT EXISTS idx_user_quest_daily ON user_quest_progress(quest_daily_id);
