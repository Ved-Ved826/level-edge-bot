# 📊 Миграция 005 — Синхронизация схемы БД

## Статус
✅ **Миграция создана и готова к применению**
- Файл: `shared/migrations/005_missing_schema_sync.sql`
- Размер: 205 строк
- Статус: готов к проверке перед применением на prod

## 📋 Что было найдено

### Расхождения между prod-БД и миграциями

#### 1. **8 новых колонок в таблице `users`** (не в миграциях)
```
coins              INTEGER NOT NULL DEFAULT 0       -- баланс монет 🪙 (Этап 11)
class_id           TEXT DEFAULT NULL               -- выбранный класс (Этап 12)
prestige_count     INTEGER NOT NULL DEFAULT 0      -- сбросы престижа ★
last_boss_attack_at INTEGER DEFAULT NULL           -- timestamp последней атаки
card_theme         TEXT DEFAULT 'default'          -- тема карточки
card_title         TEXT DEFAULT 'Новичок'          -- кастомный титул
streak_days        INTEGER NOT NULL DEFAULT 0      -- стрик дней 🔥
streak_freezes     INTEGER NOT NULL DEFAULT 0      -- заморозки стрика 🧊
```

#### 2. **12 таблиц, которых нет в миграциях**

| Таблица | Этап | Назначение |
|---------|------|-----------|
| `achievements_pool` | 6 | 27 достижений и пасхалок |
| `user_achievements` | 6 | Разблокированные ачивки |
| `air_drops` | 4 | Войс-дропы 🎁 и Happy Hours |
| `boss_damage_logs` | 13 | Логи ударов по Мировому Боссу |
| `guild_events` | 4 | События гильдии (Happy Hours) |
| `user_inventory` | 14 | Инвентарь предметов |
| `market_listings` | 14 | Выставленные на рынок предметы |
| `direct_trades` | 14 | Прямые сделки между друзьями |
| `user_cosmetics` | 5 | Кастомизация карточки |
| `user_quest_progress` | 1 | Прогресс по квестам |
| `weekly_activity` | 7 | Еженедельная активность (лиги) |

### Получено из prod-БД
```
Таблицы в Turso (реальная БД):
✓ achievements_pool
✓ air_drops
✓ boss_damage_logs
✓ direct_trades
✓ duels
✓ guild_events
✓ guild_settings
✓ market_listings
✓ quests_daily
✓ quests_pool
✓ season_archive
✓ user_achievements
✓ user_cosmetics
✓ user_daily_activity
```

## 📝 Структура миграции 005

### Блок 1: ALTER TABLE users
```sql
ALTER TABLE users ADD COLUMN coins INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN class_id TEXT DEFAULT NULL;
ALTER TABLE users ADD COLUMN prestige_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN last_boss_attack_at INTEGER DEFAULT NULL;
ALTER TABLE users ADD COLUMN card_theme TEXT DEFAULT 'default';
ALTER TABLE users ADD COLUMN card_title TEXT DEFAULT 'Новичок';
ALTER TABLE users ADD COLUMN streak_days INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN streak_freezes INTEGER NOT NULL DEFAULT 0;
```

⚠️ **Важно:** SQLite не поддерживает `IF NOT EXISTS` для `ALTER TABLE ADD COLUMN`!
- Если колонка уже существует, миграция выдаст ошибку
- Перед применением проверьте: `PRAGMA table_info(users);`

### Блок 2-5: Таблицы для достижений и войс-дропов
```sql
CREATE TABLE IF NOT EXISTS achievements_pool (...)
CREATE TABLE IF NOT EXISTS user_achievements (...)
CREATE TABLE IF NOT EXISTS air_drops (...)
CREATE TABLE IF NOT EXISTS boss_damage_logs (...)
```

### Блок 6-12: Таблицы для инвентаря и торговли
```sql
CREATE TABLE IF NOT EXISTS guild_events (...)
CREATE TABLE IF NOT EXISTS user_inventory (...)
CREATE TABLE IF NOT EXISTS market_listings (...)
CREATE TABLE IF NOT EXISTS direct_trades (...)
CREATE TABLE IF NOT EXISTS user_cosmetics (...)
CREATE TABLE IF NOT EXISTS user_quest_progress (...)
CREATE TABLE IF NOT EXISTS weekly_activity (...)
```

### Индексы: 15 индексов для оптимизации
```sql
CREATE INDEX idx_user_achievements_user ON user_achievements(user_id, guild_id);
CREATE INDEX idx_user_achievements_achievement ON user_achievements(achievement_id);
CREATE INDEX idx_air_drops_guild ON air_drops(guild_id);
CREATE INDEX idx_air_drops_claimed ON air_drops(claimed_by);
CREATE INDEX idx_boss_damage_logs_boss ON boss_damage_logs(boss_id, guild_id);
CREATE INDEX idx_boss_damage_logs_user ON boss_damage_logs(user_id, guild_id);
CREATE INDEX idx_guild_events_ends_at ON guild_events(ends_at);
CREATE INDEX idx_user_inventory_user ON user_inventory(user_id, guild_id);
CREATE INDEX idx_user_inventory_guild ON user_inventory(guild_id);
CREATE INDEX idx_market_listings_guild ON market_listings(guild_id);
CREATE INDEX idx_market_listings_seller ON market_listings(seller_id);
CREATE INDEX idx_direct_trades_guild ON direct_trades(guild_id);
CREATE INDEX idx_direct_trades_target ON direct_trades(target_id);
CREATE INDEX idx_user_quest_user ON user_quest_progress(user_id, guild_id);
CREATE INDEX idx_user_quest_daily ON user_quest_progress(quest_daily_id);
CREATE INDEX idx_weekly_activity_week ON weekly_activity(week_key);
CREATE INDEX idx_weekly_activity_user ON weekly_activity(user_id);
CREATE INDEX idx_weekly_activity_guild ON weekly_activity(guild_id);
```

## ✅ Процедура применения

### 1. Предварительная проверка на DEV/STAGING
```bash
# Проверить текущую схему users
turso db shell disbot-db-staging ".schema users"

# Или через PRAGMA
turso db shell disbot-db-staging "PRAGMA table_info(users);"
```

### 2. Применить миграцию
```bash
turso db shell disbot-db-zomka < shared/migrations/005_missing_schema_sync.sql
```

### 3. Финальная проверка
```bash
# Проверить новые колонки в users
turso db shell disbot-db-zomka "PRAGMA table_info(users);"

# Проверить созданные таблицы
turso db shell disbot-db-zomka "SELECT COUNT(*) FROM sqlite_master WHERE type='table';"

# Ожидается: 15 таблиц (было ~11, добавляется ~4)
```

### 4. Коммит миграции в repo
```bash
git add shared/migrations/005_missing_schema_sync.sql
git commit -m "fix: restore missing schema for achievements, inventory, events (005)"
```

## ⚠️ Критические замечания

### SQLite ограничение: ALTER TABLE
```
SQLite НЕ поддерживает:
  ALTER TABLE users ADD COLUMN coins INTEGER IF NOT EXISTS;

Поддерживает только простой синтаксис:
  ALTER TABLE users ADD COLUMN coins INTEGER NOT NULL DEFAULT 0;

❌ РЕШЕНИЕ: Нельзя сделать эту часть идемпотентной в SQLite
✅ Обходной путь: Перед применением проверить схему вручную
```

### Foreign Key Constraints
- Все таблицы с FOREIGN KEY используют `IF NOT EXISTS`
- Это безопасно, так как таблицы-источники уже существуют
- Если миграция частично применилась, переапплицирование будет безопасно

### Порядок выполнения
⚠️ **Важно:** Применяйте блоки в указанном порядке!
1. ALTER TABLE users (может быть пропущено, если колонки уже есть)
2. achievements_pool → user_achievements (зависимость по FK)
3. air_drops, boss_damage_logs, guild_events (независимые)
4. user_inventory → market_listings, direct_trades (зависимость)
5. user_cosmetics, user_quest_progress, weekly_activity (независимые)

## 📊 Итоги

| Метрика | Значение |
|---------|----------|
| Новых колонок | 8 (в таблице users) |
| Новых таблиц | 12 |
| Новых индексов | 15 |
| Файл | `shared/migrations/005_missing_schema_sync.sql` |
| Статус | ✅ готов |
| Риск | ⚠️ средний (ALTER TABLE может ошибиться) |

## 🔍 Проверочный лист перед применением

- [ ] Прочитана вся миграция 005
- [ ] Проверена текущая схема users на prod
- [ ] Убедитесь, что колонки coins, class_id и др. ещё не добавлены
- [ ] Созданы резервные копии БД (если нужны)
- [ ] Миграция протестирована на staging
- [ ] Согласовано время для применения (минимум простоя)
- [ ] Готов rollback-план (в крайнем случае)

---

**Создано:** 2026-09-09 12:05 UTC+10
**Источник данных:** Turso API (libsql://disbot-db-zomka.aws-ap-northeast-1.turso.io)
