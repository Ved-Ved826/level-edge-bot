// ============================================
// Каталог уникальных реликвий (Этап 14)
// ============================================

export interface UniqueItem {
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

// 15 уникальных реликвий (по 3 на редкость + по 1 на финальные)
export const UNIQUE_ITEMS: UniqueItem[] = [
  // --- Обычные (common) ---
  {
    item_id: 'rusty_pipe',
    slot: 'weapon',
    name: 'Ржавая газовая труба',
    rarity: 'common',
    atk: 25,
    def: 0,
    crit: 0,
    coin: 0,
    price: 50,
    description: 'Ржавая газовая труба — надёжный старый друг.',
  },
  {
    item_id: 'leather_jacket',
    slot: 'armor',
    name: 'Потёртая кожанка',
    rarity: 'common',
    atk: 0,
    def: 20,
    crit: 0,
    coin: 0,
    price: 50,
    description: 'Потёртая кожанка от старого куртье.',
  },
  {
    item_id: 'copper_nut',
    slot: 'ring',
    name: 'Медная гайка на палец',
    rarity: 'common',
    atk: 10,
    def: 10,
    crit: 0,
    coin: 0,
    price: 50,
    description: 'Медная гайка — неожиданно прочная.',
  },

  // --- Редкие (rare) ---
  {
    item_id: 'hunting_shotgun',
    slot: 'weapon',
    name: 'Дробовик ИЖ-27',
    rarity: 'rare',
    atk: 95,
    def: 0,
    crit: 5,
    coin: 0,
    price: 200,
    description: 'Классический дробовик ИЖ-27 — надёжный друг охотника.',
  },
  {
    item_id: 'sailor_pea_coat',
    slot: 'armor',
    name: 'Штормовой бушлат моряка',
    rarity: 'rare',
    atk: 0,
    def: 80,
    crit: 0,
    coin: 5,
    price: 200,
    description: 'Бушлат выдержал шторма и баланс.',
  },
  {
    item_id: 'shark_tooth',
    slot: 'amulet',
    name: 'Акулий клык с Шаморы',
    rarity: 'rare',
    atk: 40,
    def: 40,
    crit: 0,
    coin: 0,
    price: 200,
    description: 'Акулий клык, привезённый с Шаморы.',
  },

  // --- Эпические (epic) ---
  {
    item_id: 'cyber_katana',
    slot: 'weapon',
    name: 'Катана «Уличный Самурай»',
    rarity: 'epic',
    atk: 220,
    def: 0,
    crit: 12,
    coin: 0,
    price: 600,
    description: 'Катана с неоновой рукоятью — стиль и мощь.',
  },
  {
    item_id: 'forklift_exo',
    slot: 'armor',
    name: 'Экзоскелет погрузчика',
    rarity: 'epic',
    atk: 30,
    def: 190,
    crit: 0,
    coin: 0,
    price: 600,
    description: 'Экзоскелет с мощным гидравлическим приводом.',
  },
  {
    item_id: 'gambler_ring',
    slot: 'ring',
    name: 'Перстень Азартного Шулера',
    rarity: 'epic',
    atk: 70,
    def: 0,
    crit: 18,
    coin: 15,
    price: 600,
    description: 'Перстень с костяными вставками — удача всегда рядом.',
  },

  // --- Легендарные (legendary) ---
  {
    item_id: 'anchor_gold_horn',
    slot: 'weapon',
    name: 'Заточенный Якорь Золотого Рога',
    rarity: 'legendary',
    atk: 420,
    def: 0,
    crit: 20,
    coin: 0,
    price: 1500,
    description: 'Якорь из Золотого Рога, заточенный до блеска.',
  },
  {
    item_id: 'titan_armor',
    slot: 'armor',
    name: 'Доспех Пепельного Титана',
    rarity: 'legendary',
    atk: 60,
    def: 350,
    crit: 0,
    coin: 0,
    price: 1500,
    description: 'Доспех, выдерживающий удары боссов.',
  },
  {
    item_id: 'pyanse_amulet',
    slot: 'amulet',
    name: 'Окаменевшее Пян-се Вечности',
    rarity: 'legendary',
    atk: 180,
    def: 180,
    crit: 0,
    coin: 25,
    price: 1500,
    description: 'Окаменевший пирожок с говядиной — источник силы.',
  },

  // --- Мифические (mythic) ---
  {
    item_id: 'star_cleaver',
    slot: 'weapon',
    name: 'Клинок Раскалывателя Звёзд',
    rarity: 'mythic',
    atk: 700,
    def: 0,
    crit: 35,
    coin: 20,
    price: 4000,
    description: 'Оружие, способное рассечь звёзды.',
  },
  {
    item_id: 'absolute_aegis',
    slot: 'armor',
    name: 'Нано-костюм «Абсолютный Заслон»',
    rarity: 'mythic',
    atk: 120,
    def: 600,
    crit: 0,
    coin: 20,
    price: 4000,
    description: 'Самый мощный нано-костюм, созданный человеком.',
  },
  {
    item_id: 'heart_of_ocean',
    slot: 'amulet',
    name: 'Сердце Океана',
    rarity: 'mythic',
    atk: 350,
    def: 350,
    crit: 30,
    coin: 30,
    price: 5000,
    description: 'Магический амулет, источающий силу моря.',
  },
];

// Вспомогательные функции
export function getRarityColor(rarity: string): number {
  const colors: Record<string, number> = {
    common: 0x95a5a6, // серый
    rare: 0x3498db, // синий
    epic: 0x9b59b6, // фиолетовый
    legendary: 0xf1c40f, // золотой
    mythic: 0xe74c3c, // красный
  };
  return colors[rarity] || 0x747f8d;
}

export function getRarityEmoji(rarity: string): string {
  const emojis: Record<string, string> = {
    common: '⚪',
    rare: '🔵',
    epic: '🟣',
    legendary: '🟡',
    mythic: '🔴',
  };
  return emojis[rarity] || '⚪';
}

// Поиск реликвии по item_id
export function findItemById(itemId: string): UniqueItem | undefined {
  return UNIQUE_ITEMS.find((item) => item.item_id === itemId);
}
