import { Buffer } from "node:buffer";
import { createClient } from "@libsql/client";
import { calculateLevel, getXpProgress } from "@shared/types";
import satori from "satori";
import { Resvg, initWasm } from "@resvg/resvg-wasm";
// @ts-ignore
import resvgWasm from "@resvg/resvg-wasm/index_bg.wasm";
// @ts-ignore
import fontData from "../assets/Inter-Regular.ttf";
import { Card, CardProps } from "./Card";

// ============================================
// Каталог уникальных реликвий (Этап 14)
// ============================================
import { UNIQUE_ITEMS, getRarityColor, getRarityEmoji, findItemById } from "./itemsCatalog";

// ============================================
// Описания Мировых Боссов (Этап 13)
// ============================================
const BOSS_DESCRIPTIONS: Record<string, string> = {
  dragon: 'Обычные тычки наносят -25% урона. Пробивают скиллы и ульты!',
  mimic: 'Быстрый босс на 12ч! Каждый удар выбивает +15..40 🪙 прямо в карман!',
  leviathan: 'Войс-буст работает в 2 раза сильнее (+50%/час, кап +100%)!',
  phantom: 'Кулдаун ударов 6 минут вместо 10! Скоростной бой.',
};

// ============================================
// Система достижений (Этап 6 - 27 секретных пасхалок)
// ============================================

interface Achievement {
  id: string;
  title: string;
  description: string;
  quote: string;
  reward: number;
}

// 27 достижений из CLAUDE.md
const ACHIEVEMENTS_LIST: Achievement[] = [
  // --- Ведьмак 3 ---
  {
    id: 'witcher_plod',
    title: '🐺 Шевелись, Плотва!',
    description: 'Отправить сообщение ровно через 30-35 сек после предыдущего',
    quote: 'Лютик, бл#ть...',
    reward: 150,
  },
  {
    id: 'witcher_gwent',
    title: '🃏 В Гвинт не сыграешь?',
    description: 'Сыграть 3 дуэли за один день',
    quote: 'Кивает молча и достаёт колоду Королевств Севера.',
    reward: 200,
  },
  {
    id: 'witcher_damn',
    title: '🐺 Зараза...',
    description: 'Проиграть дуэль с броском кубика меньше 10',
    quote: 'Ветер воет...',
    reward: 100,
  },
  {
    id: 'witcher_blaviken',
    title: '⚔️ Мясник из Блавикена',
    description: 'Выиграть 3 дуэли подряд без поражений',
    quote: 'Если приходится выбирать между злом и злом...',
    reward: 350,
  },
  {
    id: 'witcher_coin',
    title: '🪙 Чеканная монета',
    description: 'Зафиксировать ровно 1000, 2000, 3000 или 5000 XP',
    quote: 'Зачтётся всё это вам!',
    reward: 250,
  },
  // --- Red Dead Redemption 2 ---
  {
    id: 'rdr_plan',
    title: '🤠 У меня есть ПЛАН!',
    description: 'Накопить 3000+ XP, ни разу не проиграв в дуэлях',
    quote: 'Нам просто нужно больше денег, Артур!',
    reward: 300,
  },
  {
    id: 'rdr_lenny',
    title: '🍻 ЛИИИННИИИИ!',
    description: 'Отправить капс-сообщение 10+ букв ночью с 02:00 до 05:00',
    quote: 'YNNEL?! ГДЕ ТЫ, ЛЕННИ?!',
    reward: 150,
  },
  {
    id: 'rdr_quickdraw',
    title: '🎯 Быстрая рука',
    description: 'Выиграть дуэль с броском 95+',
    quote: 'На этом сервере место только для одного.',
    reward: 250,
  },
  {
    id: 'rdr_tahiti',
    title: '🥭 Билет на Таити',
    description: 'Провести более 5 часов в войсе за день',
    quote: 'Мы будем выращивать манго и жить припеваючи.',
    reward: 300,
  },
  {
    id: 'rdr_tax',
    title: '💰 Капитализм, Артур',
    description: 'Сжечь более 200 XP на налоге с дуэлей',
    quote: 'Мы воры в мире, которому мы больше не нужны.',
    reward: 200,
  },
  // --- Владивосток и ДВ ---
  {
    id: 'vlad_2000',
    title: '🌊 Владивосток 2000',
    description: 'Оказаться ровно с 2000 XP на балансе',
    quote: 'Уходим, уходим, уходят кометы...',
    reward: 200,
  },
  {
    id: 'vlad_midnight',
    title: '⚓ Полночь на Эгершельде',
    description: 'Отправить сообщение ровно в 00:00 (Владивосток)',
    quote: 'Маяк светит, квесты сбросились.',
    reward: 200,
  },
  {
    id: 'vlad_pyanse',
    title: '🥟 Пян-се на Луговой',
    description: 'Быть активным в чате во время обеда с 12:00 до 13:00 (Владивосток)',
    quote: 'С пылу с жару, с перцем и капустой.',
    reward: 120,
  },
  {
    id: 'vlad_typhoon',
    title: '🌪️ Тайфун прошёл стороной',
    description: 'Спасти стрик с помощью заморозки',
    quote: 'Опять передавали штормовое, но обошлось.',
    reward: 250,
  },
  {
    id: 'vlad_right_hand',
    title: '🚗 Истинный праворульщик',
    description: 'Сменить тему на Киберпанк или Магму',
    quote: 'Руль в бардачке, едем боком.',
    reward: 100,
  },
  {
    id: 'vlad_golden_horn',
    title: '🌉 Хозяин Золотого Рога',
    description: 'Занять 1-е место в лидерборде сервера',
    quote: 'Мост построили, сервер держим.',
    reward: 500,
  },
  // --- Half-Life 2 ---
  {
    id: 'hl_wakeup',
    title: '🚆 Проснитесь и попойте',
    description: 'Отправить сообщение с 06:00 до 07:00 утра (Владивосток)',
    quote: 'Нужный человек не в том месте...',
    reward: 150,
  },
  {
    id: 'hl_can',
    title: '🥫 Подними эту банку',
    description: 'Выполнить свой первый ежедневный квест',
    quote: 'А теперь брось её в урну.',
    reward: 100,
  },
  {
    id: 'hl_water',
    title: '💧 Не пейте воду',
    description: 'Провести 2 часа непрерывно в войсе',
    quote: 'Они туда что-то подмешивают...',
    reward: 250,
  },
  {
    id: 'hl_crowbar',
    title: '🪓 Монтировка против страйдера',
    description: 'Победить в дуэли оппонента, у которого уровень выше твоего на 2+',
    quote: 'Физика Source на твоей стороне.',
    reward: 300,
  },
  {
    id: 'hl_airdrop',
    title: '📦 Ящик сопротивления',
    description: 'Первым забрать контейнер войс-дропа',
    quote: 'Сигнальная ракета сработала.',
    reward: 150,
  },
  // --- Мемы / Навальный ---
  {
    id: 'fbk_hello',
    title: '📣 Привет, это Навальный',
    description: 'Написать сообщение после 3+ дней отсутствия на сервере',
    quote: 'Я не молчал, я просто был в оффлайне!',
    reward: 150,
  },
  {
    id: 'fbk_sandwich',
    title: '🥪 Не бутерброд',
    description: 'Удержать стрик активности ровно 14 дней',
    quote: 'Стрик — он что, бутерброд, чтобы его сбрасывать?',
    reward: 250,
  },
  {
    id: 'fbk_final_battle',
    title: '⚔️ Финальная битва',
    description: 'Сыграть дуэль со ставкой от 1000 XP',
    quote: 'Финальная битва добра с нейтралитетом!',
    reward: 300,
  },
  {
    id: 'fbk_investigation',
    title: '🕵️ Команда расследователей',
    description: 'Посмотреть карточки и /rank 5 разных людей за день',
    quote: 'Мы нашли у него незадекларированный уровень.',
    reward: 150,
  },
  {
    id: 'fbk_prb',
    title: '☀️ Прекрасный Сервер Будущего',
    description: 'Закрыть все 3 дейлика за один день',
    quote: 'Россия будет счастливой, а опыт нафармлен.',
    reward: 250,
  },
  // --- Классика ---
  {
    id: 'lucky_777',
    title: '🎰 Три топора',
    description: 'Зафиксировать ровно 777 XP на балансе',
    quote: 'Поднял бабла, теперь в топе.',
    reward: 250,
  },
  {
    id: 'casino_house',
    title: '🎲 Казино всегда в плюсе',
    description: 'Сжечь более 100 XP налога в одной дуэли',
    quote: 'Карты с самого начала были краплеными.',
    reward: 150,
  },
];

interface Env {
  DATABASE_URL: string;
  DATABASE_AUTH_TOKEN: string;
  DISCORD_PUBLIC_KEY: string;
  DISCORD_APPLICATION_ID: string;
  DISCORD_BOT_TOKEN: string;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

interface DiscordInteraction {
  id: string;
  token: string;
  type: number;
  data?: {
    name?: string;
    options?: { name: string; value: any }[];
    custom_id?: string;
    values?: string[];
    resolved?: { users?: { [id: string]: { username: string; discriminator: string; avatar?: string | null } }; members?: { [id: string]: any } };
  } | {
    name: string;
    options?: { name: string; value: any }[];
    custom_id?: string;
    values?: string[];
    resolved?: { users?: { [id: string]: { username: string; discriminator: string; avatar?: string | null } }; members?: { [id: string]: any } };
  };
  member?: {
    user: { id: string; username: string; avatar: string | null; discriminator: string };
    id: string;
    permissions?: string;
  };
  guild_id?: string;
  message?: { components?: any[]; embeds?: any[] };
}

// ============================================
// Вспомогательные утилиты (WASM, Дата, Бары)
// ============================================

async function unlockAchievement(
  db: any,
  userId: string,
  guildId: string,
  achievementId: string,
  webhookUrl: string,
  appId: string
): Promise<void> {
  try {
    const achievement = ACHIEVEMENTS_LIST.find((a) => a.id === achievementId);
    if (!achievement) return;

    // Проверяем, не открыто ли уже достижение
    const existing = await db.execute({
      sql: "SELECT 1 FROM user_achievements WHERE user_id = ? AND guild_id = ? AND achievement_id = ?",
      args: [userId, guildId, achievementId],
    });

    if (existing.rows.length > 0) return;

    // Вставляем запись о достижении
    const now = Math.floor(Date.now() / 1000);
    await db.execute({
      sql: "INSERT INTO user_achievements (user_id, guild_id, achievement_id, unlocked_at) VALUES (?, ?, ?, ?)",
      args: [userId, guildId, achievementId, now],
    });

    // Отправляем уведомление в Discord через webhook
    const embed = {
      embeds: [
        {
          title: `🎉 Достижение разблокировано!`,
          description: `<@${userId}> открыл **"${achievement.title}"**!`,
          color: 0xF1C40F,
          fields: [
            { name: "Награда", value: `+${achievement.reward} XP`, inline: true },
            { name: "Цитата", value: `"${achievement.quote}"`, inline: false },
          ],
          footer: { text: achievement.description },
        },
      ],
    };

    // Асинхронная отправка без блокировки
    fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(embed),
    }).catch(() => {});
  } catch (err) {
    console.error(`[Achievement] Error unlocking ${achievementId}:`, err);
  }
}

let wasmInitPromise: Promise<void> | null = null;
function ensureWasmInitialized(): Promise<void> {
  if (!wasmInitPromise) wasmInitPromise = initWasm(resvgWasm);
  return wasmInitPromise;
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  return bytes;
}

async function verifyDiscordSignature(sig: string, ts: string, body: string, pk: string): Promise<boolean> {
  try {
    const tsData = new TextEncoder().encode(ts);
    const bData = new TextEncoder().encode(body);
    const msgData = new Uint8Array(tsData.length + bData.length);
    msgData.set(tsData);
    msgData.set(bData, tsData.length);
    const pkBytes = hexToBytes(pk);
    const sigBytes = hexToBytes(sig);
    const key = await crypto.subtle.importKey("raw", pkBytes, { name: "Ed25519" } as any, false, ["verify"]);
    return await crypto.subtle.verify("Ed25519", key, sigBytes, msgData);
  } catch (err) {
    console.error("[Error] Sig verify failed:", err);
    return false;
  }
}

function getVladivostokDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Vladivostok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function renderProgressBar(current: number, target: number, length: number = 10): string {
  const ratio = Math.min(Math.max(current / target, 0), 1);
  const filled = Math.round(ratio * length);
  const empty = length - filled;
  return "█".repeat(filled) + "░".repeat(empty);
}

// ============================================
// Система реликвий и экипировки (Этап 14)
// ============================================

// Формат строки предмета в инвентаре
function formatInventoryItem(item: any, itemId: number): string {
  const atk = (item.atk_bonus as number) || 0;
  const def = (item.def_bonus as number) || 0;
  const crit = (item.crit_bonus as number) || 0;
  const coin = (item.coin_bonus as number) || 0;
  const isEquipped = (item.is_equipped as number) || 0;
  const rarityEmoji = getRarityEmoji(item.rarity as string);
  return `[ID #${itemId}] ${rarityEmoji} **${item.item_name}** (${item.rarity}) ${isEquipped ? '⭐ [НАДЕТО]' : ''}\n` +
    `└ ⚔️ +${atk} | 🛡️ +${def} | 🎯 +${crit}% | 🪙 +${coin}%\n`;
}

// Достать предмет по ID
async function getInventoryItem(db: any, itemId: number, userId: string, guildId: string): Promise<any | null> {
  const res = await db.execute({
    sql: 'SELECT * FROM user_inventory WHERE id = ? AND user_id = ? AND guild_id = ?',
    args: [itemId, userId, guildId],
  });
  return res.rows.length > 0 ? res.rows[0] : null;
}

// Достать предмет по item_id (для проверки уникальности)
async function getInventoryItemByItemId(db: any, itemId: string, guildId: string): Promise<any | null> {
  const res = await db.execute({
    sql: 'SELECT * FROM user_inventory WHERE item_id = ? AND guild_id = ?',
    args: [itemId, guildId],
  });
  return res.rows.length > 0 ? res.rows[0] : null;
}

// Достать все предметы пользователя
async function getUserInventory(db: any, userId: string, guildId: string, page: number = 1, pageSize: number = 6): Promise<{ items: any[]; total: number; page: number; maxPages: number }> {
  const totalRes = await db.execute({
    sql: 'SELECT COUNT(*) as total FROM user_inventory WHERE user_id = ? AND guild_id = ?',
    args: [userId, guildId],
  });
  const total = (totalRes.rows[0]?.total as number) || 0;
  const maxPages = Math.ceil(total / pageSize) || 1;
  const safePage = Math.max(1, Math.min(page, maxPages));
  const offset = (safePage - 1) * pageSize;

  const itemsRes = await db.execute({
    sql: 'SELECT * FROM user_inventory WHERE user_id = ? AND guild_id = ? ORDER BY rarity DESC, atk_bonus + def_bonus + crit_bonus + coin_bonus DESC LIMIT ? OFFSET ?',
    args: [userId, guildId, pageSize, offset],
  });

  return { items: itemsRes.rows, total, page: safePage, maxPages };
}

// Достать все надетые предметы пользователя (объединённый запрос с IN)
async function getUserGear(db: any, userId: string, guildId: string): Promise<{
  weapon: any;
  armor: any;
  ring: any;
  amulet: any;
  totalAtk: number;
  totalDef: number;
  totalCrit: number;
  totalCoin: number;
}> {
  const gear: any = { weapon: null, armor: null, ring: null, amulet: null };
  let totalAtk = 0;
  let totalDef = 0;
  let totalCrit = 0;
  let totalCoin = 0;

  const slots = ['weapon', 'armor', 'ring', 'amulet'] as const;
  const placeholders = slots.map(() => '?').join(', ');
  const res = await db.execute({
    sql: `SELECT * FROM user_inventory WHERE user_id = ? AND guild_id = ? AND slot IN (${placeholders}) AND is_equipped = 1`,
    args: [userId, guildId, ...slots],
  });

  for (const row of res.rows) {
    const slot = row.slot as string;
    if (gear.hasOwnProperty(slot)) {
      gear[slot] = row;
      totalAtk += (row.atk_bonus as number) || 0;
      totalDef += (row.def_bonus as number) || 0;
      totalCrit += (row.crit_bonus as number) || 0;
      totalCoin += (row.coin_bonus as number) || 0;
    }
  }

  return { ...gear, totalAtk, totalDef, totalCrit, totalCoin };
}

// Достать лоты рынка
async function getMarketListings(db: any, guildId: string, page: number = 1, pageSize: number = 10): Promise<{ listings: any[]; total: number; page: number; maxPages: number }> {
  const totalRes = await db.execute({
    sql: 'SELECT COUNT(*) as total FROM market_listings WHERE guild_id = ?',
    args: [guildId],
  });
  const total = (totalRes.rows[0]?.total as number) || 0;
  const maxPages = Math.ceil(total / pageSize) || 1;
  const safePage = Math.max(1, Math.min(page, maxPages));
  const offset = (safePage - 1) * pageSize;

  const listingsRes = await db.execute({
    sql: 'SELECT ml.*, ui.item_name, ui.rarity, ui.slot, ui.atk_bonus, ui.def_bonus, ui.crit_bonus, ui.coin_bonus FROM market_listings ml JOIN user_inventory ui ON ml.inventory_id = ui.id WHERE ml.guild_id = ? ORDER BY ml.created_at DESC LIMIT ? OFFSET ?',
    args: [guildId, pageSize, offset],
  });

  return { listings: listingsRes.rows, total, page: safePage, maxPages };
}

// Добавить лот на рынок
async function addMarketListing(db: any, guildId: string, sellerId: string, inventoryId: number, price: number): Promise<number> {
  const now = Math.floor(Date.now() / 1000);
  await db.execute({
    sql: 'INSERT INTO market_listings (guild_id, seller_id, inventory_id, price, created_at) VALUES (?, ?, ?, ?, ?)',
    args: [guildId, sellerId, inventoryId, price, now],
  });
  // Get last inserted row id using SELECT
  const res = await db.execute({ sql: 'SELECT last_insert_rowid() as id' });
  return (res.rows[0]?.id as number) || 0;
}

// Проверка уникальности предмета на сервере
async function isItemUniqueOnServer(db: any, itemId: string, guildId: string): Promise<boolean> {
  const res = await db.execute({
    sql: 'SELECT COUNT(*) as count FROM user_inventory WHERE item_id = ? AND guild_id = ? AND item_id != \'junk\'',
    args: [itemId, guildId],
  });
  const count = (res.rows[0]?.count as number) || 0;
  return count === 0;
}

// ============================================
// Система RPG-классов (Этап 12)
// ============================================

interface ClassInfo {
  displayName: string;
  skill1Name: string;
  skill2Name: string;
}

function getClassDisplayName(classId: string): string {
  const classes: Record<string, string> = {
    warrior: "🛡️ Паладин",
    berserker: "🪓 Берсерк",
    mage: "🔮 Архимаг",
    necromancer: "💀 Некромант",
    ranger: "🏹 Следопыт",
    assassin: "🗡️ Ассасин",
    artificer: "⚡ Техномаг",
    bard: "🎵 Бард",
  };
  return classes[classId] || classId;
}

function getClassSkills(classId: string): { skill1Name: string; skill2Name: string } {
  const skills: Record<string, ClassInfo> = {
    warrior: {
      displayName: "🛡️ Паладин",
      skill1Name: "Удар щитом",
      skill2Name: "Божественный бастион",
    },
    berserker: {
      displayName: "🪓 Берсерк",
      skill1Name: "Рассекающий взмах",
      skill2Name: "Казнь",
    },
    mage: {
      displayName: "🔮 Архимаг",
      skill1Name: "Огненная стрела",
      skill2Name: "Звёздный метеор",
    },
    necromancer: {
      displayName: "💀 Некромант",
      skill1Name: "Костяное копьё",
      skill2Name: "Призыв орды",
    },
    ranger: {
      displayName: "🏹 Следопыт",
      skill1Name: "Прицельный выстрел",
      skill2Name: "Охотничий капкан",
    },
    assassin: {
      displayName: "🗡️ Ассасин",
      skill1Name: "Ядовитый клинок",
      skill2Name: "Танец теней",
    },
    artificer: {
      displayName: "⚡ Техномаг",
      skill1Name: "Шоковая турель",
      skill2Name: "Орбитальный лазер",
    },
    bard: {
      displayName: "🎵 Бард",
      skill1Name: "Боевой мотив",
      skill2Name: "Гимн победы",
    },
  };
  const info = skills[classId];
  return info
    ? { skill1Name: info.skill1Name, skill2Name: info.skill2Name }
    : { skill1Name: "Навык", skill2Name: "Ульта" };
}

// ============================================
// Генерация карточки ранга (/rank)
// ============================================

async function fetchAvatarAsBase64(user: { id: string; avatar: string | null; discriminator?: string }): Promise<string> {
  let url = "";
  if (user.avatar) {
    url = "https://cdn.discordapp.com/avatars/" + user.id + "/" + user.avatar + ".png?size=256";
  } else {
    // Для новых пользователей (discriminator === "0") используем default avatar index
    const idx = Number((BigInt(user.id) >> 22n) % 6n);
    url = "https://cdn.discordapp.com/embed/avatars/" + idx + ".png?size=256";
  }
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error("Avatar fetch failed");
    const buf = await res.arrayBuffer();
    const b64 = Buffer.from(buf).toString("base64");
    return "data:image/png;base64," + b64;
  } catch (err) {
    console.error("Avatar fetch error:", err);
    return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
  }
}

async function renderCardToPng(props: CardProps): Promise<Uint8Array> {
  await ensureWasmInitialized();
  const svg = await satori(Card(props), { width: 800, height: 260, fonts: [{ name: "Inter", data: fontData as ArrayBuffer, weight: 400, style: "normal" }] });
  const resvg = new Resvg(svg, { fitTo: { mode: "width", value: 800 } });
  return resvg.render().asPng();
}

async function handleRankCommand(interaction: DiscordInteraction, env: Env): Promise<{ png: Uint8Array; username: string } | { error: string }> {
  const gid = interaction.guild_id;
  if (!gid) return { error: "No guild" };

  // Получаем ID целевого пользователя из опции 'user' или используем ID автора команды
  const userOption = interaction.data?.options?.find((o: any) => o.name === 'user')?.value as string | undefined;
  const callerUser = interaction.member?.user;
  if (!callerUser) return { error: "No caller user" };

  const isSelf = !userOption || userOption === callerUser.id;
  const targetId = isSelf ? callerUser.id : userOption;

  let targetUser: { id: string; username: string; avatar: string | null; discriminator?: string };

  if (isSelf) {
    targetUser = {
      id: callerUser.id,
      username: callerUser.username,
      avatar: callerUser.avatar ?? null,
      discriminator: callerUser.discriminator || "0",
    };
  } else {
    const resolvedUser = interaction.data?.resolved?.users?.[targetId];
    if (!resolvedUser) {
      return { error: "User not found in resolved" };
    }
    targetUser = {
      id: targetId,
      username: resolvedUser.username || "Unknown",
      avatar: resolvedUser.avatar ?? null,
      discriminator: resolvedUser.discriminator || "0",
    };
  }

  try {
    const db = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });

    // Ищем данные по user_id = targetId в текущей гильдии
    const ures = await db.execute({ sql: "SELECT xp, messages_count, voice_seconds, streak_days, prestige_count FROM users WHERE user_id = ? AND guild_id = ?", args: [targetId, gid] });
    if (ures.rows.length === 0) return { error: "User not found in database" };
    const udata = ures.rows[0];
    const xp = (udata.xp as number) || 0;
    const msgc = (udata.messages_count as number) || 0;
    const voicesec = (udata.voice_seconds as number) || 0;
    const vh = Math.floor(voicesec / 3600);
    const streakDays = (udata.streak_days as number) || 0;
    const prestigeCount = (udata.prestige_count as number) || 0;

    // Достаём тему и титул из user_cosmetics
    const cosmetRes = await db.execute({
      sql: "SELECT theme_id, title_id FROM user_cosmetics WHERE user_id = ? AND guild_id = ?",
      args: [targetId, gid],
    });
    const themeId = cosmetRes.rows.length > 0 ? (cosmetRes.rows[0].theme_id as string) : "default";
    const customTitle = cosmetRes.rows.length > 0 ? (cosmetRes.rows[0].title_id as string) : "Новичок";

    const rres = await db.execute({ sql: "SELECT COUNT(*) as rank FROM users WHERE guild_id = ? AND xp > ?", args: [gid, xp] });
    const rank = ((rres.rows[0]?.rank as number) || 0) + 1;
    const tres = await db.execute({ sql: "SELECT COUNT(*) as total FROM users WHERE guild_id = ?", args: [gid] });
    const total = (tres.rows[0]?.total as number) || 1;
    const lvl = calculateLevel(xp);
    const prog = getXpProgress(xp);
    const avatar = await fetchAvatarAsBase64(targetUser);
    const png = await renderCardToPng({ username: targetUser.username, avatarBase64: avatar, level: lvl, rank, totalUsers: total, xp, nextLevelXp: prog.nextLevelXp, progress: prog.progress, messagesCount: msgc, voiceHours: vh, streakDays, prestigeCount, statusColor: "#23a55a", themeId, customTitle });
    return { png, username: targetUser.username };
  } catch (err) {
    console.error("[Error] rank cmd:", err);
    return { error: "DB error" };
  }
}

async function sendFollowUp(token: string, appId: string, result: { png: Uint8Array; username: string } | { error: string }): Promise<Response> {
  const wurl = "https://discord.com/api/v10/webhooks/" + appId + "/" + token + "/messages/@original";
  const fd = new FormData();
  if ("error" in result) {
    fd.append("payload_json", JSON.stringify({ content: result.error }));
  } else {
    fd.append("payload_json", JSON.stringify({ attachments: [{ id: 0, filename: "rank-" + result.username + ".png" }] }));
    fd.append("files[0]", new Blob([result.png], { type: "image/png" }), "rank-" + result.username + ".png");
  }
  return fetch(wurl, { method: "PATCH", body: fd });
}

// ============================================
// Лидерборд (/leaderboard)
// ============================================

interface LeaderboardEntry {
  user_id: string;
  xp: number;
  season_xp: number;
  messages_count: number;
  voice_seconds: number;
}

// Объединённый тип для сортировки
type SortBy = "xp" | "messages_count" | "voice_seconds" | "season_xp";

async function getLeaderboardData(env: Env, guildId: string, page: number = 1, mode: "season" | "all" = "all", sortBy: SortBy = "xp"): Promise<{ entries: LeaderboardEntry[]; total: number; page: number; maxPages: number }> {
  const db = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });
  const pageSize = 10;

  const tres = await db.execute({ sql: "SELECT COUNT(*) as total FROM users WHERE guild_id = ?", args: [guildId] });
  const total = (tres.rows[0]?.total as number) || 0;
  const maxPages = Math.ceil(total / pageSize) || 1;
  const safePage = Math.max(1, Math.min(page, maxPages));
  const offset = (safePage - 1) * pageSize;

  // Выбираем сортировку и колонки в зависимости от режима
  let orderColumn = sortBy;
  if (mode === "season" && sortBy === "xp") {
    orderColumn = "season_xp";
  }

  const ures = await db.execute({
    sql: `SELECT user_id, xp, season_xp, messages_count, voice_seconds FROM users WHERE guild_id = ? ORDER BY ${orderColumn} DESC LIMIT ? OFFSET ?`,
    args: [guildId, pageSize, offset],
  });

  const entries = ures.rows.map((r) => ({
    user_id: r.user_id as string,
    xp: r.xp as number,
    season_xp: (r.season_xp as number) || 0,
    messages_count: r.messages_count as number,
    voice_seconds: r.voice_seconds as number,
  }));

  return { entries, total, page: safePage, maxPages };
}

function buildLeaderboardEmbed(entries: LeaderboardEntry[], page: number, maxPages: number, total: number, mode: "season" | "all" = "all") {
  const currentSeason = mode === "season" ? getCurrentSeason() : "За всё время";

  let description = "";
  entries.forEach((entry, idx) => {
    const pos = (page - 1) * 10 + idx + 1;
    const lvl = calculateLevel(entry.xp);
    const msgc = entry.messages_count;
    const voicesec = entry.voice_seconds;
    const vh = Math.floor(voicesec / 3600);

    let line = "";
    if (pos === 1) line += "🥇 ";
    else if (pos === 2) line += "🥈 ";
    else if (pos === 3) line += "🥉 ";
    else line += `${pos}. `;

    if (mode === "season") {
      line += `**<@${entry.user_id}>** — Уровень ${lvl} • ${entry.season_xp.toLocaleString()} сезонного XP (${msgc.toLocaleString()} сообщ. / ${vh} ч.)`;
    } else {
      line += `**<@${entry.user_id}>** — Уровень ${lvl} • ${entry.xp.toLocaleString()} XP (${msgc.toLocaleString()} сообщ. / ${vh} ч.)`;
    }
    description += line + "\n";
  });

  return {
    embeds: [
      {
        title: `🏆 Таблица лидеров • ${currentSeason}`,
        description: description || "Пока нет данных",
        color: 0x5865f2,
        footer: { text: `Страница ${page} из ${maxPages} • Всего участников: ${total}` },
      },
    ],
    components: [
      // Верхний ряд: переключатели режима
      {
        type: 1,
        components: [
          {
            type: 2,
            custom_id: `lb_mode_season_${page}`,
            style: mode === "season" ? 1 : 2, // Primary если активен, Secondary иначе
            label: "🏆 Текущий сезон",
          },
          {
            type: 2,
            custom_id: `lb_mode_all_${page}`,
            style: mode === "all" ? 1 : 2,
            label: "👑 За всё время",
          },
        ],
      },
      // Нижний ряд: пагинация
      {
        type: 1,
        components: [
          { type: 2, custom_id: `lb_page_${mode}_prev_${page}`, style: 2, label: "◀ Назад", disabled: page <= 1 },
          { type: 2, custom_id: `lb_page_${mode}_next_${page}`, style: 2, label: "Вперед ▶", disabled: page >= maxPages },
        ],
      },
    ],
  };
}

// Получение текущего сезона (для лидерборда)
function getCurrentSeason(): string {
  const month = new Date().getUTCMonth() + 1;
  if (month >= 3 && month <= 5) return "🌸 Весенний кубок";
  if (month >= 6 && month <= 8) return "☀️ Летний драйв";
  if (month >= 9 && month <= 11) return "🍂 Осенний марафон";
  return "❄️ Зимняя битва";
}

// ============================================
// Квесты и Дейли-активность
// ============================================

const DEFAULT_QUESTS = [
  { id: "msg_1", title: "Разминка пальцев", desc: "Отправьте 10 сообщений в чат", type: "messages", target: 10, xp: 50 },
  { id: "msg_2", title: "Активный спикер", desc: "Отправьте 30 сообщений в чат", type: "messages", target: 30, xp: 150 },
  { id: "msg_3", title: "Гроза чата", desc: "Отправьте 60 сообщений в чат", type: "messages", target: 60, xp: 300 },
  { id: "msg_4", title: "Стена текста", desc: "Отправьте 100 сообщений в чат", type: "messages", target: 100, xp: 500 },
  { id: "vc_1", title: "Заглянул на огонёк", desc: "Проведите 15 минут в голосовом канале", type: "voice", target: 15, xp: 100 },
  { id: "vc_2", title: "Душевный разговор", desc: "Проведите 45 минут в голосовом канале", type: "voice", target: 45, xp: 250 },
  { id: "vc_3", title: "Войс-марафон", desc: "Проведите 90 минут в голосовом канале", type: "voice", target: 90, xp: 450 },
  { id: "sp_1", title: "Двойной удар", desc: "Отправьте 25 сообщений в чат", type: "messages", target: 25, xp: 120 },
  { id: "sp_2", title: "Ночной дозор", desc: "Проведите 30 минут в войсе", type: "voice", target: 30, xp: 200 },
];

async function ensureQuestsPool(db: any): Promise<void> {
  try {
    const result = await db.execute({ sql: "SELECT COUNT(*) as count FROM quests_pool", args: [] });
    if (((result.rows[0]?.count as number) || 0) === 0) {
      for (const q of DEFAULT_QUESTS) {
        await db.execute({
          sql: "INSERT OR IGNORE INTO quests_pool (id, title, description, quest_type, target, reward_xp) VALUES (?, ?, ?, ?, ?, ?)",
          args: [q.id, q.title, q.desc, q.type, q.target, q.xp],
        });
      }
    }
  } catch (err) {
    console.error("[Quests] Error ensuring pool:", err);
  }
}

async function ensureDailyQuests(db: any, guildId: string): Promise<boolean> {
  const today = getVladivostokDate();
  try {
    await ensureQuestsPool(db);

    const existing = await db.execute({
      sql: "SELECT COUNT(*) as count FROM quests_daily WHERE guild_id = ? AND active_date = ?",
      args: [guildId, today],
    });

    if (((existing.rows[0]?.count as number) || 0) > 0) return true;

    const poolRes = await db.execute({ sql: "SELECT * FROM quests_pool", args: [] });
    const pool = poolRes.rows;
    if (pool.length === 0) return false;

    const msgQuests = pool.filter((q: any) => q.quest_type === "messages");
    const voiceQuests = pool.filter((q: any) => q.quest_type === "voice");
    const pickRandom = (arr: any[]) => arr[Math.floor(Math.random() * arr.length)];

    const selected: any[] = [];
    if (msgQuests.length > 0) selected.push(pickRandom(msgQuests));
    if (voiceQuests.length > 0) selected.push(pickRandom(voiceQuests));

    const remaining = pool.filter((q: any) => !selected.some((s) => s.id === q.id));
    if (remaining.length > 0) selected.push(pickRandom(remaining));

    for (let idx = 0; idx < selected.length; idx++) {
      const q = selected[idx];
      const dailyId = `${guildId}_${today}_${idx + 1}`;
      await db.execute({
        sql: "INSERT OR IGNORE INTO quests_daily (id, guild_id, quest_id, active_date, target, reward_xp) VALUES (?, ?, ?, ?, ?, ?)",
        args: [dailyId, guildId, q.id, today, q.target || q.target_value, q.reward_xp || q.xp],
      });
    }

    return true;
  } catch (err) {
    console.error("[Quests] Error ensuring daily quests:", err);
    return false;
  }
}

async function getUserDailyActivity(db: any, userId: string, guildId: string): Promise<{ messages_count: number; voice_seconds: number }> {
  const today = getVladivostokDate();
  try {
    const result = await db.execute({
      sql: "SELECT messages_count, voice_seconds FROM user_daily_activity WHERE user_id = ? AND guild_id = ? AND activity_date = ?",
      args: [userId, guildId, today],
    });
    if (result.rows.length === 0) return { messages_count: 0, voice_seconds: 0 };
    const row = result.rows[0];
    return {
      messages_count: (row.messages_count as number) || 0,
      voice_seconds: (row.voice_seconds as number) || 0,
    };
  } catch (err) {
    console.error("[Error] getUserDailyActivity:", err);
    return { messages_count: 0, voice_seconds: 0 };
  }
}

async function getUserQuestProgress(db: any, userId: string, guildId: string): Promise<{ completed: number; total: number; quests: any[] }> {
  const today = getVladivostokDate();
  try {
    const questsResult = await db.execute({
      sql: `SELECT qd.id as daily_id, qd.target, qd.reward_xp, qp.title, qp.description, qp.quest_type
            FROM quests_daily qd
            JOIN quests_pool qp ON qd.quest_id = qp.id
            WHERE qd.guild_id = ? AND qd.active_date = ?`,
      args: [guildId, today],
    });

    const quests = questsResult.rows || [];
    if (quests.length === 0) return { completed: 0, total: 0, quests: [] };

    const progressResults: any[] = [];
    for (const quest of quests) {
      const dailyId = quest.daily_id as string;
      const presult = await db.execute({
        sql: "SELECT current_progress, completed_at FROM user_quest_progress WHERE user_id = ? AND guild_id = ? AND quest_daily_id = ?",
        args: [userId, guildId, dailyId],
      });
      progressResults.push({ quest, progress: presult.rows[0] });
    }

    const completed = progressResults.filter((pr: any) => pr.progress && pr.progress.completed_at !== null).length;

    return {
      completed,
      total: quests.length,
      quests: progressResults.map((pr: any) => ({
        title: pr.quest.title as string,
        description: pr.quest.description as string,
        quest_type: pr.quest.quest_type as string,
        reward_xp: pr.quest.reward_xp as number,
        current_progress: (pr.progress?.current_progress as number) || 0,
        completed_at: pr.progress?.completed_at ? (pr.progress.completed_at as number) : null,
        target: pr.quest.target as number,
      })),
    };
  } catch (err) {
    console.error("[Error] getUserQuestProgress:", err);
    return { completed: 0, total: 0, quests: [] };
  }
}

function buildRankTodayEmbed(userId: string, username: string, activity: any, questProgress: any, today: string, streakData: { streakDays: number; streakFreezes: number }, coins: number) {
  const msgc = activity.messages_count;
  const voicesec = activity.voice_seconds;
  const vh = Math.floor(voicesec / 3600);
  const vm = Math.floor(voicesec / 60);
  const streakDays = streakData.streakDays;
  const streakFreezes = streakData.streakFreezes;

  // Формирование текста множителя XP
  let multiplierText = "1.0x";
  if (streakDays >= 30) multiplierText = "1.25x (+25%)";
  else if (streakDays >= 14) multiplierText = "1.15x (+15%)";
  else if (streakDays >= 7) multiplierText = "1.10x (+10%)";
  else if (streakDays >= 3) multiplierText = "1.05x (+5%)";

  return {
    embeds: [
      {
        title: `📊 Активность ${username} за сегодня`,
        description: `Профиль: <@${userId}>`,
        color: 0x5865f2,
        fields: [
          { name: "💬 Сообщений", value: `**${msgc.toLocaleString()}**`, inline: true },
          { name: "🎙 В голосовом канале", value: `**${vm} мин.** (${vh} ч. ${vm % 60} мин.)`, inline: true },
          { name: "🎯 Выполнено квестов", value: `**${questProgress.completed} / ${questProgress.total}**`, inline: true },
          { name: "🔥 Стрик активности", value: `**${streakDays} дн.** (${multiplierText}) | 🧊 Заморозок: **${streakFreezes}**`, inline: true },
          { name: "🪙 Баланс монет", value: `**${(coins || 0).toLocaleString()}**`, inline: true },
        ],
        footer: { text: `Дата: ${today} • Сброс в 00:00 (Владивосток, UTC+10)` },
      },
    ],
  };
}

function buildQuestsEmbed(questProgress: any, today: string) {
  let description = "";

  if (questProgress.quests.length === 0) {
    description = "Сегодня квестов нет. Приходите завтра!";
  } else {
    questProgress.quests.forEach((q: any) => {
      const progress = q.current_progress;
      const target = q.target;
      const completed = q.completed_at !== null;

      if (completed) {
        description += `✅ **${q.title}** — ${q.description}\n`;
        description += `\`[██████████]\` **${target} / ${target}** • **Выполнено! (+${q.reward_xp} XP)**\n\n`;
      } else {
        const bar = renderProgressBar(progress, target, 10);
        const percent = target > 0 ? Math.round((progress / target) * 100) : 0;
        const typeIcon = q.quest_type === "voice" ? "🎙" : "💬";

        description += `${typeIcon} **${q.title}** — *${q.description}*\n`;
        description += `\`[${bar}]\` **${progress} / ${target}** (${percent}%) • Награда: **+${q.reward_xp} XP**\n\n`;
      }
    });
  }

  return {
    embeds: [
      {
        title: `🎯 Ежедневные квесты на ${today}`,
        description: description,
        color: 0x5865f2,
        footer: { text: `Сброс квестов каждый день в 00:00 (Владивосток, UTC+10)` },
      },
    ],
  };
}

// ============================================
// Система дуэлей (/duel) - Этап 3
// ============================================

async function checkUserExists(db: any, userId: string, guildId: string): Promise<boolean> {
  try {
    const res = await db.execute({
      sql: "SELECT 1 FROM users WHERE user_id = ? AND guild_id = ?",
      args: [userId, guildId],
    });
    return res.rows.length > 0;
  } catch (err) {
    console.error("[Duel] Error checking user:", err);
    return false;
  }
}

async function getUserXp(db: any, userId: string, guildId: string): Promise<number> {
  try {
    const res = await db.execute({
      sql: "SELECT xp FROM users WHERE user_id = ? AND guild_id = ?",
      args: [userId, guildId],
    });
    if (res.rows.length === 0) return 0;
    return (res.rows[0].xp as number) || 0;
  } catch (err) {
    console.error("[Duel] Error getting XP:", err);
    return 0;
  }
}

async function getUserCoins(db: any, userId: string, guildId: string): Promise<number> {
  try {
    const res = await db.execute({
      sql: "SELECT coins FROM users WHERE user_id = ? AND guild_id = ?",
      args: [userId, guildId],
    });
    if (res.rows.length === 0) return 0;
    return (res.rows[0].coins as number) || 0;
  } catch (err) {
    console.error("[Duel] Error getting coins:", err);
    return 0;
  }
}

async function updateCoins(db: any, userId: string, guildId: string, coinChange: number): Promise<number> {
  try {
    const res = await db.execute({
      sql: "SELECT coins FROM users WHERE user_id = ? AND guild_id = ?",
      args: [userId, guildId],
    });
    if (res.rows.length === 0) return 0;
    const currentCoins = (res.rows[0].coins as number) || 0;
    const newCoins = currentCoins + coinChange;
    const finalCoins = Math.max(0, newCoins);
    await db.execute({
      sql: "UPDATE users SET coins = ? WHERE user_id = ? AND guild_id = ?",
      args: [finalCoins, userId, guildId],
    });
    return finalCoins;
  } catch (err) {
    console.error("[Duel] Error updating coins:", err);
    return 0;
  }
}

async function updateXpAndLevel(db: any, userId: string, guildId: string, xpChange: number): Promise<number> {
  try {
    const res = await db.execute({
      sql: "SELECT xp FROM users WHERE user_id = ? AND guild_id = ?",
      args: [userId, guildId],
    });
    if (res.rows.length === 0) return 0;
    const currentXp = (res.rows[0].xp as number) || 0;
    const newXp = currentXp + xpChange;
    const newLevel = calculateLevel(newXp);
    await db.execute({
      sql: "UPDATE users SET xp = ?, level = ? WHERE user_id = ? AND guild_id = ?",
      args: [newXp, newLevel, userId, guildId],
    });
    return newXp;
  } catch (err) {
    console.error("[Duel] Error updating XP:", err);
    return 0;
  }
}

async function createDuelRecord(db: any, duelId: string, guildId: string, challengerId: string, opponentId: string, betAmount: number): Promise<boolean> {
  try {
    const now = Math.floor(Date.now() / 1000);
    await db.execute({
      sql: "INSERT INTO duels (id, guild_id, challenger_id, opponent_id, bet_amount, status, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?)",
      args: [duelId, guildId, challengerId, opponentId, betAmount, now],
    });
    return true;
  } catch (err) {
    console.error("[Duel] Error creating record:", err);
    return false;
  }
}

async function getDuelById(db: any, duelId: string): Promise<any> {
  try {
    const res = await db.execute({
      sql: "SELECT * FROM duels WHERE id = ?",
      args: [duelId],
    });
    return res.rows.length > 0 ? res.rows[0] : null;
  } catch (err) {
    console.error("[Duel] Error getting duel:", err);
    return null;
  }
}

async function updateDuelStatus(db: any, duelId: string, status: "accepted" | "declined" | "completed"): Promise<boolean> {
  try {
    await db.execute({
      sql: "UPDATE duels SET status = ? WHERE id = ?",
      args: [status, duelId],
    });
    return true;
  } catch (err) {
    console.error("[Duel] Error updating status:", err);
    return false;
  }
}

function buildDuelEmbed(challengerId: string, opponentId: string, bet: number, duelId: string, currency: string = 'xp') {
  const totalPot = bet * 2;
  const tax = Math.round(totalPot * 0.26);
  const winPot = totalPot - tax;
  const winnerProfit = winPot - bet;

  const isCoins = currency === 'coins';
  const currencyLabel = isCoins ? '🪙' : 'XP';
  const title = isCoins ? "⚔️ Дуэль на монеты!" : "⚔️ Дуэль на опыт!";

  return {
    embeds: [
      {
        title: title,
        description: `**<@${challengerId}>** бросает вызов **<@${opponentId}>**!\n\n` +
          `💰 Ставка: **${bet.toLocaleString()} ${currencyLabel}**\n` +
          `🏆 Чистый выигрыш победителя: **+${winnerProfit.toLocaleString()} ${currencyLabel}**\n` +
          `🔥 Сгораемый налог сервера (26%): **${tax.toLocaleString()} ${currencyLabel}**\n\n` +
          `*У оппонента есть 60 секунд, чтобы принять вызов.*`,
        color: 0xFF8800,
        footer: { text: "Дуэль отменится автоматически через 60 секунд" },
      },
    ],
    components: [
      {
        type: 1,
        components: [
          {
            type: 2,
            custom_id: `duel_accept_${duelId}_${currency}`,
            style: 3,
            label: "⚔️ Принять вызов",
          },
          {
            type: 2,
            custom_id: `duel_decline_${duelId}`,
            style: 4,
            label: "🏳️ Отклонить",
          },
        ],
      },
    ],
  };
}

function buildDuelDeclineEmbed(challengerId: string, opponentId: string) {
  return {
    embeds: [
      {
        title: "🏳️ Дуэль отменена",
        description: `**<@${opponentId}>** отклонил(а) вызов от **<@${challengerId}>**. Опыт сохранён.`,
        color: 0x747f8d,
      },
    ],
    components: [],
  };
}

function buildDuelResultEmbed(challengerId: string, opponentId: string, winnerId: string, loserId: string, roll1: number, roll2: number, bet: number, tax: number, winnerProfit: number, currency: string = 'xp') {
  const isCoins = currency === 'coins';
  const currencyLabel = isCoins ? '🪙' : 'XP';

  return {
    embeds: [
      {
        title: "🏆 Победитель дуэли!",
        description: `**<@${winnerId}>** победил(а) в дуэли!\n\n` +
          `🎲 Бросок кубиков:\n` +
          `• <@${challengerId}>: выбросил **${roll1}** 🎲\n` +
          `• <@${opponentId}>: выбросил **${roll2}** 🎲\n\n` +
          `💰 Результат:\n` +
          `• <@${winnerId}> получает: **+${winnerProfit.toLocaleString()} ${currencyLabel}**\n` +
          `• <@${loserId}> теряет: **-${bet.toLocaleString()} ${currencyLabel}**\n` +
          `• Сервер сжёг налог 26%: **${tax.toLocaleString()} ${currencyLabel}**`,
        color: 0xFEE75C,
      },
    ],
    components: [],
  };
}

// ============================================
// Главный Interaction Handler
// ============================================

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/interactions") {
      const sig = request.headers.get("x-signature-ed25519");
      const ts = request.headers.get("x-signature-timestamp");
      if (!sig || !ts) return Response.json({ error: "No sig" }, { status: 401 });

      const body = await request.text();
      const valid = await verifyDiscordSignature(sig, ts, body, env.DISCORD_PUBLIC_KEY);
      if (!valid) return Response.json({ error: "Bad sig" }, { status: 401 });

      const inter: DiscordInteraction = JSON.parse(body);

      // 1. PING
      if (inter.type === 1) return Response.json({ type: 1 });

      // 2. Слэш-команда /rank
      if (inter.type === 2 && inter.data?.name === "rank") {
        ctx.waitUntil(
          (async () => {
            try {
              const res = await handleRankCommand(inter, env);

              // Если пользователь не найден в БД - отправляем ephemeral-сообщение
              if ("error" in res && res.error === "User not found in database") {
                const resp = await fetch(`https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${inter.token}/messages/@original`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ content: "❌ Этот пользователь ещё не проявлял активность на сервере!", flags: 64 }),
                });
                if (!resp.ok) console.error("Rank not found response fail:", await resp.text());
                return;
              }

              const r = await sendFollowUp(inter.token, env.DISCORD_APPLICATION_ID, res);
              if (!r.ok) console.error("Follow up fail:", await r.text());
            } catch (e) {
              console.error("Error:", e);
            }
          })()
        );
        return Response.json({ type: 5 });
      }

      // 3. Слэш-команда /leaderboard
      if (inter.type === 2 && inter.data?.name === "leaderboard") {
        const pageOption = inter.data?.options?.find((o) => o.name === "page")?.value as number;
        const page = pageOption || 1;
        const gid = inter.guild_id;
        if (!gid) return Response.json({ error: "No guild" }, { status: 400 });

        ctx.waitUntil(
          (async () => {
            try {
              const data = await getLeaderboardData(env, gid, page, "all", "xp");
              const result = buildLeaderboardEmbed(data.entries, data.page, data.maxPages, data.total, "all");
              const resp = await fetch(`https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${inter.token}/messages/@original`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(result),
              });
              if (!resp.ok) console.error("Leaderboard update fail:", await resp.text());
            } catch (e) {
              console.error("Leaderboard error:", e);
            }
          })()
        );
        return Response.json({ type: 5 });
      }

      // 4. Кнопки пагинации и режимов лидерборда (Type 3)
      if (inter.type === 3 && inter.data?.custom_id?.startsWith("lb_")) {
        const gid = inter.guild_id;
        if (!gid) return Response.json({ error: "No guild" }, { status: 400 });

        const customId = inter.data.custom_id;
        let page = 1;
        let mode: "season" | "all" = "all";
        let action: "page" | "mode" = "page";

        // Обработка переключения режима: lb_mode_season_X или lb_mode_all_X
        if (customId.startsWith("lb_mode_season_")) {
          mode = "season";
          page = parseInt(customId.substring(15), 10) || 1;
          action = "mode";
        } else if (customId.startsWith("lb_mode_all_")) {
          mode = "all";
          page = parseInt(customId.substring(12), 10) || 1;
          action = "mode";
        } else if (customId.startsWith("lb_page_season_prev_")) {
          page = Math.max(1, parseInt(customId.substring(20), 10) - 1);
          mode = "season";
          action = "page";
        } else if (customId.startsWith("lb_page_season_next_")) {
          page = parseInt(customId.substring(20), 10) + 1;
          mode = "season";
          action = "page";
        } else if (customId.startsWith("lb_page_all_prev_")) {
          page = Math.max(1, parseInt(customId.substring(17), 10) - 1);
          mode = "all";
          action = "page";
        } else if (customId.startsWith("lb_page_all_next_")) {
          page = parseInt(customId.substring(17), 10) + 1;
          mode = "all";
          action = "page";
        } else {
          // Старый формат (для обратной совместимости)
          const curPage = parseInt(customId.replace("lb_prev_", "").replace("lb_next_", ""), 10) || 1;
          page = curPage;
          if (customId.startsWith("lb_prev_")) page = Math.max(1, curPage - 1);
          else if (customId.startsWith("lb_next_")) page = curPage + 1;
        }

        const data = await getLeaderboardData(env, gid, page, mode, mode === "season" ? "season_xp" : "xp");
        const result = buildLeaderboardEmbed(data.entries, data.page, data.maxPages, data.total, mode);

        return Response.json({ type: 7, data: result });
      }

      // 5. Слэш-команда /rank-today
      if (inter.type === 2 && inter.data?.name === "rank-today") {
        const uid = inter.member?.user.id;
        const gid = inter.guild_id;
        const user = inter.member?.user;
        if (!uid || !gid || !user) return Response.json({ error: "No user or guild" }, { status: 400 });

        ctx.waitUntil(
          (async () => {
            try {
              const db = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });
              const activity = await getUserDailyActivity(db, uid, gid);
              const questProgress = await getUserQuestProgress(db, uid, gid);

              // Достаём данные о стрике и монетах
              const streakRes = await db.execute({
                sql: "SELECT streak_days, streak_freezes, coins FROM users WHERE user_id = ? AND guild_id = ?",
                args: [uid, gid],
              });
              const streakData = {
                streakDays: (streakRes.rows[0]?.streak_days as number) || 0,
                streakFreezes: (streakRes.rows[0]?.streak_freezes as number) || 0,
              };
              const coins = (streakRes.rows[0]?.coins as number) || 0;

              const today = getVladivostokDate();
              const result = buildRankTodayEmbed(uid, user.username, activity, questProgress, today, streakData, coins);

              const resp = await fetch(`https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${inter.token}/messages/@original`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(result),
              });
              if (!resp.ok) console.error("Rank today update fail:", await resp.text());
            } catch (e) {
              console.error("Rank today error:", e);
            }
          })()
        );
        return Response.json({ type: 5 });
      }

      // 6. Слэш-команда /quests
      if (inter.type === 2 && inter.data?.name === "quests") {
        const gid = inter.guild_id;
        const uid = inter.member?.user.id;
        if (!gid || !uid) return Response.json({ error: "No guild or user" }, { status: 400 });

        ctx.waitUntil(
          (async () => {
            try {
              const db = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });
              await ensureDailyQuests(db, gid);

              const questProgress = await getUserQuestProgress(db, uid, gid);
              const today = getVladivostokDate();
              const result = buildQuestsEmbed(questProgress, today);

              const resp = await fetch(`https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${inter.token}/messages/@original`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(result),
              });
              if (!resp.ok) console.error("Quests update fail:", await resp.text());
            } catch (e) {
              console.error("Quests error:", e);
            }
          })()
        );
        return Response.json({ type: 5 });
      }

      // 7. Слэш-команда /duel
      if (inter.type === 2 && inter.data?.name === "duel") {
        const gid = inter.guild_id;
        const challengerId = inter.member?.user.id;
        if (!gid || !challengerId) return Response.json({ error: "No guild or user" }, { status: 400 });

        // Извлекаем опции команды
        const opponentOption = inter.data?.options?.find((o) => o.name === "opponent")?.value as string;
        const betOption = inter.data?.options?.find((o) => o.name === "bet")?.value as number;
        const currencyOption = inter.data?.options?.find((o) => o.name === "currency")?.value as string;

        // По умолчанию валюта - XP, можно выбрать 'coins' для дуэлей на монеты
        const currency = currencyOption || 'xp';

        if (!opponentOption) {
          return Response.json({
            type: 4,
            data: { content: "❌ Укажите пользователя, которому хотите бросить вызов!", flags: 64 },
          });
        }

        // Валидация ставки в зависимости от валюты
        if (!betOption) {
          return Response.json({
            type: 4,
            data: { content: "❌ Укажите размер ставки!", flags: 64 },
          });
        }

        if (currency === 'coins') {
          // Для монет ставка от 100 до 5000
          if (betOption < 100 || betOption > 5000) {
            return Response.json({
              type: 4,
              data: { content: "❌ Ставка монетами должна быть от 100 до 5000 🪙!", flags: 64 },
            });
          }
        } else {
          // Для XP ставка от 50 до 2000
          if (betOption < 50 || betOption > 2000) {
            return Response.json({
              type: 4,
              data: { content: "❌ Ставка должна быть от 50 до 2000 XP!", flags: 64 },
            });
          }
        }

        // Проверка: оппонент не должен быть ботом или самим собой
        if (opponentOption === challengerId) {
          return Response.json({
            type: 4,
            data: { content: "❌ Нельзя дуэлиться с самим собой!", flags: 64 },
          });
        }

        if (inter.data?.resolved?.users?.[opponentOption]) {
          const opponentUser = inter.data.resolved.users[opponentOption];
          // Проверка бота по discriminator или флагу (если будет добавлен)
          // В текущей схеме боты имеют discriminator "0000" - но это не надёжно
          // Поэтому просто проверяем, что пользователь есть в resolved
        }

        const db = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });

        // Проверка существования пользователей
        const challengerExists = await checkUserExists(db, challengerId, gid);
        const opponentExists = await checkUserExists(db, opponentOption, gid);

        if (!challengerExists) {
          return Response.json({
            type: 4,
            data: { content: "❌ Вы не найдены в базе данных. Напишите сообщение, чтобы зарегистрироваться!", flags: 64 },
          });
        }

        if (!opponentExists) {
          return Response.json({
            type: 4,
            data: { content: "❌ Оппонент не найден в базе данных. Пользователь должен отправить хотя бы одно сообщение!", flags: 64 },
          });
        }

        // Проверка баланса (зависит от валюты)
        let challengerBalance, opponentBalance;
        if (currency === 'coins') {
          challengerBalance = await getUserCoins(db, challengerId, gid);
          opponentBalance = await getUserCoins(db, opponentOption, gid);
        } else {
          challengerBalance = await getUserXp(db, challengerId, gid);
          opponentBalance = await getUserXp(db, opponentOption, gid);
        }

        if (challengerBalance < betOption) {
          const balanceText = currency === 'coins'
            ? `❌ У вас недостаточно монет для этой ставки! Текущий баланс: **${challengerBalance.toLocaleString()} 🪙**`
            : `❌ У вас недостаточно XP для этой ставки! Текущий баланс: **${challengerBalance.toLocaleString()} XP**`;
          return Response.json({
            type: 4,
            data: { content: balanceText, flags: 64 },
          });
        }

        if (opponentBalance < betOption) {
          const balanceText = currency === 'coins'
            ? `❌ У оппонента недостаточно монет для этой ставки! Текущий баланс: **${opponentBalance.toLocaleString()} 🪙**`
            : `❌ У оппонента недостаточно XP для этой ставки! Текущий баланс: **${opponentBalance.toLocaleString()} XP**`;
          return Response.json({
            type: 4,
            data: { content: balanceText, flags: 64 },
          });
        }

        // Создаём запись дуэли
        const duelId = `duel_${Date.now()}_${challengerId.slice(-4)}`;
        const created = await createDuelRecord(db, duelId, gid, challengerId, opponentOption, betOption);

        if (!created) {
          return Response.json({
            type: 4,
            data: { content: "❌ Ошибка при создании дуэли. Попробуйте ещё раз.", flags: 64 },
          });
        }

        // Отправляем Embed с кнопками (с учётом валюты)
        const result = buildDuelEmbed(challengerId, opponentOption, betOption, duelId, currency);

        return Response.json({ type: 4, data: result });
      }

      // 8. Обработка кнопок дуэли (Type 3)
      if (inter.type === 3 && (inter.data?.custom_id?.startsWith("duel_accept_") || inter.data?.custom_id?.startsWith("duel_decline_"))) {
        const customId = inter.data.custom_id;
        // Парсим custom_id: duel_accept_{duelId}_{currency} или duel_decline_{duelId}
        let duelId: string;
        let currency: string = 'xp'; // по умолчанию XP

        if (customId.startsWith("duel_accept_")) {
          // Формат: duel_accept_{duelId}_{currency}
          const parts = customId.substring(14).split('_');
          duelId = parts.slice(0, -1).join('_'); // всё кроме последнего - duelId
          const lastPart = parts[parts.length - 1];
          if (lastPart === 'coins' || lastPart === 'xp') {
            currency = lastPart;
          }
        } else {
          duelId = customId.substring(16);
        }

        const db = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });
        const duel = await getDuelById(db, duelId);

        if (!duel) {
          return Response.json({
            type: 4,
            data: { content: "⚠️ Эта дуэль не найдена или уже завершена.", flags: 64 },
          });
        }

        const challengerId = duel.challenger_id as string;
        const opponentId = duel.opponent_id as string;
        const guildId = duel.guild_id as string;
        const bet = duel.bet_amount as number;
        const status = duel.status as string;

        // Проверка: только оппонент может нажимать кнопки
        const clickedUserId = inter.member?.user.id;
        if (!clickedUserId || clickedUserId !== opponentId) {
          return Response.json({
            type: 4,
            data: { content: "❌ Вы не можете отвечать на чужой вызов дуэли!", flags: 64 },
          });
        }

        // Проверка статуса дуэли
        if (status !== "pending") {
          return Response.json({
            type: 4,
            data: { content: "⚠️ Эта дуэль уже завершена или недействительна.", flags: 64 },
          });
        }

        if (customId.startsWith("duel_decline_")) {
          // Дуэль отклонена
          await updateDuelStatus(db, duelId, "declined");

          const result = buildDuelDeclineEmbed(challengerId, opponentId);
          return Response.json({ type: 7, data: result });
        }

        if (customId.startsWith("duel_accept_")) {
          // Дуэль принята - проводим бросок кубиков
          const roll1 = Math.floor(Math.random() * 100) + 1;
          let roll2 = Math.floor(Math.random() * 100) + 1;

          // Если ничья - перебрасываем для оппонента
          if (roll1 === roll2) {
            roll2 = (roll1 % 100) + 1;
          }

          // Определяем победителя и проигравшего
          let winnerId: string, loserId: string;
          if (roll1 > roll2) {
            winnerId = challengerId;
            loserId = opponentId;
          } else {
            winnerId = opponentId;
            loserId = challengerId;
          }

          // Расчёт экономики
          const totalPot = bet * 2;
          const tax = Math.round(totalPot * 0.26);
          const winnerProfit = (totalPot - tax) - bet;

          // Атомарная операция: проверка баланса и списание в одном UPDATE
          // Предотвращает гонку данных при параллельных запросах
          if (currency === 'coins') {
            // Попытка списать монеты с гарантией достаточного баланса
            const challengerDeduct = await db.execute({
              sql: "UPDATE users SET coins = coins - ? WHERE user_id = ? AND guild_id = ? AND coins >= ?",
              args: [bet, challengerId, guildId, bet],
            });

            const opponentDeduct = await db.execute({
              sql: "UPDATE users SET coins = coins - ? WHERE user_id = ? AND guild_id = ? AND coins >= ?",
              args: [bet, opponentId, guildId, bet],
            });

            // Проверяем, удалось ли списать с обоих (rowsAffected == 1)
            if (!challengerDeduct.rowsAffected || !opponentDeduct.rowsAffected) {
              await updateDuelStatus(db, duelId, "declined");
              return Response.json({
                type: 4,
                data: { content: `⚠️ У одного из участников недостаточно 🪙 для дуэли. Дуэль отменена.`, flags: 64 },
              });
            }

            // Начисляем выигрыши
            await updateCoins(db, winnerId, guildId, winnerProfit);
          } else {
            // Попытка списать XP с гарантией достаточного баланса
            const challengerDeduct = await db.execute({
              sql: "UPDATE users SET xp = xp - ? WHERE user_id = ? AND guild_id = ? AND xp >= ?",
              args: [bet, challengerId, guildId, bet],
            });

            const opponentDeduct = await db.execute({
              sql: "UPDATE users SET xp = xp - ? WHERE user_id = ? AND guild_id = ? AND xp >= ?",
              args: [bet, opponentId, guildId, bet],
            });

            // Проверяем, удалось ли списать с обоих
            if (!challengerDeduct.rowsAffected || !opponentDeduct.rowsAffected) {
              await updateDuelStatus(db, duelId, "declined");
              return Response.json({
                type: 4,
                data: { content: `⚠️ У одного из участников недостаточно XP для дуэли. Дуэль отменена.`, flags: 64 },
              });
            }

            // Начисляем выигрыши и обновляем уровни
            await updateXpAndLevel(db, winnerId, guildId, winnerProfit);
          }

          // Обновляем статус дуэли
          await updateDuelStatus(db, duelId, "completed");

          const result = buildDuelResultEmbed(challengerId, opponentId, winnerId, loserId, roll1, roll2, bet, tax, winnerProfit, currency);

          // Проверка достижений дуэли (Этап 6)
          const winnerLevel = calculateLevel((await getUserXp(db, winnerId, guildId)));
          const loserLevel = calculateLevel((await getUserXp(db, loserId, guildId)));

          // Формируем webhook URL для уведомлений
          const webhookUrl = `https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${inter.token}`;

          // hl_crowbar: победил оппонента на 2+ уровня выше
          if (loserLevel - winnerLevel >= 2) {
            await unlockAchievement(db, winnerId, guildId, 'hl_crowbar', webhookUrl, env.DISCORD_APPLICATION_ID);
          }

          // fbk_final_battle: ставка >= 1000 XP
          if (bet >= 1000) {
            await unlockAchievement(db, challengerId, guildId, 'fbk_final_battle', webhookUrl, env.DISCORD_APPLICATION_ID);
          }

          // casino_house: налог с дуэли > 100 XP
          if (tax > 100) {
            await unlockAchievement(db, loserId, guildId, 'casino_house', webhookUrl, env.DISCORD_APPLICATION_ID);
          }

          // rdr_quickdraw: победил с roll >= 95
          if (winnerId === challengerId && roll1 >= 95) {
            await unlockAchievement(db, challengerId, guildId, 'rdr_quickdraw', webhookUrl, env.DISCORD_APPLICATION_ID);
          } else if (winnerId === opponentId && roll2 >= 95) {
            await unlockAchievement(db, opponentId, guildId, 'rdr_quickdraw', webhookUrl, env.DISCORD_APPLICATION_ID);
          }

          //witcher_damn: проиграл с roll < 10
          if (loserId === challengerId && roll1 < 10) {
            await unlockAchievement(db, challengerId, guildId, 'witcher_damn', webhookUrl, env.DISCORD_APPLICATION_ID);
          } else if (loserId === opponentId && roll2 < 10) {
            await unlockAchievement(db, opponentId, guildId, 'witcher_damn', webhookUrl, env.DISCORD_APPLICATION_ID);
          }

          return Response.json({ type: 7, data: result });
        }
      }

      // ============================================
      // Обработка кнопок атаки Мирового Босса (Этап 13)
      // ============================================

      // 24. Обработка кнопок атаки босса (Type 3)
      // ИСПРАВЛЕНО: type: 4 для ранних валидаций, единственный type: 5 defer перед тяжёлой работой
      if (inter.type === 3 && inter.data?.custom_id?.startsWith("boss_atk_")) {
        const customId = inter.data.custom_id;
        const attackType = customId === 'boss_atk_basic' ? 'basic' : customId === 'boss_atk_skill' ? 'skill' : 'ult';
        const uid = inter.member?.user.id;
        const gid = inter.guild_id;

        // 1. БЫСТРАЯ ВАЛИДАЦИЯ: uid/gid отсутствуют -> type: 4
        if (!uid || !gid) {
          return Response.json({
            type: 4,
            data: { content: "❌ Не удалось определить пользователя или сервер.", flags: 64 },
          });
        }

        // 2. БЫСТРАЯ ВАЛИДАЦИЯ: нет активного босса -> type: 4
        const db = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });
        const bossResult = await db.execute({
          sql: 'SELECT * FROM world_boss WHERE guild_id = ? AND status = ? LIMIT 1',
          args: [gid, 'active'],
        });

        if (bossResult.rows.length === 0) {
          return Response.json({
            type: 4,
            data: { content: "❌ Сейчас нет активного босса!", flags: 64 },
          });
        }

        const boss = bossResult.rows[0];
        const bossType = boss.boss_type as string;
        const maxHp = boss.max_hp as number;
        const currentHp = boss.current_hp as number;

        // 3. БЫСТРАЯ ВАЛИДАЦИЯ: данные пользователя не найдены -> type: 4
        const userRes = await db.execute({
          sql: 'SELECT level, class_id, prestige_count, last_boss_attack_at FROM users WHERE user_id = ? AND guild_id = ?',
          args: [uid, gid],
        });

        if (userRes.rows.length === 0) {
          return Response.json({
            type: 4,
            data: { content: "❌ Данные пользователя не найдены.", flags: 64 },
          });
        }

        const userData = userRes.rows[0];
        const level = (userData.level as number) || 0;
        const classId = userData.class_id as string | null;
        const prestigeCount = (userData.prestige_count as number) || 0;
        const lastAttackAt = userData.last_boss_attack_at as number || 0;

        // 4. БЫСТРАЯ ВАЛИДАЦИЯ: класс stripped (только basic доступен) -> type: 4
        if (classId === 'stripped' && attackType !== 'basic') {
          return Response.json({
            type: 4,
            data: { content: `❌ Вы лишены классового звания! Можно использовать только **⚔️ Обычный удар** до сброса Престижа.`, flags: 64 },
          });
        }

        // 5. БЫСТРАЯ ВАЛИДАЦИЯ: кулдаун (атомарный переход) -> type: 4
        // Используем атомарный UPDATE для предотвращения race condition на double-click
        const isSpeedBoss = bossType === 'phantom'; // phantom имеет 6-минутный кулдаун
        const baseCooldown = isSpeedBoss ? 6 * 60 * 1000 : 10 * 60 * 1000;
        const now = Date.now();
        const timeSinceLastAttack = now - lastAttackAt;

        if (timeSinceLastAttack < baseCooldown) {
          const remainingMs = baseCooldown - timeSinceLastAttack;
          const remainingMin = Math.ceil(remainingMs / 60000);
          return Response.json({
            type: 4,
            data: { content: `⏳ Отдых между атаками! До следующего удара: **${remainingMin} мин.**`, flags: 64 },
          });
        }

        // 6. БЫСТРАЯ ВАЛИДАЦИЯ: уровень для скилла < 10 -> type: 4
        if (attackType === 'skill' && level < 10) {
          return Response.json({
            type: 4,
            data: { content: "🔒 Классовый спец-скилл откроется на 10 уровне!", flags: 64 },
          });
        }

        // 7. БЫСТРАЯ ВАЛИДАЦИЯ: уровень для ульты < 50 -> type: 4
        if (attackType === 'ult' && level < 50) {
          return Response.json({
            type: 4,
            data: { content: "🔒 Ультимативная способность откроется на 50 уровне!", flags: 64 },
          });
        }

        // ============================================
        // ЕДИНСТВЕННЫЙ DEFER (type: 5) — после всех быстрых проверок
        // Всё, что ниже — тяжёлая работа с БД, уходит в ctx.waitUntil
        // ============================================
        ctx.waitUntil(
          (async () => {
            const webhookUrl = `https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${inter.token}`;

            try {
              // Базовый урон
              let baseDamage = 0;
              if (attackType === 'basic') {
                baseDamage = Math.floor(Math.random() * 201) + 600;
              } else if (attackType === 'skill') {
                baseDamage = Math.floor(Math.random() * 301) + 1100;
              } else {
                baseDamage = Math.floor(Math.random() * 601) + 1800;
              }

              // Достаём экипированные статы
              const gear = await getUserGear(db, uid, gid);
              baseDamage += gear.totalAtk;

              // Войс-буст (для leviathan усилен в 2 раза)
              const today = getVladivostokDate();
              const voiceResult = await db.execute({
                sql: 'SELECT voice_seconds FROM user_daily_activity WHERE user_id = ? AND guild_id = ? AND activity_date = ?',
                args: [uid, gid, today],
              });
              const voiceSeconds = (voiceResult.rows[0]?.voice_seconds as number) || 0;
              const voiceHours = voiceSeconds / 3600;

              let voiceBonus = 0;
              if (bossType === 'leviathan') {
                // Левиафан: войс-буст работает в 2 раза сильнее (+50%/час, кап +100%)
                voiceBonus = Math.min(voiceHours * 0.5, 1.0);
              } else {
                // Обычный войс-буст
                voiceBonus = Math.min(voiceHours * 0.25, 0.5);
              }

              // Престиж-буст (+5% на каждую звезду престижа)
              const prestigeBonus = prestigeCount * 0.05;

              // Особенности босса по типам
              // dragon: обычные тычки наносят -25% урона, пробивают скиллы/ульты
              if (bossType === 'dragon' && attackType === 'basic') {
                baseDamage = Math.round(baseDamage * 0.75);
              }

              // mimic: быстрый босс, каждый удар выбивает монеты (уже обработано ниже)
              // phantom: кулдаун 6 минут вместо 10 (уже обработано выше в cooldown проверке)

              // Классовые особенности: берсеркер на low HP ульте
              if (classId === 'berserker' && attackType === 'ult' && currentHp < maxHp * 0.2) {
                baseDamage = Math.round(baseDamage * 3); // x3 урона на ульте при < 20% HP босса
              }

              // Итоговый урон
              const finalDamage = Math.round(baseDamage * (1 + voiceBonus + prestigeBonus));

              // Фишка Мимика — выдача монет
              if (bossType === 'goblin') {
                const randomCoins = Math.floor(Math.random() * 26) + 15;
                await db.execute({
                  sql: 'UPDATE users SET coins = coins + ? WHERE user_id = ? AND guild_id = ?',
                  args: [randomCoins, uid, gid],
                });
              }

              // Атомарный урон в БД
              const bossId = boss.id as number;
              await db.execute({
                sql: 'UPDATE world_boss SET current_hp = MAX(0, current_hp - ?) WHERE id = ? AND guild_id = ? AND status = ?',
                args: [finalDamage, bossId, gid, 'active'],
              });

              await db.execute({
                sql: 'UPDATE users SET last_boss_attack_at = ? WHERE user_id = ? AND guild_id = ?',
                args: [now, uid, gid],
              });

              await db.execute({
                sql: 'INSERT INTO boss_damage_logs (boss_id, user_id, guild_id, damage, attack_type, created_at) VALUES (?, ?, ?, ?, ?, ?)',
                args: [bossId, uid, gid, finalDamage, attackType, now],
              });

              // Проверяем, повержен ли босс (безопасный SELECT с правильными колонками)
              const updatedBossResult = await db.execute({
                sql: 'SELECT current_hp, max_hp, message_id, boss_name FROM world_boss WHERE id = ? AND guild_id = ?',
                args: [bossId, gid],
              });
              const updatedBoss = updatedBossResult.rows[0];
              const newCurrentHp = updatedBoss.current_hp as number;

              // Используем фиксированные награды по типу босса
              // (xp_reward и coins_reward не существуют в таблице world_boss)
              let xpReward = 800;
              let coinsReward = 200;

              // Комбинируем награды в зависимости от типа босса
              if (bossType === 'mimic') {
                coinsReward = 300; // Мимик выдаёт больше монет
              } else if (bossType === 'leviathan') {
                xpReward = 1000; // Левиафан выдаёт больше опыта
              } else if (bossType === 'phantom') {
                xpReward = 900; // Фантом чуть дороже
              }
              const bossName = updatedBoss.boss_name as string;
              const bossChannelId = boss.channel_id as string;

              // Ветка: БОСС ПОВЕРЖЕН
              if (newCurrentHp <= 0) {
                await db.execute({
                  sql: 'UPDATE world_boss SET status = ? WHERE id = ? AND guild_id = ?',
                  args: ['defeated', bossId, gid],
                });

                // Начисляем награду всем участникам через batch
                const participantsResult = await db.execute({
                  sql: 'SELECT user_id, guild_id, SUM(damage) as total_dmg FROM boss_damage_logs WHERE boss_id = ? GROUP BY user_id, guild_id',
                  args: [bossId],
                });

                const participants = participantsResult.rows || [];
                const batchOps = participants.map((p: any) => ({
                  sql: 'UPDATE users SET xp = xp + ?, coins = coins + ? WHERE user_id = ? AND guild_id = ?',
                  args: [xpReward, coinsReward, p.user_id as string, p.guild_id as string],
                }));
                await db.batch(batchOps);

                // Топ-3 дамагеров
                const topDamageersResult = await db.execute({
                  sql: 'SELECT user_id, SUM(damage) as total_dmg FROM boss_damage_logs WHERE boss_id = ? GROUP BY user_id ORDER BY total_dmg DESC LIMIT 3',
                  args: [bossId],
                });
                const topDamageers = topDamageersResult.rows || [];

                // Редактируем Embed в канале
                const appId = env.DISCORD_APPLICATION_ID;
                const editUrl = `https://discord.com/api/v10/webhooks/${appId}/${boss.message_id as string}`;

                const victoryEmbed = {
                  embeds: [{
                    title: `🎉 МИРОВОЙ БОСС ${bossName} ПОВЕРЖЕН!`,
                    description: `Победа! Босс повержен!\n\n` +
                      `**Награда каждому участнику:**\n` +
                      `• 🎯 **+${xpReward} XP**\n` +
                      `• 🪙 **+${coinsReward} монет**\n\n` +
                      `**Топ дамагеров:**\n` +
                      (topDamageers.map((d: any, i: number) => {
                        const pos = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`;
                        return `${pos} <@${d.user_id as string}> — **${(d.total_dmg as number).toLocaleString()}** урона`;
                      }).join('\n') || '*Ударов пока не нанесено*'),
                    color: 0xF1C40F,
                  }],
                  components: [],
                };

                try {
                  await fetch(editUrl, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(victoryEmbed),
                  });
                } catch (err) {
                  console.error('[WorldBoss] Failed to edit victory message:', err);
                }
              } else {
                // Ветка: БОЙ ПРОДОЛЖАЕТСЯ
                const hpBarLength = 20;
                const hpRatio = Math.max(0, Math.min(newCurrentHp / maxHp, 1));
                const filled = Math.round(hpRatio * hpBarLength);
                const empty = hpBarLength - filled;
                const hpBar = '█'.repeat(filled) + '░'.repeat(empty);

                // Топ-3 текущих дамагеров
                const currentTopResult = await db.execute({
                  sql: 'SELECT user_id, SUM(damage) as total_dmg FROM boss_damage_logs WHERE boss_id = ? GROUP BY user_id ORDER BY total_dmg DESC LIMIT 3',
                  args: [bossId],
                });
                const currentTop = currentTopResult.rows || [];

                let topText = '';
                if (currentTop.length > 0) {
                  topText = currentTop.map((d: any, i: number) => {
                    const pos = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`;
                    return `${pos} <@${d.user_id as string}> — **${(d.total_dmg as number).toLocaleString()}** урона`;
                  }).join('\n');
                } else {
                  topText = '*Ударов пока не нанесено*';
                }

                const bossDesc = BOSS_DESCRIPTIONS[boss.boss_type as string] || 'Одолейте босса вместе с друзьями!';
                const diffMs = Math.max(0, (boss.expires_at as number) - now);
                const hoursLeft = Math.floor(diffMs / 3600000);
                const minsLeft = Math.floor((diffMs % 3600000) / 60000);
                const timeLeftStr = hoursLeft > 24
                  ? `${Math.floor(hoursLeft / 24)} дн. ${hoursLeft % 24} ч.`
                  : `${hoursLeft} ч. ${minsLeft} мин.`;

                const updatedEmbed = {
                  embeds: [{
                    title: `⚔️ МИРОВОЙ ��ОСС: ${boss.boss_name as string}`,
                    description: `${bossDesc}\n\n` +
                      `❤️ **HP:** \`${hpBar}\` **${newCurrentHp.toLocaleString()} / ${maxHp.toLocaleString()}**\n` +
                      `⏳ **Исчезнет через:** ${timeLeftStr}\n\n` +
                      `💥 **Топ охотников:**\n${topText}`,
                    color: 0xE74C3C,
                  }],
                  components: [
                    {
                      type: 1,
                      components: [
                        { type: 2, custom_id: 'boss_atk_basic', style: 4, label: '⚔️ Обычный удар' },
                        { type: 2, custom_id: 'boss_atk_skill', style: 1, label: '✨ Спец-скилл' },
                        { type: 2, custom_id: 'boss_atk_ult', style: 3, label: '👑 Ульта' },
                      ],
                    },
                  ],
                };

                // Редактируем Embed в канале через API бота
                const botToken = env.DISCORD_BOT_TOKEN;
                if (botToken && updatedBoss.message_id) {
                  const editUrl = `https://discord.com/api/v10/channels/${bossChannelId}/messages/${updatedBoss.message_id}`;
                  try {
                    await fetch(editUrl, {
                      method: 'PATCH',
                      headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bot ${botToken}`,
                      },
                      body: JSON.stringify(updatedEmbed),
                    });
                  } catch (err) {
                    console.error('[WorldBoss] Failed to edit HP message:', err);
                  }
                }
              }

              // Ответ обновлением через PATCH @original (БЕЗ поля type!)
              const cdMinutes = Math.ceil(baseCooldown / 60000);
              await fetch(webhookUrl, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  content: `💥 Вы нанесли **${finalDamage}** урона! (Осталось HP: ${newCurrentHp} / ${maxHp}). Следующий удар доступен через ${cdMinutes} мин.`,
                  flags: 64,
                }),
              });
            } catch (err) {
              console.error('[WorldBoss] Error in waitUntil:', err);
            }
          })()
        );

        // ЕДИНСТВЕННЫЙ type: 5 (DEFERRED) — сразу после всех быстрых проверок
        return Response.json({ type: 5 });
      }

      // 25. Слэш-команда /boss (Этап 13 - Показать статус босса)
      if (inter.type === 2 && inter.data?.name === "boss") {
        const gid = inter.guild_id;
        if (!gid) return Response.json({ error: "No guild" }, { status: 400 });

        const db = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });

        // Проверяем наличие активного босса
        const bossResult = await db.execute({
          sql: 'SELECT * FROM world_boss WHERE guild_id = ? AND status = ? LIMIT 1',
          args: [gid, 'active'],
        });

        if (bossResult.rows.length === 0) {
          return Response.json({
            type: 4,
            data: { content: "В данный момент на сервере нет активного босса. Он появится по расписанию!", flags: 64 },
          });
        }

        const boss = bossResult.rows[0];
        const bossDesc = BOSS_DESCRIPTIONS[boss.boss_type as string] || 'Одолейте босса вместе с друзьями!';
        const maxHp = boss.max_hp as number;
        const currentHp = boss.current_hp as number;
        const hoursLeft = Math.ceil((boss.expires_at as number - Date.now()) / 3600000);

        // Прогресс-бар HP (20 символов)
        const hpRatio = Math.max(0, Math.min(currentHp / maxHp, 1));
        const filled = Math.round(hpRatio * 20);
        const empty = 20 - filled;
        const hpBar = '█'.repeat(filled) + '░'.repeat(empty);

        // Топ-3 дамагеров
        const topDamageersResult = await db.execute({
          sql: 'SELECT user_id, SUM(damage) as total_dmg FROM boss_damage_logs WHERE boss_id = ? GROUP BY user_id ORDER BY total_dmg DESC LIMIT 3',
          args: [boss.id as number],
        });
        const topDamageers = topDamageersResult.rows || [];

        let topText = '';
        if (topDamageers.length > 0) {
          topText = topDamageers.map((d: any, i: number) => {
            const pos = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`;
            return `${pos} <@${d.user_id as string}> — **${(d.total_dmg as number).toLocaleString()}** урона`;
          }).join('\n');
        } else {
          topText = '*Ударов пока не нанесено*';
        }

        const result = {
          embeds: [{
            title: `⚔️ МИРОВОЙ БОСС: ${boss.boss_name as string}`,
            description: `${bossDesc}\n\n` +
              `❤️ **HP:** \`${hpBar}\` **${currentHp.toLocaleString()} / ${maxHp.toLocaleString()}**\n` +
              `⏳ **Исчезнет через:** ${hoursLeft} ч.\n\n` +
              `**Топ охотников:**\n${topText}\n\n` +
              `Сражение проходит в канале <#1051085743839260694>!`,
            color: 0xE74C3C,
          }],
          components: [],
        };

        ctx.waitUntil(
          (async () => {
            try {
              const resp = await fetch(`https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${inter.token}/messages/@original`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(result),
              });
              if (!resp.ok) console.error("Boss status update fail:", await resp.text());
            } catch (e) {
              console.error("Boss status error:", e);
            }
          })()
        );

        return Response.json({ type: 5 });
      }

      // 10. Обработка кнопок сброса престижа (Type 3 - Этап 9)
      if (inter.type === 3 && (inter.data?.custom_id?.startsWith("prestige_confirm_") || inter.data?.custom_id?.startsWith("prestige_cancel_"))) {
        const customId = inter.data.custom_id;
        const uid = customId.startsWith("prestige_confirm_") ? customId.substring(19) : customId.substring(18);
        if (!inter.guild_id) return Response.json({ error: "No guild" }, { status: 400 });

        const db = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });

        // Проверка: только автор может нажимать кнопки
        const clickedUserId = inter.member?.user.id;
        if (!clickedUserId || clickedUserId !== uid) {
          return Response.json({
            type: 4,
            data: { content: "❌ Вы не можете управлять чужим сбросом престижа!", flags: 64 },
          });
        }

        // Достаём актуальные данные пользователя
        const userRes = await db.execute({
          sql: 'SELECT xp, level, prestige_count FROM users WHERE user_id = ? AND guild_id = ?',
          args: [uid, inter.guild_id as string],
        });

        if (userRes.rows.length === 0) {
          return Response.json({
            type: 4,
            data: { content: "❌ Данные пользователя не найдены.", flags: 64 },
          });
        }

        const userData = userRes.rows[0];
        const level = userData.level as number || 0;

        // Перепроверка: уровень должен быть >= 100
        if (level < 100) {
          return Response.json({
            type: 4,
            data: { content: "⚠️ Ваш уровень изменился. Сброс престижа недоступен.", flags: 64 },
          });
        }

        const prestigeCount = (userData.prestige_count as number) || 0;

        if (customId.startsWith("prestige_cancel_")) {
          // Сброс отменён
          const result = {
            embeds: [{
              title: 'Сброс престижа отменён',
              description: 'Ваш 100 уровень в безопасности.',
              color: 0x747f8d,
            }],
            components: [],
          };
          return Response.json({ type: 7, data: result });
        }

        if (customId.startsWith("prestige_confirm_")) {
          // Подтверждение сброса
          const guildId = inter.guild_id as string;
          await db.execute({
            sql: 'UPDATE users SET prestige_count = prestige_count + 1, xp = 0, level = 0, class_id = NULL WHERE user_id = ? AND guild_id = ?',
            args: [uid, guildId],
          });

          const result = {
            embeds: [{
              title: '🎉 ПОЗДРАВЛЯЕМ СО СБРОСОМ ПРЕСТИЖА!',
              description: `**<@${uid}>** успешно сбросил уровень и получил **Престиж ★ ${prestigeCount + 1}**!\n\n` +
                '✨ Ваш класс сброшен! Вы можете выбрать новый боевой путь через **/class**!\n\n' +
                'Золотая звезда престижа теперь сияет на вашей карточке **/rank**!',
              color: 0xFFD700,
            }],
            components: [],
          };
          return Response.json({ type: 7, data: result });
        }
      }

      // 11. Обработка кнопок Войс-дропов (Type 3)
      if (inter.type === 3 && inter.data?.custom_id?.startsWith("airdrop_claim_")) {
        const customId = inter.data.custom_id;
        const dropId = customId.substring(14); // remove "airdrop_claim_"

        const db = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });
        const dropResult = await db.execute({
          sql: 'SELECT * FROM air_drops WHERE id = ?',
          args: [dropId],
        });

        if (dropResult.rows.length === 0) {
          return Response.json({
            type: 4,
            data: { content: "❌ Дроп не найден или устарел.", flags: 64 },
          });
        }

        const drop = dropResult.rows[0];
        const claimedBy = drop.claimed_by as string | null;
        const rewardXp = drop.reward_xp as number;
        const rewardType = drop.reward_type as string;

        // Проверяем, не забрали ли уже дроп
        if (claimedBy !== null) {
          return Response.json({
            type: 4,
            data: { content: `❌ Этот дроп уже успел забрать <@${claimedBy}>!`, flags: 64 },
          });
        }

        const guildId = drop.guild_id as string;
        const clickedUserId = inter.member?.user.id;

        if (!clickedUserId) {
          return Response.json({
            type: 4,
            data: { content: "❌ Не удалось определить пользователя.", flags: 64 },
          });
        }

        // Помечаем дроп как забранный
        const now = Math.floor(Date.now() / 1000);
        await db.execute({
          sql: 'UPDATE air_drops SET claimed_by = ?, claimed_at = ? WHERE id = ?',
          args: [clickedUserId, now, dropId],
        });

        // Выдаём награду
        if (rewardType === 'freeze') {
          // Заморозка стрика
          await db.execute({
            sql: 'UPDATE users SET streak_freezes = streak_freezes + 1 WHERE user_id = ? AND guild_id = ?',
            args: [clickedUserId, guildId],
          });
          console.log(`[AirDrop] User ${clickedUserId} claimed freeze reward from ${dropId}`);
        } else if (rewardType === 'xp') {
          // XP награда
          await db.execute({
            sql: 'UPDATE users SET xp = xp + ? WHERE user_id = ? AND guild_id = ?',
            args: [rewardXp, clickedUserId, guildId],
          });
          // Обновляем уровень
          const userResult = await db.execute({
            sql: 'SELECT xp FROM users WHERE user_id = ? AND guild_id = ?',
            args: [clickedUserId, guildId],
          });
          if (userResult.rows.length > 0) {
            const newXp = userResult.rows[0].xp as number;
            const newLevel = calculateLevel(newXp);
            await db.execute({
              sql: 'UPDATE users SET level = ? WHERE user_id = ? AND guild_id = ?',
              args: [newLevel, clickedUserId, guildId],
            });
          }
          console.log(`[AirDrop] User ${clickedUserId} claimed ${rewardXp} XP from ${dropId}`);
        }

        // Проверка достижения hl_airdrop - первый кто забрал дроп (проверяем, что claimed_by был null)
        if (claimedBy === null) {
          const webhookUrl = `https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${inter.token}`;
          await unlockAchievement(db, clickedUserId, guildId, 'hl_airdrop', webhookUrl, env.DISCORD_APPLICATION_ID);
        }

        // Ответ обновлением сообщения (Type 7)
        const result = {
          embeds: [{
            title: '🎉 Контейнер вскрыт!',
            description: `**<@${clickedUserId}>** первым открыл ящик и забрал награду:`,
            color: 0x2ECC71,
            fields: rewardType === 'freeze' ? [
              { name: 'Награда', value: '🧊 **1 Заморозка стрика!**', inline: true },
            ] : [
              { name: 'Награда', value: `💰 **+${rewardXp} XP**`, inline: true },
            ],
          }],
          components: [],
        };

        return Response.json({ type: 7, data: result });
      }

      // 10. Слэш-команда /card-customize (Этап 5 - Кастомизация карточки)
      if (inter.type === 2 && inter.data?.name === "card-customize") {
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

          // Достаём текущие настройки пользователя
          const cosmetRes = await db.execute({
            sql: "SELECT theme_id, title_id FROM user_cosmetics WHERE user_id = ? AND guild_id = ?",
            args: [uid, gid],
          });

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

      // 11. Обработка Select Menu для смены темы (Type 3)
      if (inter.type === 3 && inter.data?.custom_id === "card_select_theme") {
        const uid = inter.member?.user.id;
        const gid = inter.guild_id;
        if (!uid || !gid) return Response.json({ error: "No user or guild" }, { status: 400 });

        const selectedTheme = (inter.data.values as string[])?.[0];

        if (!selectedTheme || !["default", "cyberpunk", "magma", "midnight", "emerald"].includes(selectedTheme)) {
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

          // Сохраняем выбранную тему (INSERT OR REPLACE)
          await db.execute({
            sql: "INSERT OR REPLACE INTO user_cosmetics (user_id, guild_id, theme_id, title_id) VALUES (?, ?, ?, 'Новичок')",
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

      // 12. Обработка кнопок выбора класса (Type 3 - Этап 12)
      if (inter.type === 3 && inter.data?.custom_id?.startsWith("class_pick_")) {
        const customId = inter.data.custom_id;
        const classKey = customId.substring(11); // remove "class_pick_"
        const uid = inter.member?.user.id;
        const gid = inter.guild_id;

        if (!uid || !gid) return Response.json({ error: "No user or guild" }, { status: 400 });

        // Валидация выбранного класса
        const validClasses = ["warrior", "berserker", "mage", "necromancer", "ranger", "assassin", "artificer", "bard"];
        if (!validClasses.includes(classKey)) {
          return Response.json({
            type: 4,
            data: { content: "❌ Неверный выбор класса.", flags: 64 },
          });
        }

        try {
          const db = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });

          // Достаём текущие данные пользователя
          const userRes = await db.execute({
            sql: "SELECT level, class_id FROM users WHERE user_id = ? AND guild_id = ?",
            args: [uid, gid],
          });

          if (userRes.rows.length === 0) {
            return Response.json({
              type: 4,
              data: { content: "❌ Данные пользователя не найдены.", flags: 64 },
            });
          }

          const userData = userRes.rows[0];
          const level = (userData.level as number) || 0;
          const classId = userData.class_id as string | null;

          // ПРОВЕРКА СТАТУСА 'stripped' — проклятие дезертира
          if (classId === 'stripped') {
            return Response.json({
              type: 4,
              data: {
                content: '❌ Ваши навыки атрофированы за неактивность! Вы не можете выбрать класс до сброса Престижа.',
                flags: 64,
              },
            });
          }

          // Проверка: уровень >= 5 и class_id еще НЕ выбран
          if (level < 5) {
            return Response.json({
              type: 4,
              data: { content: "⚠️ Ваш уровень изменился. Выбор класса недоступен.", flags: 64 },
            });
          }

          if (userData.class_id !== null) {
            return Response.json({
              type: 4,
              data: { content: "⚠️ Вы уже выбрали класс. Сменить его можно только при сбросе Престижа.", flags: 64 },
            });
          }

          // Атомарно сохраняем выбор класса
          await db.execute({
            sql: "UPDATE users SET class_id = ? WHERE user_id = ? AND guild_id = ? AND class_id IS NULL",
            args: [classKey, uid, gid],
          });

          // Проверяем, был ли успешный update (класс еще не был выбран)
          // Если строк затронуто 0, значит класс уже выбрали (конфликт)
          const classDisplayName = getClassDisplayName(classKey);

          // Праздничный Embed с поздравлением
          const result = {
            embeds: [{
              title: `🎉 Вы выбрали класс: ${classDisplayName}!`,
              description: `**<@${uid}>** теперь состоит в классе **${classDisplayName}**!\n\n` +
                `Ваш скилл **Скилл 1** откроется на 10 уровне, а **Ульта** — на 50 уровне.\n\n` +
                `🔒 *Сменить класс можно только при сбросе Престижа на 100 уровне.*`,
              color: 0x2ecc71,
            }],
            components: [],
          };
          return Response.json({ type: 7, data: result });
        } catch (err) {
          console.error("[ClassPick] Error:", err);
          return Response.json({
            type: 4,
            data: { content: "❌ Ошибка при выборе класса. Попробуйте позже.", flags: 64 },
          });
        }
      }

      // 13. Слэш-команда /achievements (Этап 6 - Система достижений)
      if (inter.type === 2 && inter.data?.name === "achievements") {
        const uidOption = inter.data?.options?.find((o: any) => o.name === "user")?.value as string | undefined;
        const targetId = uidOption || inter.member?.user.id;
        const gid = inter.guild_id;
        if (!gid || !targetId) return Response.json({ error: "No guild or user" }, { status: 400 });

        ctx.waitUntil(
          (async () => {
            try {
              const db = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });

              // Достаём имя пользователя
              const targetUser = inter.data?.resolved?.users?.[targetId];
              const username = targetUser ? targetUser.username : inter.member?.user.username || "Unknown";

              // Достаём все открытые ачивки из БД
              const achievementsRes = await db.execute({
                sql: 'SELECT achievement_id, unlocked_at FROM user_achievements WHERE user_id = ? AND guild_id = ? ORDER BY unlocked_at DESC',
                args: [targetId, gid],
              });

              const unlockedAchievements = achievementsRes.rows || [];

              // Создаём словарь открытых ачивок для быстрого поиска
              const unlockedMap = new Map<string, number>();
              unlockedAchievements.forEach((row: any) => {
                unlockedMap.set(row.achievement_id as string, row.unlocked_at as number);
              });

              // Получаем полный список достижений из константы
              const totalAchievements = ACHIEVEMENTS_LIST.length;
              const unlockedCount = unlockedAchievements.length;

              // Формируем Embed
              let description = "";
              if (unlockedAchievements.length === 0) {
                description = "*Пока нет открытых достижений. Исследуйте сервер, чтобы разгадать секреты!*";
              } else {
                // Сортируем открытые ачивки по дате открытия (descending)
                const sortedUnlocked = unlockedAchievements
                  .map((row: any) => ({
                    id: row.achievement_id as string,
                    unlockedAt: row.unlocked_at as number,
                  }))
                  .sort((a: any, b: any) => b.unlockedAt - a.unlockedAt);

                sortedUnlocked.forEach((item: any) => {
                  const ach = ACHIEVEMENTS_LIST.find(a => a.id === item.id);
                  if (ach) {
                    description += `✅ **${ach.title}** — *${ach.description}* • <t:${item.unlockedAt}:d>\n`;
                  }
                });
              }

              description += `\n🔒 Секретных пасхалок осталось найти: **${totalAchievements - unlockedCount}**`;

              const result = {
                embeds: [{
                  title: `🏆 Достижения: ${username}`,
                  description: description,
                  color: 0xF1C40F,
                  footer: { text: `Прогресс: ${unlockedCount} / ${totalAchievements} достижений` },
                }],
                components: [],
              };

              const resp = await fetch(`https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${inter.token}/messages/@original`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(result),
              });
              if (!resp.ok) console.error("Achievements update fail:", await resp.text());
            } catch (e) {
              console.error("Achievements error:", e);
            }
          })()
        );
        return Response.json({ type: 5 });
      }

      // 13. Слэш-команда /server-kings (Этап 8 - Короли сервера)
      if (inter.type === 2 && inter.data?.name === 'server-kings') {
        const gid = inter.guild_id;
        if (!gid) return Response.json({ error: "No guild" }, { status: 400 });

        ctx.waitUntil(
          (async () => {
            try {
              const db = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });

              // Chat King
              const chatRes = await db.execute({
                sql: 'SELECT user_id, messages_count FROM users WHERE guild_id = ? ORDER BY messages_count DESC LIMIT 1',
                args: [gid],
              });
              const chatKing = chatRes.rows.length > 0 ? { user_id: chatRes.rows[0].user_id as string, messages_count: chatRes.rows[0].messages_count as number } : null;

              // Voice King
              const voiceRes = await db.execute({
                sql: 'SELECT user_id, voice_seconds FROM users WHERE guild_id = ? ORDER BY voice_seconds DESC LIMIT 1',
                args: [gid],
              });
              const voiceKing = voiceRes.rows.length > 0 ? { user_id: voiceRes.rows[0].user_id as string, voice_seconds: voiceRes.rows[0].voice_seconds as number } : null;

              // Online King
              const onlineRes = await db.execute({
                sql: 'SELECT user_id, online_seconds FROM users WHERE guild_id = ? ORDER BY online_seconds DESC LIMIT 1',
                args: [gid],
              });
              const onlineKing = onlineRes.rows.length > 0 ? { user_id: onlineRes.rows[0].user_id as string, online_seconds: onlineRes.rows[0].online_seconds as number } : null;

              // Streak King
              const streakRes = await db.execute({
                sql: 'SELECT user_id, streak_days FROM users WHERE guild_id = ? ORDER BY streak_days DESC LIMIT 1',
                args: [gid],
              });
              const streakKing = streakRes.rows.length > 0 ? { user_id: streakRes.rows[0].user_id as string, streak_days: streakRes.rows[0].streak_days as number } : null;

              // Quest Master
              const questRes = await db.execute({
                sql: 'SELECT user_id, COUNT(*) as count FROM user_quest_progress WHERE guild_id = ? AND completed_at IS NOT NULL GROUP BY user_id ORDER BY count DESC LIMIT 1',
                args: [gid],
              });
              const questMaster = questRes.rows.length > 0 ? { user_id: questRes.rows[0].user_id as string, count: questRes.rows[0].count as number } : null;

              // Формируем Embed
              const description = `💬 **Chat King:** <@${chatKing?.user_id || '-'}> — **${chatKing?.messages_count.toLocaleString() || 0}** сообщ.
🎙 **Voice King:** <@${voiceKing?.user_id || '-'}> — **${Math.floor((voiceKing?.voice_seconds || 0) / 3600)}** ч. в войсе
🟢 **Online King:** <@${onlineKing?.user_id || '-'}> — **${Math.floor((onlineKing?.online_seconds || 0) / 3600)}** ч. онлайн 🪑
🔥 **Streak King:** <@${streakKing?.user_id || '-'}> — **${streakKing?.streak_days || 0}** дн. стрик
🎯 **Quest Master:** <@${questMaster?.user_id || '-'}> — **${questMaster?.count || 0}** квестов

*Короны обновляются в реальном времени!*
`;

              const result = {
                embeds: [{
                  title: '👑 Зал Королевской Славы Сервера',
                  description: description,
                  color: 0xF1C40F,
                  footer: { text: 'Кто займет трон в конце года? • /recap для личной статистики' },
                }],
                components: [],
              };

              const resp = await fetch(`https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${inter.token}/messages/@original`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(result),
              });
              if (!resp.ok) console.error('Server kings update fail:', await resp.text());
            } catch (e) {
              console.error('Server kings error:', e);
            }
          })()
        );
        return Response.json({ type: 5 });
      }

      // 14. Слэш-команда /recap (Этап 8 - Discord Wrapped)
      if (inter.type === 2 && inter.data?.name === 'recap') {
        const uidOption = inter.data?.options?.find((o: any) => o.name === 'user')?.value as string | undefined;
        const targetId = uidOption || inter.member?.user.id;
        const gid = inter.guild_id;
        if (!gid || !targetId) return Response.json({ error: 'No guild or user' }, { status: 400 });

        ctx.waitUntil(
          (async () => {
            try {
              const db = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });

              // Достаём имя пользователя
              const targetUser = inter.data?.resolved?.users?.[targetId];
              const username = targetUser ? targetUser.username : inter.member?.user.username || 'Unknown';

              // Достаём данные пользователя
              const userRes = await db.execute({
                sql: 'SELECT messages_count, voice_seconds, online_seconds, xp, level, max_streak FROM users WHERE user_id = ? AND guild_id = ?',
                args: [targetId, gid],
              });

              if (userRes.rows.length === 0) {
                return Response.json({
                  type: 4,
                  data: { content: '❌ Данные пользователя не найдены. Напишите первое сообщение, чтобы зарегистрироваться!', flags: 64 },
                });
              }

              const userData = userRes.rows[0];
              const messages = userData.messages_count as number || 0;
              const voiceSeconds = userData.voice_seconds as number || 0;
              const onlineSeconds = userData.online_seconds as number || 0;
              const totalXp = userData.xp as number || 0;
              const level = userData.level as number || 0;
              const maxStreak = userData.max_streak as number || 0;

              // Считаем выполненные квесты
              const questRes = await db.execute({
                sql: 'SELECT COUNT(*) as count FROM user_quest_progress WHERE user_id = ? AND guild_id = ? AND completed_at IS NOT NULL',
                args: [targetId, gid],
              });
              const completedQuests = (questRes.rows[0]?.count as number) || 0;

              // Считаем позицию в топе
              const rankRes = await db.execute({
                sql: 'SELECT COUNT(*) as rank FROM users WHERE guild_id = ? AND xp > ?',
                args: [gid, totalXp],
              });
              const rank = ((rankRes.rows[0]?.rank as number) || 0) + 1;

              const totalRes = await db.execute({
                sql: 'SELECT COUNT(*) as total FROM users WHERE guild_id = ?',
                args: [gid],
              });
              const totalUsers = (totalRes.rows[0]?.total as number) || 1;

              // Вычисляем архетип игрока
              let persona = '⭐ Восходящая Звезда';
              const voiceHours = voiceSeconds / 3600;
              const onlineHours = onlineSeconds / 3600;

              if (voiceHours > 20) {
                persona = '🎙 Повелитель Микрофона';
              } else if (messages > 500) {
                persona = '💬 Текстовый Пулемётчик';
              } else if (onlineHours > 50) {
                persona = '🟢 Призрак Сервера (Онлайн 24/7)';
              } else if (maxStreak >= 14) {
                persona = '🔥 Неугасимое Пламя';
              }

              const description = (
                `🎭 Ваш архетип: **${persona}**\n` +
                `🏆 Место на сервере: **#${rank}** из **${totalUsers}**\n\n` +
                `📊 **Ваша статистика за год:**\n` +
                `• 💬 Сообщений отправлено: **${messages.toLocaleString()}**\n` +
                `• 🎙 Времени в войсе: **${Math.floor(voiceSeconds / 3600)} ч. ${Math.floor((voiceSeconds % 3600) / 60)} мин.**\n` +
                `• 🟢 Времени онлайн на сервере: **${Math.floor(onlineSeconds / 3600)} ч.**\n` +
                `• 🎯 Заданий выполнено: **${completedQuests}**\n` +
                `• 🔥 Лучший стрик года: **${maxStreak} дн.**`
              );

              const result = {
                embeds: [{
                  title: `✨ Discord Wrapped: Итоги года для ${username}`,
                  description: description,
                  color: 0x9B59B6,
                  footer: { text: 'LevelEdge Wrapped • Спасибо, что вы с нами!' },
                }],
                components: [],
              };

              const resp = await fetch(`https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${inter.token}/messages/@original`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(result),
              });
              if (!resp.ok) console.error('Recap update fail:', await resp.text());
            } catch (e) {
              console.error('Recap error:', e);
            }
          })()
        );
        return Response.json({ type: 5 });
      }
// 16. Слэш-команда /export (Этап 10 - CSV-экспорт аналитики)
      if (inter.type === 2 && inter.data?.name === "export") {
        const uid = inter.member?.user.id;
        const gid = inter.guild_id;
        if (!uid || !gid) return Response.json({ error: "No user or guild" }, { status: 400 });

        // Проверка прав администратора (флаг ADMINISTRATOR = 0x8)
        const perms = (inter.member as any)?.permissions;
        const isAdmin = perms ? (BigInt(perms) & 8n) === 8n : false;

        // Если прав нет — вежливо сообщаем об этом
        if (!isAdmin) {
          return Response.json({
            type: 4,
            data: {
              content: "❌ Эта команда доступна только администраторам сервера!",
              flags: 64, // Скрытое сообщение (видно только вызвавшему)
            },
          });
        }

        // Немедленно отвечаем type: 5 (думает...), чтобы избежать таймаута при генерации файла
        ctx.waitUntil(
          (async () => {
            const webhookUrl = `https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${inter.token}/messages/@original`;
            try {
              const db = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });

              // Выбираем всех участников сервера
              const usersRes = await db.execute({
                sql: "SELECT user_id, xp, level, season_xp, messages_count, voice_seconds, online_seconds, streak_days, max_streak, prestige_count FROM users WHERE guild_id = ? ORDER BY xp DESC",
                args: [gid],
              });

              const rows = usersRes.rows;
              if (!rows || rows.length === 0) {
                await fetch(webhookUrl, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    content: "❌ В базе данных пока нет участников для экспорта.",
                  }),
                });
                return;
              }

              // Формируем аккуратную CSV-таблицу
              let csvString = "User ID,Total XP,Level,Season XP,Messages,Voice Hours,Online Hours,Current Streak,Max Streak,Prestige Stars\n";
              for (const r of rows) {
                const uId = r.user_id as string;
                const xp = (r.xp as number) || 0;
                const lvl = (r.level as number) || 0;
                const sXp = (r.season_xp as number) || 0;
                const msgCount = (r.messages_count as number) || 0;
                const voiceHours = (((r.voice_seconds as number) || 0) / 3600).toFixed(1);
                const onlineHours = (((r.online_seconds as number) || 0) / 3600).toFixed(1);
                const streakDays = (r.streak_days as number) || 0;
                const maxStreak = (r.max_streak as number) || 0;
                const prestigeStars = (r.prestige_count as number) || 0;

                csvString += `"${uId}",${xp},${lvl},${sXp},${msgCount},${voiceHours},${onlineHours},${streakDays},${maxStreak},${prestigeStars}\n`;
              }

              // Собираем FormData для отправки бинарного файла
              const formData = new FormData();
              const payload = JSON.stringify({
                embeds: [
                  {
                    title: "📊 Аналитика сервера выгружена",
                    description: `Успешно экспортировано участников: **${rows.length}**.\nФайл аналитики прикреплён ниже.`,
                    color: 0x5865f2,
                    footer: { text: "LevelEdge Analytics • Полная выгрузка" },
                  },
                ],
                attachments: [{ id: 0, filename: "server-analytics.csv" }],
              });

              formData.append("payload_json", payload);
              formData.append(
                "files[0]",
                new Blob([csvString], { type: "text/csv;charset=utf-8;" }),
                "server-analytics.csv"
              );

              // Отправляем файл в чат
              const resp = await fetch(webhookUrl, {
                method: "PATCH",
                body: formData,
              });

              if (!resp.ok) {
                console.error("Export webhook error:", await resp.text());
              }
            } catch (err) {
              console.error("[Export] Error:", err);
              await fetch(webhookUrl, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  content: "❌ Произошла ошибка при формировании аналитики.",
                }),
              });
            }
          })()
        );

        return Response.json({ type: 5 });
      }
// 16. Слэш-команда /sell-junk (Этап 11 - Быстрый автобай хлама)
      if (inter.type === 2 && inter.data?.name === "sell-junk") {
        const uid = inter.member?.user.id;
        const gid = inter.guild_id;
        if (!uid || !gid) return Response.json({ error: "No user or guild" }, { status: 400 });

        ctx.waitUntil(
          (async () => {
            const webhookUrl = `https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${inter.token}/messages/@original`;
            try {
              const db = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });

              // Выбираем все предметы типа 'junk' пользователя
              const junkRes = await db.execute({
                sql: "SELECT id, item_name, sell_price FROM user_inventory WHERE user_id = ? AND guild_id = ? AND item_type = 'junk'",
                args: [uid, gid],
              });

              const junkItems = junkRes.rows;
              if (junkItems.length === 0) {
                await fetch(webhookUrl, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    content: "❌ У вас нет хлама для быстрой продажи!",
                    flags: 64, // Скрытое сообщение
                  }),
                });
                return;
              }

              // Достаём class_id для проверки бонуса техномага
              const classRes = await db.execute({
                sql: "SELECT class_id FROM users WHERE user_id = ? AND guild_id = ?",
                args: [uid, gid],
              });
              const classId = classRes.rows.length > 0 ? (classRes.rows[0].class_id as string | null) : null;
              const isArtificer = classId === 'artificer';

              // Считаем сумму и количество
              let totalCoins = 0;
              const itemIds: number[] = [];
              for (const item of junkItems) {
                totalCoins += (item.sell_price as number) || 10;
                itemIds.push(item.id as number);
              }

              // Бонус Техномага (+25% монет)
              if (isArtificer) {
                totalCoins = Math.round(totalCoins * 1.25);
              }

              // Атомарно начисляем монеты
              await db.execute({
                sql: "UPDATE users SET coins = coins + ? WHERE user_id = ? AND guild_id = ?",
                args: [totalCoins, uid, gid],
              });

              // Удаляем проданные предметы
              const placeholders = itemIds.map(() => '?').join(', ');
              await db.execute({
                sql: `DELETE FROM user_inventory WHERE user_id = ? AND guild_id = ? AND item_type = 'junk' AND id IN (${placeholders})`,
                args: [uid, gid, ...itemIds],
              });

              // Отправляем красивый Embed
              await fetch(webhookUrl, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  embeds: [{
                    title: "💰 Хлам успешно продан Скупщику!",
                    description: `Продано предметов: **${junkItems.length} шт.**\nПолучено: **+${totalCoins.toLocaleString()} 🪙**${isArtificer ? '\n\n⚡ Бонус Техномага (+25%): активирован!' : ''}`,
                    color: 0xF1C40F,
                    footer: { text: isArtificer ? "LevelEdge Marketplace (Техномаг)" : "LevelEdge Marketplace" },
                  }],
                  components: [],
                }),
              });
            } catch (err) {
              console.error("[SellJunk] Error:", err);
              await fetch(webhookUrl, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  content: "❌ Произошла ошибка при продаже хлама.",
                  flags: 64,
                }),
              });
            }
          })()
        );

        return Response.json({ type: 5 });
      }

      // 15. Слэш-команда /class (Этап 12 - Система RPG-классов)
      if (inter.type === 2 && inter.data?.name === "class") {
        const uid = inter.member?.user.id;
        const gid = inter.guild_id;
        if (!uid || !gid) return Response.json({ error: "No user or guild" }, { status: 400 });

        ctx.waitUntil(
          (async () => {
            try {
              const db = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });

              // Достаём данные пользователя
              const userRes = await db.execute({
                sql: "SELECT level, class_id, prestige_count FROM users WHERE user_id = ? AND guild_id = ?",
                args: [uid, gid],
              });

              if (userRes.rows.length === 0) {
                await fetch(`https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${inter.token}/messages/@original`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    content: "❌ Данные пользователя не найдены. Напишите первое сообщение, чтобы зарегистрироваться!",
                    flags: 64,
                  }),
                });
                return;
              }

              const userData = userRes.rows[0];
              const level = (userData.level as number) || 0;
              const classId = userData.class_id as string | null;
              const prestigeCount = (userData.prestige_count as number) || 0;

              // ПРОВЕРКА СТАТУСА 'stripped' — проклятие дезертира
              if (classId === 'stripped') {
                const result = {
                  embeds: [{
                    title: '🥀 Вы лишены классового звания!',
                    description: 'Ваши навыки атрофировались из-за недели неактивности на сервере!\n\n' +
                      '❌ Вы не можете использовать классовые скиллы и ульту.\n' +
                      '🔒 Выбрать новый класс можно **только после сброса Престижа** на 100 уровне!\n\n' +
                      '*Продолжайте общаться и проявлять активность, чтобы вернуть былую славу!*',
                    color: 0x747f8d,
                  }],
                  components: [],
                };
                await fetch(`https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${inter.token}/messages/@original`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(result),
                });
                return;
              }

              // А) Если уровень < 5
              if (level < 5) {
                const result = {
                  embeds: [{
                    title: "🔒 Выбор класса недоступен",
                    description: `Выбор боевого RPG-класса открывается на **5 уровне**!\nВаш текущий уровень: **${level} / 5**.\n\n*Продолжайте общаться в чате и голосовых каналах, чтобы разблокировать классы!*`,
                    color: 0x747f8d,
                  }],
                  components: [],
                };
                await fetch(`https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${inter.token}/messages/@original`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(result),
                });
                return;
              }

              // Б) Если class_id еще НЕ выбран
              if (classId === null) {
                const result = {
                  embeds: [{
                    title: "⚔️ Выберите свой боевой класс",
                    description: `Выберите свой путь! **Внимание:** сменить класс можно будет только после сброса Престижа на 100 уровне!\n\n` +
                      "🛡️ **Паладин** — Танк и мощь. Урон масштабируется от защиты.\n" +
                      "🪓 **Берсерк** — Массовый урон по области.\n" +
                      "🔮 **Архимаг** — Стихийный DoT. Поджигает босса автономным ожогом.\n" +
                      "💀 **Некромант** — Призыв орды из костей.\n" +
                      "🏹 **Следопыт** — Криты и скорость.\n" +
                      "🗡️ **Ассасин** — Мгновенный ядовитый урон.\n" +
                      "⚡ **Техномаг** — Сетевые турели и лазеры.\n" +
                      "🎵 **Бард** — Душа войса. Баффает друзей в комнате.\n\n" +
                      "*Нажмите кнопку ниже, чтобы сделать окончательный выбор:*",
                    color: 0x5865f2,
                  }],
                  components: [
                    {
                      type: 1,
                      components: [
                        { type: 2, custom_id: "class_pick_warrior", style: 1, label: "🛡️ Паладин" },
                        { type: 2, custom_id: "class_pick_berserker", style: 1, label: "🪓 Берсерк" },
                        { type: 2, custom_id: "class_pick_mage", style: 1, label: "🔮 Архимаг" },
                        { type: 2, custom_id: "class_pick_necromancer", style: 1, label: "💀 Некромант" },
                      ],
                    },
                    {
                      type: 1,
                      components: [
                        { type: 2, custom_id: "class_pick_ranger", style: 1, label: "🏹 Следопыт" },
                        { type: 2, custom_id: "class_pick_assassin", style: 1, label: "🗡️ Ассасин" },
                        { type: 2, custom_id: "class_pick_artificer", style: 1, label: "⚡ Техномаг" },
                        { type: 2, custom_id: "class_pick_bard", style: 1, label: "🎵 Бард" },
                      ],
                    },
                  ],
                };
                await fetch(`https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${inter.token}/messages/@original`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(result),
                });
                return;
              }

              // В) Если class_id УЖЕ выбран
              const className = getClassDisplayName(classId);
              const { skill1Name, skill2Name } = getClassSkills(classId);
              const skill1Status = level >= 10 ? "✅ Доступен" : "🔒 Откроется на 10 ур.";
              const skill2Status = level >= 50 ? "✅ Доступна" : "🔒 Откроется на 50 ур.";

              const colorMap: Record<string, number> = {
                warrior: 0xe74c3c,
                berserker: 0xc0392b,
                mage: 0x3498db,
                necromancer: 0x2c3e50,
                ranger: 0x2ecc71,
                assassin: 0x1abc9c,
                artificer: 0xf39c12,
                bard: 0x9b59b6,
              };

              const result = {
                embeds: [{
                  title: `📜 Ваш боевой профиль: ${className}`,
                  description: `**Класс:** ${className}\n**Уровень:** ${level}\n\n` +
                    `**Скилл 1 (10 ур.):** ${skill1Name} — ${skill1Status}\n` +
                    `**Ульта (50 ур.):** ${skill2Name} — ${skill2Status}\n\n` +
                    `🔒 *Сменить класс можно только при сбросе Престижа на 100 уровне.*`,
                  color: colorMap[classId] || 0x5865f2,
                }],
                components: [],
              };
              await fetch(`https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${inter.token}/messages/@original`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(result),
              });
            } catch (e) {
              console.error("[Class] Error:", e);
            }
          })()
        );

        return Response.json({ type: 5 });
      }

      // 17. Слэш-команда /inventory [page]
      if (inter.type === 2 && inter.data?.name === "inventory") {
        const uid = inter.member?.user.id;
        const gid = inter.guild_id;
        if (!uid || !gid) return Response.json({ error: "No user or guild" }, { status: 400 });

        const pageOption = inter.data?.options?.find((o) => o.name === "page")?.value as number;
        const page = pageOption || 1;

        ctx.waitUntil(
          (async () => {
            const webhookUrl = `https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${inter.token}/messages/@original`;
            try {
              const db = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });

              const inventoryData = await getUserInventory(db, uid, gid, page);

              if (inventoryData.items.length === 0) {
                await fetch(webhookUrl, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    content: "🎒 Ваш инвентарь пуст! Купите предметы на рынке или найдите дроп.",
                    flags: 64,
                  }),
                });
                return;
              }

              let description = "";
              for (const item of inventoryData.items) {
                description += formatInventoryItem(item, item.id as number);
              }

              const result = {
                embeds: [{
                  title: `🎒 Инвентарь пользователя`,
                  description: description,
                  color: 0x5865f2,
                  footer: { text: `Страница ${inventoryData.page} из ${inventoryData.maxPages} • Всего предметов: ${inventoryData.total}` },
                }],
                components: inventoryData.maxPages > 1 ? [
                  {
                    type: 1,
                    components: [
                      { type: 2, custom_id: `inventory_page_prev_${page}`, style: 2, label: "◀ Назад", disabled: page <= 1 },
                      { type: 2, custom_id: `inventory_page_next_${page}`, style: 2, label: "Вперед ▶", disabled: page >= inventoryData.maxPages },
                    ],
                  },
                ] : [],
              };

              await fetch(webhookUrl, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(result),
              });
            } catch (err) {
              console.error("[Inventory] Error:", err);
              await fetch(webhookUrl, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  content: "❌ Ошибка при загрузке инвентаря. Попробуйте позже.",
                  flags: 64,
                }),
              });
            }
          })()
        );
        return Response.json({ type: 5 });
      }

      // 18. Слэш-команда /gear [user]
      if (inter.type === 2 && inter.data?.name === "gear") {
        const uidOption = inter.data?.options?.find((o) => o.name === "user")?.value as string | undefined;
        const uid = uidOption || inter.member?.user.id;
        const gid = inter.guild_id;
        if (!gid || !uid) return Response.json({ error: "No guild or user" }, { status: 400 });

        ctx.waitUntil(
          (async () => {
            const webhookUrl = `https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${inter.token}/messages/@original`;
            try {
              const db = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });

              const gear = await getUserGear(db, uid, gid);

              let description = "";
              const slotIcons: Record<string, string> = {
                weapon: '🗡️',
                armor: '🛡️',
                ring: '💍',
                amulet: '📿',
              };
              const slotNames: Record<string, string> = {
                weapon: 'Оружие',
                armor: 'Броня',
                ring: 'Кольцо',
                amulet: 'Амулет',
              };

              for (const slot of ['weapon', 'armor', 'ring', 'amulet'] as const) {
                const item = gear[slot];
                if (item) {
                  description += `${slotIcons[slot]} **${slotNames[slot]}:** ${getRarityEmoji(item.rarity as string)} **${item.item_name}**\n`;
                } else {
                  description += `${slotIcons[slot]} **${slotNames[slot]}:** Нет\n`;
                }
              }

              const result = {
                embeds: [{
                  title: `🛡️ Снаряжение пользователя`,
                  description: description,
                  color: 0x2ecc71,
                  fields: [{
                    name: "Характеристики",
                    value: `⚔️ Атака: **+${gear.totalAtk}** | 🛡️ Защита: **+${gear.totalDef}** | 🎯 Крит: **+${gear.totalCrit}%** | 🪙 Монеты: **+${gear.totalCoin}%**`,
                    inline: false,
                  }],
                }],
              };

              await fetch(webhookUrl, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(result),
              });
            } catch (err) {
              console.error("[Gear] Error:", err);
              await fetch(webhookUrl, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  content: "❌ Ошибка при загрузке снаряжения. Попробуйте позже.",
                  flags: 64,
                }),
              });
            }
          })()
        );
        return Response.json({ type: 5 });
      }

      // 19. Слэш-команда /equip [id]
      if (inter.type === 2 && inter.data?.name === "equip") {
        const uid = inter.member?.user.id;
        const gid = inter.guild_id;
        if (!uid || !gid) return Response.json({ error: "No user or guild" }, { status: 400 });

        const idOption = inter.data?.options?.find((o) => o.name === "id")?.value as number;
        if (!idOption) {
          return Response.json({
            type: 4,
            data: { content: "❌ Укажите ID предмета для экипировки!", flags: 64 },
          });
        }

        ctx.waitUntil(
          (async () => {
            const webhookUrl = `https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${inter.token}/messages/@original`;
            try {
              const db = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });

              const item = await getInventoryItem(db, idOption, uid, gid);
              if (!item) {
                await fetch(webhookUrl, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    content: "❌ Предмет не найден в вашем инвентаре!",
                    flags: 64,
                  }),
                });
                return;
              }

              const slot = item.slot as string;
              if (!['weapon', 'armor', 'ring', 'amulet'].includes(slot)) {
                await fetch(webhookUrl, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    content: `❌ Нельзя экипировать этот предмет в слот ${slot}!`,
                    flags: 64,
                  }),
                });
                return;
              }

              // Снять старую вещь из этого слота
              await db.execute({
                sql: 'UPDATE user_inventory SET is_equipped = 0 WHERE user_id = ? AND guild_id = ? AND slot = ?',
                args: [uid, gid, slot],
              });

              // Надеть новую вещь
              await db.execute({
                sql: 'UPDATE user_inventory SET is_equipped = 1 WHERE id = ?',
                args: [idOption],
              });

              const result = {
                embeds: [{
                  title: "✅ Предмет экипирован!",
                  description: `Вы успешно экипировали **${item.item_name}** в слот **${slot}**!`,
                  color: 0x2ecc71,
                }],
              };

              await fetch(webhookUrl, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(result),
              });
            } catch (err) {
              console.error("[Equip] Error:", err);
              await fetch(webhookUrl, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  content: "❌ Ошибка при экипировке предмета. Попробуйте позже.",
                  flags: 64,
                }),
              });
            }
          })()
        );
        return Response.json({ type: 5 });
      }

      // 20. Слэш-команда /unequip [slot]
      if (inter.type === 2 && inter.data?.name === "unequip") {
        const uid = inter.member?.user.id;
        const gid = inter.guild_id;
        if (!uid || !gid) return Response.json({ error: "No user or guild" }, { status: 400 });

        const slotOption = inter.data?.options?.find((o) => o.name === "slot")?.value as string;
        if (!slotOption || !['weapon', 'armor', 'ring', 'amulet'].includes(slotOption)) {
          return Response.json({
            type: 4,
            data: {
              content: "❌ Укажите правильный слот: weapon, armor, ring или amulet!",
              flags: 64,
            },
          });
        }

        ctx.waitUntil(
          (async () => {
            const webhookUrl = `https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${inter.token}/messages/@original`;
            try {
              const db = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });

              // Проверить, есть ли вещь в этом слоте
              const itemRes = await db.execute({
                sql: 'SELECT item_name FROM user_inventory WHERE user_id = ? AND guild_id = ? AND slot = ? AND is_equipped = 1',
                args: [uid, gid, slotOption],
              });

              if (itemRes.rows.length === 0) {
                await fetch(webhookUrl, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    content: `❌ В слоте **${slotOption}** нет надетого предмета!`,
                    flags: 64,
                  }),
                });
                return;
              }

              // Снять вещь
              await db.execute({
                sql: 'UPDATE user_inventory SET is_equipped = 0 WHERE user_id = ? AND guild_id = ? AND slot = ?',
                args: [uid, gid, slotOption],
              });

              const result = {
                embeds: [{
                  title: "❌ Предмет снят",
                  description: `Снаряжение из слота **${slotOption}** снято.`,
                  color: 0xe74c3c,
                }],
              };

              await fetch(webhookUrl, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(result),
              });
            } catch (err) {
              console.error("[Unequip] Error:", err);
              await fetch(webhookUrl, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  content: "❌ Ошибка при снятии предмета. Попробуйте позже.",
                  flags: 64,
                }),
              });
            }
          })()
        );
        return Response.json({ type: 5 });
      }

      // 21. Слэш-команда /trade user:@User item_id:number price:number
      if (inter.type === 2 && inter.data?.name === "trade") {
        const uid = inter.member?.user.id;
        const gid = inter.guild_id;
        if (!uid || !gid) return Response.json({ error: "No user or guild" }, { status: 400 });

        const targetOption = inter.data?.options?.find((o) => o.name === "user")?.value as string;
        const itemIdOption = inter.data?.options?.find((o) => o.name === "item_id")?.value as number;
        const priceOption = inter.data?.options?.find((o) => o.name === "price")?.value as number;

        if (!targetOption) {
          return Response.json({
            type: 4,
            data: { content: "❌ Укажите пользователя, с которым хотите совершить сделку!", flags: 64 },
          });
        }
        if (!itemIdOption) {
          return Response.json({
            type: 4,
            data: { content: "❌ Укажите ID предмета для продажи!", flags: 64 },
          });
        }
        if (priceOption === undefined || priceOption === null) {
          return Response.json({
            type: 4,
            data: { content: "❌ Укажите цену в монетах! (0 для подарка)", flags: 64 },
          });
        }

        ctx.waitUntil(
          (async () => {
            const webhookUrl = `https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${inter.token}/messages/@original`;
            try {
              const db = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });

              // Проверить, что предмет существует и принад��ежит отправителю
              const itemRes = await db.execute({
                sql: 'SELECT * FROM user_inventory WHERE id = ? AND user_id = ? AND guild_id = ?',
                args: [itemIdOption, uid, gid],
              });

              if (itemRes.rows.length === 0) {
                await fetch(webhookUrl, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    content: "❌ Предмет не найден в вашем инвентаре!",
                    flags: 64,
                  }),
                });
                return;
              }

              const item = itemRes.rows[0];
              if ((item.is_equipped as number) === 1) {
                await fetch(webhookUrl, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    content: "❌ Нельзя продать надетый предмет! Сначала снимите его через /unequip.",
                    flags: 64,
                  }),
                });
                return;
              }

              // Создать запись сделки
              const now = Math.floor(Date.now() / 1000);
              await db.execute({
                sql: 'INSERT INTO direct_trades (guild_id, sender_id, target_id, inventory_id, price, status, created_at) VALUES (?, ?, ?, ?, ?, \'pending\', ?)',
                args: [gid, uid, targetOption, itemIdOption, priceOption, now],
              });
              // Получить ID вставленной записи
              const tradeRes = await db.execute({ sql: 'SELECT last_insert_rowid() as id', args: [] });
              const tradeId = (tradeRes.rows[0]?.id as number) || 0;

              // Создать Embed с предложением
              const result = {
                embeds: [{
                  title: "🤝 Предложение сделки!",
                  description: `<@${uid}> предлагает <@${targetOption}> приобрести предмет:\n\n` +
                    `📦 **${item.item_name}** (${getRarityEmoji(item.rarity as string)} ${item.rarity})\n` +
                    `💰 Цена: **${priceOption.toLocaleString()} 🪙**`,
                  color: 0x3498db,
                }],
                components: [
                  {
                    type: 1,
                    components: [
                      {
                        type: 2,
                        custom_id: `trade_accept_${tradeId}`,
                        style: 3,
                        label: "✅ Принять сделку",
                      },
                      {
                        type: 2,
                        custom_id: `trade_decline_${tradeId}`,
                        style: 4,
                        label: "❌ Отклонить",
                      },
                    ],
                  },
                ],
              };

              await fetch(webhookUrl, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(result),
              });
            } catch (err) {
              console.error("[Trade] Error:", err);
              await fetch(webhookUrl, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  content: "❌ Ошибка при создании сделки. Попробуйте позже.",
                  flags: 64,
                }),
              });
            }
          })()
        );
        return Response.json({ type: 5 });
      }

      // 22. Слэш-команда /market [action] [page] [item_id] [price]
      if (inter.type === 2 && inter.data?.name === "market") {
        const uid = inter.member?.user.id;
        const gid = inter.guild_id;
        if (!uid || !gid) return Response.json({ error: "No user or guild" }, { status: 400 });

        const actionOption = inter.data?.options?.find((o) => o.name === "action")?.value as string | undefined;
        const action = actionOption || "browse";

        ctx.waitUntil(
          (async () => {
            const webhookUrl = `https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${inter.token}/messages/@original`;
            try {
              const db = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });

              if (action === "browse") {
                const pageOption = inter.data?.options?.find((o) => o.name === "page")?.value as number;
                const page = pageOption || 1;
                const marketData = await getMarketListings(db, gid, page);

                if (marketData.listings.length === 0) {
                  await fetch(webhookUrl, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      content: "🛒 Рынок пуст! Начните торговлю с помощью `/market sell`.",
                      flags: 64,
                    }),
                  });
                  return;
                }

                let description = "";
                for (const listing of marketData.listings) {
                  description += `📦 **${listing.item_name}** (${getRarityEmoji(listing.rarity as string)} ${listing.rarity})\n` +
                    `└ ⚔️ +${listing.atk_bonus} | 🛡️ +${listing.def_bonus} | 🎯 +${listing.crit_bonus}% | 🪙 +${listing.coin_bonus}%\n` +
                    `└ 🛍️ Продавец: <@${listing.seller_id}> | 💰 Цена: **${listing.price.toLocaleString()} 🪙**\n\n`;
                }

                const result = {
                  embeds: [{
                    title: "🛒 Рынок",
                    description: description,
                    color: 0x3498db,
                    footer: { text: `Страница ${marketData.page} из ${marketData.maxPages} • Всего лотов: ${marketData.total}` },
                  }],
                  components: marketData.maxPages > 1 ? [
                    {
                      type: 1,
                      components: [
                        { type: 2, custom_id: `market_page_prev_${page}`, style: 2, label: "◀ Назад", disabled: page <= 1 },
                        { type: 2, custom_id: `market_page_next_${page}`, style: 2, label: "Вперед ▶", disabled: page >= marketData.maxPages },
                      ],
                    },
                  ] : [],
                };

                await fetch(webhookUrl, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(result),
                });
              } else if (action === "sell") {
                const itemOption = inter.data?.options?.find((o) => o.name === "item_id")?.value as number;
                const priceOption = inter.data?.options?.find((o) => o.name === "price")?.value as number;

                if (!itemOption || !priceOption) {
                  await fetch(webhookUrl, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      content: "❌ Используйте: `/market sell item_id:ID price:ЦЕНА`",
                      flags: 64,
                    }),
                  });
                  return;
                }

                // Проверить предмет
                const itemRes = await db.execute({
                  sql: 'SELECT * FROM user_inventory WHERE id = ? AND user_id = ? AND guild_id = ?',
                  args: [itemOption, uid, gid],
                });

                if (itemRes.rows.length === 0) {
                  await fetch(webhookUrl, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      content: "❌ Предмет не найден в вашем инвентаре!",
                      flags: 64,
                    }),
                  });
                  return;
                }

                if ((itemRes.rows[0].is_equipped as number) === 1) {
                  await fetch(webhookUrl, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      content: "❌ Нельзя выставить на продажу надетый предмет! Сначала снимите его через /unequip.",
                      flags: 64,
                    }),
                  });
                  return;
                }

                // Добавить лот
                const listingId = await addMarketListing(db, gid, uid, itemOption, priceOption);
                const item = itemRes.rows[0];

                const result = {
                  embeds: [{
                    title: "✅ Лот выставлен на рынок!",
                    description: `Вы выставили на продажу:\n\n` +
                      `📦 **${item.item_name}** (${getRarityEmoji(item.rarity as string)} ${item.rarity})\n` +
                      `💰 Цена: **${priceOption.toLocaleString()} 🪙**`,
                    color: 0x2ecc71,
                  }],
                };

                await fetch(webhookUrl, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(result),
                });
              } else if (action === "buy") {
                const itemOption = inter.data?.options?.find((o) => o.name === "item_id")?.value as number;

                if (!itemOption) {
                  await fetch(webhookUrl, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      content: "❌ Используйте: `/market buy item_id:ID`",
                      flags: 64,
                    }),
                  });
                  return;
                }

                const listingRes = await db.execute({
                  sql: 'SELECT * FROM market_listings WHERE id = ?',
                  args: [itemOption],
                });

                if (listingRes.rows.length === 0) {
                  await fetch(webhookUrl, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      content: "❌ Лот не найден!",
                      flags: 64,
                    }),
                  });
                  return;
                }

                const listing = listingRes.rows[0];
                const sellerId = listing.seller_id as string;
                const inventoryId = listing.inventory_id as number;
                const price = listing.price as number;

                // Проверить баланс покупателя
                const buyerRes = await db.execute({
                  sql: 'SELECT coins FROM users WHERE user_id = ? AND guild_id = ?',
                  args: [uid, gid],
                });

                if (buyerRes.rows.length === 0) {
                  await fetch(webhookUrl, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      content: "❌ У вас нет данных в базе! Напишите сообщение, чтобы зарегистрироваться.",
                      flags: 64,
                    }),
                  });
                  return;
                }

                const buyerCoins = (buyerRes.rows[0].coins as number) || 0;
                if (buyerCoins < price) {
                  await fetch(webhookUrl, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      content: `❌ У вас недостаточно монет для этой сделки! Текущий баланс: **${buyerCoins.toLocaleString()} 🪙**`,
                      flags: 64,
                    }),
                  });
                  return;
                }

                // Проверить, что предмет всё ещё у продавца
                const itemRes = await db.execute({
                  sql: 'SELECT * FROM user_inventory WHERE id = ?',
                  args: [inventoryId],
                });

                if (itemRes.rows.length === 0) {
                  await fetch(webhookUrl, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      content: "⚠️ Предмет уже продан или удалён!",
                      flags: 64,
                    }),
                  });
                  return;
                }

                const currentItem = itemRes.rows[0];
                if (currentItem.user_id as string !== sellerId) {
                  await fetch(webhookUrl, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      content: "⚠️ Предмет уже продан или удалён!",
                      flags: 64,
                    }),
                  });
                  return;
                }

                // Передача монет и предмета
                await db.execute({
                  sql: 'UPDATE users SET coins = coins - ? WHERE user_id = ? AND guild_id = ?',
                  args: [price, uid, gid],
                });
                await db.execute({
                  sql: 'UPDATE users SET coins = coins + ? WHERE user_id = ? AND guild_id = ?',
                  args: [price, sellerId, gid],
                });
                await db.execute({
                  sql: 'UPDATE user_inventory SET user_id = ? WHERE id = ?',
                  args: [uid, inventoryId],
                });

                // Удалить лот
                await db.execute({
                  sql: 'DELETE FROM market_listings WHERE id = ?',
                  args: [itemOption],
                });

                const result = {
                  embeds: [{
                    title: "🎉 Сделка успешна!",
                    description: `Вы купили **${currentItem.item_name}** за **${price.toLocaleString()} 🪙**!\n\n` +
                      `💰 <@${sellerId}> получил свои монеты.`,
                    color: 0x2ecc71,
                  }],
                };

                await fetch(webhookUrl, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(result),
                });
              } else {
                await fetch(webhookUrl, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    content: "❌ Используйте: /market browse, /market sell item_id:X price:Y, /market buy item_id:X",
                    flags: 64,
                  }),
                });
              }
            } catch (err) {
              console.error("[Market] Error:", err);
              await fetch(webhookUrl, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  content: "❌ Ошибка при работе с рынком. Попробуйте позже.",
                  flags: 64,
                }),
              });
            }
          })()
        );
        return Response.json({ type: 5 });
      }

      // 23. Слэш-команда /give-relic (только для администраторов)
      if (inter.type === 2 && inter.data?.name === "give-relic") {
        const uid = inter.member?.user.id;
        const gid = inter.guild_id;
        if (!uid || !gid) return Response.json({ error: "No user or guild" }, { status: 400 });

        // Проверка прав администратора
        const perms = (inter.member as any)?.permissions;
        const isAdmin = perms ? (BigInt(perms) & 8n) === 8n : false;
        if (!isAdmin) {
          return Response.json({
            type: 4,
            data: { content: "❌ Эта команда доступна только администраторам сервера!", flags: 64 },
          });
        }

        const itemIdOption = inter.data?.options?.find((o) => o.name === "item_id")?.value as string;
        const targetOption = inter.data?.options?.find((o) => o.name === "user")?.value as string;

        if (!itemIdOption) {
          return Response.json({
            type: 4,
            data: { content: "❌ Укажите item_id реликвии!", flags: 64 },
          });
        }
        if (!targetOption) {
          return Response.json({
            type: 4,
            data: { content: "❌ Укажите пользователя для выдачи реликвии!", flags: 64 },
          });
        }

        ctx.waitUntil(
          (async () => {
            const webhookUrl = `https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${inter.token}/messages/@original`;
            try {
              const db = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });

              // Проверить, есть ли такая реликвия в каталоге
              const relic = UNIQUE_ITEMS.find((r) => r.item_id === itemIdOption);
              if (!relic) {
                await fetch(webhookUrl, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    content: `❌ Реликвия с item_id **${itemIdOption}** не найдена в каталоге!`,
                    flags: 64,
                  }),
                });
                return;
              }

              // Проверить уникальность на сервере
              const existing = await getInventoryItemByItemId(db, itemIdOption, gid);
              if (existing) {
                const owner = existing.user_id as string;
                await fetch(webhookUrl, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    content: `❌ Этот артефакт уже существует на сервере у <@${owner}>!`,
                    flags: 64,
                  }),
                });
                return;
              }

              // Создать предмет
              const now = Math.floor(Date.now() / 1000);
              await db.execute({
                sql: 'INSERT INTO user_inventory (user_id, guild_id, item_name, item_id, item_type, rarity, slot, atk_bonus, def_bonus, crit_bonus, coin_bonus, is_equipped, description, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)',
                args: [targetOption, gid, relic.name, relic.item_id, 'relic', relic.rarity, relic.slot, relic.atk, relic.def, relic.crit, relic.coin, relic.description, now],
              });

              const result = {
                embeds: [{
                  title: "🎁 Реликвия выдана!",
                  description: `Администратор <@${uid}> выдал <@${targetOption}> реликвию:\n\n` +
                    `📦 **${relic.name}** (${getRarityEmoji(relic.rarity)} ${relic.rarity})\n` +
                    `⚔️ +${relic.atk} | 🛡️ +${relic.def} | 🎯 +${relic.crit}% | 🪙 +${relic.coin}%\n` +
                    `💰 Цена: **${relic.price.toLocaleString()} 🪙**`,
                  color: 0xf1c40f,
                }],
              };

              await fetch(webhookUrl, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(result),
              });
            } catch (err) {
              console.error("[GiveRelic] Error:", err);
              await fetch(webhookUrl, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  content: "❌ Ошибка при выдаче реликвии. Попробуйте позже.",
                  flags: 64,
                }),
              });
            }
          })()
        );
        return Response.json({ type: 5 });
      }

      // 16. Слэш-команда /export (Этап 10 - CSV-экспорт аналитики)
      if (inter.type === 2 && inter.data?.name === "export") {
        const gid = inter.guild_id;
        const uid = inter.member?.user.id;
        if (!gid || !uid) return Response.json({ error: "No guild or user" }, { status: 400 });

        // Проверка прав администратора (флаг ADMINISTRATOR = 8)
        const permissions = inter.member?.permissions;
        if (!permissions || !(BigInt(permissions) & 8n)) {
          return Response.json({
            type: 4,
            data: { content: "❌ Эта команда доступна только администраторам сервера!", flags: 64 },
          });
        }

        // Немедленно ответим DEFERRED, чтобы избежать таймаута
        ctx.waitUntil(
          (async () => {
            try {
              const db = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });

              // Выбираем всех участников гильдии
              const usersRes = await db.execute({
                sql: "SELECT user_id, xp, level, season_xp, messages_count, voice_seconds, online_seconds, streak_days, max_streak, prestige_count FROM users WHERE guild_id = ? ORDER BY xp DESC",
                args: [gid],
              });

              const rows = usersRes.rows;
              if (rows.length === 0) {
                const webhookUrl = `https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${inter.token}/messages/@original`;
                await fetch(webhookUrl, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    content: "❌ На сервере нет участников с данными.",
                    flags: 64,
                  }),
                });
                return;
              }

              // Формируем CSV-строку
              let csvString = "User ID,Total XP,Level,Season XP,Messages,Voice Hours,Online Hours,Current Streak,Max Streak,Prestige Stars\n";
              for (const r of rows) {
                const userId = r.user_id as string;
                const xp = (r.xp as number) || 0;
                const level = (r.level as number) || 0;
                const seasonXp = (r.season_xp as number) || 0;
                const msgCount = (r.messages_count as number) || 0;
                const voiceHours = ((r.voice_seconds as number) || 0) / 3600;
                const onlineHours = ((r.online_seconds as number) || 0) / 3600;
                const streakDays = (r.streak_days as number) || 0;
                const maxStreak = (r.max_streak as number) || 0;
                const prestigeStars = (r.prestige_count as number) || 0;

                csvString += `"${userId}",${xp},${level},${seasonXp},${msgCount},${voiceHours.toFixed(1)},${onlineHours.toFixed(1)},${streakDays},${maxStreak},${prestigeStars}\n`;
              }

              const webhookUrl = `https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${inter.token}/messages/@original`;

              // Собираем FormData
              const payload = JSON.stringify({
                embeds: [{
                  title: "📊 Аналитика сервера выгружена",
                  description: `Успешно экспортировано участников: **${rows.length}**.\nФайл прикреплён ниже.`,
                  color: 0x5865F2,
                  footer: { text: "LevelEdge Analytics" },
                }],
                attachments: [{ id: 0, filename: "server-analytics.csv" }],
              });

              const formData = new FormData();
              formData.append("payload_json", payload);
              formData.append("files[0]", new Blob([csvString], { type: "text/csv;charset=utf-8;" }), "server-analytics.csv");

              // Отправляем через PATCH webhook
              const resp = await fetch(webhookUrl, { method: "PATCH", body: formData });
              if (!resp.ok) {
                console.error("Export error:", await resp.text());
              }
            } catch (err) {
              console.error("[Export] Error:", err);
            }
          })()
        );

        return Response.json({ type: 5 });
      }

      // 17. Слэш-команда /boss-spawn (только для администраторов)
      if (inter.type === 2 && inter.data?.name === "boss-spawn") {
        const gid = inter.guild_id;
        const uid = inter.member?.user.id;
        if (!gid || !uid) return Response.json({ error: "No guild or user" }, { status: 400 });

        // Проверка прав администратора (флаг ADMINISTRATOR = 8)
        const permissions = inter.member?.permissions;
        if (!permissions || !(BigInt(permissions) & 8n)) {
          return Response.json({
            type: 4,
            data: { content: "❌ Эта команда доступна только администраторам сервера!", flags: 64 },
          });
        }

        ctx.waitUntil(
          (async () => {
            const webhookUrl = `https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${inter.token}/messages/@original`;
            try {
              const db = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });

              // 4 пресета боссов
              const bossPresets = [
                { boss_id: 'dragon', boss_name: '🔥 Пепельный Дракон Золотого Рога', max_hp: 7500, hours: 24 },
                { boss_id: 'mimic', boss_name: '💰 Жадный Мимик с Шаморы', max_hp: 4200, hours: 12 },
                { boss_id: 'leviathan', boss_name: '🌊 Кибер-Левиафан Японского Моря', max_hp: 6000, hours: 24 },
                { boss_id: 'phantom', boss_name: '👁️ Фантомный Архитектор Бездны', max_hp: 5500, hours: 24 },
              ];

              // Завершаем старого босса (если есть)
              await db.execute({
                sql: "UPDATE world_boss SET status = ? WHERE status = ? AND guild_id = ?",
                args: ['escaped', 'active', gid],
              });

              // Выбираем случайного босса
              const preset = bossPresets[Math.floor(Math.random() * bossPresets.length)];
              const spawnedAt = Date.now();
              const expiresAt = spawnedAt + preset.hours * 60 * 60 * 1000;

              // Вставляем нового босса
              const insertResult = await db.execute({
                sql: `INSERT INTO world_boss (guild_id, channel_id, boss_id, boss_name, boss_type, max_hp, current_hp, status, spawned_at, expires_at)
                      VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
                args: [gid, '1051085743839260694', preset.boss_id, preset.boss_name, preset.boss_id, preset.max_hp, preset.max_hp, spawnedAt, expiresAt],
              });

              // Получаем ID вставленной записи
              const idResult = await db.execute({ sql: 'SELECT last_insert_rowid() as id', args: [] });
              const bossId = (idResult.rows[0]?.id as number) || 1;

              // Сбрасываем кулдаун атак
              await db.execute({
                sql: 'UPDATE users SET last_boss_attack_at = 0',
                args: [],
              });

              // Формируем Embed для спавна босса
              const embed = {
                embeds: [{
                  title: `⚔️ МИРОВОЙ БОСС: ${preset.boss_name}`,
                  description: `**Босс призван администратором!**\n\n` +
                    `❤️ **HP:** \`--------------------\` **${preset.max_hp.toLocaleString()} / ${preset.max_hp.toLocaleString()}**\n` +
                    `⏳ **Исчезнет через:** ${preset.hours} ч.\n\n` +
                    `💥 **Топ охотников:**\n*Ударов пока не нанесено*`,
                  color: 0xE74C3C,
                }],
                components: [
                  {
                    type: 1,
                    components: [
                      { type: 2, custom_id: 'boss_atk_basic', style: 4, label: '⚔️ Обычный удар' },
                      { type: 2, custom_id: 'boss_atk_skill', style: 1, label: '✨ Спец-скилл' },
                      { type: 2, custom_id: 'boss_atk_ult', style: 3, label: '👑 Ульта' },
                    ],
                  },
                ],
              };

              // Отправляем Embed в канал через API бота
              const token = env.DISCORD_BOT_TOKEN;
              if (!token) {
                console.error('[BossSpawn] DISCORD_BOT_TOKEN is not set in worker env');
                await fetch(webhookUrl, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    content: '❌ Бот не настроен (отсутствует токен). Обратитесь к разработчику.',
                  }),
                });
              } else {
                const apiUrl = `https://discord.com/api/v10/channels/1051085743839260694/messages`;
                const response = await fetch(apiUrl, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bot ${token}`,
                  },
                  body: JSON.stringify(embed),
                });

                if (response.ok) {
                  const msgData = await response.json() as { id: string };
                  const messageId = msgData.id;

                  // Обновляем message_id в БД (с фильтром по guild_id для безопасности)
                  await db.execute({
                    sql: 'UPDATE world_boss SET message_id = ? WHERE id = ? AND guild_id = ?',
                    args: [messageId, bossId, gid],
                  });

                  await fetch(webhookUrl, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      content: `✅ Новый Мировой Босс успешно призван в канал рейда!`,
                    }),
                  });
                } else {
                  console.error('[BossSpawn] Failed to send message:', await response.text());
                  await fetch(webhookUrl, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      content: '❌ Ошибка при отправке сообщения в канал.',
                    }),
                  });
                }
              }
            } catch (err) {
              console.error('[BossSpawn] Error:', err);
              await fetch(webhookUrl, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  content: '❌ Ошибка при спавне босса.',
                }),
              });
            }
          })()
        );

        return Response.json({ type: 5 });
      }

      // 16. Слэш-команда /prestige (Этап 9 - Система престижа)
      if (inter.type === 2 && inter.data?.name === "prestige") {
        const uid = inter.member?.user.id;
        const gid = inter.guild_id;
        if (!uid || !gid) return Response.json({ error: "No user or guild" }, { status: 400 });

        ctx.waitUntil(
          (async () => {
            const webhookUrl = `https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${inter.token}/messages/@original`;
            try {
              const db = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });

              // Достаём данные пользователя
              const userRes = await db.execute({
                sql: "SELECT xp, level, prestige_count FROM users WHERE user_id = ? AND guild_id = ?",
                args: [uid, gid],
              });

              if (userRes.rows.length === 0) {
                await fetch(webhookUrl, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    content: "❌ Данные пользователя не найдены. Напишите первое сообщение, чтобы зарегистрироваться!",
                  }),
                });
                return;
              }

              const userData = userRes.rows[0];
              const level = (userData.level as number) || 0;
              const xp = (userData.xp as number) || 0;
              const prestigeCount = (userData.prestige_count as number) || 0;

              let result: any;

              // Если уровень меньше 100
              if (level < 100) {
                result = {
                  embeds: [
                    {
                      title: "🔒 Сброс престижа недоступен",
                      description:
                        `Для совершения сброса престижа требуется **100 уровень**.\n` +
                        `Ваш текущий уровень: **${level} / 100** (${xp.toLocaleString()} XP).\n\n` +
                        `*Продолжайте проявлять активность в чате и войсе, чтобы достичь вершины!*`,
                      color: 0x747f8d,
                    },
                  ],
                  components: [],
                };
              } else {
                // Если уровень >= 100
                result = {
                  embeds: [
                    {
                      title: "⭐ Доступен сброс престижа!",
                      description:
                        `Вы достигли максимального 100 уровня! Вы можете сбросить опыт до 0 и получить постоянную **Звезду Престижа**.\n\n` +
                        `• Текущий престиж: **★ ${prestigeCount}** ➔ станет: **★ ${prestigeCount + 1}**\n` +
                        `• Ваш уровень вернётся на 0, но звезда останется на вашей карточке навсегда!\n\n` +
                        `Вы уверены, что хотите совершить сброс?`,
                      color: 0xffd700,
                    },
                  ],
                  components: [
                    {
                      type: 1,
                      components: [
                        {
                          type: 2,
                          custom_id: `prestige_confirm_${uid}`,
                          style: 3,
                          label: "⭐ Подтвердить сброс",
                        },
                        {
                          type: 2,
                          custom_id: `prestige_cancel_${uid}`,
                          style: 2,
                          label: "❌ Отмена",
                        },
                      ],
                    },
                  ],
                };
              }

              // Отправляем готовый ответ в Discord через webhook
              await fetch(webhookUrl, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(result),
              });
            } catch (e) {
              console.error("Prestige error:", e);
              await fetch(webhookUrl, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  content: "❌ Ошибка при обработке команды. Попробуйте позже.",
                }),
              });
            }
          })()
        );

        return Response.json({ type: 5 });
      }

      return Response.json({ error: "Unknown interaction" }, { status: 400 });
    }

    if (url.pathname === "/health") return new Response("OK");
    return new Response("Not Found", { status: 404 });
  },
};
