// Магазин /shop и кастомизация карточки (/card-customize, card_select_theme).

import { createClient } from "@libsql/client";
import { ButtonInteraction, CommandInteraction, Env, ExecutionContext } from "../types";
import { unlockAchievement } from "../db/queries";
import { UNIQUE_ITEMS, findItemById, getRarityEmoji } from "../itemsCatalog";

// ============================================
// Ротационный магазин сервера (ограниченный глобальный сток)
// Завоз: каждую среду в 16:00 UTC. Сток слота: 0..2 шт. на весь сервер.
// ============================================

interface ShopOffer {
  item_type: 'equipment' | 'streak_freeze' | 'banner';
  item_id: string;
  item_name: string;
  item_rarity: string;
  price: number;
  icon: string;
  details: string;
}

// Каталог реликвий не содержит tier 'uncommon', легендарные и мифические строго запрещены.
// Вес несуществующего uncommon (32%) отнесён к rare, вес epic расширен: 15% + 3% = 18%.
const EQUIPMENT_RARITY_WEIGHTS: Array<{ rarity: string; weight: number }> = [
  { rarity: 'common', weight: 50 },
  { rarity: 'rare', weight: 32 },
  { rarity: 'epic', weight: 18 },
];

const FREEZE_PRICE = 1800;

// Эксклюзивные темы карточки /rank — продаются только в ротационном магазине
const SHOP_BANNERS: Array<{ item_id: string; item_name: string; price: number }> = [
  { item_id: 'aurora', item_name: 'Северное Сияние', price: 3500 },
  { item_id: 'blood_moon', item_name: 'Кровавая Луна', price: 4500 },
  { item_id: 'gold_tsar', item_name: 'Царское Золото', price: 5000 },
];

const EXCLUSIVE_THEME_IDS = SHOP_BANNERS.map((b) => b.item_id);

function formatTimer(targetTs: number, nowMs: number): string {
  const diff = Math.max(0, targetTs * 1000 - nowMs);
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  return `${days} дн. ${hours} ч. ${mins} мин.`;
}

// Последняя граница завоза (среда 16:00 UTC) в unix-секундах
function getLastResetBoundary(nowMs: number): number {
  const d = new Date(nowMs);
  const reset = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 16, 0, 0, 0);
  const diffDays = (d.getUTCDay() - 3 + 7) % 7; // 3 = среда
  let boundary = reset - diffDays * 86400000;
  if (boundary > nowMs) boundary -= 7 * 86400000;
  return Math.floor(boundary / 1000);
}

function pickWeightedEquipment(excludeIds: Set<string>): (typeof UNIQUE_ITEMS)[number] | undefined {
  const pool = UNIQUE_ITEMS.filter(
    (it) => !excludeIds.has(it.item_id) && EQUIPMENT_RARITY_WEIGHTS.some((w) => w.rarity === it.rarity)
  );
  if (pool.length === 0) return undefined;
  const totalWeight = EQUIPMENT_RARITY_WEIGHTS.reduce((sum, w) => {
    const inPool = pool.filter((it) => it.rarity === w.rarity).length;
    return sum + w.weight * inPool;
  }, 0);
  let roll = Math.random() * totalWeight;
  for (const it of pool) {
    roll -= EQUIPMENT_RARITY_WEIGHTS.find((w) => w.rarity === it.rarity)!.weight;
    if (roll <= 0) return it;
  }
  return pool[pool.length - 1];
}

function equipmentDetails(it: (typeof UNIQUE_ITEMS)[number]): string {
  return `⚔️ +${it.atk} | 🛡️ +${it.def} | 🎯 +${it.crit}% | 🪙 +${it.coin}%\n*${it.description}*`;
}

function makeEquipmentOffer(it: (typeof UNIQUE_ITEMS)[number]): ShopOffer {
  const slotIcons: Record<string, string> = { weapon: '⚔️', armor: '🛡️', ring: '💍', amulet: '📜' };
  return {
    item_type: 'equipment',
    item_id: it.item_id,
    item_name: it.name,
    item_rarity: it.rarity,
    price: it.price,
    icon: slotIcons[it.slot] || '🎁',
    details: equipmentDetails(it),
  };
}

function makeFreezeOffer(): ShopOffer {
  return {
    item_type: 'streak_freeze',
    item_id: 'streak_freeze',
    item_name: 'Заморозка огонька',
    item_rarity: 'special',
    price: FREEZE_PRICE,
    icon: '🧊',
    details: 'Спасает серию активности от сгорания при пропуске дня (списывается автоматически).',
  };
}

function makeBannerOffer(b: (typeof SHOP_BANNERS)[number]): ShopOffer {
  return {
    item_type: 'banner',
    item_id: b.item_id,
    item_name: `Баннер «${b.item_name}»`,
    item_rarity: 'special',
    price: b.price,
    icon: '🎨',
    details: `Эксклюзивная тема карточки /rank. Больше нигде не продаётся.`,
  };
}

// 3 разных предмета без дублей: слот 1 — снаряжение, слот 2 — сервис (заморозка/баннер), слот 3 — любой оставшийся
function generateShopOffers(): ShopOffer[] {
  const used = new Set<string>();
  const offers: ShopOffer[] = [];

  const eq = pickWeightedEquipment(used);
  if (eq) {
    used.add(eq.item_id);
    offers.push(makeEquipmentOffer(eq));
  }

  const services = [makeFreezeOffer(), ...SHOP_BANNERS.map(makeBannerOffer)].filter((o) => !used.has(o.item_id));
  const service = services[Math.floor(Math.random() * services.length)];
  used.add(service.item_id);
  offers.push(service);

  const restPool = [
    ...UNIQUE_ITEMS.filter((it) => !used.has(it.item_id) && EQUIPMENT_RARITY_WEIGHTS.some((w) => w.rarity === it.rarity)).map(makeEquipmentOffer),
    ...[makeFreezeOffer(), ...SHOP_BANNERS.map(makeBannerOffer)].filter((o) => !used.has(o.item_id)),
  ];
  if (restPool.length > 0) {
    offers.push(restPool[Math.floor(Math.random() * restPool.length)]);
  }

  // Перемешиваем, чтобы сервисный товар не всегда был во втором слоте
  for (let i = offers.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [offers[i], offers[j]] = [offers[j], offers[i]];
  }
  return offers;
}

async function ensureShopTables(db: ReturnType<typeof createClient>): Promise<void> {
  await db.batch([
    {
      sql: `CREATE TABLE IF NOT EXISTS server_shop (
              guild_id TEXT NOT NULL,
              slot INTEGER NOT NULL,
              item_type TEXT NOT NULL,
              item_id TEXT NOT NULL,
              item_name TEXT NOT NULL,
              item_rarity TEXT NOT NULL,
              price INTEGER NOT NULL,
              stock_remaining INTEGER NOT NULL,
              updated_at INTEGER NOT NULL,
              PRIMARY KEY (guild_id, slot)
            )`,
      args: [],
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS user_theme_unlocks (
              user_id TEXT NOT NULL,
              guild_id TEXT NOT NULL,
              theme_id TEXT NOT NULL,
              unlocked_at INTEGER NOT NULL,
              PRIMARY KEY (user_id, guild_id, theme_id)
            )`,
      args: [],
    },
  ], 'write');
}

// Витрина гильдии с ленивой ротацией: нет записей или обновлялась до последней среды 16:00 UTC — перегенерация
async function getShopRowsOrRotate(db: ReturnType<typeof createClient>, gid: string) {
  await ensureShopTables(db);
  const nowSec = Math.floor(Date.now() / 1000);
  let res = await db.execute({
    sql: 'SELECT * FROM server_shop WHERE guild_id = ? ORDER BY slot',
    args: [gid],
  });
  const boundary = getLastResetBoundary(Date.now());
  const needsRotate =
    res.rows.length < 3 || res.rows.some((r) => ((r.updated_at as number) || 0) < boundary);
  if (needsRotate) {
    const offers = generateShopOffers();
    await db.batch(
      [
        { sql: 'DELETE FROM server_shop WHERE guild_id = ?', args: [gid] },
        ...offers.map((o, idx) => ({
          sql: 'INSERT INTO server_shop (guild_id, slot, item_type, item_id, item_name, item_rarity, price, stock_remaining, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          args: [gid, idx + 1, o.item_type, o.item_id, o.item_name, o.item_rarity, o.price, Math.floor(Math.random() * 3), nowSec],
        })),
      ],
      'write'
    );
    res = await db.execute({
      sql: 'SELECT * FROM server_shop WHERE guild_id = ? ORDER BY slot',
      args: [gid],
    });
  }
  return res.rows;
}

function offerDetailsByRow(row: any): string {
  const itemType = row.item_type as string;
  if (itemType === 'equipment') {
    const it = findItemById(row.item_id as string);
    return it ? equipmentDetails(it) : 'Снаряжение с бонусами к статам.';
  }
  if (itemType === 'streak_freeze') return makeFreezeOffer().details;
  return makeBannerOffer({ item_id: row.item_id as string, item_name: row.item_name as string, price: 0 }).details;
}

async function buildShopPayload(db: ReturnType<typeof createClient>, gid: string) {
  const rows = await getShopRowsOrRotate(db, gid);
  const nextReset = getLastResetBoundary(Date.now()) + 7 * 86400000;

  let description = '';
  const buttons: any[] = [];
  rows.forEach((row, idx) => {
    const slot = (row.slot as number) || idx + 1;
    const stock = (row.stock_remaining as number) || 0;
    const rarityLabel = row.item_type === 'equipment' ? `${getRarityEmoji(row.item_rarity as string)} ${row.item_rarity}` : '✨ Эксклюзив';
    const stockLabel = stock > 0 ? `📦 В наличии: **${stock}/2 шт.**` : '🔴 **РАСПРОДАНО**';
    description +=
      `**Слот ${slot}** — ${row.item_name}\n` +
      `└ ${rarityLabel} • 💰 **${(row.price as number).toLocaleString()} 🪙** • ${stockLabel}\n` +
      `└ ${offerDetailsByRow(row)}\n\n`;
    buttons.push({
      type: 2,
      custom_id: `shop_buy_${slot}`,
      style: 3,
      label: `Купить [Слот ${slot}]`,
      disabled: stock === 0,
    });
  });

  return {
    embeds: [
      {
        title: '🏪 Ротационный магазин сервера',
        description: description || 'Витрина пуста. Загляните позже!',
        color: 0xf1c40f,
        footer: {
          text: `Новый завоз через: ${formatTimer(nextReset, Date.now())} (Каждую среду в 16:00 UTC)`,
        },
      },
    ],
    components: buttons.length > 0 ? [{ type: 1, components: buttons }] : [],
  };
}

// Покупка по кнопке: CAS по стоку, оплата с личного баланса, выдача предмета
export async function handleShopBuy(
  inter: ButtonInteraction,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const uid = inter.member?.user.id;
  const gid = inter.guild_id;
  if (!uid || !gid) return Response.json({ error: "No user or guild" }, { status: 400 });
  const slot = parseInt(inter.data.custom_id.split('_').pop() || '0', 10);
  const webhookUrl = `https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${inter.token}/messages/@original`;

  ctx.waitUntil(
    (async () => {
      try {
        const db = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });
        await ensureShopTables(db);
        const rowRes = await db.execute({
          sql: 'SELECT * FROM server_shop WHERE guild_id = ? AND slot = ?',
          args: [gid, slot],
        });
        if (rowRes.rows.length === 0) {
          await fetch(webhookUrl, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: '❌ Слот пуст. Откройте /shop заново.', flags: 64 }),
          });
          return;
        }
        const row = rowRes.rows[0];
        const price = (row.price as number) || 0;
        const itemType = row.item_type as string;
        const itemId = row.item_id as string;
        const itemName = row.item_name as string;

        const userRes = await db.execute({
          sql: 'SELECT coins FROM users WHERE user_id = ? AND guild_id = ?',
          args: [uid, gid],
        });
        const coins = userRes.rows.length > 0 ? ((userRes.rows[0].coins as number) || 0) : 0;
        if (userRes.rows.length === 0) {
          await fetch(webhookUrl, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: '❌ Данные пользователя не найдены.', flags: 64 }),
          });
          return;
        }
        if (coins < price) {
          await fetch(webhookUrl, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              content: `❌ Недостаточно монет! Нужно **${price.toLocaleString()} 🪙**, у вас: **${coins.toLocaleString()} 🪙**.`,
              flags: 64,
            }),
          });
          return;
        }
        // Баннер уже разблокирован — повторная покупка бессмысленна
        if (itemType === 'banner') {
          const unlockRes = await db.execute({
            sql: 'SELECT 1 FROM user_theme_unlocks WHERE user_id = ? AND guild_id = ? AND theme_id = ?',
            args: [uid, gid, itemId],
          });
          if (unlockRes.rows.length > 0) {
            await fetch(webhookUrl, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ content: '❌ Эта тема уже разблокирована в вашей коллекции.', flags: 64 }),
            });
            return;
          }
        }

        // CAS по стоку и балансу — единая транзакция
        const casResults = await db.batch(
          [
            {
              sql: 'UPDATE server_shop SET stock_remaining = stock_remaining - 1 WHERE guild_id = ? AND slot = ? AND stock_remaining > 0',
              args: [gid, slot],
            },
            {
              sql: 'UPDATE users SET coins = coins - ? WHERE user_id = ? AND guild_id = ? AND coins >= ?',
              args: [price, uid, gid, price],
            },
          ],
          'write'
        );
        if (!casResults[0].rowsAffected) {
          await fetch(webhookUrl, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: '❌ Товар только что раскупили! Дождитесь следующей среды.', flags: 64 }),
          });
          return;
        }
        if (!casResults[1].rowsAffected) {
          // Баланс изменился между чтением и списанием — возвращаем сток на место
          await db.execute({
            sql: 'UPDATE server_shop SET stock_remaining = stock_remaining + 1 WHERE guild_id = ? AND slot = ?',
            args: [gid, slot],
          });
          await fetch(webhookUrl, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: '❌ Недостаточно монет! Ваш баланс изменился, попробуйте снова.', flags: 64 }),
          });
          return;
        }

        // Выдача предмета; при сбое — компенсация (сток + монеты)
        const nowSec = Math.floor(Date.now() / 1000);
        try {
          if (itemType === 'equipment') {
            const it = findItemById(itemId);
            if (!it) throw new Error('Товар отсутствует в каталоге');
            await db.execute({
              sql: 'INSERT INTO user_inventory (user_id, guild_id, item_name, item_id, item_type, rarity, slot, atk_bonus, def_bonus, crit_bonus, coin_bonus, is_equipped, description, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)',
              args: [uid, gid, it.name, it.item_id, 'relic', it.rarity, it.slot, it.atk, it.def, it.crit, it.coin, it.description, nowSec],
            });
          } else if (itemType === 'streak_freeze') {
            await db.execute({
              sql: 'UPDATE users SET streak_freezes = streak_freezes + 1 WHERE user_id = ? AND guild_id = ?',
              args: [uid, gid],
            });
          } else if (itemType === 'banner') {
            await db.execute({
              sql: 'INSERT INTO user_theme_unlocks (user_id, guild_id, theme_id, unlocked_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, guild_id, theme_id) DO NOTHING',
              args: [uid, gid, itemId, nowSec],
            });
          } else {
            throw new Error('Неизвестный тип товара');
          }
        } catch (grantErr) {
          console.error('[ShopRotation] Grant failed, compensating:', grantErr);
          await db.batch(
            [
              { sql: 'UPDATE server_shop SET stock_remaining = stock_remaining + 1 WHERE guild_id = ? AND slot = ?', args: [gid, slot] },
              { sql: 'UPDATE users SET coins = coins + ? WHERE user_id = ? AND guild_id = ?', args: [price, uid, gid] },
            ],
            'write'
          );
          await fetch(webhookUrl, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: '❌ Ошибка при выдаче товара. Монеты и сток возвращены, попробуйте позже.', flags: 64 }),
          });
          return;
        }

        const successText =
          itemType === 'equipment'
            ? `**${itemName}** зачислен в инвентарь! Проверьте \`/inventory\`, надеть — \`/equip\`.`
            : itemType === 'streak_freeze'
              ? '**Заморозка огонька** куплена! Она автоматически спасёт серию активности при пропуске дня.'
              : `Тема **${itemName}** разблокирована! Выберите её в \`/card-customize\` и полюбуйтесь на \`/rank\`.`;
        await fetch(webhookUrl, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            embeds: [
              {
                title: '✅ Покупка успешна!',
                description: `${successText}\n\n💰 Списано: **${price.toLocaleString()} 🪙** • Остаток: **${(coins - price).toLocaleString()} 🪙**`,
                color: 0x2ecc71,
              },
            ],
          }),
        });
      } catch (err) {
        console.error('[ShopRotation] Buy error:', err);
        await fetch(webhookUrl, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: '❌ Ошибка при покупке товара. Попробуйте позже.', flags: 64 }),
        });
      }
    })()
  );
  return Response.json({ type: 5 });
}

// Админский принудительный реролл витрины
export async function handleShopAdminReroll(
  inter: CommandInteraction,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const uid = inter.member?.user.id;
  const gid = inter.guild_id;
  if (!uid || !gid) return Response.json({ error: "No user or guild" }, { status: 400 });
  // Проверка прав администратора
  const perms = (inter.member as any)?.permissions;
  const isAdmin = perms ? (BigInt(perms) & 8n) === 8n : false;
  if (!isAdmin) {
    return Response.json({
      type: 4,
      data: { content: '❌ Эта команда доступна только администраторам сервера!', flags: 64 },
    });
  }
  const sub = inter.data.options?.[0]?.name;
  if (sub !== 'reroll') {
    return Response.json({
      type: 4,
      data: { content: '❌ Доступная подкоманда: `reroll` — принудительный новый завоз витрины.', flags: 64 },
    });
  }
  const webhookUrl = `https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${inter.token}/messages/@original`;
  ctx.waitUntil(
    (async () => {
      try {
        const db = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });
        await ensureShopTables(db);
        const nowSec = Math.floor(Date.now() / 1000);
        const offers = generateShopOffers();
        await db.batch(
          [
            { sql: 'DELETE FROM server_shop WHERE guild_id = ?', args: [gid] },
            ...offers.map((o, idx) => ({
              sql: 'INSERT INTO server_shop (guild_id, slot, item_type, item_id, item_name, item_rarity, price, stock_remaining, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
              args: [gid, idx + 1, o.item_type, o.item_id, o.item_name, o.item_rarity, o.price, Math.floor(Math.random() * 3), nowSec],
            })),
          ],
          'write'
        );
        const lines = offers
          .map((o, idx) => `**Слот ${idx + 1}:** ${o.icon} ${o.item_name} — ${o.price.toLocaleString()} 🪙`)
          .join('\n');
        await fetch(webhookUrl, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            embeds: [
              {
                title: '🔄 Витрина перегенерирована!',
                description: `Новый ассортимент с глобальным стоком:\n\n${lines}\n\nОткройте \`/shop\`, чтобы увидеть полный расклад.`,
                color: 0x2ecc71,
              },
            ],
          }),
        });
      } catch (err) {
        console.error('[ShopRotation] Reroll error:', err);
        await fetch(webhookUrl, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: '❌ Ошибка при перегенерации витрины.', flags: 64 }),
        });
      }
    })()
  );
  return Response.json({ type: 5 });
}

export async function handleCardCustomize(
  inter: CommandInteraction,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const uid = inter.member?.user.id;
  const gid = inter.guild_id;
  if (!uid || !gid) return Response.json({ error: "No user or guild" }, { status: 400 });
  try {
    const db = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });
    // Создаём таблицу user_cosmetics если её нет (на всякий случай)
    await db.execute({
      sql: `CREATE TABLE IF NOT EXISTS user_cosmetics (

              user_id TEXT NOT NULL,

              guild_id TEXT NOT NULL,

              theme_id TEXT DEFAULT 'default',

              title_id TEXT DEFAULT 'Новичок',

              badges TEXT DEFAULT '[]',

              PRIMARY KEY (user_id, guild_id)

            )`,

            args: [],

          });



          // Достаём текущие настройки и разблокированные эксклюзивные темы одним батчем
          const customRes = await db.batch(
            [
              {
                sql: `CREATE TABLE IF NOT EXISTS user_theme_unlocks (
                        user_id TEXT NOT NULL,
                        guild_id TEXT NOT NULL,
                        theme_id TEXT NOT NULL,
                        unlocked_at INTEGER NOT NULL,
                        PRIMARY KEY (user_id, guild_id, theme_id)
                      )`,
                args: [],
              },
              {
                sql: "SELECT theme_id, title_id FROM user_cosmetics WHERE user_id = ? AND guild_id = ?",
                args: [uid, gid],
              },
              {
                sql: "SELECT theme_id FROM user_theme_unlocks WHERE user_id = ? AND guild_id = ?",
                args: [uid, gid],
              },
            ],
            'write'
          );
          const cosmetRes = customRes[1];
          const unlockedThemes = new Set(customRes[2].rows.map((r) => r.theme_id as string));

          let currentTheme = "default";

          let currentTitle = "Новичок";



          if (cosmetRes.rows.length > 0) {

            currentTheme = cosmetRes.rows[0].theme_id as string;

            currentTitle = cosmetRes.rows[0].title_id as string;

          }



          // Список тем

          const themeOptions = [

            { label: "🟣 Классическая (Discord Blurple)", value: "default" },

            { label: "🌸 Киберпанк (Неоновый роз / Бирюза)", value: "cyberpunk" },

            { label: "🔥 Магма (Вулканический огонь)", value: "magma" },

            { label: "🌌 Полночь (Глубокий космос / Индиго)", value: "midnight" },

            { label: "🍃 Изумруд (Зелёный нефрит / Золото)", value: "emerald" },

          ];



          const themeLabels: Record<string, string> = {

            default: "Классическая (Discord Blurple)",

            cyberpunk: "Киберпанк (Неоновый роз / Бирюза)",

            magma: "Магма (Вулканический огонь)",

            midnight: "Полночь (Глубокий космос / Индиго)",

            emerald: "Изумруд (Зелёный нефрит / Золото)",

          };



          // Эксклюзивные баннеры ротационного магазина — в списке только разблокированные
          for (const b of SHOP_BANNERS) {
            themeLabels[b.item_id] = `Баннер «${b.item_name}» (эксклюзив)`;
            if (unlockedThemes.has(b.item_id)) {
              themeOptions.push({ label: `🎨 ${b.item_name} ★ Эксклюзив`, value: b.item_id });
            }
          }



          const result = {

            embeds: [{

              title: "🎨 Кастомизация карточки ранга",

              description: `Текущая тема: **${themeLabels[currentTheme] || currentTheme}** • Текущий титул: **${currentTitle}**\n` +
          "Выберите тему оформления из списка ниже:",
        color: 0x5865f2,
      }],
      components: [{
        type: 1,
        components: [{
          type: 3,
          custom_id: "card_select_theme",
          placeholder: "Выберите тему оформления...",
          options: themeOptions,
        }],
      }],
    };
    return Response.json({ type: 4, data: result });
  } catch (err) {
    console.error("[CardCustomize] Error:", err);
    return Response.json({
      type: 4,
      data: { content: "❌ Ошибка при загрузке настроек карточки. Попробуйте позже.", flags: 64 },
    });
  }
}

export async function handleCardSelectTheme(
  inter: ButtonInteraction,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const uid = inter.member?.user.id;
  const gid = inter.guild_id;
  if (!uid || !gid) return Response.json({ error: "No user or guild" }, { status: 400 });
  const selectedTheme = (inter.data.values as string[])?.[0];
  const baseThemes = ["default", "cyberpunk", "magma", "midnight", "emerald"];
  if (!selectedTheme || (!baseThemes.includes(selectedTheme) && !EXCLUSIVE_THEME_IDS.includes(selectedTheme))) {
    return Response.json({
      type: 4,
      data: { content: "❌ Неверная тема выбора.", flags: 64 },
    });
  }
  try {
    const db = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });
    // Создаём таблицу user_cosmetics если её нет
    await db.execute({
      sql: `CREATE TABLE IF NOT EXISTS user_cosmetics (

              user_id TEXT NOT NULL,

              guild_id TEXT NOT NULL,

              theme_id TEXT DEFAULT 'default',

              title_id TEXT DEFAULT 'Новичок',

              badges TEXT DEFAULT '[]',

              PRIMARY KEY (user_id, guild_id)

            )`,

            args: [],

          });



          // Эксклюзивные темы ротационного магазина: применяются только по разблокировке, без доплаты
          if (EXCLUSIVE_THEME_IDS.includes(selectedTheme)) {
            await db.execute({
              sql: `CREATE TABLE IF NOT EXISTS user_theme_unlocks (
                      user_id TEXT NOT NULL,
                      guild_id TEXT NOT NULL,
                      theme_id TEXT NOT NULL,
                      unlocked_at INTEGER NOT NULL,
                      PRIMARY KEY (user_id, guild_id, theme_id)
                    )`,
              args: [],
            });
            const unlockRes = await db.execute({
              sql: 'SELECT 1 FROM user_theme_unlocks WHERE user_id = ? AND guild_id = ? AND theme_id = ?',
              args: [uid, gid, selectedTheme],
            });
            if (unlockRes.rows.length === 0) {
              return Response.json({
                type: 4,
                data: { content: '🔒 Эта тема продаётся только в ротационном магазине — купите её в `/shop`.', flags: 64 },
              });
            }
            await db.execute({
              sql: "INSERT INTO user_cosmetics (user_id, guild_id, theme_id, title_id) VALUES (?, ?, ?, 'Новичок') ON CONFLICT(user_id, guild_id) DO UPDATE SET theme_id = excluded.theme_id",
              args: [uid, gid, selectedTheme],
            });
            return Response.json({
              type: 7,
              data: {
                embeds: [{
                  title: "✅ Тема успешно изменена!",
                  description: `Напишите **/rank**, чтобы увидеть обновлённую карточку!`,
                  color: 0x2ecc71,
                }],
                components: [],
              },
            });
          }



          // Платные темы: cyberpunk, magma, midnight, emerald стоят 3500 монет, default бесплатна

          const paidThemes = ['cyberpunk', 'magma', 'midnight', 'emerald'];

          const themeCost = 3500;

          if (paidThemes.includes(selectedTheme)) {

            const themeUserRes = await db.execute({

              sql: 'SELECT coins FROM users WHERE user_id = ? AND guild_id = ?',

              args: [uid, gid],

            });

            const themeCoins = themeUserRes.rows.length > 0 ? ((themeUserRes.rows[0].coins as number) || 0) : 0;

            if (themeCoins < themeCost) {

              return Response.json({

                type: 4,

                data: { content: `❌ Эта тема стоит **${themeCost.toLocaleString()} 🪙**. Ваш баланс: **${themeCoins.toLocaleString()} 🪙**.`, flags: 64 },
        });
      }
      // C6: списание атомарное, с проверкой баланса в самом UPDATE.
      // Двойной клик по кнопке больше не уводит баланс в минус.
      const themePayResult = await db.execute({
        sql: 'UPDATE users SET coins = coins - ? WHERE user_id = ? AND guild_id = ? AND coins >= ?',
        args: [themeCost, uid, gid, themeCost],
      });
      if (!themePayResult.rowsAffected) {
        return Response.json({
          type: 4,
          data: { content: `❌ Недостаточно 🪙 для покупки темы (нужно **${themeCost.toLocaleString()} 🪙**).`, flags: 64 },
        });
      }
    }
    // C6: upsert вместо INSERT OR REPLACE — REPLACE затирал купленный ранее
    // платный титул обратно на «Новичок». title_id при конфликте не трогаем.
    await db.execute({
      sql: "INSERT INTO user_cosmetics (user_id, guild_id, theme_id, title_id) VALUES (?, ?, ?, 'Новичок') ON CONFLICT(user_id, guild_id) DO UPDATE SET theme_id = excluded.theme_id",
      args: [uid, gid, selectedTheme],
    });
    // Проверка достижения vlad_right_hand - тема cyberpunk или magma
    if (selectedTheme === 'cyberpunk' || selectedTheme === 'magma') {
      const webhookUrl = `https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${inter.token}`;
      await unlockAchievement(db, uid, gid, 'vlad_right_hand', webhookUrl, env.DISCORD_APPLICATION_ID);
    }
    const result = {
      embeds: [{
        title: "✅ Тема успешно изменена!",
        description: `Напишите **/rank**, чтобы увидеть обновлённую карточку!`,
        color: 0x2ecc71,
      }],
      components: [],
    };
    return Response.json({ type: 7, data: result });
  } catch (err) {
    console.error("[CardSelectTheme] Error:", err);
    return Response.json({
      type: 4,
      data: { content: "❌ Ошибка при сохранении темы. Попробуйте позже.", flags: 64 },
    });
  }
}

export async function handleShop(
  inter: CommandInteraction,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const uid = inter.member?.user.id;
  const gid = inter.guild_id;
  if (!uid || !gid) return Response.json({ error: "No user or guild" }, { status: 400 });
  const shopItemOption = inter.data?.options?.find((o) => o.name === "item")?.value as string | undefined;
  // Без выбора товара — показываем ротационную витрину (ленивая генерация по средам 16:00 UTC)
  if (!shopItemOption) {
    ctx.waitUntil(
      (async () => {
        const webhookUrl = `https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${inter.token}/messages/@original`;
        try {
          const db = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });
          const payload = await buildShopPayload(db, gid);
          await fetch(webhookUrl, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
        } catch (err) {
          console.error("[Shop] Showcase error:", err);
          await fetch(webhookUrl, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content: "❌ Ошибка при загрузке витрины магазина. Попробуйте позже." }),
          });
        }
      })()
    );
    return Response.json({ type: 5 });
  }
  ctx.waitUntil(
    (async () => {
      const webhookUrl = `https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${inter.token}/messages/@original`;
      try {
        const db = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });
        const titleShop: Record<string, { title: string; price: number }> = {
          title_mayonez: { title: "Майонез", price: 5000 },
          title_gospodin: { title: "Господин", price: 15000 },
          title_navalny: { title: "Навальный", price: 30000 },
          title_tsar: { title: "Царь-Батюшка", price: 50000 },
        };
        const shopUserRes = await db.execute({
          sql: 'SELECT coins FROM users WHERE user_id = ? AND guild_id = ?',
          args: [uid, gid],
        });
        if (shopUserRes.rows.length === 0) {
          await fetch(webhookUrl, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content: "❌ Данные пользователя не найдены." }),
          });
          return;
        }
        const shopCoins = (shopUserRes.rows[0].coins as number) || 0;
        if (shopItemOption === "freeze") {
          // Заморозки теперь продаются только через ротационную витрину с глобальным стоком
          await fetch(webhookUrl, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              content: "🧊 Заморозки огонька теперь продаются в **ротационной витрине** `/shop` с ограниченным серверным стоком. Загляните туда!",
            }),
          });
          return;
        }
        const titleData = titleShop[shopItemOption];
        if (!titleData) {
          await fetch(webhookUrl, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content: "❌ Неизвестный товар. Используйте `/shop` без параметров, чтобы увидеть каталог." }),
          });
          return;
        }
        if (shopCoins < titleData.price) {
          await fetch(webhookUrl, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content: `❌ Недостаточно монет! Нужно **${titleData.price.toLocaleString()} 🪙**, у вас: **${shopCoins.toLocaleString()} 🪙**.` }),
          });
          return;
        }
        await db.execute({
          sql: 'UPDATE users SET coins = coins - ? WHERE user_id = ? AND guild_id = ?',
          args: [titleData.price, uid, gid],
        });
        await db.execute({
          sql: `CREATE TABLE IF NOT EXISTS user_cosmetics (

                  user_id TEXT NOT NULL,

                  guild_id TEXT NOT NULL,

                  theme_id TEXT DEFAULT 'default',

                  title_id TEXT DEFAULT 'Новичок',

                  badges TEXT DEFAULT '[]',

                  PRIMARY KEY (user_id, guild_id)

                )`,

                args: [],

              });



              await db.execute({

                sql: `INSERT INTO user_cosmetics (user_id, guild_id, title_id) VALUES (?, ?, ?)

                      ON CONFLICT(user_id, guild_id) DO UPDATE SET title_id = excluded.title_id`,

                args: [uid, gid, titleData.title],

              });



              await fetch(webhookUrl, {

                method: "PATCH",

                headers: { "Content-Type": "application/json" },

                body: JSON.stringify({

                  embeds: [{

                    title: "🎉 Покупка успешна!",

                    description: `Вы приобрели статус **${titleData.title}**! Теперь он отображается на вашей карточке /rank!`,
              color: 0xF1C40F,
            }],
          }),
        });
      } catch (err) {
        console.error("[Shop] Error:", err);
        await fetch(`https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${inter.token}/messages/@original`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: "❌ Ошибка при покупке товара. Попробуйте позже." }),
        });
      }
    })()
  );
  return Response.json({ type: 5 });
}
