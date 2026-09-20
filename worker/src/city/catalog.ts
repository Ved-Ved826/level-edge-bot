// ============================================
// Каталог системы Недвижимости и Города (Шаг 1)
// ============================================

import { BuildingConfig, BuildingType, PlotData } from './types';

/**
 * 12 фиксированных участков карты.
 * zone/title в БД (city_plots) не хранятся — берутся из каталога по id участка.
 */
export const PLOTS_CATALOG: PlotData[] = [
  // #1, #2: Горный склон — только шахты
  { id: 1, zone: 'mountain', title: 'Горный склон', base_price: 3000, allowed_buildings: ['mine'] },
  { id: 2, zone: 'mountain', title: 'Горный склон', base_price: 3000, allowed_buildings: ['mine'] },
  // #3, #4: Пригородная долина — только фермы
  { id: 3, zone: 'suburb', title: 'Пригородная долина', base_price: 2500, allowed_buildings: ['farm'] },
  { id: 4, zone: 'suburb', title: 'Пригородная долина', base_price: 2500, allowed_buildings: ['farm'] },
  // #5, #6: Шоссе и трасса — АЗС и супермаркеты
  { id: 5, zone: 'highway', title: 'Шоссе и трасса', base_price: 3500, allowed_buildings: ['gas_station', 'shop'] },
  { id: 6, zone: 'highway', title: 'Шоссе и трасса', base_price: 3500, allowed_buildings: ['gas_station', 'shop'] },
  // #7, #8: Деловой центр (Золотая земля) — казино, банки, рестораны
  { id: 7, zone: 'center', title: 'Деловой центр (Золотая земля)', base_price: 7000, allowed_buildings: ['casino', 'bank', 'restaurant'] },
  { id: 8, zone: 'center', title: 'Деловой центр (Золотая земля)', base_price: 7000, allowed_buildings: ['casino', 'bank', 'restaurant'] },
  // #9, #10: Торговый проспект — супермаркеты и рестораны
  { id: 9, zone: 'highway', title: 'Торговый проспект', base_price: 4000, allowed_buildings: ['shop', 'restaurant'] },
  { id: 10, zone: 'highway', title: 'Торговый проспект', base_price: 4000, allowed_buildings: ['shop', 'restaurant'] },
  // #11, #12: Морская гавань — порты и рестораны
  { id: 11, zone: 'coast', title: 'Морская гавань', base_price: 5000, allowed_buildings: ['port', 'restaurant'] },
  { id: 12, zone: 'coast', title: 'Морская гавань', base_price: 5000, allowed_buildings: ['port', 'restaurant'] },
];

/**
 * Параметры зданий: стоимость постройки, множитель апгрейда,
 * дневной доход и недельный налог по уровням 1-3.
 */
export const BUILDINGS_CONFIG: Record<BuildingType, BuildingConfig> = {
  mine: {
    type: 'mine',
    name: 'Шахта',
    emoji: '⛏️',
    base_cost: 4000,
    upgrade_multiplier: 1.6,
    daily_revenue: [300, 750, 1600],
    weekly_tax: [60, 150, 320],
  },
  farm: {
    type: 'farm',
    name: 'Ферма',
    emoji: '🌾',
    base_cost: 3000,
    upgrade_multiplier: 1.6,
    daily_revenue: [220, 550, 1200],
    weekly_tax: [45, 110, 240],
  },
  gas_station: {
    type: 'gas_station',
    name: 'АЗС',
    emoji: '⛽',
    base_cost: 4500,
    upgrade_multiplier: 1.6,
    daily_revenue: [350, 850, 1800],
    weekly_tax: [70, 170, 360],
  },
  shop: {
    type: 'shop',
    name: 'Супермаркет',
    emoji: '🛒',
    base_cost: 3800,
    upgrade_multiplier: 1.6,
    daily_revenue: [280, 700, 1500],
    weekly_tax: [55, 140, 300],
  },
  restaurant: {
    type: 'restaurant',
    name: 'Ресторан',
    emoji: '🍽️',
    base_cost: 4200,
    upgrade_multiplier: 1.6,
    daily_revenue: [320, 800, 1700],
    weekly_tax: [65, 160, 340],
  },
  casino: {
    type: 'casino',
    name: 'Казино',
    emoji: '🎰',
    base_cost: 9000,
    upgrade_multiplier: 1.6,
    daily_revenue: [800, 2000, 4500],
    weekly_tax: [180, 450, 1000],
  },
  bank: {
    type: 'bank',
    name: 'Банк',
    emoji: '🏛️',
    base_cost: 12000,
    upgrade_multiplier: 1.6,
    daily_revenue: [1000, 2500, 5500],
    weekly_tax: [220, 550, 1200],
  },
  port: {
    type: 'port',
    name: 'Морской порт',
    emoji: '⚓',
    base_cost: 6500,
    upgrade_multiplier: 1.6,
    daily_revenue: [500, 1250, 2700],
    weekly_tax: [100, 250, 540],
  },
};
