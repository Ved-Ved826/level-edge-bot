# 📋 LevelEdge — Полная Структура Проекта

**Дата сканирования:** 2026-09-09  
**Всего строк кода:** ~8,030 строк  
**Основная версия:** 0.0.1  
**Архитектура:** Monorepo (3 workspaces: worker, collector, shared)

---

## 📁 ОБЩАЯ СТРУКТУРА ПРОЕКТА

```
E:\disbot/
├── package.json                 # Root monorepo manifest (workspaces)
├── package-lock.json
├── register.js                  # Discord bot registration script
├── CLAUDE.md                    # Project instructions & roadmap
│
├── shared/                      # Shared TypeScript types & utilities
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   │   ├── index.ts             # Main exports
│   │   ├── schema.ts            # (Empty — legacy placeholder)
│   │   └── index.js             # Compiled JS
│   ├── quests_pool.ts           # Quest templates pool
│   └── dist/                    # Compiled output
│
├── worker/                      # Cloudflare Worker (Edge)
│   ├── package.json
│   ├── tsconfig.json
│   ├── wrangler.toml
│   ├── src/
│   │   ├── worker.ts            # Main HTTP handler (8030+ lines)
│   │   ├── index.ts             # Index exports
│   │   ├── Card.tsx             # React card component for Satori
│   │   ├── itemsCatalog.ts       # 15+ unique items (weapons, armor, etc.)
│   │   ├── types.d.ts            # WASM & font type declarations
│   │   └── assets/
│   │       └── Inter-Regular.ttf # Font for card rendering
│   ├── dist/                    # Compiled output
│   └── .wrangler/               # Wrangler build artifacts
│
├── collector/                   # Node.js Collector Daemon
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   │   └── collector.ts         # Main daemon (5000+ lines)
│   ├── dist/
│   │   └── collector.js         # Compiled entry point
│   └── Dockerfile               # Container image definition
│
└── node_modules/                # Dependencies
```

---

## 🔧 ТЕХНИЧЕСКИЙ СТЕК

### **1. Root Package (Monorepo Orchestration)**
**Файл:** `package.json`

- **Тип:** ESM (ECMAScript Module)
- **Workspaces:** 
  - `collector` — Node.js daemon
  - `worker` — Cloudflare Worker
  - `shared` — TypeScript types & utilities
- **Назначение:** Единая точка управления зависимостями и скриптами всех трёх компонентов

---

## 📦 SHARED TYPES (`shared/`)

### **Главная задача:** Экспортировать единые типы и утилиты для всех компонентов

**Ключевые файлы:**

#### `src/index.ts` — Основной экспорт (~40 строк)
- **`User` интерфейс:** Структура пользователя в БД
  ```ts
  interface User {
    user_id: string;
    guild_id: string;
    xp: number;
    level: number;
    messages_count: number;
    voice_seconds: number;
    last_message_at: number | null;
    voice_joined_at: number | null;
    voice_segment_muted: number;
  }
  ```

- **`GuildSettings` интерфейс:** Настройки гильдии (сервера)

- **Функции для расчётов уровня:**
  - `calculateLevel(xp)` → уровень игрока (квадратный корень от XP)
  - `calculateXpForLevel(level)` → XP для конкретного уровня
  - `getNextLevelXp(level)` → XP для следующего уровня
  - `getXpProgress(xp)` → прогресс текущего уровня (%, current, next)

#### `quests_pool.ts` — Пул ежедневных квестов (~130 строк)
Определяет 15+ шаблонов квестов:
- **Текстовые (messages):** 5 квестов (10..100 сообщений, 50..500 XP)
- **Голосовые (voice_minutes):** 5 квестов (15..150 минут, 100..750 XP)
- **Комбо (combo):** 5 квестов (смешанные условия, 150..800 XP)

---

## 🔗 CLOUDFLARE WORKER (`worker/`)

### **Главная задача:** HTTP Edge-сервер для Discord Interactions, рендер карточек, обработка команд/кнопок

### **Ключевые файлы:**

#### `src/worker.ts` — Основной обработчик (~8000+ строк)

**Модули внутри:**

1. **Система достижений (27 ачивок)**
   - Ведьмак 3 (5 ачивок): Плотва, Гвинт, Зараза, Бладикен, Чеканная монета
   - Red Dead Redemption 2 (5 ачивок): План, Ленни, Быстрая рука, Таити, Капитализм
   - Владивосток & ДВ (6 ачивок): 2000, Полночь, Пян-се, Тайфун, Праворульщик, Золотой Рог
   - Half-Life 2 (5 ачивок): Проснитесь, Банка, Вода, Монтировка, Ящик
   - Мемы/Навальный (5 ачивок): Привет, Бутерброд, Финальная битва, Расследователи, ПСБ
   - Классика (2 ачивки): 777, Казино

2. **Описания Мировых Боссов (Этап 13)**
   - `dragon` — -25% урона, пробивают скиллы
   - `mimic` — 12ч кулдаун, +15..40 🪙 за удар
   - `leviathan` — войс-буст x2 сильнее
   - `phantom` — 6 мин кулдаун вместо 10

3. **Функции обработки интеракций Discord:**
   - `/rank` — карточка профиля игрока
   - `/rank-today` — активность за день
   - `/duel` — система дуэлей с налогом 26%
   - `/market` — свободный рынок лута между друзьями
   - `/spin` — колесо фортуны (1 раз в 24ч)
   - `/quests` — ежедневные квесты
   - `/boss-spawn`, `boss_atk_*` — Мировой босс в канале
   - `/prestige` — сброс престижа со звёздами
   - `/leaderboard` — лидерборд сезона
   - `/card-customize` — выбор темы карточки
   - `/export` — CSV-экспорт для админов
   - `/server-kings` — Зал славы
   - `/recap` — годовой дайджест

4. **Рендеринг карточек (Satori + WASM + Resvg)**
   - Загрузка WASM модуля для конвертации SVG → PNG
   - Создание React-компонентов карточек через Satori
   - Вставка аватара (base64-кодированный PNG)
   - Отправка PNG в Discord embeds

#### `src/Card.tsx` — React-компонент карточки профиля (~300+ строк)

**Темы оформления (5 шт):**
1. **`default`** — Discord Blurple (классическая синяя)
2. **`cyberpunk`** — Неоновый роз/бирюза
3. **`magma`** — Вулканический огонь (оранжевый)
4. **`midnight`** — Глубокий космос (индиго)
5. **`emerald`** — Зелёный нефрит/золото

**CardProps интерфейс:**
```ts
interface CardProps {
  username: string;
  avatarBase64: string;
  level: number;
  rank: number;
  totalUsers: number;
  xp: number;
  nextLevelXp: number;
  progress: number;
  messagesCount: number;
  voiceHours: number;
  streakDays?: number;           // 🔥 стрики
  prestigeCount?: number;         // ★ престиж
  statusColor?: string;
  themeId?: string;
  customTitle?: string;
}
```

**Рендер:** Flexbox-лейаут 800x260px с:
- Аватар (64x64px, левый угол)
- Ник, уровень, ранк, тема
- Прогресс-бар XP (эффект свечения)
- Статистика: сообщения, часы в войсе
- Бейджи (стрики 🔥, престиж ★)

#### `src/itemsCatalog.ts` — Каталог реликвий (~300+ строк)

**15 уникальных предметов по 5 редкостям:**

1. **Обычные (⚪ common):**
   - Ржавая газовая труба (оружие, 25 ATK)
   - Потёртая кожанка (броня, 20 DEF)
   - Медная гайка (кольцо, 10 ATK + 10 DEF)

2. **Редкие (🔵 rare):**
   - Дробовик ИЖ-27 (оружие, 95 ATK + 5 CRIT)
   - Штормовой бушлат (броня, 80 DEF + 5 COIN)
   - Акулий клык (амулет, 40 ATK + 40 DEF)

3. **Эпические (🟣 epic):**
   - Катана «Уличный Самурай» (оружие, 220 ATK + 12 CRIT)
   - Экзоскелет погрузчика (броня, 30 ATK + 190 DEF)
   - Перстень Азартного Шулера (кольцо, 70 ATK + 18 CRIT + 15 COIN)

4. **Легендарные (🟡 legendary):**
   - Якорь Золотого Рога (оружие, 420 ATK + 20 CRIT)
   - Доспех Пепельного Титана (броня, 50 ATK + 320 DEF)
   - [+ 1 амулет]

5. **Мифические (🔴 mythic):**
   - [Финальные сет-вещи]

**Интерфейс UniqueItem:**
```ts
interface UniqueItem {
  item_id: string;
  slot: 'weapon' | 'armor' | 'ring' | 'amulet';
  name: string;
  rarity: 'common' | 'rare' | 'epic' | 'legendary' | 'mythic';
  atk: number;
  def: number;
  crit: number;
  coin: number;
  price: number;
  description: string;
}
```

**Вспомогательные функции:**
- `getRarityColor(rarity)` → цвет HEX для эмодзи
- `getRarityEmoji(rarity)` → эмодзи редкости
- `findItemById(item_id)` → поиск предмета в каталоге

#### `src/index.ts` — Главная точка входа Worker
- Импорты всех утилит, Card-компонента, itemsCatalog
- Переэкспорты для использования в worker.ts

#### `src/types.d.ts` — Type definitions (~10 строк)
```ts
declare module '*.ttf' {
  const content: ArrayBuffer;
  export default content;
}

declare module '*.wasm' {
  const module: WebAssembly.Module;
  export default module;
}
```

**Назначение:** Разрешить импорт TTF-шрифтов и WASM-модулей как JS-модули

---

## 🔄 NODE.JS COLLECTOR DAEMON (`collector/`)

### **Главная задача:** WebSocket-шлюз Discord, трекинг активности в реальном времени

**Ключевые файлы:**

#### `src/collector.ts` — Основной коллектор (~5000+ строк)

**Основные компоненты:**

1. **HTTP Healthcheck-сервер (порт 8000/PORT)**
   ```ts
   http.createServer((req, res) => {
     res.writeHead(200, { 'Content-Type': 'text/plain' });
     res.end('Collector is running!');
   }).listen(PORT);
   ```
   **Назначение:** Healthcheck для Render/Koyeb

2. **Пул квестов (дублирован из shared)**
   - 5 текстовых квестов
   - 5 голосовых квестов
   - 5 комбо-квестов
   - (ПРИМЕЧАНИЕ: дублировано для избежания tsconfig issues)

3. **Система достижений (27 ачивок)**
   - Тот же набор как в worker.ts
   - Каждая с функцией-триггером `trigger(db, userId, guildId, data)`
   - Примеры триггеров:
     - `checkWitcherPlod` — 30-35 сек между сообщениями
     - `checkWitcherGwent` — 3 дуэли за день
     - `checkVladMidnight` — сообщение в 00:00 по Владивостоку
     - `checkHLWater` — 2 часа в войсе подряд

4. **Discord.js Client Setup**
   - **Intents:** GatewayIntentBits.MessageContent, Guilds, GuildMembers, GuildVoiceStates, DirectMessages
   - **События:**
     - `messageCreate` — трекинг текстовых сообщений (с динамическим кулдауном 15–120 сек)
     - `voiceStateUpdate` — трекинг входа/выхода из войса
     - `ready` — инициализация при старте

5. **Динамический XP Cooldown (~100+ строк логики)**
   - Первое сообщение: 15 сек кулдаун
   - Постепенное увеличение кулдауна при спаме
   - Максимум: 120 сек (2 минуты)
   - **Цель:** Естественное общение без АФК-ферм

6. **Сегментный войс-учёт**
   - Игнорирует `selfDeaf + selfMute` (АФК)
   - Начисляет опыт раз в 5 минут
   - Отслеживает войс_joined_at для таймингов

7. **Фоновые таймеры/тикеры**
   - **Таймер онлайна:** Раз в 5 мин начисление XP за войс
   - **Генерация дейли-квестов:** Каждый день в 00:00 UTC+10
   - **Спавн Мирового Босса:** Раз в 24 часа в канал `1051085743839260694`
   - **Еженедельные подземелья:** Случайное время 18:00–23:00 UTC+10

8. **Таблица пользователей (многогильдийный учёт)**
   - Каждый юзер — запись `(user_id, guild_id)` (составной ключ)
   - Избегает кросс-гильдийного загрязнения

---

## 🗄️ БАЗА ДАННЫХ (Turso / libSQL)

**Строка подключения:** Через `createClient()` из `@libsql/client`

**Основные таблицы:**

| Таблица | Колонки | Назначение |
|---------|---------|-----------|
| `users` | `user_id`, `guild_id`, `xp`, `level`, `messages_count`, `voice_seconds`, `coins`, `class_id`, `prestige_count`, ... | Профиль игрока |
| `daily_quests` | `user_id`, `guild_id`, `quest_id`, `progress`, `completed_at` | Ежедневные квесты (сброс в 00:00 UTC+10) |
| `user_achievements` | `user_id`, `guild_id`, `achievement_id`, `unlocked_at` | Открытые достижения |
| `user_inventory` | `id`, `user_id`, `guild_id`, `item_name`, `item_type`, `rarity`, `sell_price`, `created_at` | Предметы в инвентаре |
| `world_boss` | `boss_id`, `guild_id`, `boss_type`, `hp_current`, `hp_max`, `spawned_at`, `last_attack_at` | Текущий Мировой Босс |
| `boss_damage_logs` | `id`, `boss_id`, `user_id`, `guild_id`, `damage`, `timestamp` | Логи ударов по боссу |
| `duel_history` | `user_id_1`, `user_id_2`, `winner_id`, `guild_id`, `xp_wagered`, `xp_burned`, `duel_at` | История дуэлей |
| `guild_settings` | `guild_id`, `xp_per_message`, `message_cooldown_seconds` | Конфиг гильдии |
| `user_daily_activity` | `user_id`, `guild_id`, `date`, `messages_sent`, `voice_minutes`, `activity_streak` | Ежедневная статистика |

**Критическое правило:** Все запросы должны включать `WHERE guild_id = ?` (кроме явных кросс-гильдийных агрегаций)

---

## 🚀 РАЗВЁРТЫВАНИЕ & ОКРУЖЕНИЕ

### **Collector (Node.js, Render.com)**
```bash
# Сборка
npm run build  # TSC → dist/collector.js

# Запуск локально
npm run dev    # node --watch dist/collector.js
npm start      # node dist/collector.js

# Docker
docker build -t disbot-collector .
docker run -e DISCORD_TOKEN=... -e DATABASE_URL=... disbot-collector
```

**Окружение:**
- `DISCORD_TOKEN` — Bot токен
- `DATABASE_URL` — Turso libSQL URL
- `PORT` — HTTP healthcheck (default 8000)

### **Worker (Cloudflare, Wrangler)**
```bash
# Сборка
npm run build  # TSC

# Локальный dev
npm run dev    # wrangler dev

# Deploy
npm run deploy  # wrangler deploy
```

**Bindings (в wrangler.toml):**
- `DATABASE_URL` — Turso connection
- `DATABASE_AUTH_TOKEN` — Auth token
- `DISCORD_PUBLIC_KEY` — Проверка подписей
- `DISCORD_APPLICATION_ID` — Bot ID
- `DISCORD_BOT_TOKEN` — Bot token для вебхуков

---

## 📊 АРХИТЕКТУРНЫЙ ПОТОК

```
Discord Server
    ↓
    ├─→ [Collector Daemon (Node.js)]
    │     ├→ Слушает события messageCreate, voiceStateUpdate
    │     ├→ Трекит сообщения, войс-время, квесты
    │     ├→ Генерирует ачивки, спавнит босса в БД
    │     └→ Записывает в Turso (user_id, guild_id, xp, level...)
    │
    └─→ [Discord Interactions (Slash Commands, Buttons)]
          ↓
       [Cloudflare Worker (Edge)]
          ├→ Проверяет Ed25519 подпись от Discord
          ├→ Отвечает `type: 5` (DEFERRED) мгновенно
          ├→ В фоне (ctx.waitUntil):
          │    ├→ Запрашивает БД (user, boss, inventory, market...)
          │    ├→ Рендирит PNG-карточку (React + Satori + WASM)
          │    ├→ Загружает аватар через Discord API
          │    └→ Отправляет PATCH /webhooks/@original с карточкой
          │
          └→ Обрабатывает команды:
               /rank → карточка профиля
               /duel → система дуэлей (налог 26%)
               /boss-spawn → спавн босса в канал
               /market → рынок лута между друзьями
               /quests → показать квесты дня
               /prestige → сброс уровня со звёздами
               ... и 20+ других команд
```

---

## 🔑 КЛЮЧЕВЫЕ МЕТРИКИ & КОНСТАНТЫ

| Метрика | Значение | Описание |
|---------|----------|---------|
| **Уровень расчёт** | `floor(0.1 * sqrt(xp))` | Каждый уровень требует больше XP |
| **Динамический кулдаун** | 15–120 сек | За сообщения (естественное общение) |
| **Войс-начисление** | Раз в 5 мин | Таймер для онлайна |
| **Дуэльный налог** | 26% | На сжигание валюты (экономика) |
| **Войс-буст кап** | +50% (x1.5) | За 2 часа в войсе |
| **Мировой босс кулдаун** | 10–15 мин | За удар (соло: 1–1.5ч) |
| **Босс HP** | 6,000–7,500 | За один спавн |
| **Босс таймаут** | 24 часа | Если не убили → деспавн |
| **Достижений** | 27 шт | Из Ведьмака, RDR2, HL2, мемов |
| **Редкостей предметов** | 5 грейдов | Common, Rare, Epic, Legendary, Mythic |
| **Тем карточки** | 5 шт | Default, Cyberpunk, Magma, Midnight, Emerald |

---

## 🛡️ КРИТИЧЕСКИЕ ПРАВИЛА (из CLAUDE.md)

### **Безопасность многогильдийности**
- **НИКОГДА** не писать `SELECT/UPDATE world_boss` без `WHERE guild_id = ?`
- Раньше: один `/boss-spawn` ломал боссов ВО ВСЕХ гильдиях сразу ❌

### **Discord Interactions & Дефер**
- Если >2 запроса к БД + external fetch → обязателен `type: 5` (DEFERRED)
- Раньше: синхронный `boss_atk_*` без дефера → timeout на добивающем ударе ❌

### **Локальный Gateway (Omniroute на порту 20128)**
- **ЗАПРЕЩЕНО** массовое убийство: `taskkill /F /IM node.exe`
- Это уничтожит локальный AI-шлюз → ConnectionRefused на всех запросах API ❌

---

## 📈 ЭТАП ВЫПОЛНЕНИЯ (из CLAUDE.md)

✅ Этап 0–10: **ГОТОВО** (база, карточка, квесты, стрики, дуэли, войс-дропы, ачивки, лиги, ачкос, престиж, CSV)  
🔄 **Текущий: Этап 11** — Экономика Монет 🪙, автобай, дуэли на монеты  
⏳ Этап 12–17: Классы, босс, инвентарь, рынок, рулетка, подземелья, сезонные вайпы

---

## 📝 РЕЗЮМЕ

**LevelEdge** — это **мощная RPG-экосистема на Edge-архитектуре Cloudflare**:

1. **Collector** → непрерывный трекинг Discord-активности (сообщения, войс, квесты)
2. **Worker** → молниеносные ответы на команды (<300ms) с PNG-карточками
3. **Shared** → единые типы для обоих компонентов
4. **Turso** → легкая бессерверная БД с libSQL-клиентом
5. **27 ачивок** → элемент игрификации с пасхалками из игр
6. **Мировой Босс** → кооперативный рейд-контент в одном канале
7. **Экономика** → монеты, дуэли, рынок, сет-бонусы, классы

**Итог:** Zero-cost игровой сервер на Cloudflare + Render + Turso для компании друзей.

