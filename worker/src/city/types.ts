// ============================================
// Типы системы Недвижимости и Города (Шаг 1)
// ============================================

export type BuildingType = 'mine' | 'farm' | 'gas_station' | 'shop' | 'restaurant' | 'casino' | 'bank' | 'port';

export type ZoneType = 'mountain' | 'suburb' | 'highway' | 'center' | 'coast';

export type OwnerType = 'user' | 'company';

export interface PlotData {
  id: number;
  zone: ZoneType;
  title: string;
  base_price: number;
  allowed_buildings: BuildingType[];
}

export interface BuildingConfig {
  type: BuildingType;
  name: string;
  emoji: string;
  base_cost: number;
  upgrade_multiplier: number;
  daily_revenue: number[]; // [lvl1, lvl2, lvl3] в монетах
  weekly_tax: number[];    // [lvl1, lvl2, lvl3] в монетах
}
