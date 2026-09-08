-- ============================================
-- Миграция 003: Система дуэлей (/duel)
-- ============================================

-- Таблица для хранения информации о дуэлях
CREATE TABLE IF NOT EXISTS duels (
  id TEXT PRIMARY KEY,          -- Уникальный ID дуэли (формат: duel_{timestamp}_{last4})
  guild_id TEXT NOT NULL,       -- ID гильдии
  challenger_id TEXT NOT NULL,  -- ID пользователя, вызывающего на дуэль
  opponent_id TEXT NOT NULL,    -- ID пользователя, получающего вызов
  bet_amount INTEGER NOT NULL,  -- Размер ставки в XP
  status TEXT DEFAULT 'pending', -- Статус: 'pending', 'accepted', 'declined', 'completed'
  created_at INTEGER NOT NULL   -- Timestamp создания дуэли
);

-- Индекс для быстрого поиска дуэлей по гильдии и статусу
CREATE INDEX IF NOT EXISTS idx_duels_guild_status ON duels(guild_id, status);

-- Индекс для поиска дуэлей по оппоненту
CREATE INDEX IF NOT EXISTS idx_duels_opponent ON duels(opponent_id);
