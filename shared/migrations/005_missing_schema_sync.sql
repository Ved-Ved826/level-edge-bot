-- ============================================
-- Миграция 005: Синхронизация схемы БД
-- Этап 11-14 (Монеты, Классы, Босс, Инвентарь)
-- ============================================
-- Это миграция восстанавливает таблицы и колонки,
-- которые были созданы вручную в prod, но не зафиксированы в миграциях.
-- ============================================

-- ============================================
-- 1. ТАБЛИЦА users — добавляем недостающие колонки
-- ============================================
-- Проверка: SQLite не поддерживает "IF NOT EXISTS" для ALTER TABLE ADD COLUMN.
-- Эта миграция идемпотентна только при первом запуске.
-- Если колонка уже существует, миграция должна быть пропущена вручную или
-- через проверку PRAGMA table_info в приложении.

ALTER TABLE users ADD COLUMN coins INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN class_id TEXT DEFAULT NULL;
ALTER TABLE users ADD COLUMN prestige_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN last_boss_attack_at INTEGER DEFAULT NULL;
ALTER TABLE users ADD COLUMN card_theme TEXT DEFAULT 'default';
ALTER TABLE users ADD COLUMN card_title TEXT DEFAULT 'Новичок';
ALTER TABLE users ADD COLUMN streak_days INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN streak_freezes INTEGER NOT NULL DEFAULT 0;

-- ============================================
-- 2. ТАБЛИЦА achievements_pool
-- ============================================
CREATE TABLE IF NOT EXISTS achievements_pool (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  quote TEXT NOT NULL,
  reward INTEGER NOT NULL
);

-- ============================================
-- 3. ТАБЛИЦА user_achievements
-- ============================================
CREATE TABLE IF NOT EXISTS user_achievements (
  user_id TEXT NOT NULL,
  guild_id TEXT NOT NULL,
  achievement_id TEXT NOT NULL,
  unlocked_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, guild_id, achievement_id),
  FOREIGN KEY (achievement_id) REFERENCES achievements_pool(id)
);

CREATE INDEX IF NOT EXISTS idx_user_achievements_user ON user_achievements(user_id, guild_id);
CREATE INDEX IF NOT EXISTS idx_user_achievements_achievement ON user_achievements(achievement_id);

-- ============================================
-- 4. ТАБЛИЦА air_drops (Войс-дропы, Этап 4)
-- ============================================
CREATE TABLE IF NOT EXISTS air_drops (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  reward_xp INTEGER NOT NULL,
  reward_type TEXT NOT NULL,
  claimed_by TEXT DEFAULT NULL,
  claimed_at INTEGER DEFAULT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_air_drops_guild ON air_drops(guild_id);
CREATE INDEX IF NOT EXISTS idx_air_drops_claimed ON air_drops(claimed_by);

-- ============================================
-- 5. ТАБЛИЦА boss_damage_logs (Мировой Босс, Этап 13)
-- ============================================
CREATE TABLE IF NOT EXISTS boss_damage_logs (
  id INTEGER PRIMARY KEY,
  boss_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  guild_id TEXT NOT NULL,
  damage INTEGER NOT NULL,
  attack_type TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_boss_damage_logs_boss ON boss_damage_logs(boss_id, guild_id);
CREATE INDEX IF NOT EXISTS idx_boss_damage_logs_user ON boss_damage_logs(user_id, guild_id);

-- ============================================
-- 6. ТАБЛИЦА guild_events (Happy Hours 2X, Этап 4)
-- ============================================
CREATE TABLE IF NOT EXISTS guild_events (
  guild_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  ends_at INTEGER NOT NULL,
  multiplier REAL NOT NULL,
  PRIMARY KEY (guild_id, event_type)
);

CREATE INDEX IF NOT EXISTS idx_guild_events_ends_at ON guild_events(ends_at);

-- ============================================
-- 7. ТАБЛИЦА user_inventory (Инвентарь и рынок, Этап 14)
-- ============================================
CREATE TABLE IF NOT EXISTS user_inventory (
  id INTEGER PRIMARY KEY,
  user_id TEXT NOT NULL,
  guild_id TEXT NOT NULL,
  item_name TEXT NOT NULL,
  item_type TEXT NOT NULL,
  rarity TEXT NOT NULL,
  sell_price INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_inventory_user ON user_inventory(user_id, guild_id);
CREATE INDEX IF NOT EXISTS idx_user_inventory_guild ON user_inventory(guild_id);

-- ============================================
-- 8. ТАБЛИЦА market_listings (Свободный рынок, Этап 14)
-- ============================================
CREATE TABLE IF NOT EXISTS market_listings (
  id INTEGER PRIMARY KEY,
  guild_id TEXT NOT NULL,
  seller_id TEXT NOT NULL,
  inventory_id INTEGER NOT NULL,
  price INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (inventory_id) REFERENCES user_inventory(id)
);

CREATE INDEX IF NOT EXISTS idx_market_listings_guild ON market_listings(guild_id);
CREATE INDEX IF NOT EXISTS idx_market_listings_seller ON market_listings(seller_id);

-- ============================================
-- 9. ТАБЛИЦА direct_trades (Прямая торговля между друзьями)
-- ============================================
CREATE TABLE IF NOT EXISTS direct_trades (
  id INTEGER PRIMARY KEY,
  guild_id TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  inventory_id INTEGER NOT NULL,
  price INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  FOREIGN KEY (inventory_id) REFERENCES user_inventory(id)
);

CREATE INDEX IF NOT EXISTS idx_direct_trades_guild ON direct_trades(guild_id);
CREATE INDEX IF NOT EXISTS idx_direct_trades_target ON direct_trades(target_id);

-- ============================================
-- 10. ТАБЛИЦА user_cosmetics (Кастомизация карточки, Этап 5)
-- ============================================
CREATE TABLE IF NOT EXISTS user_cosmetics (
  user_id TEXT NOT NULL,
  guild_id TEXT NOT NULL,
  theme_id TEXT DEFAULT 'default',
  title_id TEXT DEFAULT 'Новичок',
  badges TEXT DEFAULT '[]',
  PRIMARY KEY (user_id, guild_id)
);

-- ============================================
-- 11. ТАБЛИЦА user_quest_progress
-- ============================================
-- Эта таблица упоминается в миграции 002, но её полная схема не была зафиксирована.
CREATE TABLE IF NOT EXISTS user_quest_progress (
  user_id TEXT NOT NULL,
  guild_id TEXT NOT NULL,
  quest_daily_id TEXT NOT NULL,
  current_progress INTEGER NOT NULL DEFAULT 0,
  completed_at INTEGER DEFAULT NULL,
  PRIMARY KEY (user_id, guild_id, quest_daily_id),
  FOREIGN KEY (quest_daily_id) REFERENCES quests_daily(id)
);

CREATE INDEX IF NOT EXISTS idx_user_quest_user ON user_quest_progress(user_id, guild_id);
CREATE INDEX IF NOT EXISTS idx_user_quest_daily ON user_quest_progress(quest_daily_id);

-- ============================================
-- 12. ТАБЛИЦА weekly_activity
-- ============================================
-- Эта таблица упоминается в миграции 004, но её полная схема не была зафиксирована.
CREATE TABLE IF NOT EXISTS weekly_activity (
  user_id TEXT NOT NULL,
  guild_id TEXT NOT NULL,
  week_key TEXT NOT NULL,
  xp_earned INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, guild_id, week_key)
);

CREATE INDEX IF NOT EXISTS idx_weekly_activity_week ON weekly_activity(week_key);
CREATE INDEX IF NOT EXISTS idx_weekly_activity_user ON weekly_activity(user_id);
CREATE INDEX IF NOT EXISTS idx_weekly_activity_guild ON weekly_activity(guild_id);

-- ============================================
-- ИТОГИ МИГРАЦИИ
-- ============================================
-- ✓ Добавлены 8 новых колонок в таблицу users
-- ✓ Добавлены 4 новые таблицы для достижений и инвентаря
-- ✓ Восстановлены недостающие определения таблиц для инвентаря и рынка
-- ✓ Добавлены необходимые индексы для производительности
--
-- ВАЖНО: ALTER TABLE ADD COLUMN будет ошибиться, если колонка уже существует.
-- Перед применением этой миграции убедитесь, что таблица users не содержит
-- эти колонки. В противном случае выполните миграцию с пропуском существующих ALTER.
