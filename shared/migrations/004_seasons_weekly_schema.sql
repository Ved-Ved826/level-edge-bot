-- ============================================
-- Миграция 004: Сезонные лиги и еженедельный спринт (Этап 7)
-- ============================================

-- Добавляем колонку season_xp в таблицу users
ALTER TABLE users ADD COLUMN season_xp INTEGER NOT NULL DEFAULT 0;

-- Таблица для еженедельной активности
-- week_key: строка вида 'YYYY-Www' (ISO неделя по Владивостоку)
CREATE TABLE IF NOT EXISTS weekly_activity (
  user_id TEXT NOT NULL,
  guild_id TEXT NOT NULL,
  week_key TEXT NOT NULL,
  xp_earned INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, guild_id, week_key)
);

-- Индексы дляweekly_activity
CREATE INDEX IF NOT EXISTS idx_weekly_activity_week ON weekly_activity(week_key);
CREATE INDEX IF NOT EXISTS idx_weekly_activity_user ON weekly_activity(user_id);
CREATE INDEX IF NOT EXISTS idx_weekly_activity_guild ON weekly_activity(guild_id);

-- Таблица архива сезонов (для сохранения топов после вайпа)
CREATE TABLE IF NOT EXISTS season_archive (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  season_name TEXT NOT NULL,
  user_id TEXT NOT NULL,
  rank_pos INTEGER NOT NULL,
  season_xp INTEGER NOT NULL,
  ended_at INTEGER NOT NULL
);

-- Индексы для season_archive
CREATE INDEX IF NOT EXISTS idx_season_archive_guild ON season_archive(guild_id);
CREATE INDEX IF NOT EXISTS idx_season_archive_season ON season_archive(season_name);
