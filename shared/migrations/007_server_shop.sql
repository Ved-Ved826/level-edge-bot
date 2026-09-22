-- ============================================
-- Миграция 007: Ротационный магазин сервера
-- (ограниченный глобальный сток, завоз каждую среду 16:00 UTC)
-- ============================================
-- Таблица создается лениво из worker (CREATE TABLE IF NOT EXISTS),
-- здесь зафиксирована каноничная схема.

CREATE TABLE IF NOT EXISTS server_shop (
  guild_id TEXT NOT NULL,
  slot INTEGER NOT NULL,            -- 1..3
  item_type TEXT NOT NULL,          -- 'equipment' | 'streak_freeze' | 'banner'
  item_id TEXT NOT NULL,
  item_name TEXT NOT NULL,
  item_rarity TEXT NOT NULL,        -- 'common' | 'rare' | 'epic' (снаряжение), 'special' (сервис)
  price INTEGER NOT NULL,
  stock_remaining INTEGER NOT NULL, -- глобальный сток на сервер: 0..2
  updated_at INTEGER NOT NULL,      -- момент генерации витрины (unix, сек)
  PRIMARY KEY (guild_id, slot)
);

CREATE INDEX IF NOT EXISTS idx_server_shop_guild ON server_shop(guild_id);

-- Разблокированные эксклюзивные темы карточки (баннеры из ротационного магазина)
CREATE TABLE IF NOT EXISTS user_theme_unlocks (
  user_id TEXT NOT NULL,
  guild_id TEXT NOT NULL,
  theme_id TEXT NOT NULL,
  unlocked_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, guild_id, theme_id)
);
