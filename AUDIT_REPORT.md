## 9. Аудит биржи, торговли и финансовых операций

> **Область проверки:** `worker/src/commands/{invest,stocks,company,market,trade,duel}.ts`, `worker/src/db/queries.ts`.
> **Дата:** 2026-09-20. **Итог:** 2 критических, 6 средних, 8 мелких находок.
> **Ограничение аудита:** обработчики кнопок `trade_accept_*` / `trade_decline_*` в переданные файлы не входят — корректность завершения прямых сделок проверена лишь частично (см. M-5).

### 9.1. Биржа и акции (invest / divest / stocks / company)

**Проверено — уязвимостей не найдено:**

- **Деление на ноль.** В `invest.ts` расчёт цены защищён проверкой `if (treasury < 1 || circulating <= 0)`; в `divest.ts`, `stocks.ts` и `portfolio` используется тернарник `circulating > 0 ? ... : 0`. Ceil-деление `(amount * treasury + circulating - 1) / circulating` целочисленно.
- **Уход в минус.** Все списания — условные UPDATE (`coins >= ?`, `available_shares >= ?`, `treasury >= ?`) с проверкой `rowsAffected` внутри write-транзакции. Уйти в минус по монетам и акциям нельзя.
- **Валидация amount.** `parseAmount()` отклоняет 0, отрицательные, дробные и `NaN`.
- **Двойной клик «Купить»/«Продать».** Каждый клик — отдельная валидная операция: монеты списываются за каждую, дюп акций невозможен (прирост `company_shares` идёт после атомарного условного UPDATE). Исключение — гонка B-1 для владельца при продаже.
- **Создание компании.** Атомарное списание стоимости (первая — 1000, далее `1000 + count * 30000`), проверка дублей тикера/имени без учёта регистра, санитизация разметки.

#### [СРЕДНИЙ] B-1. Гонка при продаже акций владельцем — контрольный пакет может уйти ниже 51

- **Файл/функция:** `worker/src/commands/invest.ts` → `handleDivest`.
- **Суть:** проверка «владелец должен сохранить ≥ 51 акцию» выполняется в JS **до** UPDATE по данным из SELECT. Две параллельные продажи владельцем (двойной клик) обе проходят проверку (`60 - 9 = 51` — ок у обоих), а условный UPDATE `shares_count >= ?` им не мешает → после второй продажи у владельца 42 акции. Контроль над компанией размыт.

**Исправление** (перенести инвариант в SQL):

```ts
// Контрольный пакет владельца не продаётся — проверка на уровне SQL (CAS)
const isOwner = String(c.owner_id) === String(sellerId);
const decRes = await tx.execute({
  sql: isOwner
    ? "UPDATE company_shares SET shares_count = shares_count - ? WHERE user_id = ? AND company_id = ? AND shares_count >= ? AND shares_count - ? >= 51"
    : "UPDATE company_shares SET shares_count = shares_count - ? WHERE user_id = ? AND company_id = ? AND shares_count >= ?",
  args: isOwner
    ? [amount, sellerId, companyId, amount, amount]
    : [amount, sellerId, companyId, amount],
});
if (!decRes.rowsAffected || decRes.rowsAffected === 0) {
  throw new Error("Недостаточно акций (владелец должен сохранить минимум 51 акцию)");
}
```

Строку с JS-проверкой `if (String(c.owner_id) === String(sellerId) && sharesCount - amount < 51) ...` удалить.

#### [МЕЛКИЙ] B-2. Уникальность тикера компании держится только на SELECT-проверке

- **Файл/функция:** `worker/src/commands/company.ts` → `handleCompanyCreate`.
- **Суть:** проверка «тикер занят» — SELECT внутри интерактивной write-транзакции (это сильно снижает риск), но единственная настоящая защита от параллельного создания — ограничение уровня БД.

**Исправление** (миграция):

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_guild_ticker ON companies(guild_id, ticker);
```

Повторная вставка бросит ошибку, транзакция откатится, игрок получит «Тикер занят».

### 9.2. Маркетплейс и обмен (market / trade)

**Ответ на ключевой вопрос:** лот **НЕ** защищён CAS'ом — в `market_listings` нет поля `status`, лот удаляется из БД **в конце** цепочки платежей. Это и порождает критический дюп ниже.

#### [КРИТИЧЕСКИЙ] M-1. Двойная покупка одного лота двумя игроками: нет атомарного захвата листинга

- **Файл/функция:** `worker/src/commands/market.ts` → `handleMarket` (ветка `action === "buy"`).
- **Суть:** два параллельных покупателя оба проходят проверки (лот существует → баланс → предмет у продавца), оба атомарно списывают монеты, продавцу начисляется цена **дважды**, а `UPDATE user_inventory SET user_id = ?` выполняется без условия `user_id = seller_id` — предмет достаётся тому, кто записался последним. Первый покупатель остаётся без монет и без предмета. Печать монет из воздуха + прямая потеря средств игрока.

**Исправление** (минимальное — атомарный захват лота ДО движения денег; DELETE играет роль CAS):

```ts
// ... все проверки listing/баланса/предмета как сейчас ...

// ШАГ 1: атомарный захват лота. Параллельный покупатель получит rowsAffected = 0.
const claimRes = await db.execute({
  sql: 'DELETE FROM market_listings WHERE id = ? AND guild_id = ?',
  args: [itemOption, gid],
});
if (!claimRes.rowsAffected) {
  await fetch(webhookUrl, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: "⚠️ Лот уже куплен другим игроком!", flags: 64 }),
  });
  return;
}

// ШАГ 2: списание монет покупателя (уже атомарное, с coins >= ?)
const buyerDeduct = await db.execute({
  sql: 'UPDATE users SET coins = coins - ? WHERE user_id = ? AND guild_id = ? AND coins >= ?',
  args: [price, uid, gid, price],
});
if (!buyerDeduct.rowsAffected) {
  // Компенсация: оплата не прошла — возвращаем лот в продажу
  await db.execute({
    sql: 'INSERT INTO market_listings (guild_id, seller_id, inventory_id, price, created_at) VALUES (?, ?, ?, ?, ?)',
    args: [gid, sellerId, inventoryId, price, Math.floor(Date.now() / 1000)],
  });
  // ... существующее сообщение «недостаточно монет», return
}

// ШАГ 3: передача предмета — строго от продавца (защита от перезаписи чужой передачи)
await db.execute({
  sql: 'UPDATE user_inventory SET user_id = ? WHERE id = ? AND guild_id = ? AND user_id = ?',
  args: [uid, inventoryId, gid, sellerId],
});
```

Существующий отдельный `DELETE FROM market_listings ...` в конце цепочки удалить — лот уже захвачен.

#### [КРИТИЧЕСКИЙ] M-2. Покупка — цепочка из 4 независимых запросов без транзакции

- **Файл/функция:** `worker/src/commands/market.ts` → `handleMarket` (ветка `buy`).
- **Суть:** «списание покупателя → начисление продавцу → передача предмета → удаление лота» — отдельные `db.execute`. Сбой/рестарт воркера между шагами: монеты списаны, предмет не передан; или предмет передан, продавцу не начислено. Правильный образец уже есть в проекте — интерактивная транзакция в `invest.ts`.

**Исправление** (предпочтительнее фикса из M-1): обернуть всю покупку в транзакцию — тогда компенсационные ветки не нужны:

```ts
const tx = await db.transaction("write");
try {
  // захват лота (DELETE + rowsAffected), списание, начисление, передача — через tx.execute
  await tx.commit();
} catch (err) {
  await tx.rollback().catch(() => {});
  throw err;
} finally {
  tx.close();
}
```

#### [СРЕДНИЙ] M-3. Один предмет можно выставить на рынок несколько раз

- **Файл/функция:** `worker/src/commands/market.ts` → `handleMarket` (ветка `sell`).
- **Суть:** нет проверки существующего лота по `inventory_id`. Двойной `/market sell` создаёт два лота на один предмет; в сочетании с M-1 усиливает дюп.

**Исправление:**

```ts
const dupRes = await db.execute({
  sql: 'SELECT 1 FROM market_listings WHERE inventory_id = ? AND guild_id = ?',
  args: [itemOption, gid],
});
if (dupRes.rows.length > 0) {
  // ❌ Этот предмет уже выставлен на рынок!
  return;
}
```

Плюс ограничение на уровне БД (см. раздел 9.6).

#### [СРЕДНИЙ] M-4. trade: цена не валидируется, разрешена сделка с самим собой

- **Файл/функция:** `worker/src/commands/trade.ts` → `handleTrade`.
- **Суть:** проверяется только `priceOption !== undefined/null` — отрицательная и дробная цена проходят. Отрицательная цена на accept обращает направление перевода монет (`coins - price` в обработчике кнопок), что ломает экономику. Нет запрета `target === uid`.

**Исправление:**

```ts
if (!Number.isInteger(priceOption) || priceOption < 0) {
  return Response.json({
    type: 4,
    data: { content: "❌ Цена должна быть целым числом >= 0!", flags: 64 },
  });
}
if (targetOption === uid) {
  return Response.json({
    type: 4,
    data: { content: "❌ Нельзя совершить сделку с самим собой!", flags: 64 },
  });
}
```

#### [СРЕДНИЙ] M-5. pending-сделка не резервирует предмет (риск дюпа/потери на accept)

- **Файл/функция:** `worker/src/commands/trade.ts` → `handleTrade` + обработчик кнопок `trade_accept_*` (в аудит не передан).
- **Суть:** предмет остаётся полностью доступным продавцу, пока сделка в `pending`: его можно продать на рынке, сдать как хлам (`/sell-junk`) или вложить в несколько сделок одновременно. Обработчик принятия обязан: (1) ревалидировать владение (`WHERE user_id = ? AND guild_id = ?`, `is_equipped = 0`); (2) передавать предмет атомарно с условием `user_id = sender`; (3) переводить сделку CAS-ом (`WHERE status = 'pending'`), как в дуэлях (C3). Иначе — дюп предмета или обмен «из воздуха».

**Исправление** (шаблон для обработчика accept):

```ts
const claimRes = await db.execute({
  sql: "UPDATE direct_trades SET status = 'accepted' WHERE id = ? AND status = 'pending' AND target_id = ?",
  args: [tradeId, uid],
});
if (!claimRes.rowsAffected) { /* сделка уже обработана */ }
// далее — ревалидация и атомарная передача предмета:
// UPDATE user_inventory SET user_id = ? WHERE id = ? AND guild_id = ? AND user_id = ? AND is_equipped = 0
```

> Рекомендуется передать файл с обработчиками кнопок на аудит в следующей итерации.

#### [МЕЛКИЙ] M-6. market buy: нет запрета покупки собственного лота

- **Файл/функция:** `worker/src/commands/market.ts` → `handleMarket` (`buy`).
- **Суть:** экономически это ноль (монеты ходят по кругу), но засоряет историю и статистику рынка.

**Исправление:**

```ts
if (sellerId === uid) {
  // ❌ Нельзя покупать собственный лот!
  return;
}
```

#### [МЕЛКИЙ] M-7. market sell: цена проверяется через falsy и без целочисленности

- **Файл/функция:** `worker/src/commands/market.ts` → `handleMarket` (`sell`).
- **Суть:** `if (!itemOption || !priceOption)` — цена `0` даёт вводящее в заблуждение сообщение «Используйте: ...», дробная цена (`10.5`) проходит и ломает целочисленную модель экономики.

**Исправление:**

```ts
if (itemOption === undefined || !Number.isInteger(priceOption) || priceOption <= 0) {
  // ❌ Используйте: /market sell item_id:ID price:ЦЕНА (цена — целое число > 0)
  return;
}
```

#### [МЕЛКИЙ] M-8. Получение ID вставленной строки отдельным SELECT — гонка

- **Файл/функция:** `worker/src/db/queries.ts` → `addMarketListing`; `worker/src/commands/trade.ts` → `handleTrade`.
- **Суть:** `SELECT last_insert_rowid()` отдельным запросом может выполниться на другом соединении пула и вернуть чужой ID. В `company.ts` уже используется правильный способ — `lastInsertRowid` из результата execute.

**Исправление:**

```ts
const res = await db.execute({
  sql: 'INSERT INTO market_listings (guild_id, seller_id, inventory_id, price, created_at) VALUES (?, ?, ?, ?, ?)',
  args: [guildId, sellerId, inventoryId, price, now],
});
return Number(res.lastInsertRowid) || 0;
```

### 9.3. Дуэли (duel.ts)

**Проверено — уязвимостей не найдено:**

- **Создал дуэль → потратил монеты → соперник принял.** Ставка НЕ списывается при создании, только проверяется. При accept оба списания атомарны (`coins >= ?` / `xp >= ?`); если у кого-то не хватило — ветка C2 возвращает уже списанное вызывавшему и переводит дуэль в `declined`. Средства не теряются.
- **Возврат при отклонении/таймауте.** Не требуется: до accept монеты не списывались. Таймаут (`getExpiredDuels` + `expireDuelById`) атомарно закрывает только `pending`-дуэли.
- **Двойной клик «Принять» / параллельный accept.** Защищён CAS-переводом статуса (`UPDATE ... WHERE status = 'pending'`, C3): победитель гонки платит выигрыш, проигравший — возвращает обе ставки. Расхождений нет.
- **Дуэль с самим собой** запрещена (`opponentOption === challengerId`).

#### [СРЕДНИЙ] D-1. winner_id, roll_1, roll_2 не сохраняются в БД

- **Файл/функция:** `worker/src/commands/duel.ts` → `handleDuelButtons` (ветка `duel_accept_`).
- **Суть:** при завершении выполняется только `UPDATE duels SET status = 'completed'`. Итог (победитель, броски, время) нигде не хранится: статистика побед, история и будущие ачивки по дуэлям невозможны, спорные ситуации не расследуются. Достижения текущего боя считаются по переменным в памяти и в БД не верифицируются.

**Исправление** (после успешного `updateDuelStatus(db, duelId, "completed")`):

```ts
await db.execute({
  sql: "UPDATE duels SET winner_id = ?, roll_1 = ?, roll_2 = ?, finished_at = ? WHERE id = ?",
  args: [winnerId, roll1, roll2, Math.floor(Date.now() / 1000), duelId],
});
```

и миграция (см. раздел 9.6).

#### [МЕЛКИЙ] D-2. Уровень проигравшего не пересчитывается после потери XP

- **Файл/функция:** `worker/src/commands/duel.ts` → `handleDuelButtons` (XP-ветка).
- **Суть:** после списания ставки XP проигравшему уровень не пересчитывается — `level` остаётся завышенным до следующего начисления XP.

**Исправление:**

```ts
await updateXpAndLevel(db, winnerId, guildId, winnerProfit);
await updateXpAndLevel(db, loserId, guildId, 0); // пересчёт уровня проигравшего
```

#### [МЕЛКИЙ] D-3. Оппонент-бот не отфильтровывается

- **Файл/функция:** `worker/src/commands/duel.ts` → `handleDuel`.
- **Суть:** в коде только комментарий-заглушка; боту можно отправить вызов и повесить «вечную» pending-дуэль.

**Исправление:**

```ts
const opponentUser = inter.data?.resolved?.users?.[opponentOption];
if (opponentUser?.bot) {
  return Response.json({ type: 4, data: { content: "❌ Нельзя вызывать на дуэль ботов!", flags: 64 } });
}
```

#### [МЕЛКИЙ] D-4. decline: не проверяется результат updateDuelStatus

- **Файл/функция:** `worker/src/commands/duel.ts` → `handleDuelButtons` (ветка `duel_decline_`).
- **Суть:** если дуэль завершилась параллельно, CAS-UPDATE вернёт `false`, но игрок всё равно увидит «Дуэль отменена». Косметика + путаница в логах.

**Исправление:**

```ts
const declined = await updateDuelStatus(db, duelId, "declined");
if (!declined) {
  return Response.json({ type: 4, data: { content: "⚠️ Эта дуэль уже завершена.", flags: 64 } });
}
const result = buildDuelDeclineEmbed(challengerId, opponentId);
return Response.json({ type: 7, data: result });
```

### 9.4. queries.ts — финансовые хелперы

#### [СРЕДНИЙ] Q-1. updateCoins: read-modify-write без атомарности

- **Файл/функция:** `worker/src/db/queries.ts` → `updateCoins`.
- **Суть:** `SELECT coins` → вычисление в JS → `UPDATE coins = ?`. Параллельная операция между чтением и записью теряется (last-write-wins) — «исчезающие» монеты при одновременно идущих дуэлях/рынке/продаже хлама.

**Исправление:**

```ts
export async function updateCoins(db: any, userId: string, guildId: string, coinChange: number): Promise<number> {
  try {
    const res = await db.execute({
      // Атомарно: прибавление и клэмп на 0 одним UPDATE
      sql: "UPDATE users SET coins = MAX(0, coins + ?) WHERE user_id = ? AND guild_id = ?",
      args: [coinChange, userId, guildId],
    });
    if (!res.rowsAffected) return 0;
    const read = await db.execute({
      sql: "SELECT coins FROM users WHERE user_id = ? AND guild_id = ?",
      args: [userId, guildId],
    });
    return (read.rows[0]?.coins as number) || 0;
  } catch (err) {
    console.error("[Duel] Error updating coins:", err);
    return 0;
  }
}
```

#### [МЕЛКИЙ] Q-2. updateXpAndLevel: та же гонка

- **Файл/функция:** `worker/src/db/queries.ts` → `updateXpAndLevel`.
- **Суть:** идентичная read-modify-write гонка для XP. Простым SQL-инкрементом не обойтись (уровень вычисляется от абсолютного XP), минимум — считать дельту атомарно и пересчитывать уровень отдельным шагом; в перспективе — хранить уровень как чистую функцию от XP.

### 9.5. Сводная таблица

| ID | Уровень | Файл | Функция | Суть |
|----|---------|------|---------|------|
| M-1 | КРИТИЧЕСКИЙ | market.ts | handleMarket (buy) | Нет CAS-захвата лота: двойная продажа, двойная оплата продавцу, потеря монет покупателя |
| M-2 | КРИТИЧЕСКИЙ | market.ts | handleMarket (buy) | 4 независимых запроса без транзакции — рассинхронизация при сбое |
| B-1 | СРЕДНИЙ | invest.ts | handleDivest | Контрольный пакет 51 акция защищён только JS-проверкой до UPDATE |
| M-3 | СРЕДНИЙ | market.ts | handleMarket (sell) | Дублирование лотов по одному inventory_id |
| M-4 | СРЕДНИЙ | trade.ts | handleTrade | Цена не валидируется (отрицательная/дробная), разрешена сделка с собой |
| M-5 | СРЕДНИЙ | trade.ts | handleTrade + accept | pending-сделка не резервирует предмет; нужна ревалидация и CAS на accept |
| Q-1 | СРЕДНИЙ | db/queries.ts | updateCoins | read-modify-write — потеря монет при параллельных операциях |
| D-1 | СРЕДНИЙ | duel.ts | handleDuelButtons | winner_id / roll_1 / roll_2 не сохраняются в duels |
| B-2 | МЕЛКИЙ | company.ts | handleCompanyCreate | Нет UNIQUE-индекса (guild_id, ticker) |
| M-6 | МЕЛКИЙ | market.ts | handleMarket (buy) | Нет запрета покупки собственного лота |
| M-7 | МЕЛКИЙ | market.ts | handleMarket (sell) | Falsy-проверка цены, нет проверки целочисленности |
| M-8 | МЕЛКИЙ | db/queries.ts | addMarketListing, trade.ts | last_insert_rowid отдельным SELECT — гонка |
| D-2 | МЕЛКИЙ | duel.ts | handleDuelButtons | Уровень проигравшего не пересчитывается |
| D-3 | МЕЛКИЙ | duel.ts | handleDuel | Оппонент-бот не фильтруется |
| D-4 | МЕЛКИЙ | duel.ts | handleDuelButtons | Результат updateDuelStatus в decline не проверяется |
| Q-2 | МЕЛКИЙ | db/queries.ts | updateXpAndLevel | Та же read-modify-write гонка для XP/уровня |

### 9.6. Рекомендуемые миграции БД

```sql
-- B-2: защита тикера компании
CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_guild_ticker ON companies(guild_id, ticker);

-- M-3: один активный лот на предмет
CREATE UNIQUE INDEX IF NOT EXISTS idx_market_listings_inventory ON market_listings(inventory_id);

-- D-1: итоги дуэлей
ALTER TABLE duels ADD COLUMN winner_id TEXT;
ALTER TABLE duels ADD COLUMN roll_1 INTEGER;
ALTER TABLE duels ADD COLUMN roll_2 INTEGER;
ALTER TABLE duels ADD COLUMN finished_at INTEGER;
```

> **Приоритет исправлений:** M-1 → M-2 → Q-1 → B-1 → M-3 / M-4 / M-5 → остальное.
