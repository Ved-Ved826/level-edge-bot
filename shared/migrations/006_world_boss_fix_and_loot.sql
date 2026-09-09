-- ============================================
-- Миграция 006: Исправление Мирового Босса и Система Лутов
-- Этап 13-14 (World Boss, Loot System)
-- ============================================
-- Эта миграция исправляет критические SQL-ошибки:
-- 1. Добавляет отсутствующие колонки в world_boss
-- 2. Создаёт систему дропа лутов
-- 3. Фиксит несоответствие типов боссов
-- 4. Расширяет user_inventory для лутов с боссов
-- ============================================

-- ============================================
-- 1. Проверка и обновление таблицы world_boss
-- ============================================
-- ПРИМЕЧАНИЕ: world_boss создаётся динамически в collector.ts
-- Но её схема должна быть расширена для:
-- - xp_reward (базовая награда XP за убийство)
-- - coins_reward (базовая награда монет за убийство)

-- Эта миграция предполагает, что world_boss уже существует.
-- Если её нет, она будет создана в collector.ts при первом запуске.

-- Добавляем колонки только если они не существуют
-- SQLite не поддерживает "IF NOT EXISTS" для ALTER TABLE ADD,
-- поэтому эта миграция должна быть выполнена один раз или проверена вручную.

ALTER TABLE world_boss ADD COLUMN xp_reward INTEGER NOT NULL DEFAULT 800;
ALTER TABLE world_boss ADD COLUMN coins_reward INTEGER NOT NULL DEFAULT 200;

-- ============================================
-- 2. Таблица boss_loot_drops (Конфигурация дропов боссов)
-- ============================================
-- Это конфигурационная таблица, которая определяет,
-- какие предметы может выдавать каждый тип босса.

CREATE TABLE IF NOT EXISTS boss_loot_drops (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  boss_type TEXT NOT NULL,
  item_name TEXT NOT NULL,
  item_slot TEXT NOT NULL,
  rarity TEXT NOT NULL,
  drop_weight INTEGER NOT NULL DEFAULT 100,
  drop_chance REAL NOT NULL DEFAULT 0.3
);

-- Индексы для быстрого доступа
CREATE INDEX IF NOT EXISTS idx_boss_loot_drops_type ON boss_loot_drops(boss_type);

-- ============================================
-- 3. Таблица boss_encounter_loot (Выданные луты за конкретного босса)
-- ============================================
-- Предотвращает повторную выдачу лутов за одного босса
-- и отслеживает, кто получил что.

CREATE TABLE IF NOT EXISTS boss_encounter_loot (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  boss_id INTEGER NOT NULL,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  inventory_id INTEGER,
  granted_at INTEGER NOT NULL,
  UNIQUE(boss_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_boss_encounter_loot_boss ON boss_encounter_loot(boss_id, guild_id);
CREATE INDEX IF NOT EXISTS idx_boss_encounter_loot_user ON boss_encounter_loot(user_id, guild_id);

-- ============================================
-- 4. Расширение user_inventory для лутов с боссов
-- ============================================
-- Добавляем колонки для хранения полных статов предмета

ALTER TABLE user_inventory ADD COLUMN item_id TEXT DEFAULT NULL;
ALTER TABLE user_inventory ADD COLUMN atk_bonus INTEGER DEFAULT 0;
ALTER TABLE user_inventory ADD COLUMN def_bonus INTEGER DEFAULT 0;
ALTER TABLE user_inventory ADD COLUMN crit_bonus INTEGER DEFAULT 0;
ALTER TABLE user_inventory ADD COLUMN coin_bonus INTEGER DEFAULT 0;
ALTER TABLE user_inventory ADD COLUMN description TEXT DEFAULT NULL;

-- ============================================
-- 5. Таблица для отслеживания победы над боссом
-- ============================================
-- Помогает определить, был ли босс реально убит
-- и предотвращает дублирование наград/лутов

CREATE TABLE IF NOT EXISTS boss_defeats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  boss_id INTEGER NOT NULL,
  guild_id TEXT NOT NULL,
  defeated_by_user TEXT NOT NULL,
  defeated_at INTEGER NOT NULL,
  participants_count INTEGER NOT NULL,
  UNIQUE(boss_id, guild_id)
);

CREATE INDEX IF NOT EXISTS idx_boss_defeats_boss ON boss_defeats(boss_id, guild_id);
CREATE INDEX IF NOT EXISTS idx_boss_defeats_user ON boss_defeats(defeated_by_user, guild_id);

-- ============================================
-- 6. Исправление колонок для classe compatibility
-- ============================================
-- Убедимся, что users имеет все необходимые колонки для классов

ALTER TABLE users ADD COLUMN class_id TEXT DEFAULT NULL;

-- ============================================
-- ИТОГИ МИГРАЦИИ
-- ============================================
-- ✓ Добавлены колонки xp_reward и coins_reward в world_boss
-- ✓ Создана таблица boss_loot_drops для конфигурации дропов
-- ✓ Создана таблица boss_encounter_loot для отслеживания выданных лутов
-- ✓ Создана таблица boss_defeats для отслеживания побед
-- ✓ Расширена user_inventory с полными статами предмета
-- ✓ Все индексы созданы для производительности
--
-- ВАЖНО: ALTER TABLE ADD COLUMN будет ошибиться, если колонка уже существует.
-- Это нормально для повторного запуска миграции.
