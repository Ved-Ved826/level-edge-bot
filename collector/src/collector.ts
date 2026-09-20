import { Client, GatewayIntentBits, Message, VoiceState } from 'discord.js';
// Р’РђР–РќРћ: СЃСѓР±РїСЏС‚СЊ /web РѕР±СЏР·Р°С‚РµР»РµРЅ РґР»СЏ Termux Android вЂ” С‚Р°Рј РЅРµС‚ РЅР°С‚РёРІРЅС‹С…
// glibc C++ Р±РёРЅР°СЂРµР№ libsql (РёРЅР°С‡Рµ MODULE_NOT_FOUND РІ requireNative).
import { createClient } from '@libsql/client/web';
import 'dotenv/config';

import http from 'node:http';

import { processCompanyCrises, processCrisisTimeouts, sendCrisisSpawnEvent } from './crises.js';

// РњРёРєСЂРѕ-СЃРµСЂРІРµСЂ РґР»СЏ РїСЂРѕС…РѕР¶РґРµРЅРёСЏ Healthcheck РЅР° Koyeb
const PORT = process.env.PORT || 8000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Collector is running!');
}).listen(PORT, () => {
  console.log(`[Healthcheck] Listening on port ${PORT}`);
});

// ============================================
// Р“Р»РѕР±Р°Р»СЊРЅР°СЏ Р·Р°С‰РёС‚Р° РѕС‚ СЃРµС‚РµРІС‹С… СЃР±РѕРµРІ Turso/libSQL
// (FetchError: Premature close, ECONNRESET, fetch failed Рё С‚.Рї.)
// РќРµ РґР°С‘Рј РїСЂРѕС†РµСЃСЃСѓ СѓРїР°СЃС‚СЊ РёР·-Р·Р° РІСЂРµРјРµРЅРЅРѕРіРѕ СЂР°Р·СЂС‹РІР° СЃРѕРµРґРёРЅРµРЅРёСЏ СЃ Р‘Р”.
// ============================================
function isTransientNetworkError(err: any): boolean {
  const message = String(err?.message || err || '');
  return (
    message.includes('Premature close') ||
    message.includes('FetchError') ||
    message.includes('ECONNRESET') ||
    message.includes('fetch failed') ||
    message.includes('ETIMEDOUT') ||
    message.includes('ENOTFOUND') ||
    message.includes('socket hang up')
  );
}

process.on('unhandledRejection', (reason: any) => {
  if (isTransientNetworkError(reason)) {
    console.error('[Network] Unhandled rejection (transient network error), collector РїСЂРѕРґРѕР»Р¶Р°РµС‚ СЂР°Р±РѕС‚Сѓ:', reason?.message || reason);
  } else {
    console.error('[UnhandledRejection]', reason);
  }
});

process.on('uncaughtException', (err: any) => {
  if (isTransientNetworkError(err)) {
    console.error('[Network] Uncaught exception (transient network error), collector РїСЂРѕРґРѕР»Р¶Р°РµС‚ СЂР°Р±РѕС‚Сѓ:', err?.message || err);
  } else {
    console.error('[UncaughtException]', err);
  }
});

// ============================================
// РџСѓР» РєРІРµСЃС‚РѕРІ (РґСѓР±Р»РёСЂРѕРІР°РЅРѕ РґР»СЏ collector, РёР·Р±РµРіР°РµРј tsconfig issues)
// ============================================
interface QuestTemplate {
  id: string;
  title: string;
  desc: string;
  type: 'messages' | 'voice' | 'combo';
  target: number;
  xp: number;
}

const QUESTS_POOL: QuestTemplate[] = [
  // РўРµРєСЃС‚РѕРІС‹Рµ РєРІРµСЃС‚С‹
  { id: 'messages_warmup_10_50xp', title: 'Р Р°Р·РјРёРЅРєР° РїР°Р»СЊС†РµРІ', desc: '10 СЃРѕРѕР±С‰РµРЅРёР№', type: 'messages', target: 10, xp: 50 },
  { id: 'messages_active_30_150xp', title: 'РђРєС‚РёРІРЅС‹Р№ СЃРїРёРєРµСЂ', desc: '30 СЃРѕРѕР±С‰РµРЅРёР№', type: 'messages', target: 30, xp: 150 },
  { id: 'messages_god_60_300xp', title: 'Р“СЂРѕР·Р° С‡Р°С‚Р°', desc: '60 СЃРѕРѕР±С‰РµРЅРёР№', type: 'messages', target: 60, xp: 300 },
  { id: 'messages_wall_100_500xp', title: 'РЎС‚РµРЅР° С‚РµРєСЃС‚Р°', desc: '100 СЃРѕРѕР±С‰РµРЅРёР№', type: 'messages', target: 100, xp: 500 },
  { id: 'messages_long_20_100xp', title: 'Р¤РёР»РѕСЃРѕС„', desc: '20 СЃРѕРѕР±С‰РµРЅРёР№ > 100 СЃРёРјРІРѕР»РѕРІ', type: 'messages', target: 20, xp: 100 },
  // Р“РѕР»РѕСЃРѕРІС‹Рµ РєРІРµСЃС‚С‹
  { id: 'voice_peep_15_100xp', title: 'Р—Р°РіР»СЏРЅСѓР» РЅР° РѕРіРѕРЅРµРє', desc: '15 РјРёРЅСѓС‚ РІ РІРѕР№СЃРµ', type: 'voice', target: 15, xp: 100 },
  { id: 'voice_deep_45_250xp', title: 'Р”СѓС€РµРІРЅС‹Р№ СЂР°Р·РіРѕРІРѕСЂ', desc: '45 РјРёРЅСѓС‚ РІ РІРѕР№СЃРµ', type: 'voice', target: 45, xp: 250 },
  { id: 'voice_marathon_90_450xp', title: 'Р’РѕР№СЃ-РјР°СЂР°С„РѕРЅ', desc: '90 РјРёРЅСѓС‚ РІ РІРѕР№СЃРµ', type: 'voice', target: 90, xp: 450 },
  { id: 'voice_host_150_750xp', title: 'РҐРѕР·СЏРёРЅ СЌС„РёСЂР°', desc: '150 РјРёРЅСѓС‚ РІ РІРѕР№СЃРµ', type: 'voice', target: 150, xp: 750 },
  { id: 'voice_night_30_200xp', title: 'РќРѕС‡РЅРѕР№ РґРѕР·РѕСЂ', desc: '30 РјРёРЅСѓС‚ РїРѕСЃР»Рµ 00:00 UTC', type: 'voice', target: 30, xp: 200 },
  // РљРѕРјР±Рѕ Рё РѕСЃРѕР±С‹Рµ
  { id: 'combo_double_25_25_300xp', title: 'Р”РІРѕР№РЅРѕР№ СѓРґР°СЂ', desc: '25 СЃРѕРѕР±С‰. + 25 РјРёРЅ РІРѕР№СЃР°', type: 'combo', target: 25, xp: 300 },
  { id: 'combo_morning_15_100xp', title: 'РЈС‚СЂРµРЅРЅРёР№ РєРѕС„Рµ', desc: '15 СЃРѕРѕР±С‰РµРЅРёР№ (06:00-12:00)', type: 'messages', target: 15, xp: 100 },
  { id: 'combo_night_10_20_150xp', title: 'РЎРѕРІРјРµСЃС‚РЅРѕРµ СѓСЃРёР»РёРµ', desc: '10 СЃРѕРѕР±С‰. + 20 РјРёРЅ РІРѕР№СЃР°', type: 'combo', target: 10, xp: 150 },
  { id: 'combo_balance_50_50_400xp', title: 'Р‘Р°Р»Р°РЅСЃ', desc: '50 СЃРѕРѕР±С‰. + 50 РјРёРЅ РІРѕР№СЃР°', type: 'combo', target: 50, xp: 400 },
  { id: 'combo_super_100_100_800xp', title: 'РСЂРѕРЅРёСЏ СЃСѓРґСЊР±С‹', desc: '100 СЃРѕРѕР±С‰. + 100 РјРёРЅ РІРѕР№СЃР°', type: 'combo', target: 100, xp: 800 },
];

// Re-export from shared types (duplicate for collector to avoid tsconfig issues)
const calculateLevel = (xp: number): number => {
  return Math.floor(0.1 * Math.sqrt(xp));
};

// ============================================
// РљР°С‚Р°Р»РѕРі РіРѕСЂРѕРґСЃРєРёС… СѓС‡Р°СЃС‚РєРѕРІ (РЁР°Рі 1 - РќРµРґРІРёР¶РёРјРѕСЃС‚СЊ Рё Р“РѕСЂРѕРґ)
// Р”СѓР±Р»РёСЂРѕРІР°РЅРѕ РёР· worker/src/city/catalog.ts РґР»СЏ collector (tsconfig issues)
// ============================================

type CityZone = 'mountain' | 'suburb' | 'highway' | 'center' | 'coast';

interface CityPlotTemplate {
  id: number;
  zone: CityZone;
  title: string;
  base_price: number;
  allowed_buildings: string[];
}

const PLOTS_CATALOG: CityPlotTemplate[] = [
  { id: 1, zone: 'mountain', title: 'Р“РѕСЂРЅС‹Р№ СЃРєР»РѕРЅ', base_price: 3000, allowed_buildings: ['mine'] },
  { id: 2, zone: 'mountain', title: 'Р“РѕСЂРЅС‹Р№ СЃРєР»РѕРЅ', base_price: 3000, allowed_buildings: ['mine'] },
  { id: 3, zone: 'suburb', title: 'РџСЂРёРіРѕСЂРѕРґРЅР°СЏ РґРѕР»РёРЅР°', base_price: 2500, allowed_buildings: ['farm'] },
  { id: 4, zone: 'suburb', title: 'РџСЂРёРіРѕСЂРѕРґРЅР°СЏ РґРѕР»РёРЅР°', base_price: 2500, allowed_buildings: ['farm'] },
  { id: 5, zone: 'highway', title: 'РЁРѕСЃСЃРµ Рё С‚СЂР°СЃСЃР°', base_price: 3500, allowed_buildings: ['gas_station', 'shop'] },
  { id: 6, zone: 'highway', title: 'РЁРѕСЃСЃРµ Рё С‚СЂР°СЃСЃР°', base_price: 3500, allowed_buildings: ['gas_station', 'shop'] },
  { id: 7, zone: 'center', title: 'Р”РµР»РѕРІРѕР№ С†РµРЅС‚СЂ (Р—РѕР»РѕС‚Р°СЏ Р·РµРјР»СЏ)', base_price: 7000, allowed_buildings: ['casino', 'bank', 'restaurant'] },
  { id: 8, zone: 'center', title: 'Р”РµР»РѕРІРѕР№ С†РµРЅС‚СЂ (Р—РѕР»РѕС‚Р°СЏ Р·РµРјР»СЏ)', base_price: 7000, allowed_buildings: ['casino', 'bank', 'restaurant'] },
  { id: 9, zone: 'highway', title: 'РўРѕСЂРіРѕРІС‹Р№ РїСЂРѕСЃРїРµРєС‚', base_price: 4000, allowed_buildings: ['shop', 'restaurant'] },
  { id: 10, zone: 'highway', title: 'РўРѕСЂРіРѕРІС‹Р№ РїСЂРѕСЃРїРµРєС‚', base_price: 4000, allowed_buildings: ['shop', 'restaurant'] },
  { id: 11, zone: 'coast', title: 'РњРѕСЂСЃРєР°СЏ РіР°РІР°РЅСЊ', base_price: 5000, allowed_buildings: ['port', 'restaurant'] },
  { id: 12, zone: 'coast', title: 'РњРѕСЂСЃРєР°СЏ РіР°РІР°РЅСЊ', base_price: 5000, allowed_buildings: ['port', 'restaurant'] },
];

/**
 * РђРІС‚РѕРјР°С‚РёС‡РµСЃРєРё СЃРѕР·РґР°С‘С‚ 12 РіРѕСЂРѕРґСЃРєРёС… СѓС‡Р°СЃС‚РєРѕРІ (id 1-12) РґР»СЏ РєР°Р¶РґРѕР№ РіРёР»СЊРґРёРё,
 * РіРґРµ РїСЂРёСЃСѓС‚СЃС‚РІСѓРµС‚ Р±РѕС‚. INSERT OR IGNORE вЂ” РёРґРµРјРїРѕС‚РµРЅС‚РЅРѕ: СѓР¶Рµ СЃРѕР·РґР°РЅРЅС‹Рµ СѓС‡Р°СЃС‚РєРё
 * (СЃ РІР»Р°РґРµР»СЊС†Р°РјРё Рё РїРѕСЃС‚СЂРѕР№РєР°РјРё) РЅРµ РїРµСЂРµР·Р°РїРёСЃС‹РІР°СЋС‚СЃСЏ.
 * zone/title РІ Р‘Р” РЅРµ С…СЂР°РЅСЏС‚СЃСЏ вЂ” Р±РµСЂСѓС‚СЃСЏ РёР· PLOTS_CATALOG РїРѕ id СѓС‡Р°СЃС‚РєР°;
 * price РёРЅРёС†РёР°Р»РёР·РёСЂСѓРµС‚СЃСЏ base_price РёР· РєР°С‚Р°Р»РѕРіР°.
 */
async function ensureCityPlots(db: any, bot: Client): Promise<void> {
  try {
    const guilds = bot.guilds.cache;
    if (guilds.size === 0) return;

    const nowSec = Math.floor(Date.now() / 1000);
    const placeholders = PLOTS_CATALOG.map(() => '(?, ?, ?, ?)').join(', ');

    for (const [guildId] of guilds) {
      const values = PLOTS_CATALOG.flatMap((p) => [p.id, guildId, p.base_price, nowSec]);
      await db.execute({
        sql: `INSERT OR IGNORE INTO city_plots (id, guild_id, price, created_at) VALUES ${placeholders}`,
        args: values,
      });
    }

    console.log(`[City] Ensured ${PLOTS_CATALOG.length} city plots for ${guilds.size} guilds`);
  } catch (err) {
    console.error('[City] Error ensuring city plots:', err);
  }
}

// ============================================
// Р­РєРѕРЅРѕРјРёРєР° РіРѕСЂРѕРґСЃРєРёС… РїРѕСЃС‚СЂРѕРµРє (РЁР°Рі 4 - Р­РєРѕРЅРѕРјРёРєР° РіРѕСЂРѕРґР°)
// 8 С‚РёРїРѕРІ РїРѕСЃС‚СЂРѕРµРє: СЃСѓС‚РѕС‡РЅС‹Р№ РґРѕС…РѕРґ Рё РЅРµРґРµР»СЊРЅС‹Р№ РЅР°Р»РѕРі РїРѕ СѓСЂРѕРІРЅСЏРј 1-3.
// Р—РЅР°С‡РµРЅРёСЏ СЃРёРЅС…СЂРѕРЅРёР·РёСЂРѕРІР°РЅС‹ СЃ worker/src/city/catalog.ts (РґСѓР±Р»РёРєР°С‚ РґР»СЏ collector).
// ============================================

interface BuildingEconomy {
  name: string;
  emoji: string;
  /** РЎСѓС‚РѕС‡РЅС‹Р№ РґРѕС…РѕРґ РїРѕ СѓСЂРѕРІРЅСЏРј 1-3 (рџЄ™) */
  dailyRevenue: number[];
  /** РќРµРґРµР»СЊРЅС‹Р№ РЅР°Р»РѕРі РїРѕ СѓСЂРѕРІРЅСЏРј 1-3 (рџЄ™) */
  weeklyTax: number[];
}

const BUILDINGS_CONFIG: Record<string, BuildingEconomy> = {
  mine: { name: 'РЁР°С…С‚Р°', emoji: 'в›ЏпёЏ', dailyRevenue: [300, 750, 1600], weeklyTax: [60, 150, 320] },
  farm: { name: 'Р¤РµСЂРјР°', emoji: 'рџЊѕ', dailyRevenue: [220, 550, 1200], weeklyTax: [45, 110, 240] },
  gas_station: { name: 'РђР—РЎ', emoji: 'в›Ѕ', dailyRevenue: [350, 850, 1800], weeklyTax: [70, 170, 360] },
  shop: { name: 'РЎСѓРїРµСЂРјР°СЂРєРµС‚', emoji: 'рџ›’', dailyRevenue: [280, 700, 1500], weeklyTax: [55, 140, 300] },
  restaurant: { name: 'Р РµСЃС‚РѕСЂР°РЅ', emoji: 'рџЌЅпёЏ', dailyRevenue: [320, 800, 1700], weeklyTax: [65, 160, 340] },
  casino: { name: 'РљР°Р·РёРЅРѕ', emoji: 'рџЋ°', dailyRevenue: [800, 2000, 4500], weeklyTax: [180, 450, 1000] },
  bank: { name: 'Р‘Р°РЅРє', emoji: 'рџЏ›пёЏ', dailyRevenue: [1000, 2500, 5500], weeklyTax: [220, 550, 1200] },
  port: { name: 'РњРѕСЂСЃРєРѕР№ РїРѕСЂС‚', emoji: 'вљ“', dailyRevenue: [500, 1250, 2700], weeklyTax: [100, 250, 540] },
};

/**
 * Р’РѕР·РІСЂР°С‰Р°РµС‚ СЌРєРѕРЅРѕРјРёС‡РµСЃРєРёРµ РїР°СЂР°РјРµС‚СЂС‹ РїРѕСЃС‚СЂРѕР№РєРё (РґРѕС…РѕРґ/РЅР°Р»РѕРі) РёР»Рё null,
 * РµСЃР»Рё СѓС‡Р°СЃС‚РѕРє РїСѓСЃС‚, РїРѕСЃС‚СЂРѕР№РєР° РЅРµРёР·РІРµСЃС‚РЅР° РёР»Рё СѓСЂРѕРІРµРЅСЊ 0.
 */
function getBuildingEconomy(buildingType: string | null, buildingLevel: number): BuildingEconomy | null {
  if (!buildingType || buildingLevel <= 0) return null;
  return BUILDINGS_CONFIG[buildingType] || null;
}

/**
 * РџР°СЂР°РјРµС‚СЂ СЌРєРѕРЅРѕРјРёРєРё РїРѕ СѓСЂРѕРІРЅСЋ РїРѕСЃС‚СЂРѕР№РєРё (1-3) СЃ Р·Р°С‰РёС‚РѕР№ РѕС‚ РІС‹С…РѕРґР° Р·Р° РіСЂР°РЅРёС†С‹ РјР°СЃСЃРёРІР°.
 */
function economyValueByLevel(values: number[], buildingLevel: number): number {
  const idx = Math.min(Math.max(buildingLevel, 1), values.length) - 1;
  return values[idx] || 0;
}

// ============================================
// Р­РєРѕРЅРѕРјРёРєР° РіРѕСЂРѕРґР° (РЁР°Рі 4): СЃСѓС‚РѕС‡РЅС‹Р№ РґРѕС…РѕРґ, РЅРµРґРµР»СЊРЅС‹Р№ РЅР°Р»РѕРі, Р°СѓРєС†РёРѕРЅС‹
// ============================================

/**
 * РЎСѓС‚РѕС‡РЅС‹Р№ РґРѕС…РѕРґ СѓС‡Р°СЃС‚РєРѕРІ СЃ РїРѕСЃС‚СЂРѕР№РєР°РјРё.
 * Р—Р°С…РІР°С‚ СЃСѓС‚РѕРє РёРґРµРјРїРѕС‚РµРЅС‚РµРЅ С‡РµСЂРµР· last_revenue_at (РЎР•РљРЈРќР”Р«, Math.floor(Date.now() / 1000)):
 * СѓС‡Р°СЃС‚РѕРє РѕР±СЂР°Р±Р°С‚С‹РІР°РµС‚СЃСЏ, С‚РѕР»СЊРєРѕ РµСЃР»Рё СЃ РїРѕСЃР»РµРґРЅРµРіРѕ РЅР°С‡РёСЃР»РµРЅРёСЏ РїСЂРѕС€Р»Рѕ >= 24 С‡Р°СЃРѕРІ.
 * РќР°С‡РёСЃР»РµРЅРёРµ: РІР»Р°РґРµР»СЊС†Сѓ-РїРѕР»СЊР·РѕРІР°С‚РµР»СЋ вЂ” РІ users.coins, РєРѕРјРїР°РЅРёРё вЂ” РІ companies.treasury.
 */
async function processDailyPlotRevenue(db: any, bot: Client): Promise<void> {
  const nowSec = Math.floor(Date.now() / 1000);
  const dayAgoSec = nowSec - 24 * 3600;

  try {
    const plotsResult = await db.execute({
      sql: `SELECT id, guild_id, owner_type, owner_id, building_type, building_level
            FROM city_plots
            WHERE building_type IS NOT NULL
              AND building_level > 0
              AND (last_revenue_at IS NULL OR last_revenue_at < ?)`,
      args: [dayAgoSec],
    });

    for (const plot of plotsResult.rows || []) {
      const plotId = Number(plot.id);
      const guildId = plot.guild_id as string;
      const ownerType = plot.owner_type as string | null;
      const ownerId = plot.owner_id as string | null;
      const buildingLevel = Number(plot.building_level) || 0;
      const economy = getBuildingEconomy(plot.building_type as string | null, buildingLevel);

      if (!economy || !ownerType || !ownerId) continue;

      const revenue = economyValueByLevel(economy.dailyRevenue, buildingLevel);

      try {
        if (ownerType === 'user') {
          await db.execute({
            sql: 'UPDATE users SET coins = coins + ? WHERE user_id = ? AND guild_id = ?',
            args: [revenue, ownerId, guildId],
          });
        } else if (ownerType === 'company') {
          await db.execute({
            sql: 'UPDATE companies SET treasury = treasury + ? WHERE id = ? AND guild_id = ?',
            args: [revenue, Number(ownerId), guildId],
          });
        } else {
          continue;
        }

        // Р—Р°С…РІР°С‚ СЃСѓС‚РѕРє вЂ” СЃС‚СЂРѕРіРѕ РїРѕСЃР»Рµ СѓСЃРїРµС€РЅРѕРіРѕ РЅР°С‡РёСЃР»РµРЅРёСЏ (РІ РЎР•РљРЈРќР”РђРҐ)
        await db.execute({
          sql: 'UPDATE city_plots SET last_revenue_at = ? WHERE guild_id = ? AND id = ?',
          args: [nowSec, guildId, plotId],
        });

        console.log(`[CityRevenue] Plot #${plotId} guild ${guildId}: +${revenue} рџЄ™ (${economy.name}, СѓСЂ. ${buildingLevel})`);
      } catch (e) {
        console.error('[CityRevenue] Error processing plot', plotId, e);
      }
    }
  } catch (err) {
    console.error('[CityRevenue] Error in processDailyPlotRevenue:', err);
  }
}

/**
 * РќРµРґРµР»СЊРЅС‹Р№ РЅР°Р»РѕРі РЅР° РїРѕСЃС‚СЂРѕР№РєРё (last_tax_at РІ РЎР•РљРЈРќР”РђРҐ < nowSec - 7*24*3600).
 * РќР°Р»РѕРі СЃРїРёСЃС‹РІР°РµС‚СЃСЏ Р°С‚РѕРјР°СЂРЅРѕ (СѓСЃР»РѕРІРёРµ coins/treasury >= tax); РїСЂРё СѓСЃРїРµС…Рµ СЃСѓРјРјР°
 * РїРѕРїРѕР»РЅСЏРµС‚ server_reserve, РїСЂРё РЅРµС…РІР°С‚РєРµ СЃСЂРµРґСЃС‚РІ вЂ” РёРЅРєСЂРµРјРµРЅС‚ unpaid_taxes_count.
 * РњР°СЂРєРµСЂ last_tax_at РѕР±РЅРѕРІР»СЏРµС‚СЃСЏ РІ РѕР±РѕРёС… СЃР»СѓС‡Р°СЏС…, С‡С‚РѕР±С‹ РЅР°Р»РѕРі СЃС‡РёС‚Р°Р»СЃСЏ СЂР°Р· РІ 7 РґРЅРµР№.
 */
async function processWeeklyPlotTaxes(db: any, bot: Client): Promise<void> {
  const nowSec = Math.floor(Date.now() / 1000);
  const weekAgoSec = nowSec - 7 * 24 * 3600;

  try {
    const plotsResult = await db.execute({
      sql: `SELECT id, guild_id, owner_type, owner_id, building_type, building_level
            FROM city_plots
            WHERE building_type IS NOT NULL
              AND building_level > 0
              AND (last_tax_at IS NULL OR last_tax_at < ?)`,
      args: [weekAgoSec],
    });

    for (const plot of plotsResult.rows || []) {
      const plotId = Number(plot.id);
      const guildId = plot.guild_id as string;
      const ownerType = plot.owner_type as string | null;
      const ownerId = plot.owner_id as string | null;
      const buildingLevel = Number(plot.building_level) || 0;
      const economy = getBuildingEconomy(plot.building_type as string | null, buildingLevel);

      if (!economy || !ownerType || !ownerId) continue;

      const tax = economyValueByLevel(economy.weeklyTax, buildingLevel);

      try {
        let paid = false;

        if (ownerType === 'user') {
          const taxResult = await db.execute({
            sql: 'UPDATE users SET coins = coins - ? WHERE user_id = ? AND guild_id = ? AND coins >= ?',
            args: [tax, ownerId, guildId, tax],
          });
          paid = (taxResult.rowsAffected as number) === 1;
        } else if (ownerType === 'company') {
          const taxResult = await db.execute({
            sql: 'UPDATE companies SET treasury = treasury - ? WHERE id = ? AND guild_id = ? AND treasury >= ?',
            args: [tax, Number(ownerId), guildId, tax],
          });
          paid = (taxResult.rowsAffected as number) === 1;
        } else {
          continue;
        }

        if (paid) {
          // РќР°Р»РѕРі СѓС…РѕРґРёС‚ РІ СЂРµР·РµСЂРІ СЃРµСЂРІРµСЂР°
          await db.execute({
            sql: `INSERT INTO server_reserve (guild_id, balance) VALUES (?, ?)
                  ON CONFLICT(guild_id) DO UPDATE SET balance = balance + ?`,
            args: [guildId, tax, tax],
          });
          await db.execute({
            sql: 'UPDATE city_plots SET last_tax_at = ?, unpaid_taxes_count = 0 WHERE guild_id = ? AND id = ?',
            args: [nowSec, guildId, plotId],
          });
          console.log(`[CityTax] Plot #${plotId} guild ${guildId}: tax ${tax} рџЄ™ paid (${ownerType})`);
        } else {
          await db.execute({
            sql: 'UPDATE city_plots SET unpaid_taxes_count = unpaid_taxes_count + 1, last_tax_at = ? WHERE guild_id = ? AND id = ?',
            args: [nowSec, guildId, plotId],
          });
          console.log(`[CityTax] Plot #${plotId} guild ${guildId}: ${ownerType} ${ownerId} can't pay ${tax} рџЄ™ (unpaid_taxes_count++)`);
        }
      } catch (e) {
        console.error('[CityTax] Error processing plot', plotId, e);
      }
    }
  } catch (err) {
    console.error('[CityTax] Error in processWeeklyPlotTaxes:', err);
  }
}

/**
 * Р—Р°РІРµСЂС€РµРЅРёРµ РёСЃС‚С‘РєС€РёС… Р°СѓРєС†РёРѕРЅРѕРІ СѓС‡Р°СЃС‚РєРѕРІ.
 * expires_at С…СЂР°РЅРёС‚СЃСЏ РІ РњРР›Р›РРЎР•РљРЈРќР”РђРҐ (Date.now()). РђС‚РѕРјР°СЂРЅС‹Р№ db.batch:
 * РїРµСЂРµРґР°С‡Р° СѓС‡Р°СЃС‚РєР° РїРѕР±РµРґРёС‚РµР»СЋ, РІС‹РїР»Р°С‚Р° РїСЂРѕРґР°РІС†Сѓ, Р·Р°РєСЂС‹С‚РёРµ Р°СѓРєС†РёРѕРЅР°.
 * Р‘РµР· СЃС‚Р°РІРѕРє вЂ” СѓС‡Р°СЃС‚РѕРє РѕСЃС‚Р°С‘С‚СЃСЏ Сѓ РІР»Р°РґРµР»СЊС†Р°, СЃ РїСЂРѕРґР°Р¶Рё СЃРЅРёРјР°РµС‚СЃСЏ.
 */
async function processExpiredAuctions(db: any, bot: Client): Promise<void> {
  const nowMs = Date.now();

  try {
    const auctionsResult = await db.execute({
      sql: `SELECT id, guild_id, plot_id, highest_bid, highest_bidder_id
            FROM plot_auctions
            WHERE status = 'active' AND expires_at <= ?`,
      args: [nowMs],
    });

    for (const a of auctionsResult.rows || []) {
      const auctionId = Number(a.id);
      const guildId = a.guild_id as string;
      const plotId = Number(a.plot_id);
      const bid = Number(a.highest_bid) || 0;
      const winnerId = (a.highest_bidder_id as string | null) || null;

      try {
        // РџСЂРѕРґР°РІРµС† вЂ” С‚РµРєСѓС‰РёР№ РІР»Р°РґРµР»РµС† СѓС‡Р°СЃС‚РєР°
        const plotResult = await db.execute({
          sql: 'SELECT owner_type, owner_id FROM city_plots WHERE guild_id = ? AND id = ?',
          args: [guildId, plotId],
        });
        const sellerType = plotResult.rows[0]?.owner_type as string | null;
        const sellerId = plotResult.rows[0]?.owner_id as string | null;

        const stmts: { sql: string; args: any[] }[] = [];

        if (winnerId && bid > 0) {
          // 1) РџРµСЂРµРґР°С‡Р° СѓС‡Р°СЃС‚РєР° РїРѕР±РµРґРёС‚РµР»СЋ вЂ” С‚РѕР»СЊРєРѕ РµСЃР»Рё РѕРЅ РІСЃС‘ РµС‰С‘ РІ РїСЂРѕРґР°Р¶Рµ
          //    (Р·Р°С‰РёС‚Р° РѕС‚ РїСЂСЏРјРѕР№ РїРѕРєСѓРїРєРё /plot buy РјРµР¶РґСѓ РёСЃС‚РµС‡РµРЅРёРµРј Рё Р·Р°РєСЂС‹С‚РёРµРј)
          stmts.push({
            sql: `UPDATE city_plots
                  SET owner_type = 'user', owner_id = ?, for_sale_price = NULL
                  WHERE guild_id = ? AND id = ? AND for_sale_price IS NOT NULL`,
            args: [winnerId, guildId, plotId],
          });
          // 2) Р’С‹РїР»Р°С‚Р° РїСЂРѕРґР°РІС†Сѓ вЂ” С‚РѕР»СЊРєРѕ РµСЃР»Рё РїРµСЂРµРґР°С‡Р° РїРѕР±РµРґРёС‚РµР»СЋ РїСЂРѕС€Р»Р°
          const soldGuard = 'EXISTS (SELECT 1 FROM city_plots WHERE guild_id = ? AND id = ? AND owner_id = ?)';
          if (sellerType === 'user' && sellerId) {
            stmts.push({
              sql: `UPDATE users SET coins = coins + ? WHERE user_id = ? AND guild_id = ? AND ${soldGuard}`,
              args: [bid, sellerId, guildId, guildId, plotId, winnerId],
            });
          } else if (sellerType === 'company' && sellerId) {
            stmts.push({
              sql: `UPDATE companies SET treasury = treasury + ? WHERE id = ? AND guild_id = ? AND ${soldGuard}`,
              args: [bid, Number(sellerId), guildId, guildId, plotId, winnerId],
            });
          }
          // 3) Р’РѕР·РІСЂР°С‚ СЃС‚Р°РІРєРё РїРѕР±РµРґРёС‚РµР»СЋ, РµСЃР»Рё СѓС‡Р°СЃС‚РѕРє РїРµСЂРµРґР°С‚СЊ РЅРµ СѓРґР°Р»РѕСЃСЊ
          stmts.push({
            sql: `UPDATE users SET coins = coins + ? WHERE user_id = ? AND guild_id = ?
                  AND NOT EXISTS (SELECT 1 FROM city_plots WHERE guild_id = ? AND id = ? AND owner_id = ?)`,
            args: [bid, winnerId, guildId, guildId, plotId, winnerId],
          });
        } else {
          // РЎС‚Р°РІРѕРє РЅРµ Р±С‹Р»Рѕ вЂ” СѓС‡Р°СЃС‚РѕРє РѕСЃС‚Р°С‘С‚СЃСЏ Сѓ РІР»Р°РґРµР»СЊС†Р°, СЃРЅРёРјР°РµРј СЃ РїСЂРѕРґР°Р¶Рё
          stmts.push({
            sql: 'UPDATE city_plots SET for_sale_price = NULL WHERE guild_id = ? AND id = ?',
            args: [guildId, plotId],
          });
        }

        // Р—Р°РєСЂС‹С‚РёРµ Р°СѓРєС†РёРѕРЅР° (guard РїРѕ status вЂ” Р·Р°С‰РёС‚Р° РѕС‚ РїРѕРІС‚РѕСЂРЅРѕР№ РѕР±СЂР°Р±РѕС‚РєРё)
        stmts.push({
          sql: "UPDATE plot_auctions SET status = 'completed' WHERE id = ? AND status = 'active'",
          args: [auctionId],
        });

        const results = await db.batch(stmts, 'write');
        const closed = (results[results.length - 1].rowsAffected as number) === 1;

        if (closed) {
          console.log(`[CityAuction] Auction #${auctionId} (plot #${plotId}, guild ${guildId}) completed` +
            (winnerId ? ` вЂ” winner ${winnerId}, seller paid ${bid} рџЄ™` : ' вЂ” no bids'));
        }
      } catch (e) {
        console.error('[CityAuction] Error completing auction', auctionId, e);
      }
    }
  } catch (err) {
    console.error('[CityAuction] Error in processExpiredAuctions:', err);
  }
}

// ============================================
// РЎРёСЃС‚РµРјР° РґРѕСЃС‚РёР¶РµРЅРёР№ (Р­С‚Р°Рї 6 - 27 СЃРµРєСЂРµС‚РЅС‹С… РїР°СЃС…Р°Р»РѕРє)
// ============================================

interface Achievement {
  id: string;
  title: string;
  description: string;
  quote: string;
  reward: number;
  trigger: (db: any, userId: string, guildId: string, data: any) => Promise<boolean>;
}

// 27 РґРѕСЃС‚РёР¶РµРЅРёР№ РёР· CLAUDE.md
const ACHIEVEMENTS_LIST: Achievement[] = [
  // --- Р’РµРґСЊРјР°Рє 3 ---
  {
    id: 'witcher_plod',
    title: 'рџђє РЁРµРІРµР»РёСЃСЊ, РџР»РѕС‚РІР°!',
    description: 'РћС‚РїСЂР°РІРёС‚СЊ СЃРѕРѕР±С‰РµРЅРёРµ СЂРѕРІРЅРѕ С‡РµСЂРµР· 30-35 СЃРµРє РїРѕСЃР»Рµ РїСЂРµРґС‹РґСѓС‰РµРіРѕ',
    quote: 'Р›СЋС‚РёРє, Р±Р»#С‚СЊ...',
    reward: 150,
    trigger: checkWitcherPlod
  },
  {
    id: 'witcher_gwent',
    title: 'рџѓЏ Р’ Р“РІРёРЅС‚ РЅРµ СЃС‹РіСЂР°РµС€СЊ?',
    description: 'РЎС‹РіСЂР°С‚СЊ 3 РґСѓСЌР»Рё Р·Р° РѕРґРёРЅ РґРµРЅСЊ',
    quote: 'РљРёРІР°РµС‚ РјРѕР»С‡Р° Рё РґРѕСЃС‚Р°С‘С‚ РєРѕР»РѕРґСѓ РљРѕСЂРѕР»РµРІСЃС‚РІ РЎРµРІРµСЂР°.',
    reward: 200,
    trigger: checkWitcherGwent
  },
  {
    id: 'witcher_damn',
    title: 'рџђє Р—Р°СЂР°Р·Р°...',
    description: 'РџСЂРѕРёРіСЂР°С‚СЊ РґСѓСЌР»СЊ СЃ Р±СЂРѕСЃРєРѕРј РєСѓР±РёРєР° РјРµРЅСЊС€Рµ 10',
    quote: 'Р’РµС‚РµСЂ РІРѕРµС‚...',
    reward: 100,
    trigger: checkWitcherDamn
  },
  {
    id: 'witcher_blaviken',
    title: 'вљ”пёЏ РњСЏСЃРЅРёРє РёР· Р‘Р»Р°РІРёРєРµРЅР°',
    description: 'Р’С‹РёРіСЂР°С‚СЊ 3 РґСѓСЌР»Рё РїРѕРґСЂСЏРґ Р±РµР· РїРѕСЂР°Р¶РµРЅРёР№',
    quote: 'Р•СЃР»Рё РїСЂРёС…РѕРґРёС‚СЃСЏ РІС‹Р±РёСЂР°С‚СЊ РјРµР¶РґСѓ Р·Р»РѕРј Рё Р·Р»РѕРј...',
    reward: 350,
    trigger: checkWitcherBlaviken
  },
  {
    id: 'witcher_coin',
    title: 'рџЄ™ Р§РµРєР°РЅРЅР°СЏ РјРѕРЅРµС‚Р°',
    description: 'Р—Р°С„РёРєСЃРёСЂРѕРІР°С‚СЊ СЂРѕРІРЅРѕ 1000, 2000, 3000 РёР»Рё 5000 XP',
    quote: 'Р—Р°С‡С‚С‘С‚СЃСЏ РІСЃС‘ СЌС‚Рѕ РІР°Рј!',
    reward: 250,
    trigger: checkWitcherCoin
  },
  // --- Red Dead Redemption 2 ---
  {
    id: 'rdr_plan',
    title: 'рџ¤  РЈ РјРµРЅСЏ РµСЃС‚СЊ РџР›РђРќ!',
    description: 'РќР°РєРѕРїРёС‚СЊ 3000+ XP, РЅРё СЂР°Р·Сѓ РЅРµ РїСЂРѕРёРіСЂР°РІ РІ РґСѓСЌР»СЏС…',
    quote: 'РќР°Рј РїСЂРѕСЃС‚Рѕ РЅСѓР¶РЅРѕ Р±РѕР»СЊС€Рµ РґРµРЅРµРі, РђСЂС‚СѓСЂ!',
    reward: 300,
    trigger: checkRDRPlan
  },
  {
    id: 'rdr_lenny',
    title: 'рџЌ» Р›РРРРќРќРРРР!',
    description: 'РћС‚РїСЂР°РІРёС‚СЊ РєР°РїСЃ-СЃРѕРѕР±С‰РµРЅРёРµ 10+ Р±СѓРєРІ РЅРѕС‡СЊСЋ СЃ 02:00 РґРѕ 05:00',
    quote: 'YNNEL?! Р“Р”Р• РўР«, Р›Р•РќРќР?!',
    reward: 150,
    trigger: checkRDRLenny
  },
  {
    id: 'rdr_quickdraw',
    title: 'рџЋЇ Р‘С‹СЃС‚СЂР°СЏ СЂСѓРєР°',
    description: 'Р’С‹РёРіСЂР°С‚СЊ РґСѓСЌР»СЊ СЃ Р±СЂРѕСЃРєРѕРј 95+',
    quote: 'РќР° СЌС‚РѕРј СЃРµСЂРІРµСЂРµ РјРµСЃС‚Рѕ С‚РѕР»СЊРєРѕ РґР»СЏ РѕРґРЅРѕРіРѕ.',
    reward: 250,
    trigger: checkRDRQuickdraw
  },
  {
    id: 'rdr_tahiti',
    title: 'рџҐ­ Р‘РёР»РµС‚ РЅР° РўР°РёС‚Рё',
    description: 'РџСЂРѕРІРµСЃС‚Рё Р±РѕР»РµРµ 5 С‡Р°СЃРѕРІ РІ РІРѕР№СЃРµ Р·Р° РґРµРЅСЊ',
    quote: 'РњС‹ Р±СѓРґРµРј РІС‹СЂР°С‰РёРІР°С‚СЊ РјР°РЅРіРѕ Рё Р¶РёС‚СЊ РїСЂРёРїРµРІР°СЋС‡Рё.',
    reward: 300,
    trigger: checkRDRTahiti
  },
  {
    id: 'rdr_tax',
    title: 'рџ’° РљР°РїРёС‚Р°Р»РёР·Рј, РђСЂС‚СѓСЂ',
    description: 'РЎР¶РµС‡СЊ Р±РѕР»РµРµ 200 XP РЅР° РЅР°Р»РѕРіРµ СЃ РґСѓСЌР»РµР№',
    quote: 'РњС‹ РІРѕСЂС‹ РІ РјРёСЂРµ, РєРѕС‚РѕСЂРѕРјСѓ РјС‹ Р±РѕР»СЊС€Рµ РЅРµ РЅСѓР¶РЅС‹.',
    reward: 200,
    trigger: checkRDRTax
  },
  // --- Р’Р»Р°РґРёРІРѕСЃС‚РѕРє Рё Р”Р’ ---
  {
    id: 'vlad_2000',
    title: 'рџЊЉ Р’Р»Р°РґРёРІРѕСЃС‚РѕРє 2000',
    description: 'РћРєР°Р·Р°С‚СЊСЃСЏ СЂРѕРІРЅРѕ СЃ 2000 XP РЅР° Р±Р°Р»Р°РЅСЃРµ',
    quote: 'РЈС…РѕРґРёРј, СѓС…РѕРґРёРј, СѓС…РѕРґСЏС‚ РєРѕРјРµС‚С‹...',
    reward: 200,
    trigger: checkVlad2000
  },
  {
    id: 'vlad_midnight',
    title: 'вљ“ РџРѕР»РЅРѕС‡СЊ РЅР° Р­РіРµСЂС€РµР»СЊРґРµ',
    description: 'РћС‚РїСЂР°РІРёС‚СЊ СЃРѕРѕР±С‰РµРЅРёРµ СЂРѕРІРЅРѕ РІ 00:00 (Р’Р»Р°РґРёРІРѕСЃС‚РѕРє)',
    quote: 'РњР°СЏРє СЃРІРµС‚РёС‚, РєРІРµСЃС‚С‹ СЃР±СЂРѕСЃРёР»РёСЃСЊ.',
    reward: 200,
    trigger: checkVladMidnight
  },
  {
    id: 'vlad_pyanse',
    title: 'рџҐџ РџСЏРЅ-СЃРµ РЅР° Р›СѓРіРѕРІРѕР№',
    description: 'Р‘С‹С‚СЊ Р°РєС‚РёРІРЅС‹Рј РІ С‡Р°С‚Рµ РІРѕ РІСЂРµРјСЏ РѕР±РµРґР° СЃ 12:00 РґРѕ 13:00 (Р’Р»Р°РґРёРІРѕСЃС‚РѕРє)',
    quote: 'РЎ РїС‹Р»Сѓ СЃ Р¶Р°СЂСѓ, СЃ РїРµСЂС†РµРј Рё РєР°РїСѓСЃС‚РѕР№.',
    reward: 120,
    trigger: checkVladPyanse
  },
  {
    id: 'vlad_typhoon',
    title: 'рџЊЄпёЏ РўР°Р№С„СѓРЅ РїСЂРѕС€С‘Р» СЃС‚РѕСЂРѕРЅРѕР№',
    description: 'РЎРїР°СЃС‚Рё СЃС‚СЂРёРє СЃ РїРѕРјРѕС‰СЊСЋ Р·Р°РјРѕСЂРѕР·РєРё',
    quote: 'РћРїСЏС‚СЊ РїРµСЂРµРґР°РІР°Р»Рё С€С‚РѕСЂРјРѕРІРѕРµ, РЅРѕ РѕР±РѕС€Р»РѕСЃСЊ.',
    reward: 250,
    trigger: checkVladTyphoon
  },
  {
    id: 'vlad_right_hand',
    title: 'рџљ— РСЃС‚РёРЅРЅС‹Р№ РїСЂР°РІРѕСЂСѓР»СЊС‰РёРє',
    description: 'РЎРјРµРЅРёС‚СЊ С‚РµРјСѓ РЅР° РљРёР±РµСЂРїР°РЅРє РёР»Рё РњР°РіРјСѓ',
    quote: 'Р СѓР»СЊ РІ Р±Р°СЂРґР°С‡РєРµ, РµРґРµРј Р±РѕРєРѕРј.',
    reward: 100,
    trigger: checkVladRightHand
  },
  {
    id: 'vlad_golden_horn',
    title: 'рџЊ‰ РҐРѕР·СЏРёРЅ Р—РѕР»РѕС‚РѕРіРѕ Р РѕРіР°',
    description: 'Р—Р°РЅСЏС‚СЊ 1-Рµ РјРµСЃС‚Рѕ РІ Р»РёРґРµСЂР±РѕСЂРґРµ СЃРµСЂРІРµСЂР°',
    quote: 'РњРѕСЃС‚ РїРѕСЃС‚СЂРѕРёР»Рё, СЃРµСЂРІРµСЂ РґРµСЂР¶РёРј.',
    reward: 500,
    trigger: checkVladGoldenHorn
  },
  // --- Half-Life 2 ---
  {
    id: 'hl_wakeup',
    title: 'рџљ† РџСЂРѕСЃРЅРёС‚РµСЃСЊ Рё РїРѕРїРѕР№С‚Рµ',
    description: 'РћС‚РїСЂР°РІРёС‚СЊ СЃРѕРѕР±С‰РµРЅРёРµ СЃ 06:00 РґРѕ 07:00 СѓС‚СЂР° (Р’Р»Р°РґРёРІРѕСЃС‚РѕРє)',
    quote: 'РќСѓР¶РЅС‹Р№ С‡РµР»РѕРІРµРє РЅРµ РІ С‚РѕРј РјРµСЃС‚Рµ...',
    reward: 150,
    trigger: checkHLWakeup
  },
  {
    id: 'hl_can',
    title: 'рџҐ« РџРѕРґРЅРёРјРё СЌС‚Сѓ Р±Р°РЅРєСѓ',
    description: 'Р’С‹РїРѕР»РЅРёС‚СЊ СЃРІРѕР№ РїРµСЂРІС‹Р№ РµР¶РµРґРЅРµРІРЅС‹Р№ РєРІРµСЃС‚',
    quote: 'Рђ С‚РµРїРµСЂСЊ Р±СЂРѕСЃСЊ РµС‘ РІ СѓСЂРЅСѓ.',
    reward: 100,
    trigger: checkHLCan
  },
  {
    id: 'hl_water',
    title: 'рџ’§ РќРµ РїРµР№С‚Рµ РІРѕРґСѓ',
    description: 'РџСЂРѕРІРµСЃС‚Рё 2 С‡Р°СЃР° РЅРµРїСЂРµСЂС‹РІРЅРѕ РІ РІРѕР№СЃРµ',
    quote: 'РћРЅРё С‚СѓРґР° С‡С‚Рѕ-С‚Рѕ РїРѕРґРјРµС€РёРІР°СЋС‚...',
    reward: 250,
    trigger: checkHLWater
  },
  {
    id: 'hl_crowbar',
    title: 'рџЄ“ РњРѕРЅС‚РёСЂРѕРІРєР° РїСЂРѕС‚РёРІ СЃС‚СЂР°Р№РґРµСЂР°',
    description: 'РџРѕР±РµРґРёС‚СЊ РІ РґСѓСЌР»Рё РѕРїРїРѕРЅРµРЅС‚Р°, Сѓ РєРѕС‚РѕСЂРѕРіРѕ СѓСЂРѕРІРµРЅСЊ РІС‹С€Рµ С‚РІРѕРµРіРѕ РЅР° 2+',
    quote: 'Р¤РёР·РёРєР° Source РЅР° С‚РІРѕРµР№ СЃС‚РѕСЂРѕРЅРµ.',
    reward: 300,
    trigger: checkHLCrowbar
  },
  {
    id: 'hl_airdrop',
    title: 'рџ“¦ РЇС‰РёРє СЃРѕРїСЂРѕС‚РёРІР»РµРЅРёСЏ',
    description: 'РџРµСЂРІС‹Рј Р·Р°Р±СЂР°С‚СЊ РєРѕРЅС‚РµР№РЅРµСЂ РІРѕР№СЃ-РґСЂРѕРїР°',
    quote: 'РЎРёРіРЅР°Р»СЊРЅР°СЏ СЂР°РєРµС‚Р° СЃСЂР°Р±РѕС‚Р°Р»Р°.',
    reward: 150,
    trigger: checkHLAirdrop
  },
  // --- РњРµРјС‹ / РќР°РІР°Р»СЊРЅС‹Р№ ---
  {
    id: 'fbk_hello',
    title: 'рџ“Ј РџСЂРёРІРµС‚, СЌС‚Рѕ РќР°РІР°Р»СЊРЅС‹Р№',
    description: 'РќР°РїРёСЃР°С‚СЊ СЃРѕРѕР±С‰РµРЅРёРµ РїРѕСЃР»Рµ 3+ РґРЅРµР№ РѕС‚СЃСѓС‚СЃС‚РІРёСЏ РЅР° СЃРµСЂРІРµСЂРµ',
    quote: 'РЇ РЅРµ РјРѕР»С‡Р°Р», СЏ РїСЂРѕСЃС‚Рѕ Р±С‹Р» РІ РѕС„С„Р»Р°Р№РЅРµ!',
    reward: 150,
    trigger: checkFBKHello
  },
  {
    id: 'fbk_sandwich',
    title: 'рџҐЄ РќРµ Р±СѓС‚РµСЂР±СЂРѕРґ',
    description: 'РЈРґРµСЂР¶Р°С‚СЊ СЃС‚СЂРёРє Р°РєС‚РёРІРЅРѕСЃС‚Рё СЂРѕРІРЅРѕ 14 РґРЅРµР№',
    quote: 'РЎС‚СЂРёРє вЂ” РѕРЅ С‡С‚Рѕ, Р±СѓС‚РµСЂР±СЂРѕРґ, С‡С‚РѕР±С‹ РµРіРѕ СЃР±СЂР°СЃС‹РІР°С‚СЊ?',
    reward: 250,
    trigger: checkFBKSandwich
  },
  {
    id: 'fbk_final_battle',
    title: 'вљ”пёЏ Р¤РёРЅР°Р»СЊРЅР°СЏ Р±РёС‚РІР°',
    description: 'РЎС‹РіСЂР°С‚СЊ РґСѓСЌР»СЊ СЃРѕ СЃС‚Р°РІРєРѕР№ РѕС‚ 1000 XP',
    quote: 'Р¤РёРЅР°Р»СЊРЅР°СЏ Р±РёС‚РІР° РґРѕР±СЂР° СЃ РЅРµР№С‚СЂР°Р»РёС‚РµС‚РѕРј!',
    reward: 300,
    trigger: checkFBKFinalBattle
  },
  {
    id: 'fbk_investigation',
    title: 'рџ•µпёЏ РљРѕРјР°РЅРґР° СЂР°СЃСЃР»РµРґРѕРІР°С‚РµР»РµР№',
    description: 'РџРѕСЃРјРѕС‚СЂРµС‚СЊ РєР°СЂС‚РѕС‡РєРё /rank 5 СЂР°Р·РЅС‹С… Р»СЋРґРµР№ Р·Р° РґРµРЅСЊ',
    quote: 'РњС‹ РЅР°С€Р»Рё Сѓ РЅРµРіРѕ РЅРµР·Р°РґРµРєР»Р°СЂРёСЂРѕРІР°РЅРЅС‹Р№ СѓСЂРѕРІРµРЅСЊ.',
    reward: 150,
    trigger: checkFBKInvestigation
  },
  {
    id: 'fbk_prb',
    title: 'вЂпёЏ РџСЂРµРєСЂР°СЃРЅС‹Р№ РЎРµСЂРІРµСЂ Р‘СѓРґСѓС‰РµРіРѕ',
    description: 'Р—Р°РєСЂС‹С‚СЊ РІСЃРµ 3 РґРµР№Р»РёРєР° Р·Р° РѕРґРёРЅ РґРµРЅСЊ',
    quote: 'Р РѕСЃСЃРёСЏ Р±СѓРґРµС‚ СЃС‡Р°СЃС‚Р»РёРІРѕР№, Р° РѕРїС‹С‚ РЅР°С„Р°СЂРјР»РµРЅ.',
    reward: 250,
    trigger: checkFBKPRB
  },
  // --- РљР»Р°СЃСЃРёРєР° ---
  {
    id: 'lucky_777',
    title: 'рџЋ° РўСЂРё С‚РѕРїРѕСЂР°',
    description: 'Р—Р°С„РёРєСЃРёСЂРѕРІР°С‚СЊ СЂРѕРІРЅРѕ 777 XP РЅР° Р±Р°Р»Р°РЅСЃРµ',
    quote: 'РџРѕРґРЅСЏР» Р±Р°Р±Р»Р°, С‚РµРїРµСЂСЊ РІ С‚РѕРїРµ.',
    reward: 250,
    trigger: checkLucky777
  },
  {
    id: 'casino_house',
    title: 'рџЋІ РљР°Р·РёРЅРѕ РІСЃРµРіРґР° РІ РїР»СЋСЃРµ',
    description: 'РЎР¶РµС‡СЊ Р±РѕР»РµРµ 100 XP РЅР°Р»РѕРіР° РІ РѕРґРЅРѕР№ РґСѓСЌР»Рё',
    quote: 'РљР°СЂС‚С‹ СЃ СЃР°РјРѕРіРѕ РЅР°С‡Р°Р»Р° Р±С‹Р»Рё РєСЂР°РїР»РµРЅС‹РјРё.',
    reward: 150,
    trigger: checkCasinoHouse
  },
];

// ============================================
// Р¤СѓРЅРєС†РёРё СЂР°Р·Р±Р»РѕРєРёСЂРѕРІРєРё РґРѕСЃС‚РёР¶РµРЅРёР№ (Р­С‚Р°Рї 6)
// ============================================

/**
 * РџСЂРѕРІРµСЂСЏРµС‚, РѕС‚РєСЂС‹С‚Рѕ Р»Рё СѓР¶Рµ РґРѕСЃС‚РёР¶РµРЅРёРµ
 */
async function checkAchievementUnlocked(db: any, userId: string, guildId: string, achievementId: string): Promise<boolean> {
  try {
    const result = await db.execute({
      sql: 'SELECT 1 FROM user_achievements WHERE user_id = ? AND guild_id = ? AND achievement_id = ?',
      args: [userId, guildId, achievementId],
    });
    return result.rows.length > 0;
  } catch (err) {
    console.error(`[Achievement] Error checking unlock: ${achievementId}`, err);
    return false;
  }
}

/**
 * РќР°С‡РёСЃР»СЏРµС‚ РЅР°РіСЂР°РґСѓ Р·Р° РґРѕСЃС‚РёР¶РµРЅРёРµ Рё РѕС‚РїСЂР°РІР»СЏРµС‚ РѕРїРѕРІРµС‰РµРЅРёРµ
 */
async function unlockAchievement(db: any, userId: string, guildId: string, achievementId: string, bot: Client, targetChannel?: any): Promise<void> {
  const achievement = ACHIEVEMENTS_LIST.find(a => a.id === achievementId);
  if (!achievement) {
    console.error(`[Achievement] Achievement not found: ${achievementId}`);
    return;
  }

  // РџСЂРѕРІРµСЂРєР°: РµСЃР»Рё СѓР¶Рµ РѕС‚РєСЂС‹С‚Рѕ
  const isUnlocked = await checkAchievementUnlocked(db, userId, guildId, achievementId);
  if (isUnlocked) {
    console.log(`[Achievement] Already unlocked: ${achievementId} for ${userId}`);
    return;
  }

  // Р’СЃС‚Р°РІР»СЏРµРј Р·Р°РїРёСЃСЊ
  const now = Math.floor(Date.now() / 1000);
  try {
    await db.execute({
      sql: 'INSERT INTO user_achievements (user_id, guild_id, achievement_id, unlocked_at) VALUES (?, ?, ?, ?)',
      args: [userId, guildId, achievementId, now],
    });

    // РќР°С‡РёСЃР»СЏРµРј XP РЅР°РіСЂР°РґСѓ
    await db.execute({
      sql: 'UPDATE users SET xp = xp + ? WHERE user_id = ? AND guild_id = ?',
      args: [achievement.reward, userId, guildId],
    });

    // РќР°С‡РёСЃР»СЏРµРј РјРѕРЅРµС‚С‹ Р·Р° РґРѕСЃС‚РёР¶РµРЅРёРµ (+300 рџЄ™)
    await db.execute({
      sql: 'UPDATE users SET coins = coins + 300 WHERE user_id = ? AND guild_id = ?',
      args: [userId, guildId],
    });

    // РћР±РЅРѕРІР»СЏРµРј СѓСЂРѕРІРµРЅСЊ
    const userResult = await db.execute({
      sql: 'SELECT xp FROM users WHERE user_id = ? AND guild_id = ?',
      args: [userId, guildId],
    });
    if (userResult.rows.length > 0) {
      const newXp = userResult.rows[0].xp as number;
      const newLevel = calculateLevel(newXp);
      await db.execute({
        sql: 'UPDATE users SET level = ? WHERE user_id = ? AND guild_id = ?',
        args: [newLevel, userId, guildId],
      });
    }

    console.log(`[Achievement] ${userId} unlocked ${achievementId} - +${achievement.reward} XP`);

    // РћС‚РїСЂР°РІР»СЏРµРј Р·РѕР»РѕС‚РѕР№ Embed РІ С‡Р°С‚
    try {
      const guild = bot.guilds.cache.get(guildId);
      if (guild) {
        // Р•СЃР»Рё РїРµСЂРµРґР°РЅ С†РµР»РµРІРѕР№ РєР°РЅР°Р», РёСЃРїРѕР»СЊР·СѓРµРј РµРіРѕ (РґР»СЏ messageCreate - message.channel)
        let channel: any = targetChannel || null;

        // Р•СЃР»Рё СЃРѕР±С‹С‚РёРµ РїСЂРѕРёР·РѕС€Р»Рѕ РІ РіРѕР»РѕСЃРѕРІРѕРј РєР°РЅР°Р»Рµ (РЅРµ С‚РµРєСЃС‚РѕРІС‹Р№) РёР»Рё РєР°РЅР°Р» РЅРµ РѕРїСЂРµРґРµР»С‘РЅ вЂ”
        // РіР°СЂР°РЅС‚РёСЂРѕРІР°РЅРЅРѕ РѕС‚РїСЂР°РІР»СЏРµРј Р·РѕР»РѕС‚РѕР№ Embed РІ РіР»Р°РІРЅС‹Р№ РєР°РЅР°Р» РёРІРµРЅС‚РѕРІ
        if (!channel || channel.type !== 0) {
          channel = getEventTargetChannel(guild);
        }

        if (channel) {
          const embed = {
            embeds: [{
              title: 'рџЏ† РЎР•РљР Р•РўРќРћР• Р”РћРЎРўРР–Р•РќРР• Р РђР—Р‘Р›РћРљРР РћР’РђРќРћ!',
              description: `<@${userId}> РѕС‚РєСЂС‹Р»(Р°) РґРѕСЃС‚РёР¶РµРЅРёРµ **\`В«${achievement.title}В»**!`,
              color: 0xF1C40F,
              fields: [
                { name: 'РћРїРёСЃР°РЅРёРµ', value: achievement.description, inline: false },
                { name: 'Р¦РёС‚Р°С‚Р°', value: `*${achievement.quote}*`, inline: false },
                { name: 'РќР°РіСЂР°РґР°', value: `**+${achievement.reward} XP**`, inline: true },
              ],
              footer: { text: 'РћС‚Р»РёС‡РЅР°СЏ СЂР°Р±РѕС‚Р°! РџСЂРѕРґРѕР»Р¶Р°Р№ РёСЃСЃР»РµРґРѕРІР°С‚СЊ СЃРµСЂРІРµСЂ...' },
            }],
          };

          try {
            await channel.send(embed);
            console.log(`[Achievement] Notification sent to ${guildId} channel ${channel.id}`);
          } catch (sendErr) {
            console.error(`[Achievement] Failed to send notification to channel ${channel.id}:`, sendErr);
          }
        }
      }
    } catch (notifyErr) {
      console.error('[Achievement] Error in notification:', notifyErr);
    }
  } catch (err) {
    console.error(`[Achievement] Error unlocking ${achievementId}:`, err);
  }
}

// ============================================
// Р¤СѓРЅРєС†РёРё РїСЂРѕРІРµСЂРєРё СѓСЃР»РѕРІРёР№ РґРѕСЃС‚РёР¶РµРЅРёР№
// ============================================

// --- Р’РµРґСЊРјР°Рє 3 ---

/**
 * witcher_plod: РћС‚РїСЂР°РІРёС‚СЊ СЃРѕРѕР±С‰РµРЅРёРµ СЂРѕРІРЅРѕ С‡РµСЂРµР· 30-35 СЃРµРє РїРѕСЃР»Рµ РїСЂРµРґС‹РґСѓС‰РµРіРѕ
 */
async function checkWitcherPlod(db: any, userId: string, guildId: string, data: { now: number; lastMessageAt: number }): Promise<boolean> {
  const { now, lastMessageAt } = data;
  if (!lastMessageAt) return false;
  // lastMessageAt С‚РµРїРµСЂСЊ РІ РјРёР»Р»РёСЃРµРєСѓРЅРґР°С…, diff РІ СЃРµРєСѓРЅРґР°С…
  const diff = Math.floor((now - lastMessageAt) / 1000);
  return diff >= 30 && diff <= 35;
}

/**
 * witcher_gwent: РЎС‹РіСЂР°С‚СЊ 3 РґСѓСЌР»Рё Р·Р° РѕРґРёРЅ РґРµРЅСЊ
 */
async function checkWitcherGwent(db: any, userId: string, guildId: string): Promise<boolean> {
  const today = getVladivostokDate();
  try {
    const result = await db.execute({
      sql: 'SELECT COUNT(*) as count FROM duels WHERE (challenger_id = ? OR opponent_id = ?) AND guild_id = ? AND created_at >= ?',
      args: [userId, userId, guildId, new Date(today).getTime() / 1000],
    });
    return (result.rows[0]?.count as number) >= 3;
  } catch (err) {
    return false;
  }
}

/**
 * witcher_damn: РџСЂРѕРёРіСЂР°С‚СЊ РґСѓСЌР»СЊ СЃ Р±СЂРѕСЃРєРѕРј РєСѓР±РёРєР° РјРµРЅСЊС€Рµ 10
 */
async function checkWitcherDamn(db: any, userId: string, guildId: string, data: { lastDuelRoll?: number }): Promise<boolean> {
  // РџСЂРѕРІРµСЂСЏРµРј РїРѕСЃР»РµРґРЅРёРµ РґСѓСЌР»Рё
  try {
    const result = await db.execute({
      sql: 'SELECT * FROM duels WHERE (challenger_id = ? OR opponent_id = ?) AND guild_id = ? ORDER BY created_at DESC LIMIT 1',
      args: [userId, userId, guildId],
    });
    if (result.rows.length > 0) {
      const duel = result.rows[0];
      // Р•СЃР»Рё РїРѕР»СЊР·РѕРІР°С‚РµР»СЊ РїСЂРѕРёРіСЂР°Р» Рё Р±СЂРѕСЃРѕРє Р±С‹Р» РјРµРЅСЊС€Рµ 10
      return (duel.status === 'completed');
    }
    return false;
  } catch (err) {
    return false;
  }
}

/**
 * witcher_blaviken: Р’С‹РёРіСЂР°С‚СЊ 3 РґСѓСЌР»Рё РїРѕРґСЂСЏРґ Р±РµР· РїРѕСЂР°Р¶РµРЅРёР№
 */
async function checkWitcherBlaviken(db: any, userId: string, guildId: string): Promise<boolean> {
  try {
    const result = await db.execute({
      sql: 'SELECT challenger_id, opponent_id, status FROM duels WHERE guild_id = ? ORDER BY created_at DESC LIMIT 10',
      args: [guildId],
    });
    const duels = result.rows || [];
    let winStreak = 0;
    let maxWinStreak = 0;
    for (const duel of duels) {
      if (duel.status === 'completed') {
        const winnerId = duel.challenger_id as string;
        const loserId = duel.opponent_id as string;
        // РћРїСЂРµРґРµР»СЏРµРј РїРѕР±РµРґРёС‚РµР»СЏ РёР· Р·Р°РїРёСЃРµР№ РґСѓСЌР»Рё (РЅСѓР¶РµРЅ roll)
        if (winnerId === userId) {
          winStreak++;
          maxWinStreak = Math.max(maxWinStreak, winStreak);
        } else {
          winStreak = 0;
        }
      }
    }
    return maxWinStreak >= 3;
  } catch (err) {
    return false;
  }
}

/**
 * witcher_coin: Р—Р°С„РёРєСЃРёСЂРѕРІР°С‚СЊ СЂРѕРІРЅРѕ 1000, 2000, 3000 РёР»Рё 5000 XP
 */
async function checkWitcherCoin(db: any, userId: string, guildId: string, data: { newXp: number }): Promise<boolean> {
  const { newXp } = data;
  return [1000, 2000, 3000, 5000].includes(newXp);
}

// --- Red Dead Redemption 2 ---

/**
 * rdr_plan: РќР°РєРѕРїРёС‚СЊ 3000+ XP, РЅРё СЂР°Р·Сѓ РЅРµ РїСЂРѕРёРіСЂР°РІ РІ РґСѓСЌР»СЏС…
 */
async function checkRDRPlan(db: any, userId: string, guildId: string): Promise<boolean> {
  try {
    // РџСЂРѕРІРµСЂСЏРµРј XP
    const xpResult = await db.execute({
      sql: 'SELECT xp FROM users WHERE user_id = ? AND guild_id = ?',
      args: [userId, guildId],
    });
    if (xpResult.rows.length === 0) return false;
    const xp = (xpResult.rows[0].xp as number) || 0;
    if (xp < 3000) return false;

    // РџСЂРѕРІРµСЂСЏРµРј, РЅРµ РїСЂРѕРёРіСЂС‹РІР°Р» Р»Рё РІ РґСѓСЌР»СЏС…
    const duelResult = await db.execute({
      sql: 'SELECT * FROM duels WHERE (challenger_id = ? OR opponent_id = ?) AND guild_id = ? AND status = ?',
      args: [userId, userId, guildId, 'completed'],
    });
    if (duelResult.rows.length === 0) return true; // Р”СѓСЌР»РµР№ РЅРµ Р±С‹Р»Рѕ

    // РџСЂРѕРІРµСЂСЏРµРј, Р±С‹Р» Р»Рё РїСЂРѕРёРіСЂС‹С€
    for (const duel of duelResult.rows) {
      // Р’ С‚РµРєСѓС‰РµР№ СЃС…РµРјРµ РїРѕР±РµРґРёС‚РµР»СЊ РѕРїСЂРµРґРµР»СЏРµС‚СЃСЏ РїРѕ roll РІ worker.ts
      // РџСЂРѕРїСѓСЃРєР°РµРј РїСЂРѕРІРµСЂРєСѓ, С‚Р°Рє РєР°Рє РІ Р‘Р” РЅРµС‚ РёРЅС„РѕСЂРјР°С†РёРё Рѕ РїСЂРѕРёРіСЂС‹С€Рµ
    }
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * rdr_lenny: РћС‚РїСЂР°РІРёС‚СЊ РєР°РїСЃ-СЃРѕРѕР±С‰РµРЅРёРµ 10+ Р±СѓРєРІ РЅРѕС‡СЊСЋ СЃ 02:00 РґРѕ 05:00
 */
async function checkRDRLenny(db: any, userId: string, guildId: string, data: { messageContent: string; hour: number }): Promise<boolean> {
  const { messageContent, hour } = data;
  if (hour < 2 || hour >= 5) return false; // РўРѕР»СЊРєРѕ 02:00-05:00
  if (!messageContent || messageContent.length < 10) return false;
  return messageContent === messageContent.toUpperCase();
}

/**
 * rdr_quickdraw: Р’С‹РёРіСЂР°С‚СЊ РґСѓСЌР»СЊ СЃ Р±СЂРѕСЃРєРѕРј 95+
 */
async function checkRDRQuickdraw(db: any, userId: string, guildId: string): Promise<boolean> {
  // РџСЂРѕРІРµСЂСЏРµРј РїРѕСЃР»РµРґРЅСЋСЋ РґСѓСЌР»СЊ СЃ РІС‹СЃРѕРєРёРј Р±СЂРѕСЃРєРѕРј
  return false; // РўСЂРµР±СѓРµС‚ РёР·РјРµРЅРµРЅРёР№ РІ worker.ts
}

/**
 * rdr_tahiti: РџСЂРѕРІРµСЃС‚Рё Р±РѕР»РµРµ 5 С‡Р°СЃРѕРІ РІ РІРѕР№СЃРµ Р·Р° РґРµРЅСЊ
 */
async function checkRDRTahiti(db: any, userId: string, guildId: string): Promise<boolean> {
  const today = getVladivostokDate();
  try {
    const result = await db.execute({
      sql: 'SELECT voice_seconds FROM user_daily_activity WHERE user_id = ? AND guild_id = ? AND activity_date = ?',
      args: [userId, guildId, today],
    });
    if (result.rows.length === 0) return false;
    const voiceSeconds = (result.rows[0].voice_seconds as number) || 0;
    return voiceSeconds > 5 * 3600; // 5 С‡Р°СЃРѕРІ
  } catch (err) {
    return false;
  }
}

/**
 * rdr_tax: РЎР¶РµС‡СЊ Р±РѕР»РµРµ 200 XP РЅР° РЅР°Р»РѕРіРµ СЃ РґСѓСЌР»РµР№
 */
async function checkRDRTax(db: any, userId: string, guildId: string): Promise<boolean> {
  try {
    const result = await db.execute({
      sql: 'SELECT bet_amount, status FROM duels WHERE guild_id = ? AND status = ?',
      args: [guildId, 'completed'],
    });
    let totalTax = 0;
    for (const duel of result.rows || []) {
      const bet = (duel.bet_amount as number) || 0;
      const tax = Math.round((bet * 2) * 0.26);
      totalTax += tax;
    }
    return totalTax > 200;
  } catch (err) {
    return false;
  }
}

// --- Р’Р»Р°РґРёРІРѕСЃС‚РѕРє Рё Р”Р’ ---

/**
 * vlad_2000: РћРєР°Р·Р°С‚СЊСЃСЏ СЂРѕРІРЅРѕ СЃ 2000 XP РЅР° Р±Р°Р»Р°РЅСЃРµ
 */
async function checkVlad2000(db: any, userId: string, guildId: string, data: { newXp: number }): Promise<boolean> {
  return data.newXp === 2000;
}

/**
 * vlad_midnight: РћС‚РїСЂР°РІРёС‚СЊ СЃРѕРѕР±С‰РµРЅРёРµ СЂРѕРІРЅРѕ РІ 00:00 (Р’Р»Р°РґРёРІРѕСЃС‚РѕРє)
 */
async function checkVladMidnight(db: any, userId: string, guildId: string, data: { hour: number; minute: number; second: number }): Promise<boolean> {
  const { hour, minute, second } = data;
  return hour === 0 && minute === 0 && second < 10; // 00:00-00:09
}

/**
 * vlad_pyanse: Р‘С‹С‚СЊ Р°РєС‚РёРІРЅС‹Рј РІ С‡Р°С‚Рµ РІРѕ РІСЂРµРјСЏ РѕР±РµРґР° СЃ 12:00 РґРѕ 13:00 (Р’Р»Р°РґРёРІРѕСЃС‚РѕРє)
 */
async function checkVladPyanse(db: any, userId: string, guildId: string, data: { hour: number }): Promise<boolean> {
  return data.hour >= 12 && data.hour < 13;
}

/**
 * vlad_typhoon: РЎРїР°СЃС‚Рё СЃС‚СЂРёРє СЃ РїРѕРјРѕС‰СЊСЋ Р·Р°РјРѕСЂРѕР·РєРё
 */
async function checkVladTyphoon(db: any, userId: string, guildId: string, data: { usedFreeze: boolean }): Promise<boolean> {
  return data.usedFreeze;
}

/**
 * vlad_right_hand: РЎРјРµРЅРёС‚СЊ С‚РµРјСѓ РЅР° РљРёР±РµСЂРїР°РЅРє РёР»Рё РњР°РіРјСѓ
 */
async function checkVladRightHand(db: any, userId: string, guildId: string, data: { themeId: string }): Promise<boolean> {
  return data.themeId === 'cyberpunk' || data.themeId === 'magma';
}

/**
 * vlad_golden_horn: Р—Р°РЅСЏС‚СЊ 1-Рµ РјРµСЃС‚Рѕ РІ Р»РёРґРµСЂР±РѕСЂРґРµ СЃРµСЂРІРµСЂР°
 */
async function checkVladGoldenHorn(db: any, userId: string, guildId: string): Promise<boolean> {
  try {
    const result = await db.execute({
      sql: 'SELECT xp FROM users WHERE user_id = ? AND guild_id = ?',
      args: [userId, guildId],
    });
    if (result.rows.length === 0) return false;
    const userXp = (result.rows[0].xp as number) || 0;

    const rankResult = await db.execute({
      sql: 'SELECT COUNT(*) as rank FROM users WHERE guild_id = ? AND xp > ?',
      args: [guildId, userXp],
    });
    const rank = ((rankResult.rows[0]?.rank as number) || 0) + 1;
    return rank === 1;
  } catch (err) {
    return false;
  }
}

// --- Half-Life 2 ---

/**
 * hl_wakeup: РћС‚РїСЂР°РІРёС‚СЊ СЃРѕРѕР±С‰РµРЅРёРµ СЃ 06:00 РґРѕ 07:00 СѓС‚СЂР° (Р’Р»Р°РґРёРІРѕСЃС‚РѕРє)
 */
async function checkHLWakeup(db: any, userId: string, guildId: string, data: { hour: number }): Promise<boolean> {
  return data.hour >= 6 && data.hour < 7;
}

/**
 * hl_can: Р’С‹РїРѕР»РЅРёС‚СЊ СЃРІРѕР№ РїРµСЂРІС‹Р№ РµР¶РµРґРЅРµРІРЅС‹Р№ РєРІРµСЃС‚
 */
async function checkHLCan(db: any, userId: string, guildId: string, data: { firstQuestCompleted: boolean }): Promise<boolean> {
  return data.firstQuestCompleted;
}

/**
 * hl_water: РџСЂРѕРІРµСЃС‚Рё 2 С‡Р°СЃР° РЅРµРїСЂРµСЂС‹РІРЅРѕ РІ РІРѕР№СЃРµ
 */
async function checkHLWater(db: any, userId: string, guildId: string, data: { continuousVoiceSeconds: number }): Promise<boolean> {
  return (data.continuousVoiceSeconds || 0) >= 7200; // 2 С‡Р°СЃР°
}

/**
 * hl_crowbar: РџРѕР±РµРґРёС‚СЊ РІ РґСѓСЌР»Рё РѕРїРїРѕРЅРµРЅС‚Р°, Сѓ РєРѕС‚РѕСЂРѕРіРѕ СѓСЂРѕРІРµРЅСЊ РІС‹С€Рµ С‚РІРѕРµРіРѕ РЅР° 2+
 */
async function checkHLCrowbar(db: any, userId: string, guildId: string, data: { opponentLevel: number; userLevel: number }): Promise<boolean> {
  return (data.opponentLevel - data.userLevel) >= 2;
}

/**
 * hl_airdrop: РџРµСЂРІС‹Рј Р·Р°Р±СЂР°С‚СЊ РєРѕРЅС‚РµР№РЅРµСЂ РІРѕР№СЃ-РґСЂРѕРїР°
 */
async function checkHLAirdrop(db: any, userId: string, guildId: string, data: { claimedAirdrop: boolean }): Promise<boolean> {
  return data.claimedAirdrop;
}

// --- РњРµРјС‹ / РќР°РІР°Р»СЊРЅС‹Р№ ---

/**
 * fbk_hello: РќР°РїРёСЃР°С‚СЊ СЃРѕРѕР±С‰РµРЅРёРµ РїРѕСЃР»Рµ 3+ РґРЅРµР№ РѕС‚СЃСѓС‚СЃС‚РІРёСЏ РЅР° СЃРµСЂРІРµСЂРµ
 */
async function checkFBKHello(db: any, userId: string, guildId: string, data: { lastMessageAt: number; now: number }): Promise<boolean> {
  const { lastMessageAt, now } = data;
  if (!lastMessageAt) return true; // РџРµСЂРІРѕРµ СЃРѕРѕР±С‰РµРЅРёРµ
  // lastMessageAt С‚РµРїРµСЂСЊ РІ РјРёР»Р»РёСЃРµРєСѓРЅРґР°С…
  const daysOffline = (now - lastMessageAt) / (1000 * 60 * 60 * 24);
  return daysOffline >= 3;
}

/**
 * fbk_sandwich: РЈРґРµСЂР¶Р°С‚СЊ СЃС‚СЂРёРє Р°РєС‚РёРІРЅРѕСЃС‚Рё СЂРѕРІРЅРѕ 14 РґРЅРµР№
 */
async function checkFBKSandwich(db: any, userId: string, guildId: string, data: { streakDays: number }): Promise<boolean> {
  return data.streakDays === 14;
}

/**
 * fbk_final_battle: РЎС‹РіСЂР°С‚СЊ РґСѓСЌР»СЊ СЃРѕ СЃС‚Р°РІРєРѕР№ РѕС‚ 1000 XP
 */
async function checkFBKFinalBattle(db: any, userId: string, guildId: string, data: { betAmount: number }): Promise<boolean> {
  return data.betAmount >= 1000;
}

/**
 * fbk_investigation: РџРѕСЃРјРѕС‚СЂРµС‚СЊ РєР°СЂС‚РѕС‡РєРё /rank 5 СЂР°Р·РЅС‹С… Р»СЋРґРµР№ Р·Р° РґРµРЅСЊ
 */
async function checkFBKInvestigation(db: any, userId: string, guildId: string): Promise<boolean> {
  // РћС‚СЃР»РµР¶РёРІР°РЅРёРµ РїСЂРѕСЃРјРѕС‚СЂРѕРІ РІ worker.ts С‡РµСЂРµР· РїРѕР»СЊР·РѕРІР°С‚РµР»СЊСЃРєРѕРµ СЃРѕСЃС‚РѕСЏРЅРёРµ
  return false;
}

/**
 * fbk_prb: Р—Р°РєСЂС‹С‚СЊ РІСЃРµ 3 РґРµР№Р»РёРєР° Р·Р° РѕРґРёРЅ РґРµРЅСЊ
 */
async function checkFBKPRB(db: any, userId: string, guildId: string): Promise<boolean> {
  const today = getVladivostokDate();
  try {
    // РРЎРџР РђР’Р›Р•РќРР•: СѓС‡РёС‚С‹РІР°РµРј С‚РѕР»СЊРєРѕ РєРІРµСЃС‚С‹, Р·Р°РєСЂС‹С‚С‹Рµ РЎР•Р“РћР”РќРЇ (С„РёР»СЊС‚СЂ РїРѕ active_date),
    // РєР°Рє РІ getUserStreakData вЂ” РёРЅР°С‡Рµ РґРѕСЃС‚РёР¶РёРјРѕСЃС‚СЊ РґР°РІРЅРёС… РєРІРµСЃС‚РѕРІ РїРѕСЂС‚РёР»Р° РїСЂРѕРІРµСЂРєСѓ.
    const result = await db.execute({
      sql: `SELECT COUNT(*) as completed
            FROM user_quest_progress uqp
            JOIN quests_daily qd ON uqp.quest_daily_id = qd.id
            WHERE uqp.user_id = ? AND uqp.guild_id = ? AND uqp.completed_at IS NOT NULL AND qd.active_date = ?`,
      args: [userId, guildId, today],
    });
    return (result.rows[0]?.completed as number) >= 3;
  } catch (err) {
    return false;
  }
}

// --- РљР»Р°СЃСЃРёРєР° ---

/**
 * lucky_777: Р—Р°С„РёРєСЃРёСЂРѕРІР°С‚СЊ СЂРѕРІРЅРѕ 777 XP РЅР° Р±Р°Р»Р°РЅСЃРµ
 */
async function checkLucky777(db: any, userId: string, guildId: string, data: { newXp: number }): Promise<boolean> {
  return data.newXp === 777;
}

/**
 * casino_house: РЎР¶РµС‡СЊ Р±РѕР»РµРµ 100 XP РЅР°Р»РѕРіР° РІ РѕРґРЅРѕР№ РґСѓСЌР»Рё
 */
async function checkCasinoHouse(db: any, userId: string, guildId: string, data: { taxAmount: number }): Promise<boolean> {
  return data.taxAmount > 100;
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers,
    // C8: Р±РµР· GuildPresences member.presence?.status РІСЃРµРіРґР° undefined,
    // РёР·-Р·Р° С‡РµРіРѕ awardOnlineSeconds РЅРµ РЅР°С‡РёСЃР»СЏР» online_seconds РЅРёРєРѕРјСѓ.
    // Р’РђР–РќРћ: С‚СЂРµР±СѓРµС‚ РІРєР»СЋС‡РµРЅРёСЏ Privileged Intent РІ Discord Developer Portal.
    GatewayIntentBits.GuildPresences,
  ],
});

const db = createClient({
  url: process.env.DATABASE_URL || 'libsql://localhost',
  authToken: process.env.DATABASE_AUTH_TOKEN,
});

// РџСЂРѕРІРµСЂРєР° Рё РѕР±РЅРѕРІР»РµРЅРёРµ СЃС…РµРјС‹ Р‘Р” РїСЂРё СЃС‚Р°СЂС‚Рµ
async function migrateSchema() {
  try {
    // РџСЂРѕРІРµСЂРєР° РЅР°Р»РёС‡РёСЏ РєРѕР»РѕРЅРєРё level (РІ СЃС‚Р°СЂС‹С… РІРµСЂСЃРёСЏС… РµС‘ РјРѕРіР»Рѕ РЅРµ Р±С‹С‚СЊ)
    const levelCheck = await db.execute({
      sql: "PRAGMA table_info(users)",
      args: [],
    });

    const columns = (levelCheck.rows || []).map((row: any) => row.name as string);

    if (!columns.includes('level')) {
      await db.execute({
        sql: 'ALTER TABLE users ADD COLUMN level INTEGER NOT NULL DEFAULT 0',
        args: [],
      });
      console.log('[Migrate] Added column: level');
    }

    if (!columns.includes('last_message_at')) {
      await db.execute({
        sql: 'ALTER TABLE users ADD COLUMN last_message_at INTEGER DEFAULT 0',
        args: [],
      });
      console.log('[Migrate] Added column: last_message_at');
    }

    if (!columns.includes('voice_joined_at')) {
      await db.execute({
        sql: 'ALTER TABLE users ADD COLUMN voice_joined_at INTEGER',
        args: [],
      });
      console.log('[Migrate] Added column: voice_joined_at');
    }

    if (!columns.includes('voice_segment_muted')) {
      await db.execute({
        sql: 'ALTER TABLE users ADD COLUMN voice_segment_muted INTEGER NOT NULL DEFAULT 0',
        args: [],
      });
      console.log('[Migrate] Added column: voice_segment_muted');
    }

    // ============================================
    // РњРёРіСЂР°С†РёСЏ 003: РљРѕР»РѕРЅРєРё РґР»СЏ СЃС‚СЂРёРєРѕРІ Р°РєС‚РёРІРЅРѕСЃС‚Рё (Р­С‚Р°Рї 2)
    // ============================================
    if (!columns.includes('streak_days')) {
      await db.execute({
        sql: 'ALTER TABLE users ADD COLUMN streak_days INTEGER NOT NULL DEFAULT 0',
        args: [],
      });
      console.log('[Migrate] Added column: streak_days');
    }

    if (!columns.includes('last_streak_date')) {
      await db.execute({
        sql: 'ALTER TABLE users ADD COLUMN last_streak_date TEXT DEFAULT NULL',
        args: [],
      });
      console.log('[Migrate] Added column: last_streak_date');
    }

    if (!columns.includes('streak_freezes')) {
      await db.execute({
        sql: 'ALTER TABLE users ADD COLUMN streak_freezes INTEGER NOT NULL DEFAULT 0',
        args: [],
      });
      console.log('[Migrate] Added column: streak_freezes');
    }

    // ============================================
    // РњРёРіСЂР°С†РёСЏ 011: РљРѕР»РѕРЅРєР° last_week_reset РґР»СЏ РµР¶РµРЅРµРґРµР»СЊРЅРѕРіРѕ СЃР±СЂРѕСЃР° (Р­С‚Р°Рї 7)
    // ============================================
    if (!columns.includes('last_week_reset')) {
      await db.execute({
        sql: 'ALTER TABLE users ADD COLUMN last_week_reset TEXT DEFAULT NULL',
        args: [],
      });
      console.log('[Migrate] Added column: last_week_reset');
    }

    // ============================================
    // РњРёРіСЂР°С†РёСЏ 023: РљРѕР»РѕРЅРєР° last_season_reset вЂ” РѕС‚РјРµС‚РєР° Р·Р°РІРµСЂС€РµРЅРёСЏ СЃРµР·РѕРЅР°.
    // РњР°СЂРєРµСЂ С…СЂР°РЅРёС‚СЃСЏ РџРћ Р“РР›Р¬Р”РРЇРњ РІ СЃР»СѓР¶РµР±РЅРѕР№ Р·Р°РїРёСЃРё users (user_id = guild_id)
    // Рё РѕР±РЅРѕРІР»СЏРµС‚СЃСЏ РЎРўР РћР“Рћ РїРѕСЃР»Рµ СѓСЃРїРµС€РЅРѕРіРѕ РєРѕРјРјРёС‚Р° СЃРµР·РѕРЅРЅРѕР№ Р»РёРєРІРёРґР°С†РёРё РєРѕРјРїР°РЅРёР№.
    // ============================================
    if (!columns.includes('last_season_reset')) {
      await db.execute({
        sql: 'ALTER TABLE users ADD COLUMN last_season_reset TEXT DEFAULT NULL',
        args: [],
      });
      console.log('[Migrate] Added column: last_season_reset');
    }

    // ============================================
    // РњРёРіСЂР°С†РёСЏ 019: РљРѕР»РѕРЅРєР° weekly_reset_week (Р±РµР·РѕРїР°СЃРЅРѕРµ РґРѕР±Р°РІР»РµРЅРёРµ, С„РёРєСЃ СЃС‚Р°Р±РёР»СЊРЅРѕСЃС‚Рё)
    // ============================================
    try {
      await db.execute({
        sql: 'ALTER TABLE users ADD COLUMN weekly_reset_week INTEGER DEFAULT 0',
        args: [],
      });
      console.log('[Migrate] Added column: weekly_reset_week');
    } catch (colErr: any) {
      // РРіРЅРѕСЂРёСЂСѓРµРј РѕС€РёР±РєСѓ, РµСЃР»Рё РєРѕР»РѕРЅРєР° СѓР¶Рµ СЃСѓС‰РµСЃС‚РІСѓРµС‚
      const errMsg = String(colErr?.message || colErr || '');
      if (!errMsg.toLowerCase().includes('duplicate column')) {
        console.error('[Migrate] Error adding weekly_reset_week column (ignored):', colErr);
      }
    }

    // ============================================
    // РњРёРіСЂР°С†РёСЏ 021: РљРѕР»РѕРЅРєР° next_boss_spawn_at РґР»СЏ СЂРµРґРєРѕРіРѕ СЃРїР°РІРЅР° Р±РѕСЃСЃРѕРІ
    // (РёРЅС‚РµСЂРІР°Р» РјРµР¶РґСѓ РїРѕСЏРІР»РµРЅРёСЏРјРё РњРёСЂРѕРІРѕРіРѕ Р‘РѕСЃСЃР°: 60-120 С‡Р°СЃРѕРІ РїРѕСЃР»Рµ РїРѕСЂР°Р¶РµРЅРёСЏ/РїРѕР±РµРіР°)
    // ============================================
    if (!columns.includes('next_boss_spawn_at')) {
      await db.execute({
        sql: 'ALTER TABLE users ADD COLUMN next_boss_spawn_at INTEGER DEFAULT 0',
        args: [],
      });
      console.log('[Migrate] Added column: next_boss_spawn_at');
    }

    // ============================================
    // РњРёРіСЂР°С†РёСЏ 012: РљРѕР»РѕРЅРєРё РґР»СЏ РіРѕРґРѕРІРѕР№ Р°РєС‚РёРІРЅРѕСЃС‚Рё Рё РјР°РєСЃРёРјР°Р»СЊРЅРѕРіРѕ СЃС‚СЂРёРєР° (Р­С‚Р°Рї 8)
    // ============================================
    if (!columns.includes('online_seconds')) {
      await db.execute({
        sql: 'ALTER TABLE users ADD COLUMN online_seconds INTEGER NOT NULL DEFAULT 0',
        args: [],
      });
      console.log('[Migrate] Added column: online_seconds');
    }

    if (!columns.includes('max_streak')) {
      await db.execute({
        sql: 'ALTER TABLE users ADD COLUMN max_streak INTEGER NOT NULL DEFAULT 0',
        args: [],
      });
      console.log('[Migrate] Added column: max_streak');
    }

    // ============================================
    // РњРёРіСЂР°С†РёСЏ 013: РљРѕР»РѕРЅРєР° prestige_count РґР»СЏ СЃРёСЃС‚РµРјС‹ РїСЂРµСЃС‚РёР¶Р° (Р­С‚Р°Рї 9)
    // ============================================
    if (!columns.includes('prestige_count')) {
      await db.execute({
        sql: 'ALTER TABLE users ADD COLUMN prestige_count INTEGER NOT NULL DEFAULT 0',
        args: [],
      });
      console.log('[Migrate] Added column: prestige_count');
    }

    // ============================================
    // РњРёРіСЂР°С†РёСЏ 014: РљРѕР»РѕРЅРєР° coins Рё С‚Р°Р±Р»РёС†Р° user_inventory (Р­С‚Р°Рї 11 - Р­РєРѕРЅРѕРјРёРєР° РњРѕРЅРµС‚)
    // ============================================
    if (!columns.includes('coins')) {
      await db.execute({
        sql: 'ALTER TABLE users ADD COLUMN coins INTEGER NOT NULL DEFAULT 0',
        args: [],
      });
      console.log('[Migrate] Added column: coins');
    }

    // ============================================
    // РњРёРіСЂР°С†РёСЏ 015: РљРѕР»РѕРЅРєР° class_id РґР»СЏ СЃРёСЃС‚РµРјС‹ RPG-РєР»Р°СЃСЃРѕРІ (Р­С‚Р°Рї 12)
    // ============================================
    if (!columns.includes('class_id')) {
      await db.execute({
        sql: 'ALTER TABLE users ADD COLUMN class_id TEXT DEFAULT NULL',
        args: [],
      });
      console.log('[Migrate] Added column: class_id');
    }

    // ============================================
    // РњРёРіСЂР°С†РёСЏ 016: РљРѕР»РѕРЅРєР° last_activity_at РґР»СЏ РїСЂРѕРєР»СЏС‚РёСЏ РґРµР·РµСЂС‚РёСЂР° (Р­С‚Р°Рї 12+)
    // ============================================
    if (!columns.includes('last_activity_at')) {
      await db.execute({
        sql: 'ALTER TABLE users ADD COLUMN last_activity_at INTEGER DEFAULT 0',
        args: [],
      });
      console.log('[Migrate] Added column: last_activity_at');

      // Р—Р°РїРѕР»РЅСЏРµРј СЃСѓС‰РµСЃС‚РІСѓСЋС‰РёРµ Р·Р°РїРёСЃРё С‚РµРєСѓС‰РёРј РІСЂРµРјРµРЅРµРј
      await db.execute({
        sql: 'UPDATE users SET last_activity_at = ? WHERE last_activity_at = 0 OR last_activity_at IS NULL',
        args: [Date.now()],
      });
      console.log('[Migrate] Filled last_activity_at for existing users');

      // РРЎРџР РђР’Р›Р•РќРР•: РєРѕРЅРІРµСЂС‚РёСЂСѓРµРј СЃС‚Р°СЂС‹Рµ Р·Р°РїРёСЃРё, РєРѕС‚РѕСЂС‹Рµ Р±С‹Р»Рё СЃРѕС…СЂР°РЅРµРЅС‹ РІ РЎР•РљРЈРќР”РђРҐ
      // Р•СЃР»Рё last_activity_at < 1000000000000, СЌС‚Рѕ СЏРІРЅРѕ СЃРµРєСѓРЅРґС‹ (РЅРµ РјРёР»Р»РёСЃРµРєСѓРЅРґС‹)
      // РўР°РєРёРµ Р·РЅР°С‡РµРЅРёСЏ РїСЂРµРѕР±СЂР°Р·СѓРµРј РІ РјРёР»Р»РёСЃРµРєСѓРЅРґС‹
      await db.execute({
        sql: 'UPDATE users SET last_activity_at = last_activity_at * 1000 WHERE last_activity_at > 0 AND last_activity_at < 1000000000000',
        args: [],
      });
      console.log('[Migrate] Converted legacy second-based last_activity_at values to milliseconds');
    }

    // ============================================
    // РњРёРіСЂР°С†РёСЏ 017: РљРѕР»РѕРЅРєР° last_boss_attack_at РґР»СЏ РњРёСЂРѕРІРѕРіРѕ Р‘РѕСЃСЃР° (Р­С‚Р°Рї 13)
    // ============================================
    if (!columns.includes('last_boss_attack_at')) {
      await db.execute({
        sql: 'ALTER TABLE users ADD COLUMN last_boss_attack_at INTEGER DEFAULT 0',
        args: [],
      });
      console.log('[Migrate] Added column: last_boss_attack_at');
    }

    // ============================================
    // РњРёРіСЂР°С†РёСЏ 018: РЎРёСЃС‚РµРјР° РњРёСЂРѕРІРѕРіРѕ Р‘РѕСЃСЃР° (Р­С‚Р°Рї 13)
    // ============================================

    // РЎРѕР·РґР°С‘Рј С‚Р°Р±Р»РёС†Сѓ world_boss
    const worldBossCheck = await db.execute({
      sql: "SELECT name FROM sqlite_master WHERE type='table' AND name='world_boss'",
      args: [],
    });

    if (worldBossCheck.rows.length === 0) {
      await db.execute({
        sql: `CREATE TABLE world_boss (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          guild_id TEXT NOT NULL,
          channel_id TEXT NOT NULL,
          message_id TEXT DEFAULT NULL,
          boss_id TEXT NOT NULL,
          boss_name TEXT NOT NULL,
          boss_type TEXT NOT NULL,
          max_hp INTEGER NOT NULL,
          current_hp INTEGER NOT NULL,
          status TEXT NOT NULL DEFAULT 'active',
          spawned_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL
        )`,
        args: [],
      });
      await db.execute({
        sql: 'CREATE INDEX idx_world_boss_guild_status ON world_boss(guild_id, status)',
        args: [],
      });
      console.log('[Migrate] Created table: world_boss');
    }

    // РЎРѕР·РґР°С‘Рј С‚Р°Р±Р»РёС†Сѓ boss_damage_logs
    const bossDamageLogsCheck = await db.execute({
      sql: "SELECT name FROM sqlite_master WHERE type='table' AND name='boss_damage_logs'",
      args: [],
    });

    if (bossDamageLogsCheck.rows.length === 0) {
      await db.execute({
        sql: `CREATE TABLE boss_damage_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          boss_id INTEGER NOT NULL,
          user_id TEXT NOT NULL,
          guild_id TEXT NOT NULL,
          damage INTEGER NOT NULL,
          attack_type TEXT NOT NULL,
          created_at INTEGER NOT NULL
        )`,
        args: [],
      });
      await db.execute({
        sql: 'CREATE INDEX idx_boss_damage_logs_boss ON boss_damage_logs(boss_id)',
        args: [],
      });
      await db.execute({
        sql: 'CREATE INDEX idx_boss_damage_logs_user ON boss_damage_logs(user_id, guild_id)',
        args: [],
      });
      console.log('[Migrate] Created table: boss_damage_logs');
    }

    // ============================================
    // РњРёРіСЂР°С†РёСЏ 017 (РїРµСЂРµРёРЅРґРµРєСЃР°С†РёСЏ): РЎРёСЃС‚РµРјР° СЂРµР»РёРєРІРёР№, СЌРєРёРїРёСЂРѕРІРєРё Рё СЂС‹РЅРєР° (Р­С‚Р°Рї 14)
    // ============================================

    // C11: CREATE TABLE user_inventory РћР‘РЇР—РђРќ РёРґС‚Рё Р”Рћ ALTER TABLE РЅРёР¶Рµ.
    // РќР° С‡РёСЃС‚РѕР№ Р‘Р” РїРµСЂРІС‹Р№ Р¶Рµ ALTER Р±СЂРѕСЃР°Р» "no such table: user_inventory",
    // РёСЃРєР»СЋС‡РµРЅРёРµ РіР»РѕС‚Р°Р»РѕСЃСЊ РІРЅРµС€РЅРёРј catch Рё РІСЃРµ РїРѕСЃР»РµРґСѓСЋС‰РёРµ РјРёРіСЂР°С†РёРё РЅРµ РІС‹РїРѕР»РЅСЏР»РёСЃСЊ.
    // РўР°Р±Р»РёС†Р° user_inventory (Р­С‚Р°Рї 11 - РЎРёСЃС‚РµРјР° РёРЅРІРµРЅС‚Р°СЂСЏ)
    const userInventoryCheck = await db.execute({
      sql: "SELECT name FROM sqlite_master WHERE type='table' AND name='user_inventory'",
      args: [],
    });

    if (userInventoryCheck.rows.length === 0) {
      await db.execute({
        sql: `CREATE TABLE user_inventory (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL,
          guild_id TEXT NOT NULL,
          item_name TEXT NOT NULL,
          item_type TEXT NOT NULL,
          rarity TEXT NOT NULL,
          sell_price INTEGER NOT NULL DEFAULT 10,
          created_at INTEGER NOT NULL
        )`,
        args: [],
      });
      await db.execute({
        sql: 'CREATE INDEX idx_user_inventory_user ON user_inventory(user_id, guild_id)',
        args: [],
      });
      console.log('[Migrate] Created table: user_inventory');
    }

    // Р”РѕР±Р°РІР»СЏРµРј РєРѕР»РѕРЅРєРё РІ user_inventory (РµСЃР»Рё РµС‰С‘ РЅРµС‚)
    // C14: РљР°Р¶РґС‹Р№ ALTER TABLE РѕР±С‘СЂРЅСѓС‚ РІ try/catch, С‡С‚РѕР±С‹ РґСѓР±Р»РёСЂСѓСЋС‰РёРµСЃСЏ РєРѕР»РѕРЅРєРё РёРіРЅРѕСЂРёСЂРѕРІР°Р»РёСЃСЊ
    // Рё РЅРµ РѕР±СЂС‹РІР°Р»Рё РѕСЃС‚Р°Р»СЊРЅС‹Рµ РјРёРіСЂР°С†РёРё Р‘Р”
    try {
      await db.execute({
        sql: 'ALTER TABLE user_inventory ADD COLUMN item_id TEXT NOT NULL DEFAULT \'junk\'',
        args: [],
      });
      console.log('[Migrate] Added column: item_id');
    } catch (err: any) {
      const errMsg = String(err?.message || err || '');
      if (!errMsg.toLowerCase().includes('duplicate column')) {
        console.error('[Migrate] Error adding item_id column:', err);
      }
    }

    try {
      await db.execute({
        sql: 'ALTER TABLE user_inventory ADD COLUMN slot TEXT NOT NULL DEFAULT \'junk\'',
        args: [],
      });
      console.log('[Migrate] Added column: slot');
    } catch (err: any) {
      const errMsg = String(err?.message || err || '');
      if (!errMsg.toLowerCase().includes('duplicate column')) {
        console.error('[Migrate] Error adding slot column:', err);
      }
    }

    try {
      await db.execute({
        sql: 'ALTER TABLE user_inventory ADD COLUMN atk_bonus INTEGER NOT NULL DEFAULT 0',
        args: [],
      });
      console.log('[Migrate] Added column: atk_bonus');
    } catch (err: any) {
      const errMsg = String(err?.message || err || '');
      if (!errMsg.toLowerCase().includes('duplicate column')) {
        console.error('[Migrate] Error adding atk_bonus column:', err);
      }
    }

    try {
      await db.execute({
        sql: 'ALTER TABLE user_inventory ADD COLUMN def_bonus INTEGER NOT NULL DEFAULT 0',
        args: [],
      });
      console.log('[Migrate] Added column: def_bonus');
    } catch (err: any) {
      const errMsg = String(err?.message || err || '');
      if (!errMsg.toLowerCase().includes('duplicate column')) {
        console.error('[Migrate] Error adding def_bonus column:', err);
      }
    }

    try {
      await db.execute({
        sql: 'ALTER TABLE user_inventory ADD COLUMN crit_bonus INTEGER NOT NULL DEFAULT 0',
        args: [],
      });
      console.log('[Migrate] Added column: crit_bonus');
    } catch (err: any) {
      const errMsg = String(err?.message || err || '');
      if (!errMsg.toLowerCase().includes('duplicate column')) {
        console.error('[Migrate] Error adding crit_bonus column:', err);
      }
    }

    try {
      await db.execute({
        sql: 'ALTER TABLE user_inventory ADD COLUMN coin_bonus INTEGER NOT NULL DEFAULT 0',
        args: [],
      });
      console.log('[Migrate] Added column: coin_bonus');
    } catch (err: any) {
      const errMsg = String(err?.message || err || '');
      if (!errMsg.toLowerCase().includes('duplicate column')) {
        console.error('[Migrate] Error adding coin_bonus column:', err);
      }
    }

    try {
      await db.execute({
        sql: 'ALTER TABLE user_inventory ADD COLUMN is_equipped INTEGER NOT NULL DEFAULT 0',
        args: [],
      });
      console.log('[Migrate] Added column: is_equipped');
    } catch (err: any) {
      const errMsg = String(err?.message || err || '');
      if (!errMsg.toLowerCase().includes('duplicate column')) {
        console.error('[Migrate] Error adding is_equipped column:', err);
      }
    }

    try {
      await db.execute({
        sql: 'ALTER TABLE user_inventory ADD COLUMN description TEXT DEFAULT \'\'',
        args: [],
      });
      console.log('[Migrate] Added column: description');
    } catch (err: any) {
      const errMsg = String(err?.message || err || '');
      if (!errMsg.toLowerCase().includes('duplicate column')) {
        console.error('[Migrate] Error adding description column:', err);
      }
    }

    // РЎРѕР·РґР°С‘Рј СѓРЅРёРєР°Р»СЊРЅС‹Р№ РёРЅРґРµРєСЃ РґР»СЏ СЂРµР»РёРєРІРёР№ (С‚РѕР»СЊРєРѕ РЅРµ-junk РїСЂРµРґРјРµС‚РѕРІ)
    await db.execute({
      sql: 'CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_guild_item ON user_inventory(guild_id, item_id) WHERE item_id != \'junk\'',
      args: [],
    });
    console.log('[Migrate] Created unique index: idx_unique_guild_item');

    // РЎРѕР·РґР°С‘Рј С‚Р°Р±Р»РёС†Сѓ СЂС‹РЅРєР°
    const marketListingsCheck = await db.execute({
      sql: "SELECT name FROM sqlite_master WHERE type='table' AND name='market_listings'",
      args: [],
    });

    if (marketListingsCheck.rows.length === 0) {
      await db.execute({
        sql: `CREATE TABLE market_listings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          guild_id TEXT NOT NULL,
          seller_id TEXT NOT NULL,
          inventory_id INTEGER NOT NULL,
          price INTEGER NOT NULL,
          created_at INTEGER NOT NULL
        )`,
        args: [],
      });
      await db.execute({
        sql: 'CREATE INDEX idx_market_listings_guild ON market_listings(guild_id)',
        args: [],
      });
      await db.execute({
        sql: 'CREATE INDEX idx_market_listings_seller ON market_listings(seller_id)',
        args: [],
      });
      console.log('[Migrate] Created table: market_listings');
    }

    // РЎРѕР·РґР°С‘Рј С‚Р°Р±Р»РёС†Сѓ РїСЂСЏРјС‹С… СЃРґРµР»РѕРє
    const directTradesCheck = await db.execute({
      sql: "SELECT name FROM sqlite_master WHERE type='table' AND name='direct_trades'",
      args: [],
    });

    if (directTradesCheck.rows.length === 0) {
      await db.execute({
        sql: `CREATE TABLE direct_trades (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          guild_id TEXT NOT NULL,
          sender_id TEXT NOT NULL,
          target_id TEXT NOT NULL,
          inventory_id INTEGER NOT NULL,
          price INTEGER NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          created_at INTEGER NOT NULL
        )`,
        args: [],
      });
      await db.execute({
        sql: 'CREATE INDEX idx_direct_trades_guild ON direct_trades(guild_id)',
        args: [],
      });
      console.log('[Migrate] Created table: direct_trades');
    }

    // ============================================
    // РњРёРіСЂР°С†РёСЏ 007: РўР°Р±Р»РёС†Р° user_cosmetics (Р­С‚Р°Рї 5 - РљР°СЃС‚РѕРјРёР·Р°С†РёСЏ РєР°СЂС‚РѕС‡РєРё)
    // ============================================
    const userCosmeticsCheck = await db.execute({
      sql: "SELECT name FROM sqlite_master WHERE type='table' AND name='user_cosmetics'",
      args: [],
    });

    if (userCosmeticsCheck.rows.length === 0) {
      await db.execute({
        sql: `CREATE TABLE user_cosmetics (
          user_id TEXT NOT NULL,
          guild_id TEXT NOT NULL,
          theme_id TEXT DEFAULT 'default',
          title_id TEXT DEFAULT 'РќРѕРІРёС‡РѕРє',
          badges TEXT DEFAULT '[]',
          PRIMARY KEY (user_id, guild_id)
        )`,
        args: [],
      });
      console.log('[Migrate] Created table: user_cosmetics');
    }

    // ============================================
    // РњРёРіСЂР°С†РёСЏ 008: РўР°Р±Р»РёС†Р° user_achievements (Р­С‚Р°Рї 6 - РЎРёСЃС‚РµРјР° РґРѕСЃС‚РёР¶РµРЅРёР№)
    // ============================================
    const userAchievementsCheck = await db.execute({
      sql: "SELECT name FROM sqlite_master WHERE type='table' AND name='user_achievements'",
      args: [],
    });

    if (userAchievementsCheck.rows.length === 0) {
      await db.execute({
        sql: `CREATE TABLE user_achievements (
          user_id TEXT NOT NULL,
          guild_id TEXT NOT NULL,
          achievement_id TEXT NOT NULL,
          unlocked_at INTEGER NOT NULL,
          PRIMARY KEY (user_id, guild_id, achievement_id)
        )`,
        args: [],
      });
      console.log('[Migrate] Created table: user_achievements');
    }

    // ============================================
    // РњРёРіСЂР°С†РёСЏ 009: РўР°Р±Р»РёС†Р° achievements_pool (Р­С‚Р°Рї 6 - РЎРёСЃС‚РµРјР° РґРѕСЃС‚РёР¶РµРЅРёР№)
    // ============================================
    const achievementsPoolCheck = await db.execute({
      sql: "SELECT name FROM sqlite_master WHERE type='table' AND name='achievements_pool'",
      args: [],
    });

    if (achievementsPoolCheck.rows.length === 0) {
      await db.execute({
        sql: `CREATE TABLE achievements_pool (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          description TEXT NOT NULL,
          quote TEXT NOT NULL,
          reward INTEGER NOT NULL
        )`,
        args: [],
      });
      console.log('[Migrate] Created table: achievements_pool');

      // Р—Р°РїРѕР»РЅСЏРµРј С‚Р°Р±Р»РёС†Сѓ РґРѕСЃС‚РёР¶РµРЅРёСЏРјРё РёР· РєРѕРЅСЃС‚Р°РЅС‚С‹
      const achievements = [
        // Р’РµРґСЊРјР°Рє 3
        ['witcher_plod', 'рџђє РЁРµРІРµР»РёСЃСЊ, РџР»РѕС‚РІР°!', 'РћС‚РїСЂР°РІРёС‚СЊ СЃРѕРѕР±С‰РµРЅРёРµ СЂРѕРІРЅРѕ С‡РµСЂРµР· 30-35 СЃРµРє РїРѕСЃР»Рµ РїСЂРµРґС‹РґСѓС‰РµРіРѕ', 'Р›СЋС‚РёРє, Р±Р»#С‚СЊ...', 150],
        ['witcher_gwent', 'рџѓЏ Р’ Р“РІРёРЅС‚ РЅРµ СЃС‹РіСЂР°РµС€СЊ?', 'РЎС‹РіСЂР°С‚СЊ 3 РґСѓСЌР»Рё Р·Р° РѕРґРёРЅ РґРµРЅСЊ', 'РљРёРІР°РµС‚ РјРѕР»С‡Р° Рё РґРѕСЃС‚Р°С‘С‚ РєРѕР»РѕРґСѓ РљРѕСЂРѕР»РµРІСЃС‚РІ РЎРµРІРµСЂР°.', 200],
        ['witcher_damn', 'рџђє Р—Р°СЂР°Р·Р°...', 'РџСЂРѕРёРіСЂР°С‚СЊ РґСѓСЌР»СЊ СЃ Р±СЂРѕСЃРєРѕРј РєСѓР±РёРєР° РјРµРЅСЊС€Рµ 10', 'Р’РµС‚РµСЂ РІРѕРµС‚...', 100],
        ['witcher_blaviken', 'вљ”пёЏ РњСЏСЃРЅРёРє РёР· Р‘Р»Р°РІРёРєРµРЅР°', 'Р’С‹РёРіСЂР°С‚СЊ 3 РґСѓСЌР»Рё РїРѕРґСЂСЏРґ Р±РµР· РїРѕСЂР°Р¶РµРЅРёР№', 'Р•СЃР»Рё РїСЂРёС…РѕРґРёС‚СЃСЏ РІС‹Р±РёСЂР°С‚СЊ РјРµР¶РґСѓ Р·Р»РѕРј Рё Р·Р»РѕРј...', 350],
        ['witcher_coin', 'рџЄ™ Р§РµРєР°РЅРЅР°СЏ РјРѕРЅРµС‚Р°', 'Р—Р°С„РёРєСЃРёСЂРѕРІР°С‚СЊ СЂРѕРІРЅРѕ 1000, 2000, 3000 РёР»Рё 5000 XP', 'Р—Р°С‡С‚С‘С‚СЃСЏ РІСЃС‘ СЌС‚Рѕ РІР°Рј!', 250],
        // Red Dead Redemption 2
        ['rdr_plan', 'рџ¤  РЈ РјРµРЅСЏ РµСЃС‚СЊ РџР›РђРќ!', 'РќР°РєРѕРїРёС‚СЊ 3000+ XP, РЅРё СЂР°Р·Сѓ РЅРµ РїСЂРѕРёРіСЂР°РІ РІ РґСѓСЌР»СЏС…', 'РќР°Рј РїСЂРѕСЃС‚Рѕ РЅСѓР¶РЅРѕ Р±РѕР»СЊС€Рµ РґРµРЅРµРі, РђСЂС‚СѓСЂ!', 300],
        ['rdr_lenny', 'рџЌ» Р›РРРРќРќРРРР!', 'РћС‚РїСЂР°РІРёС‚СЊ РєР°РїСЃ-СЃРѕРѕР±С‰РµРЅРёРµ 10+ Р±СѓРєРІ РЅРѕС‡СЊСЋ СЃ 02:00 РґРѕ 05:00', 'YNNEL?! Р“Р”Р• РўР«, Р›Р•РќРќР?!', 150],
        ['rdr_quickdraw', 'рџЋЇ Р‘С‹СЃС‚СЂР°СЏ СЂСѓРєР°', 'Р’С‹РёРіСЂР°С‚СЊ РґСѓСЌР»СЊ СЃ Р±СЂРѕСЃРєРѕРј 95+', 'РќР° СЌС‚РѕРј СЃРµСЂРІРµСЂРµ РјРµСЃС‚Рѕ С‚РѕР»СЊРєРѕ РґР»СЏ РѕРґРЅРѕРіРѕ.', 250],
        ['rdr_tahiti', 'рџҐ­ Р‘РёР»РµС‚ РЅР° РўР°РёС‚Рё', 'РџСЂРѕРІРµСЃС‚Рё Р±РѕР»РµРµ 5 С‡Р°СЃРѕРІ РІ РІРѕР№СЃРµ Р·Р° РґРµРЅСЊ', 'РњС‹ Р±СѓРґРµРј РІС‹СЂР°С‰РёРІР°С‚СЊ РјР°РЅРіРѕ Рё Р¶РёС‚СЊ РїСЂРёРїРµРІР°СЋС‡Рё.', 300],
        ['rdr_tax', 'рџ’° РљР°РїРёС‚Р°Р»РёР·Рј, РђСЂС‚СѓСЂ', 'РЎР¶РµС‡СЊ Р±РѕР»РµРµ 200 XP РЅР° РЅР°Р»РѕРіРµ СЃ РґСѓСЌР»РµР№', 'РњС‹ РІРѕСЂС‹ РІ РјРёСЂРµ, РєРѕС‚РѕСЂРѕРјСѓ РјС‹ Р±РѕР»СЊС€Рµ РЅРµ РЅСѓР¶РЅС‹.', 200],
        // Р’Р»Р°РґРёРІРѕСЃС‚РѕРє Рё Р”Р’
        ['vlad_2000', 'рџЊЉ Р’Р»Р°РґРёРІРѕСЃС‚РѕРє 2000', 'РћРєР°Р·Р°С‚СЊСЃСЏ СЂРѕРІРЅРѕ СЃ 2000 XP РЅР° Р±Р°Р»Р°РЅСЃРµ', 'РЈС…РѕРґРёРј, СѓС…РѕРґРёРј, СѓС…РѕРґСЏС‚ РєРѕРјРµС‚С‹...', 200],
        ['vlad_midnight', 'вљ“ РџРѕР»РЅРѕС‡СЊ РЅР° Р­РіРµСЂС€РµР»СЊРґРµ', 'РћС‚РїСЂР°РІРёС‚СЊ СЃРѕРѕР±С‰РµРЅРёРµ СЂРѕРІРЅРѕ РІ 00:00 (Р’Р»Р°РґРёРІРѕСЃС‚РѕРє)', 'РњР°СЏРє СЃРІРµС‚РёС‚, РєРІРµСЃС‚С‹ СЃР±СЂРѕСЃРёР»РёСЃСЊ.', 200],
        ['vlad_pyanse', 'рџҐџ РџСЏРЅ-СЃРµ РЅР° Р›СѓРіРѕРІРѕР№', 'Р‘С‹С‚СЊ Р°РєС‚РёРІРЅС‹Рј РІ С‡Р°С‚Рµ РІРѕ РІСЂРµРјСЏ РѕР±РµРґР° СЃ 12:00 РґРѕ 13:00 (Р’Р»Р°РґРёРІРѕСЃС‚РѕРє)', 'РЎ РїС‹Р»Сѓ СЃ Р¶Р°СЂСѓ, СЃ РїРµСЂС†РµРј Рё РєР°РїСѓСЃС‚РѕР№.', 120],
        ['vlad_typhoon', 'рџЊЄпёЏ РўР°Р№С„СѓРЅ РїСЂРѕС€С‘Р» СЃС‚РѕСЂРѕРЅРѕР№', 'РЎРїР°СЃС‚Рё СЃС‚СЂРёРє СЃ РїРѕРјРѕС‰СЊСЋ Р·Р°РјРѕСЂРѕР·РєРё', 'РћРїСЏС‚СЊ РїРµСЂРµРґР°РІР°Р»Рё С€С‚РѕСЂРјРѕРІРѕРµ, РЅРѕ РѕР±РѕС€Р»РѕСЃСЊ.', 250],
        ['vlad_right_hand', 'рџљ— РСЃС‚РёРЅРЅС‹Р№ РїСЂР°РІРѕСЂСѓР»СЊС‰РёРє', 'РЎРјРµРЅРёС‚СЊ С‚РµРјСѓ РЅР° РљРёР±РµСЂРїР°РЅРє РёР»Рё РњР°РіРјСѓ', 'Р СѓР»СЊ РІ Р±Р°СЂРґР°С‡РєРµ, РµРґРµРј Р±РѕРєРѕРј.', 100],
        ['vlad_golden_horn', 'рџЊ‰ РҐРѕР·СЏРёРЅ Р—РѕР»РѕС‚РѕРіРѕ Р РѕРіР°', 'Р—Р°РЅСЏС‚СЊ 1-Рµ РјРµСЃС‚Рѕ РІ Р»РёРґРµСЂР±РѕСЂРґРµ СЃРµСЂРІРµСЂР°', 'РњРѕСЃС‚ РїРѕСЃС‚СЂРѕРёР»Рё, СЃРµСЂРІРµСЂ РґРµСЂР¶РёРј.', 500],
        // Half-Life 2
        ['hl_wakeup', 'рџљ† РџСЂРѕСЃРЅРёС‚РµСЃСЊ Рё РїРѕРїРѕР№С‚Рµ', 'РћС‚РїСЂР°РІРёС‚СЊ СЃРѕРѕР±С‰РµРЅРёРµ СЃ 06:00 РґРѕ 07:00 СѓС‚СЂР° (Р’Р»Р°РґРёРІРѕСЃС‚РѕРє)', 'РќСѓР¶РЅС‹Р№ С‡РµР»РѕРІРµРє РЅРµ РІ С‚РѕРј РјРµСЃС‚Рµ...', 150],
        ['hl_can', 'рџҐ« РџРѕРґРЅРёРјРё СЌС‚Сѓ Р±Р°РЅРєСѓ', 'Р’С‹РїРѕР»РЅРёС‚СЊ СЃРІРѕР№ РїРµСЂРІС‹Р№ РµР¶РµРґРЅРµРІРЅС‹Р№ РєРІРµСЃС‚', 'Рђ С‚РµРїРµСЂСЊ Р±СЂРѕСЃСЊ РµС‘ РІ СѓСЂРЅСѓ.', 100],
        ['hl_water', 'рџ’§ РќРµ РїРµР№С‚Рµ РІРѕРґСѓ', 'РџСЂРѕРІРµСЃС‚Рё 2 С‡Р°СЃР° РЅРµРїСЂРµСЂС‹РІРЅРѕ РІ РІРѕР№СЃРµ', 'РћРЅРё С‚СѓРґР° С‡С‚Рѕ-С‚Рѕ РїРѕРґРјРµС€РёРІР°СЋС‚...', 250],
        ['hl_crowbar', 'рџЄ“ РњРѕРЅС‚РёСЂРѕРІРєР° РїСЂРѕС‚РёРІ СЃС‚СЂР°Р№РґРµСЂР°', 'РџРѕР±РµРґРёС‚СЊ РІ РґСѓСЌР»Рё РѕРїРїРѕРЅРµРЅС‚Р°, Сѓ РєРѕС‚РѕСЂРѕРіРѕ СѓСЂРѕРІРµРЅСЊ РІС‹С€Рµ С‚РІРѕРµРіРѕ РЅР° 2+', 'Р¤РёР·РёРєР° Source РЅР° С‚РІРѕРµР№ СЃС‚РѕСЂРѕРЅРµ.', 300],
        ['hl_airdrop', 'рџ“¦ РЇС‰РёРє СЃРѕРїСЂРѕС‚РёРІР»РµРЅРёСЏ', 'РџРµСЂРІС‹Рј Р·Р°Р±СЂР°С‚СЊ РєРѕРЅС‚РµР№РЅРµСЂ РІРѕР№СЃ-РґСЂРѕРїР°', 'РЎРёРіРЅР°Р»СЊРЅР°СЏ СЂР°РєРµС‚Р° СЃСЂР°Р±РѕС‚Р°Р»Р°.', 150],
        // РњРµРјС‹ / РќР°РІР°Р»СЊРЅС‹Р№
        ['fbk_hello', 'рџ“Ј РџСЂРёРІРµС‚, СЌС‚Рѕ РќР°РІР°Р»СЊРЅС‹Р№', 'РќР°РїРёСЃР°С‚СЊ СЃРѕРѕР±С‰РµРЅРёРµ РїРѕСЃР»Рµ 3+ РґРЅРµР№ РѕС‚СЃСѓС‚СЃС‚РІРёСЏ РЅР° СЃРµСЂРІРµСЂРµ', 'РЇ РЅРµ РјРѕР»С‡Р°Р», СЏ РїСЂРѕСЃС‚Рѕ Р±С‹Р» РІ РѕС„С„Р»Р°Р№РЅРµ!', 150],
        ['fbk_sandwich', 'рџҐЄ РќРµ Р±СѓС‚РµСЂР±СЂРѕРґ', 'РЈРґРµСЂР¶Р°С‚СЊ СЃС‚СЂРёРє Р°РєС‚РёРІРЅРѕСЃС‚Рё СЂРѕРІРЅРѕ 14 РґРЅРµР№', 'РЎС‚СЂРёРє вЂ” РѕРЅ С‡С‚Рѕ, Р±СѓС‚РµСЂР±СЂРѕРґ, С‡С‚РѕР±С‹ РµРіРѕ СЃР±СЂР°СЃС‹РІР°С‚СЊ?', 250],
        ['fbk_final_battle', 'вљ”пёЏ Р¤РёРЅР°Р»СЊРЅР°СЏ Р±РёС‚РІР°', 'РЎС‹РіСЂР°С‚СЊ РґСѓСЌР»СЊ СЃРѕ СЃС‚Р°РІРєРѕР№ РѕС‚ 1000 XP', 'Р¤РёРЅР°Р»СЊРЅР°СЏ Р±РёС‚РІР° РґРѕР±СЂР° СЃ РЅРµР№С‚СЂР°Р»РёС‚РµС‚РѕРј!', 300],
        ['fbk_investigation', 'рџ•µпёЏ РљРѕРјР°РЅРґР° СЂР°СЃСЃР»РµРґРѕРІР°С‚РµР»РµР№', 'РџРѕСЃРјРѕС‚СЂРµС‚СЊ РєР°СЂС‚РѕС‡РєРё /rank 5 СЂР°Р·РЅС‹С… Р»СЋРґРµР№ Р·Р° РґРµРЅСЊ', 'РњС‹ РЅР°С€Р»Рё Сѓ РЅРµРіРѕ РЅРµР·Р°РґРµРєР»Р°СЂРёСЂРѕРІР°РЅРЅС‹Р№ СѓСЂРѕРІРµРЅСЊ.', 150],
        ['fbk_prb', 'вЂпёЏ РџСЂРµРєСЂР°СЃРЅС‹Р№ РЎРµСЂРІРµСЂ Р‘СѓРґСѓС‰РµРіРѕ', 'Р—Р°РєСЂС‹С‚СЊ РІСЃРµ 3 РґРµР№Р»РёРєР° Р·Р° РѕРґРёРЅ РґРµРЅСЊ', 'Р РѕСЃСЃРёСЏ Р±СѓРґРµС‚ СЃС‡Р°СЃС‚Р»РёРІРѕР№, Р° РѕРїС‹С‚ РЅР°С„Р°СЂРјР»РµРЅ.', 250],
        // РљР»Р°СЃСЃРёРєР°
        ['lucky_777', 'рџЋ° РўСЂРё С‚РѕРїРѕСЂР°', 'Р—Р°С„РёРєСЃРёСЂРѕРІР°С‚СЊ СЂРѕРІРЅРѕ 777 XP РЅР° Р±Р°Р»Р°РЅСЃРµ', 'РџРѕРґРЅСЏР» Р±Р°Р±Р»Р°, С‚РµРїРµСЂСЊ РІ С‚РѕРїРµ.', 250],
        ['casino_house', 'рџЋІ РљР°Р·РёРЅРѕ РІСЃРµРіРґР° РІ РїР»СЋСЃРµ', 'РЎР¶РµС‡СЊ Р±РѕР»РµРµ 100 XP РЅР°Р»РѕРіР° РІ РѕРґРЅРѕР№ РґСѓСЌР»Рё', 'РљР°СЂС‚С‹ СЃ СЃР°РјРѕРіРѕ РЅР°С‡Р°Р»Р° Р±С‹Р»Рё РєСЂР°РїР»РµРЅС‹РјРё.', 150],
      ];
      const placeholders = achievements.map(() => '(?, ?, ?, ?, ?)').join(', ');
      const values = achievements.flat();
      await db.execute({
        sql: `INSERT INTO achievements_pool (id, title, description, quote, reward) VALUES ${placeholders}`,
        args: values,
      });
      console.log('[Migrate] Populated achievements_pool table');
    }

    // ============================================
    // РњРёРіСЂР°С†РёСЏ 004: РўР°Р±Р»РёС†Р° duels (Р­С‚Р°Рї 3)
    // ============================================
    const duelsCheck = await db.execute({
      sql: "SELECT name FROM sqlite_master WHERE type='table' AND name='duels'",
      args: [],
    });

    if (duelsCheck.rows.length === 0) {
      await db.execute({
        sql: `CREATE TABLE duels (
          id TEXT PRIMARY KEY,
          guild_id TEXT NOT NULL,
          challenger_id TEXT NOT NULL,
          opponent_id TEXT NOT NULL,
          bet_amount INTEGER NOT NULL,
          status TEXT DEFAULT 'pending',
          created_at INTEGER NOT NULL,
          message_id TEXT DEFAULT NULL,
          channel_id TEXT DEFAULT NULL
        )`,
        args: [],
      });
      await db.execute({
        sql: 'CREATE INDEX idx_duels_guild_status ON duels(guild_id, status)',
        args: [],
      });
      await db.execute({
        sql: 'CREATE INDEX idx_duels_opponent ON duels(opponent_id)',
        args: [],
      });
      console.log('[Migrate] Created table: duels');
    }

    // ============================================
    // РњРёРіСЂР°С†РёСЏ 020: РљРѕР»РѕРЅРєРё message_id Рё channel_id РґР»СЏ РґСѓСЌР»РµР№ (Р­С‚Р°Рї 11+)
    // ============================================
    try {
      const duelsColumnsCheck = await db.execute({
        sql: "PRAGMA table_info(duels)",
        args: [],
      });
      const duelsColumns = (duelsColumnsCheck.rows || []).map((row: any) => row.name as string);

      if (!duelsColumns.includes('message_id')) {
        await db.execute({
          sql: 'ALTER TABLE duels ADD COLUMN message_id TEXT DEFAULT NULL',
          args: [],
        });
        console.log('[Migrate] Added column: message_id to duels');
      }

      if (!duelsColumns.includes('channel_id')) {
        await db.execute({
          sql: 'ALTER TABLE duels ADD COLUMN channel_id TEXT DEFAULT NULL',
          args: [],
        });
        console.log('[Migrate] Added column: channel_id to duels');
      }
    } catch (err: any) {
      console.error('[Migrate] Error adding duel columns (ignored):', err);
    }

    // ============================================
    // РњРёРіСЂР°С†РёСЏ 005: РўР°Р±Р»РёС†Р° guild_events (Р­С‚Р°Рї 4 - Happy Hours)
    // ============================================
    const guildEventsCheck = await db.execute({
      sql: "SELECT name FROM sqlite_master WHERE type='table' AND name='guild_events'",
      args: [],
    });

    if (guildEventsCheck.rows.length === 0) {
      await db.execute({
        sql: `CREATE TABLE guild_events (
          guild_id TEXT NOT NULL,
          event_type TEXT NOT NULL,
          ends_at INTEGER NOT NULL,
          multiplier REAL NOT NULL,
          PRIMARY KEY (guild_id, event_type)
        )`,
        args: [],
      });
      await db.execute({
        sql: 'CREATE INDEX idx_guild_events_active ON guild_events(event_type, ends_at)',
        args: [],
      });
      console.log('[Migrate] Created table: guild_events');
    }

    // ============================================
    // РњРёРіСЂР°С†РёСЏ 006: РўР°Р±Р»РёС†Р° air_drops (Р­С‚Р°Рї 4 - Voice Drops)
    // ============================================
    const airDropsCheck = await db.execute({
      sql: "SELECT name FROM sqlite_master WHERE type='table' AND name='air_drops'",
      args: [],
    });

    if (airDropsCheck.rows.length === 0) {
      await db.execute({
        sql: `CREATE TABLE air_drops (
          id TEXT PRIMARY KEY,
          guild_id TEXT NOT NULL,
          channel_id TEXT NOT NULL,
          reward_xp INTEGER NOT NULL,
          reward_type TEXT NOT NULL,
          claimed_by TEXT DEFAULT NULL,
          claimed_at INTEGER DEFAULT NULL,
          created_at INTEGER NOT NULL
        )`,
        args: [],
      });
      await db.execute({
        sql: 'CREATE INDEX idx_air_drops_channel ON air_drops(channel_id)',
        args: [],
      });
      await db.execute({
        sql: 'CREATE INDEX idx_air_drops_claimable ON air_drops(claimed_by, created_at)',
        args: [],
      });
      console.log('[Migrate] Created table: air_drops');
    }

    // ============================================
    // РњРёРіСЂР°С†РёСЏ 002: РўР°Р±Р»РёС†С‹ РµР¶РµРґРЅРµРІРЅРѕР№ Р°РєС‚РёРІРЅРѕСЃС‚Рё Рё РєРІРµСЃС‚РѕРІ
    // ============================================
    const dailyActivityCheck = await db.execute({
      sql: "SELECT name FROM sqlite_master WHERE type='table' AND name='user_daily_activity'",
      args: [],
    });

    if (dailyActivityCheck.rows.length === 0) {
      await db.execute({
        sql: `CREATE TABLE user_daily_activity (
          user_id TEXT NOT NULL,
          guild_id TEXT NOT NULL,
          activity_date TEXT NOT NULL,
          messages_count INTEGER NOT NULL DEFAULT 0,
          voice_seconds INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (user_id, guild_id, activity_date)
        )`,
        args: [],
      });
      console.log('[Migrate] Created table: user_daily_activity');
    }

    const questsPoolCheck = await db.execute({
      sql: "SELECT name FROM sqlite_master WHERE type='table' AND name='quests_pool'",
      args: [],
    });

    if (questsPoolCheck.rows.length === 0) {
      await db.execute({
        sql: `CREATE TABLE quests_pool (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          description TEXT NOT NULL,
          quest_type TEXT NOT NULL,
          target_value INTEGER NOT NULL,
          reward_xp INTEGER NOT NULL,
          is_active INTEGER NOT NULL DEFAULT 1
        )`,
        args: [],
      });
      console.log('[Migrate] Created table: quests_pool');
    }

    const questsDailyCheck = await db.execute({
      sql: "SELECT name FROM sqlite_master WHERE type='table' AND name='quests_daily'",
      args: [],
    });

    if (questsDailyCheck.rows.length === 0) {
      await db.execute({
        sql: `CREATE TABLE quests_daily (
          id TEXT PRIMARY KEY,
          guild_id TEXT NOT NULL,
          quest_id TEXT NOT NULL,
          active_date TEXT NOT NULL,
          target INTEGER NOT NULL,
          reward_xp INTEGER NOT NULL
        )`,
        args: [],
      });
      console.log('[Migrate] Created table: quests_daily');
    }

    const userQuestProgressCheck = await db.execute({
      sql: "SELECT name FROM sqlite_master WHERE type='table' AND name='user_quest_progress'",
      args: [],
    });

    if (userQuestProgressCheck.rows.length === 0) {
      await db.execute({
        sql: `CREATE TABLE user_quest_progress (
          user_id TEXT NOT NULL,
          guild_id TEXT NOT NULL,
          quest_daily_id TEXT NOT NULL,
          current_progress INTEGER NOT NULL DEFAULT 0,
          completed_at INTEGER DEFAULT NULL,
          PRIMARY KEY (user_id, guild_id, quest_daily_id)
        )`,
        args: [],
      });
      console.log('[Migrate] Created table: user_quest_progress');
    }

    // ============================================
    // РњРёРіСЂР°С†РёСЏ 010: РўР°Р±Р»РёС†С‹ СЃРµР·РѕРЅРѕРІ Рё РЅРµРґРµР»СЊ (Р­С‚Р°Рї 7)
    // ============================================

    // Р”РѕР±Р°РІР»СЏРµРј РєРѕР»РѕРЅРєСѓ season_xp РІ users
    if (!columns.includes('season_xp')) {
      await db.execute({
        sql: 'ALTER TABLE users ADD COLUMN season_xp INTEGER NOT NULL DEFAULT 0',
        args: [],
      });
      console.log('[Migrate] Added column: season_xp');
    }

    // РўР°Р±Р»РёС†Р° weekly_activity РґР»СЏ РµР¶РµРЅРµРґРµР»СЊРЅРѕР№ Р°РєС‚РёРІРЅРѕСЃС‚Рё
    const weeklyActivityCheck = await db.execute({
      sql: "SELECT name FROM sqlite_master WHERE type='table' AND name='weekly_activity'",
      args: [],
    });

    if (weeklyActivityCheck.rows.length === 0) {
      await db.execute({
        sql: `CREATE TABLE weekly_activity (
          user_id TEXT NOT NULL,
          guild_id TEXT NOT NULL,
          week_key TEXT NOT NULL,
          xp_earned INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (user_id, guild_id, week_key)
        )`,
        args: [],
      });
      console.log('[Migrate] Created table: weekly_activity');
    }

    // РўР°Р±Р»РёС†Р° season_archive РґР»СЏ Р°СЂС…РёРІР° СЃРµР·РѕРЅРѕРІ
    const seasonArchiveCheck = await db.execute({
      sql: "SELECT name FROM sqlite_master WHERE type='table' AND name='season_archive'",
      args: [],
    });

    if (seasonArchiveCheck.rows.length === 0) {
      await db.execute({
        sql: `CREATE TABLE season_archive (
          id TEXT PRIMARY KEY,
          guild_id TEXT NOT NULL,
          season_name TEXT NOT NULL,
          user_id TEXT NOT NULL,
          rank_pos INTEGER NOT NULL,
          season_xp INTEGER NOT NULL,
          ended_at INTEGER NOT NULL
        )`,
        args: [],
      });
      console.log('[Migrate] Created table: season_archive');
    }

    // РџСЂРѕРІРµСЂРєР° С‚Р°Р±Р»РёС†С‹ guild_settings
    const settingsCheck = await db.execute({
      sql: "SELECT name FROM sqlite_master WHERE type='table' AND name='guild_settings'",
      args: [],
    });

    if (settingsCheck.rows.length === 0) {
      await db.execute({
        sql: `CREATE TABLE guild_settings (
          guild_id TEXT PRIMARY KEY,
          xp_per_message INTEGER NOT NULL DEFAULT 15,
          message_cooldown_seconds INTEGER NOT NULL DEFAULT 30
        )`,
        args: [],
      });
      console.log('[Migrate] Created table: guild_settings');
    }

    // ============================================
    // РњРёРіСЂР°С†РёСЏ 022: РўР°Р±Р»РёС†С‹ Р±РёСЂР¶Рё РєРѕРјРїР°РЅРёР№
    // (server_reserve, companies, company_shares, company_crises)
    // ============================================
    await db.execute({
      sql: `CREATE TABLE IF NOT EXISTS server_reserve (
        guild_id TEXT PRIMARY KEY,
        balance INTEGER NOT NULL DEFAULT 0
      )`,
      args: [],
    });

    await db.execute({
      sql: `CREATE TABLE IF NOT EXISTS companies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        name TEXT NOT NULL,
        ticker TEXT NOT NULL,
        description TEXT DEFAULT '',
        treasury INTEGER NOT NULL DEFAULT 500,
        total_shares INTEGER NOT NULL DEFAULT 100,
        available_shares INTEGER NOT NULL DEFAULT 49,
        last_growth_day TEXT DEFAULT NULL,
        frozen INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        UNIQUE(guild_id, ticker),
        UNIQUE(guild_id, owner_id)
      )`,
      args: [],
    });

    await db.execute({
      sql: `CREATE TABLE IF NOT EXISTS company_shares (
        user_id TEXT NOT NULL,
        guild_id TEXT NOT NULL,
        company_id INTEGER NOT NULL,
        shares_count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY(user_id, company_id)
      )`,
      args: [],
    });

    await db.execute({
      sql: `CREATE TABLE IF NOT EXISTS company_crises (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL,
        guild_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        message_id TEXT NOT NULL UNIQUE,
        kind TEXT NOT NULL DEFAULT 'finance',
        scenario_text TEXT NOT NULL DEFAULT '',
        player_reply TEXT DEFAULT NULL,
        outcome_text TEXT DEFAULT NULL,
        treasury_delta INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      )`,
      args: [],
    });

    await db.execute({
      sql: 'CREATE INDEX IF NOT EXISTS idx_companies_guild ON companies(guild_id)',
      args: [],
    });
    await db.execute({
      sql: 'CREATE INDEX IF NOT EXISTS idx_shares_guild_user ON company_shares(guild_id, user_id)',
      args: [],
    });
    await db.execute({
      sql: 'CREATE INDEX IF NOT EXISTS idx_crises_status_exp ON company_crises(status, expires_at)',
      args: [],
    });
    await db.execute({
      sql: 'CREATE INDEX IF NOT EXISTS idx_crises_company ON company_crises(company_id, status)',
      args: [],
    });
    console.log('[Migrate] Exchange tables ensured (server_reserve, companies, company_shares, company_crises)');

    // ============================================
    // РњРёРіСЂР°С†РёСЏ 024: РєРѕР»РѕРЅРєРё РЅР°СЃС‚СЂРѕРµРЅРёСЏ РєРѕРјРїР°РЅРёР№ (mood_bps, mood_updated_at).
    // ALTER TABLE РёРґРµРјРїРѕС‚РµРЅС‚РµРЅ: СЃРЅР°С‡Р°Р»Р° PRAGMA table_info(companies).
    // РўР°Р±Р»РёС†Р° companies РіР°СЂР°РЅС‚РёСЂРѕРІР°РЅРЅРѕ СЃСѓС‰РµСЃС‚РІСѓРµС‚ вЂ” СЃРѕР·РґР°РЅР° РІС‹С€Рµ (РјРёРіСЂР°С†РёСЏ 022).
    // ============================================
    const companiesColumnsCheck = await db.execute({
      sql: "PRAGMA table_info(companies)",
      args: [],
    });
    const companiesColumns = (companiesColumnsCheck.rows || []).map((row: any) => row.name as string);

    if (!companiesColumns.includes('mood_bps')) {
      await db.execute({
        sql: 'ALTER TABLE companies ADD COLUMN mood_bps INTEGER NOT NULL DEFAULT 0',
        args: [],
      });
      console.log('[Migrate] Added column: mood_bps to companies');
    }

    if (!companiesColumns.includes('mood_updated_at')) {
      await db.execute({
        sql: 'ALTER TABLE companies ADD COLUMN mood_updated_at INTEGER NOT NULL DEFAULT 0',
        args: [],
      });
      console.log('[Migrate] Added column: mood_updated_at to companies');
    }

    // ============================================
    // РњРёРіСЂР°С†РёСЏ 025: РёСЃС‚РѕСЂРёСЏ Р±РёСЂР¶Рё Рё outbox РїСѓР±Р»РёС‡РЅС‹С… СЃРѕР±С‹С‚РёР№
    // (company_trades, company_nav_history, market_events, exchange_guild_state).
    // company_trades Рё company_nav_history РїСЂРё СЃРµР·РѕРЅРЅРѕР№ Р»РёРєРІРёРґР°С†РёРё РќР• СѓРґР°Р»СЏСЋС‚СЃСЏ:
    // РЅСѓР¶РЅС‹ РґР»СЏ СЂРµР№С‚РёРЅРіР° СЃРµР·РѕРЅР°; С‡РёСЃС‚РєР° вЂ” РїРѕ РІРѕР·СЂР°СЃС‚Сѓ, РѕС‚РґРµР»СЊРЅРѕР№ Р·Р°РґР°С‡РµР№.
    // ============================================
    await db.execute({
      sql: `CREATE TABLE IF NOT EXISTS company_trades (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        company_id INTEGER NOT NULL,
        user_id TEXT NOT NULL,
        season_id TEXT NOT NULL,
        side TEXT NOT NULL CHECK(side IN ('buy','sell')),
        shares INTEGER NOT NULL,
        base_amount INTEGER NOT NULL,
        coins INTEGER NOT NULL,
        treasury_after INTEGER NOT NULL,
        circulating_after INTEGER NOT NULL,
        mood_bps_after INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      )`,
      args: [],
    });

    await db.execute({
      sql: 'CREATE INDEX IF NOT EXISTS idx_trades_company_time ON company_trades(company_id, created_at)',
      args: [],
    });
    await db.execute({
      sql: 'CREATE INDEX IF NOT EXISTS idx_trades_guild_season_user ON company_trades(guild_id, season_id, user_id)',
      args: [],
    });

    await db.execute({
      sql: `CREATE TABLE IF NOT EXISTS company_nav_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        company_id INTEGER NOT NULL,
        ts INTEGER NOT NULL,
        treasury INTEGER NOT NULL,
        circulating INTEGER NOT NULL,
        mood_bps INTEGER NOT NULL DEFAULT 0,
        reason TEXT NOT NULL CHECK(reason IN ('create','buy','sell','growth','crisis'))
      )`,
      args: [],
    });

    await db.execute({
      sql: 'CREATE INDEX IF NOT EXISTS idx_nav_history_company_time ON company_nav_history(company_id, ts)',
      args: [],
    });

    // Outbox: СЃРѕР±С‹С‚РёСЏ РїРёС€СѓС‚СЃСЏ РІ С‚РѕР№ Р¶Рµ С‚СЂР°РЅР·Р°РєС†РёРё, С‡С‚Рѕ Рё РѕРїРµСЂР°С†РёСЏ,
    // РґРѕСЃС‚Р°РІР»СЏСЋС‚СЃСЏ РІ Discord РїРѕСЃР»Рµ РєРѕРјРјРёС‚Р°, С‡РёСЃС‚СЏС‚СЃСЏ РїРѕСЃР»Рµ РѕС‚РїСЂР°РІРєРё.
    await db.execute({
      sql: `CREATE TABLE IF NOT EXISTS market_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        sent_at INTEGER DEFAULT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT DEFAULT NULL
      )`,
      args: [],
    });

    await db.execute({
      sql: 'CREATE INDEX IF NOT EXISTS idx_market_events_outbox ON market_events(sent_at, id)',
      args: [],
    });

    // РЎР»СѓР¶РµР±РЅРѕРµ СЃРѕСЃС‚РѕСЏРЅРёРµ Р±РёСЂР¶Рё РїРѕ РіРёР»СЊРґРёРё (РєР°РЅР°Р» Р»РµРЅС‚С‹, РґР°Р№РґР¶РµСЃС‚С‹, СЂР°СЃРїРёСЃР°РЅРёРµ РєСЂРёР·РёСЃРѕРІ)
    await db.execute({
      sql: `CREATE TABLE IF NOT EXISTS exchange_guild_state (
        guild_id TEXT PRIMARY KEY,
        market_channel_id TEXT DEFAULT NULL,
        last_digest_day TEXT DEFAULT NULL,
        next_crisis_at INTEGER DEFAULT NULL
      )`,
      args: [],
    });

    console.log('[Migrate] Exchange history tables ensured (company_trades, company_nav_history, market_events, exchange_guild_state)');

    // ============================================
    // РњРёРіСЂР°С†РёСЏ 026: РєРѕР»РѕРЅРєРё РєСЂРёР·РёСЃРѕРІ (options_json, timeout_json, resolved_option,
    // resolved_at). ALTER TABLE РёРґРµРјРїРѕС‚РµРЅС‚РµРЅ: СЃРЅР°С‡Р°Р»Р° PRAGMA table_info(company_crises).
    // РўР°Р±Р»РёС†Р° company_crises РіР°СЂР°РЅС‚РёСЂРѕРІР°РЅРЅРѕ СЃСѓС‰РµСЃС‚РІСѓРµС‚ вЂ” СЃРѕР·РґР°РЅР° РІС‹С€Рµ (РјРёРіСЂР°С†РёСЏ 022).
    // ============================================
    const crisesColumnsCheck = await db.execute({
      sql: "PRAGMA table_info(company_crises)",
      args: [],
    });
    const crisesColumns = (crisesColumnsCheck.rows || []).map((row: any) => row.name as string);

    if (!crisesColumns.includes('options_json')) {
      await db.execute({
        sql: 'ALTER TABLE company_crises ADD COLUMN options_json TEXT DEFAULT NULL',
        args: [],
      });
      console.log('[Migrate] Added column: options_json to company_crises');
    }

    if (!crisesColumns.includes('timeout_json')) {
      await db.execute({
        sql: 'ALTER TABLE company_crises ADD COLUMN timeout_json TEXT DEFAULT NULL',
        args: [],
      });
      console.log('[Migrate] Added column: timeout_json to company_crises');
    }

    if (!crisesColumns.includes('resolved_option')) {
      await db.execute({
        sql: 'ALTER TABLE company_crises ADD COLUMN resolved_option TEXT DEFAULT NULL',
        args: [],
      });
      console.log('[Migrate] Added column: resolved_option to company_crises');
    }

    if (!crisesColumns.includes('resolved_at')) {
      await db.execute({
        sql: 'ALTER TABLE company_crises ADD COLUMN resolved_at INTEGER DEFAULT NULL',
        args: [],
      });
      console.log('[Migrate] Added column: resolved_at to company_crises');
    }

    // ============================================
    // РњРёРіСЂР°С†РёСЏ 027: РёС‚РѕРіРё СЃРµР·РѕРЅРѕРІ Р±РёСЂР¶Рё (РЁР°Рі 8 вЂ” СЃРµР·РѕРЅРЅС‹Р№ СЂРµР№С‚РёРЅРі ROI).
    // season_results Р·Р°РїРѕР»РЅСЏРµС‚СЃСЏ РїСЂРё СЃРµР·РѕРЅРЅРѕР№ Р»РёРєРІРёРґР°С†РёРё
    // (liquidateCompaniesOnSeasonChange) Рё С‡РёС‚Р°РµС‚СЃСЏ РєРѕРјР°РЅРґРѕР№ /exchange-top
    // РґР»СЏ Р·Р°РІРµСЂС€РёРІС€РёС…СЃСЏ СЃРµР·РѕРЅРѕРІ.
    // ============================================
    await db.execute({
      sql: `CREATE TABLE IF NOT EXISTS season_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        season_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK(kind IN ('investor', 'company')),
        rank INTEGER NOT NULL,
        target_id TEXT NOT NULL,
        label TEXT NOT NULL,
        invested INTEGER NOT NULL,
        returned INTEGER NOT NULL,
        roi_bps INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      )`,
      args: [],
    });

    await db.execute({
      sql: 'CREATE INDEX IF NOT EXISTS idx_season_results_lookup ON season_results(guild_id, season_id, kind, rank)',
      args: [],
    });
    console.log('[Migrate] Season results table ensured (season_results)');

    // ============================================
    // РњРёРіСЂР°С†РёСЏ 028: РЎРёСЃС‚РµРјР° РќРµРґРІРёР¶РёРјРѕСЃС‚Рё Рё Р“РѕСЂРѕРґР° (РЁР°Рі 1).
    // city_plots вЂ” 12 С„РёРєСЃРёСЂРѕРІР°РЅРЅС‹С… СѓС‡Р°СЃС‚РєРѕРІ РЅР° РіРёР»СЊРґРёСЋ (id 1-12);
    // zone/title Р±РµСЂСѓС‚СЃСЏ РёР· PLOTS_CATALOG РїРѕ id, price вЂ” С‚РµРєСѓС‰Р°СЏ С†РµРЅР°
    // СѓС‡Р°СЃС‚РєР° (РёР·РЅР°С‡Р°Р»СЊРЅРѕ base_price РёР· РєР°С‚Р°Р»РѕРіР°).
    // plot_auctions вЂ” Р°СѓРєС†РёРѕРЅС‹ РїСЂРѕРґР°Р¶Рё СѓС‡Р°СЃС‚РєРѕРІ.
    // ============================================
    await db.execute({
      sql: `CREATE TABLE IF NOT EXISTS city_plots (
        id INTEGER NOT NULL,
        guild_id TEXT NOT NULL,
        owner_type TEXT DEFAULT NULL CHECK(owner_type IN ('user', 'company')),
        owner_id TEXT DEFAULT NULL,
        building_type TEXT DEFAULT NULL,
        building_level INTEGER NOT NULL DEFAULT 0,
        price INTEGER NOT NULL DEFAULT 0,
        for_sale_price INTEGER DEFAULT NULL,
        unpaid_taxes_count INTEGER NOT NULL DEFAULT 0,
        last_tax_at INTEGER DEFAULT NULL,
        last_revenue_at INTEGER DEFAULT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY(guild_id, id)
      )`,
      args: [],
    });

    await db.execute({
      sql: `CREATE TABLE IF NOT EXISTS plot_auctions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        plot_id INTEGER NOT NULL,
        highest_bidder_type TEXT DEFAULT NULL,
        highest_bidder_id TEXT DEFAULT NULL,
        highest_bid INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'completed', 'cancelled')),
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      )`,
      args: [],
    });

    await db.execute({
      sql: 'CREATE INDEX IF NOT EXISTS idx_city_plots_owner ON city_plots(guild_id, owner_type, owner_id)',
      args: [],
    });
    await db.execute({
      sql: 'CREATE INDEX IF NOT EXISTS idx_plot_auctions_active ON plot_auctions(guild_id, status, expires_at)',
      args: [],
    });
    console.log('[Migrate] City tables ensured (city_plots, plot_auctions)');
  } catch (err) {
    console.error('[Migrate] Error during schema migration:', err);
  }
}

// ============================================
// Р¤СѓРЅРєС†РёРё РґР»СЏ СЂР°Р±РѕС‚С‹ СЃ РєРІРµСЃС‚Р°РјРё Рё РµР¶РµРґРЅРµРІРЅРѕР№ Р°РєС‚РёРІРЅРѕСЃС‚СЊСЋ
// ============================================

// РџРѕР»СѓС‡РµРЅРёРµ С‚РµРєСѓС‰РµР№ РґР°С‚С‹ РїРѕ РІСЂРµРјРµРЅРё Р’Р»Р°РґРёРІРѕСЃС‚РѕРєР° (UTC+10, 00:00 СЃР±СЂРѕСЃ)
function getVladivostokDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Vladivostok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

/**
 * РџСЂРѕРІРµСЂСЏРµС‚, СЂР°Р·СЂРµС€РµРЅРѕ Р»Рё Р·Р°РїСѓСЃРєР°С‚СЊ РёРІРµРЅС‚С‹ РІ С‚РµРєСѓС‰РµРµ РІСЂРµРјСЏ РїРѕ Р’Р»Р°РґРёРІРѕСЃС‚РѕРєСѓ
 * Р’ Р±СѓРґРЅРёРµ РґРЅРё (РїРЅ-РїС‚): СЃ 17:00 РґРѕ 22:00
 * Р’ РІС‹С…РѕРґРЅС‹Рµ РґРЅРё (СЃР±-РІСЃ): СЃ 10:00 РґРѕ 23:59
 */
function isEventTimeAllowed(timeZone: string = 'Asia/Vladivostok'): boolean {
  const now = new Date();
  const vladivostokDate = new Date(now.getTime() + 10 * 60 * 60 * 1000);

  const dayOfWeek = vladivostokDate.getUTCDay(); // 0 = РІРѕСЃРєСЂРµСЃРµРЅСЊРµ, 6 = СЃСѓР±Р±РѕС‚Р°
  const hour = vladivostokDate.getUTCHours(); // 0-23 РїРѕ Р’Р»Р°РґРёРІРѕСЃС‚РѕРєСѓ

  // Р’ Р±СѓРґРЅРёРµ РґРЅРё (РїРѕРЅРµРґРµР»СЊРЅРёРє-РїСЏС‚РЅРёС†Р°: 1-5)
  if (dayOfWeek >= 1 && dayOfWeek <= 5) {
    return hour >= 17 && hour < 22;
  }

  // Р’ РІС‹С…РѕРґРЅС‹Рµ РґРЅРё (СЃСѓР±Р±РѕС‚Р°-РІРѕСЃРєСЂРµСЃРµРЅСЊРµ: 0, 6)
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return hour >= 10 && hour <= 23;
  }

  return false;
}

// ============================================
// Р¤СѓРЅРєС†РёРё РґР»СЏ СЂР°Р±РѕС‚С‹ СЃ СЃРµР·РѕРЅР°РјРё Рё РЅРµРґРµР»СЏРјРё (Р­С‚Р°Рї 7)
// ============================================

// ============================================
// Р¤СѓРЅРєС†РёРё РґР»СЏ СЂР°Р±РѕС‚С‹ СЃ СЃРµР·РѕРЅР°РјРё Рё РЅРµРґРµР»СЏРјРё (Р­С‚Р°Рї 7)
// ============================================

// РџРѕР»СѓС‡РµРЅРёРµ РєР»СЋС‡Р° РЅРµРґРµР»Рё РІ С„РѕСЂРјР°С‚Рµ ISO (YYYY-Www) РїРѕ РІСЂРµРјРµРЅРё Р’Р»Р°РґРёРІРѕСЃС‚РѕРєР°
function getWeekKey(date: Date = new Date()): string {
  // РЎРґРІРёРіР°РµРј РґР°С‚Сѓ РЅР° UTC+10 (Р’Р»Р°РґРёРІРѕСЃС‚РѕРє)
  const vladivostokDate = new Date(date.getTime() + 10 * 60 * 60 * 1000);

  // РџРѕР»СѓС‡Р°РµРј РіРѕРґ Рё РЅРѕРјРµСЂ РЅРµРґРµР»Рё
  const year = vladivostokDate.getFullYear();
  const dayOfYear = getDayOfYear(vladivostokDate);

  // РќРѕРјРµСЂ РЅРµРґРµР»Рё РїРѕ ISO (РїРѕРЅРµРґРµР»СЊРЅРёРє - РЅР°С‡Р°Р»Рѕ РЅРµРґРµР»Рё)
  const weekNum = Math.ceil(dayOfYear / 7);

  return `Y${year}-W${weekNum.toString().padStart(2, '0')}`;
}

// РџРѕР»СѓС‡РµРЅРёРµ РЅРѕРјРµСЂР° РґРЅСЏ РІ РіРѕРґСѓ
function getDayOfYear(date: Date): number {
  const start = new Date(date.getFullYear(), 0, 0);
  const diff = date.getTime() - start.getTime();
  const oneDay = 1000 * 60 * 60 * 24;
  return Math.floor(diff / oneDay);
}

// РћРїСЂРµРґРµР»РµРЅРёРµ С‚РµРєСѓС‰РµРіРѕ СЃРµР·РѕРЅР° РїРѕ РјРµСЃСЏС†Сѓ
function getCurrentSeason(date: Date = new Date()): string {
  const month = date.getUTCMonth() + 1; // 1-12

  if (month >= 3 && month <= 5) return 'рџЊё Р’РµСЃРµРЅРЅРёР№ РєСѓР±РѕРє';
  if (month >= 6 && month <= 8) return 'вЂпёЏ Р›РµС‚РЅРёР№ РґСЂР°Р№РІ';
  if (month >= 9 && month <= 11) return 'рџЌ‚ РћСЃРµРЅРЅРёР№ РјР°СЂР°С„РѕРЅ';
  return 'вќ„пёЏ Р—РёРјРЅСЏСЏ Р±РёС‚РІР°'; // 12, 1, 2
}

// РџРѕР»СѓС‡РµРЅРёРµ ID СЃРµР·РѕРЅР° РґР»СЏ Р°СЂС…РёРІР° (РЅР°РїСЂРёРјРµСЂ: '2026-spring')
function getSeasonId(date: Date = new Date()): string {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;

  let seasonName = '';
  if (month >= 3 && month <= 5) seasonName = 'spring';
  else if (month >= 6 && month <= 8) seasonName = 'summer';
  else if (month >= 9 && month <= 11) seasonName = 'autumn';
  else seasonName = 'winter';

  return `${year}-${seasonName}`;
}

// ============================================
// Р¤СѓРЅРєС†РёРё РґР»СЏ СЂР°Р±РѕС‚С‹ СЃРѕ СЃС‚СЂРёРєР°РјРё Р°РєС‚РёРІРЅРѕСЃС‚Рё (Р­С‚Р°Рї 2)
// ============================================

// Р’С‹С‡РёСЃР»РµРЅРёРµ РјРЅРѕР¶РёС‚РµР»СЏ XP РѕС‚ РґР»РёРЅС‹ СЃС‚СЂРёРєР°
function getXpMultiplier(streakDays: number): number {
  if (streakDays >= 30) return 1.25;  // +25%
  if (streakDays >= 14) return 1.15;  // +15%
  if (streakDays >= 7) return 1.10;   // +10%
  if (streakDays >= 3) return 1.05;   // +5%
  return 1.0;
}

// РџСЂРѕРІРµСЂРєР° СѓСЃР»РѕРІРёР№ РґР»СЏ Р°РєС‚РёРІРЅРѕСЃС‚Рё РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ (РґР»СЏ СЃС‚СЂРёРєР°)
function checkActivityCondition(activity: { messages_count: number; voice_seconds: number }, questCompleted: boolean): boolean {
  // РЈСЃР»РѕРІРёСЏ: 20+ СЃРѕРѕР±С‰РµРЅРёР№ РР›Р 15+ РјРёРЅСѓС‚ (900 СЃРµРєСѓРЅРґ) РІ РІРѕР№СЃРµ РР›Р Р·Р°РєСЂС‹С‚ С…РѕС‚СЏ Р±С‹ 1 РєРІРµСЃС‚
  return activity.messages_count >= 20 || activity.voice_seconds >= 900 || questCompleted;
}

// РџРѕР»СѓС‡РµРЅРёРµ РґР°РЅРЅС‹С… РґР»СЏ РїСЂРѕРІРµСЂРєРё СЃС‚СЂРёРєР° (Р°РєС‚РёРІРЅРѕСЃС‚СЊ + РєРІРµСЃС‚С‹)
async function getUserStreakData(db: any, userId: string, guildId: string): Promise<{ activity: any; questCompleted: boolean }> {
  const today = getVladivostokDate();

  // РџРѕР»СѓС‡Р°РµРј РµР¶РµРґРЅРµРІРЅСѓСЋ Р°РєС‚РёРІРЅРѕСЃС‚СЊ
  const activityResult = await db.execute({
    sql: 'SELECT messages_count, voice_seconds FROM user_daily_activity WHERE user_id = ? AND guild_id = ? AND activity_date = ?',
    args: [userId, guildId, today],
  });

  const activity = activityResult.rows.length > 0
    ? { messages_count: (activityResult.rows[0].messages_count as number) || 0, voice_seconds: (activityResult.rows[0].voice_seconds as number) || 0 }
    : { messages_count: 0, voice_seconds: 0 };

  // РџСЂРѕРІРµСЂСЏРµРј, Р·Р°РєСЂС‹С‚ Р»Рё С…РѕС‚СЏ Р±С‹ 1 РєРІРµСЃС‚ РЎР•Р“РћР”РќРЇ
  // РРЎРџР РђР’Р›Р•РќРР•: СЂР°РЅСЊС€Рµ СѓС‡РёС‚С‹РІР°Р»РёСЃСЊ РІСЃРµ РєРІРµСЃС‚С‹ Р·Р° РІСЃС‘ РІСЂРµРјСЏ (Р±РµР· С„РёР»СЊС‚СЂР° РїРѕ РґР°С‚Рµ),
  // РёР·-Р·Р° С‡РµРіРѕ СЃС‚СЂРёРє РїРѕРґРґРµСЂР¶РёРІР°Р»СЃСЏ РґР°РІРЅРѕ Р·Р°РєСЂС‹С‚С‹РјРё РєРІРµСЃС‚Р°РјРё. Р”РѕР±Р°РІР»РµРЅ С„РёР»СЊС‚СЂ РїРѕ active_date.
  const questResult = await db.execute({
    sql: `SELECT COUNT(*) as completed
          FROM user_quest_progress uqp
          JOIN quests_daily qd ON uqp.quest_daily_id = qd.id
          WHERE uqp.user_id = ? AND uqp.guild_id = ? AND uqp.completed_at IS NOT NULL AND qd.active_date = ?`,
    args: [userId, guildId, today],
  });

  const questCompleted = (questResult.rows[0]?.completed as number) > 0;

  return { activity, questCompleted };
}

// РћР±РЅРѕРІР»РµРЅРёРµ СЃС‚СЂРёРєР° РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ
async function updateUserStreak(db: any, userId: string, guildId: string): Promise<{ streakDays: number; streakFreezes: number; updated: boolean }> {
  const today = getVladivostokDate();

  try {
    // РџРѕР»СѓС‡Р°РµРј С‚РµРєСѓС‰РёРµ РґР°РЅРЅС‹Рµ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ
    const userResult = await db.execute({
      sql: 'SELECT streak_days, last_streak_date, streak_freezes FROM users WHERE user_id = ? AND guild_id = ?',
      args: [userId, guildId],
    });

    if (userResult.rows.length === 0) {
      // РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ РЅРµ РЅР°Р№РґРµРЅ - СЃРѕР·РґР°С‘Рј Р·Р°РїРёСЃСЊ СЃ РґРµС„РѕР»С‚РЅС‹РјРё Р·РЅР°С‡РµРЅРёСЏРјРё
      await db.execute({
        sql: 'UPDATE users SET streak_days = 1, last_streak_date = ? WHERE user_id = ? AND guild_id = ?',
        args: [today, userId, guildId],
      });
      return { streakDays: 1, streakFreezes: 0, updated: true };
    }

    const userRow = userResult.rows[0];
    let streakDays = (userRow.streak_days as number) || 0;
    const lastStreakDate = userRow.last_streak_date as string | null;
    let streakFreezes = (userRow.streak_freezes as number) || 0;

    // Р•СЃР»Рё СЃРµРіРѕРґРЅСЏ СѓР¶Рµ РѕР±РЅРѕРІР»СЏР»Рё СЃС‚СЂРёРє - РЅРёС‡РµРіРѕ РЅРµ РґРµР»Р°РµРј
    if (lastStreakDate === today) {
      return { streakDays, streakFreezes, updated: false };
    }

    // РџРѕР»СѓС‡Р°РµРј РґР°РЅРЅС‹Рµ РґР»СЏ РїСЂРѕРІРµСЂРєРё Р°РєС‚РёРІРЅРѕСЃС‚Рё
    const { activity, questCompleted } = await getUserStreakData(db, userId, guildId);

    // РџСЂРѕРІРµСЂСЏРµРј СѓСЃР»РѕРІРёРµ Р°РєС‚РёРІРЅРѕСЃС‚Рё
    if (!checkActivityCondition(activity, questCompleted)) {
      // РЈСЃР»РѕРІРёРµ РЅРµ РІС‹РїРѕР»РЅРµРЅРѕ - СЃР±СЂРѕСЃ СЃС‚СЂРёРєР°
      await db.execute({
        sql: 'UPDATE users SET streak_days = 1, last_streak_date = ? WHERE user_id = ? AND guild_id = ?',
        args: [today, userId, guildId],
      });
      return { streakDays: 1, streakFreezes, updated: true };
    }

    // РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ Р°РєС‚РёРІРµРЅ - РїСЂРѕРІРµСЂСЏРµРј СЂР°Р·РЅРёС†Сѓ СЃ РІС‡РµСЂР°С€РЅРёРј РґРЅС‘Рј
    let newStreakDays = streakDays;
    let needUpdate = false;

    if (lastStreakDate === null) {
      // РџРµСЂРІС‹Р№ РґРµРЅСЊ Р°РєС‚РёРІРЅРѕСЃС‚Рё
      newStreakDays = 1;
      needUpdate = true;
    } else {
      // Р’С‹С‡РёСЃР»СЏРµРј СЂР°Р·РЅРёС†Сѓ РІ РґРЅСЏС… РјРµР¶РґСѓ today Рё last_streak_date
      // Р¤РѕСЂРјР°С‚ РґР°С‚С‹: YYYY-MM-DD
      const todayParts = today.split('-').map(Number);
      const lastParts = lastStreakDate.split('-').map(Number);

      const todayDate = new Date(todayParts[0], todayParts[1] - 1, todayParts[2]);
      const lastDate = new Date(lastParts[0], lastParts[1] - 1, lastParts[2]);

      const diffTime = todayDate.getTime() - lastDate.getTime();
      const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

      if (diffDays === 1) {
        // Р’С‡РµСЂР° Р±С‹Р» РїРѕСЃР»РµРґРЅРёР№ РґРµРЅСЊ СЃС‚СЂРёРєР° - РїСЂРѕРґРѕР»Р¶Р°РµРј
        newStreakDays = streakDays + 1;
        needUpdate = true;
      } else if (diffDays > 1) {
        // РџСЂРѕС€Р»Рѕ 2+ РґРЅСЏ - РїСЂРѕРІРµСЂСЏРµРј Р·Р°РјРѕСЂРѕР·РєРё
        if (streakFreezes > 0) {
          // Р•СЃС‚СЊ Р·Р°РјРѕСЂРѕР·РєР° - С‚СЂР°С‚РёРј РµС‘ Рё СЃРѕС…СЂР°РЅСЏРµРј СЃС‚СЂРёРє
          streakFreezes -= 1;
          needUpdate = true;
          console.log(`[Streak] User ${userId} used freeze to preserve streak`);
          // vlad_typhoon: СЃРїР°СЃР»Рё СЃС‚СЂРёРє Р·Р°РјРѕСЂРѕР·РєРѕР№
          await unlockAchievement(db, userId, guildId, 'vlad_typhoon', client, undefined);
        } else {
          // РќРµС‚ Р·Р°РјРѕСЂРѕР·РєРё - СЃР±СЂРѕСЃ
          newStreakDays = 1;
          needUpdate = true;
        }
      }
      // Р•СЃР»Рё diffDays === 0 (СѓР¶Рµ РѕР±РЅРѕРІР»СЏР»Рё СЃРµРіРѕРґРЅСЏ) - РЅРёС‡РµРіРѕ РЅРµ РґРµР»Р°РµРј

      // fbk_sandwich: СЃС‚СЂРёРє РґРѕСЃС‚РёРі 14 РґРЅРµР№
      if (newStreakDays === 14 && needUpdate) {
        await unlockAchievement(db, userId, guildId, 'fbk_sandwich', client, undefined);
      }
    }

    if (needUpdate) {
      await db.execute({
        sql: 'UPDATE users SET streak_days = ?, last_streak_date = ?, streak_freezes = ? WHERE user_id = ? AND guild_id = ?',
        args: [newStreakDays, today, streakFreezes, userId, guildId],
      });
    }

    // РћР±РЅРѕРІР»РµРЅРёРµ РјР°РєСЃРёРјР°Р»СЊРЅРѕРіРѕ СЃС‚СЂРёРєР°
    if (newStreakDays > (userRow.max_streak as number || 0)) {
      await db.execute({
        sql: 'UPDATE users SET max_streak = ? WHERE user_id = ? AND guild_id = ?',
        args: [newStreakDays, userId, guildId],
      });
    }

    return { streakDays: newStreakDays, streakFreezes, updated: needUpdate };
  } catch (err) {
    console.error('[Streak] Error updating streak:', err);
    return { streakDays: 0, streakFreezes: 0, updated: false };
  }
}

// РќР°С‡РёСЃР»РµРЅРёРµ XP СЃ РјРЅРѕР¶РёС‚РµР»РµРј СЃС‚СЂРёРєР°
async function awardXpWithStreak(db: any, userId: string, guildId: string, baseXp: number): Promise<number> {
  // РЎРЅР°С‡Р°Р»Р° РѕР±РЅРѕРІР»СЏРµРј СЃС‚СЂРёРє
  const { streakDays } = await updateUserStreak(db, userId, guildId);

  // РџСЂРёРјРµРЅСЏРµРј РјРЅРѕР¶РёС‚РµР»СЊ
  const multiplier = getXpMultiplier(streakDays);
  const finalXp = Math.round(baseXp * multiplier);

  await db.execute({
    sql: 'UPDATE users SET xp = xp + ? WHERE user_id = ? AND guild_id = ?',
    args: [finalXp, userId, guildId],
  });

  console.log(`[Streak] User ${userId} received ${baseXp} XP x${multiplier} = ${finalXp} XP (streak: ${streakDays} days)`);

  return finalXp;
}

// ============================================
// Р¤СѓРЅРєС†РёРё РґР»СЏ СЃРµР·РѕРЅРЅРѕРіРѕ Рё РЅРµРґРµР»СЊРЅРѕРіРѕ РЅР°С‡РёСЃР»РµРЅРёСЏ XP (Р­С‚Р°Рї 7)
// ============================================

/**
 * РќР°С‡РёСЃР»СЏРµС‚ РѕРїС‹С‚ СЃ СѓС‡С‘С‚РѕРј СЃС‚СЂРёРєР° Рё СЃРµР·РѕРЅРЅРѕРіРѕ/РЅРµРґРµР»СЊРЅРѕРіРѕ РЅР°С‡РёСЃР»РµРЅРёСЏ
 * @returns {finalXp, seasonXp, weekXp} - РёС‚РѕРіРѕРІС‹Р№ XP, СЃРµР·РѕРЅРЅС‹Р№ РѕРїС‹С‚, РЅРµРґРµР»СЊРЅС‹Р№ РѕРїС‹С‚
 */
async function awardXpWithAllMultipliers(
  db: any,
  userId: string,
  guildId: string,
  baseXp: number
): Promise<{ finalXp: number; seasonXp: number; weekXp: number }> {
  // РЎРЅР°С‡Р°Р»Р° РѕР±РЅРѕРІР»СЏРµРј СЃС‚СЂРёРє
  const { streakDays } = await updateUserStreak(db, userId, guildId);

  // РџРѕР»СѓС‡Р°РµРј РјРЅРѕР¶РёС‚РµР»Рё
  const streakMultiplier = getXpMultiplier(streakDays);

  // РџРѕР»СѓС‡Р°РµРј С‚РµРєСѓС‰РёРµ СЃРµР·РѕРЅ Рё РЅРµРґРµР»СЋ
  const seasonName = getCurrentSeason();
  const weekKey = getWeekKey();

  // РќР°С‡РёСЃР»СЏРµРј СЃРµР·РѕРЅРЅС‹Р№ XP
  const seasonXp = Math.round(baseXp * streakMultiplier);
  await db.execute({
    sql: 'UPDATE users SET season_xp = season_xp + ? WHERE user_id = ? AND guild_id = ?',
    args: [seasonXp, userId, guildId],
  });

  // UPSERT РІ weekly_activity
  await db.execute({
    sql: `INSERT INTO weekly_activity (user_id, guild_id, week_key, xp_earned)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(user_id, guild_id, week_key)
          DO UPDATE SET xp_earned = xp_earned + ?`,
    args: [userId, guildId, weekKey, seasonXp, seasonXp],
  });

  // РџСЂРёРјРµРЅСЏРµРј РјРЅРѕР¶РёС‚РµР»СЊ СЃС‚СЂРёРєР° Рє РёС‚РѕРіРѕРІРѕРјСѓ XP
  const finalXp = seasonXp;

  await db.execute({
    sql: 'UPDATE users SET xp = xp + ? WHERE user_id = ? AND guild_id = ?',
    args: [finalXp, userId, guildId],
  });

  console.log(
    `[XP] User ${userId}: base=${baseXp}, streak=${streakMultiplier}x, season=${seasonName}, week=${weekKey}, total=${finalXp} XP`
  );

  return { finalXp, seasonXp, weekXp: seasonXp };
}

/**
 * РџСЂРѕРІРµСЂСЏРµС‚ СЃРјРµРЅСѓ РЅРµРґРµР»Рё Рё РїСЂРѕРІРѕРґРёС‚ РµР¶РµРЅРµРґРµР»СЊРЅС‹Р№ СЃР±СЂРѕСЃ
 * Р’С‹Р·С‹РІР°РµС‚СЃСЏ СЂР°Р· РІ С‡Р°СЃ
 */
async function checkWeeklyReset(db: any, bot: Client): Promise<void> {
  const currentWeekKey = getWeekKey();
  const currentSeasonId = getSeasonId();

  // C7: Р·РґРµСЃСЊ Р±С‹Р» РјС‘СЂС‚РІС‹Р№ Р·Р°РїСЂРѕСЃ
  //   'SELECT weekly_reset_week FROM guild_settings WHERE guild_id = ?' СЃ args: [],
  // РћРЅ РїР°РґР°Р» РЅР° РєР°Р¶РґРѕРј РІС‹Р·РѕРІРµ (РЅРµСЃРѕРІРїР°РґРµРЅРёРµ С‡РёСЃР»Р° РїР»РµР№СЃС…РѕР»РґРµСЂРѕРІ Рё Р°СЂРіСѓРјРµРЅС‚РѕРІ),
  // РёСЃРєР»СЋС‡РµРЅРёРµ РіР»РѕС‚Р°Р»РѕСЃСЊ РІРЅРµС€РЅРёРј catch вЂ” Рё РІРµСЃСЊ checkWeeklyReset Р±С‹Р» РјС‘СЂС‚РІ.
  // РљРѕР»РѕРЅРєРё weekly_reset_week РІ guild_settings РЅРµ СЃСѓС‰РµСЃС‚РІСѓРµС‚ РІРѕРІСЃРµ (РѕРЅР° РµСЃС‚СЊ
  // С‚РѕР»СЊРєРѕ Сѓ users), Р° СЂРµР·СѓР»СЊС‚Р°С‚ Р·Р°РїСЂРѕСЃР° РЅРёРіРґРµ РЅРµ РёСЃРїРѕР»СЊР·РѕРІР°Р»СЃСЏ, РїРѕСЌС‚РѕРјСѓ РѕРЅ СѓРґР°Р»С‘РЅ.
  try {
    // РџРѕР»СѓС‡Р°РµРј РІСЃРµ guild_id РёР· users
    const guildsResult = await db.execute({
      sql: 'SELECT DISTINCT guild_id FROM users',
      args: [],
    });

    const guildIds = (guildsResult.rows || []).map((r: any) => r.guild_id as string);

    for (const guildId of guildIds) {
      // lastWeekKey С‡РёС‚Р°РµС‚СЃСЏ Р·Р°РЅРѕРІРѕ РґР»СЏ РљРђР–Р”РћР™ РіРёР»СЊРґРёРё вЂ” СЂР°РЅСЊС€Рµ Р·РЅР°С‡РµРЅРёРµ
      // РїСЂРѕС‚РµРєР°Р»Рѕ РёР· РїСЂРµРґС‹РґСѓС‰РµР№ РёС‚РµСЂР°С†РёРё С†РёРєР»Р° Рё РіРёР»СЊРґРёСЏ РјРѕРіР»Р° РїСЂРѕРїСѓСЃС‚РёС‚СЊ СЃР±СЂРѕСЃ.
      let lastWeekKey: string | null = null;

      // РџРѕР»СѓС‡Р°РµРј РґР°С‚Сѓ РїРѕСЃР»РµРґРЅРµРіРѕ СЃР±СЂРѕСЃР° РёР· РїРѕР»СЊР·РѕРІР°С‚РµР»СЊСЃРєРѕР№ Р·Р°РїРёСЃРё
      const userResult = await db.execute({
        sql: 'SELECT last_week_reset FROM users WHERE user_id = ? AND guild_id = ?',
        args: [guildId, guildId], // РСЃРїРѕР»СЊР·СѓРµРј guild_id РєР°Рє user_id РґР»СЏ С…СЂР°РЅРµРЅРёСЏ РјРµС‚Р°РґР°РЅРЅС‹С…
      });

      if (userResult.rows.length > 0) {
        lastWeekKey = userResult.rows[0].last_week_reset as string | null;
      }

      // Р•СЃР»Рё РЅРµРґРµР»СЏ РёР·РјРµРЅРёР»Р°СЃСЊ
      if (lastWeekKey !== currentWeekKey) {
        console.log(`[WeeklyReset] Week changed from ${lastWeekKey} to ${currentWeekKey} for guild ${guildId}`);

        // РќР°С…РѕРґРёРј РїРѕР±РµРґРёС‚РµР»СЏ РїСЂРѕС€Р»РѕР№ РЅРµРґРµР»Рё
        const winnerResult = await db.execute({
          sql: `SELECT user_id, xp_earned FROM weekly_activity
                WHERE guild_id = ? AND week_key = ?
                ORDER BY xp_earned DESC LIMIT 1`,
          args: [guildId, lastWeekKey || currentWeekKey],
        });

        if (winnerResult.rows.length > 0) {
          const winner = winnerResult.rows[0];
          const winnerId = winner.user_id as string;
          const xpEarned = winner.xp_earned as number;

          // РќР°С‡РёСЃР»СЏРµРј +500 XP РїРѕР±РµРґРёС‚РµР»СЋ
          await db.execute({
            sql: 'UPDATE users SET xp = xp + 500 WHERE user_id = ? AND guild_id = ?',
            args: [winnerId, guildId],
          });

          // РћР±РЅРѕРІР»СЏРµРј СѓСЂРѕРІРµРЅСЊ
          const userXpResult = await db.execute({
            sql: 'SELECT xp FROM users WHERE user_id = ? AND guild_id = ?',
            args: [winnerId, guildId],
          });
          if (userXpResult.rows.length > 0) {
            const newXp = userXpResult.rows[0].xp as number;
            const newLevel = calculateLevel(newXp);
            await db.execute({
              sql: 'UPDATE users SET level = ? WHERE user_id = ? AND guild_id = ?',
              args: [newLevel, winnerId, guildId],
            });
          }

          console.log(`[WeeklyReset] User ${winnerId} wins guild ${guildId} week - +500 XP`);

          // РћС‚РїСЂР°РІР»СЏРµРј Embed РІ РєР°РЅР°Р»
          try {
            const guild = bot.guilds.cache.get(guildId);
            if (guild) {
              // РђРЅРѕРЅСЃ Р§РµРјРїРёРѕРЅР° РќРµРґРµР»Рё РІСЃРµРіРґР° РїСѓР±Р»РёРєСѓРµРј РІ РіР»Р°РІРЅРѕРј РєР°РЅР°Р»Рµ РёРІРµРЅС‚РѕРІ
              const channel = getEventTargetChannel(guild) as any;

              if (channel) {
                const embed = {
                  embeds: [{
                    title: 'рџ‘‘ Р§Р•РњРџРРћРќ РќР•Р”Р•Р›Р РћРџР Р•Р”Р•Р›РЃРќ!',
                    description: `**<@${winnerId}>** РЅР°Р±СЂР°Р» Р±РѕР»СЊС€Рµ РІСЃРµС… РѕРїС‹С‚Р° Р·Р° РїСЂРѕС€Р»СѓСЋ РЅРµРґРµР»СЋ (**${xpEarned.toLocaleString()} XP**) Рё РїРѕР»СѓС‡Р°РµС‚ Р·РІР°РЅРёРµ Р§РµРјРїРёРѕРЅР° РќРµРґРµР»Рё Рё +500 XP!`,
                    color: 0xFFD700,
                    footer: { text: 'РќРµРґРµР»СЏ Р·Р°РІРµСЂС€Р°РµС‚СЃСЏ РІ 00:00 (Р’Р»Р°РґРёРІРѕСЃС‚РѕРє)' },
                  }],
                };

                try {
                  await channel.send(embed);
                  console.log(`[WeeklyReset] Notification sent to guild ${guildId}`);
                } catch (sendErr) {
                  console.error(`[WeeklyReset] Failed to send notification to guild ${guildId}:`, sendErr);
                }
              }
            }
          } catch (notifyErr) {
            console.error('[WeeklyReset] Error in notification:', notifyErr);
          }
        }

        // РћР±РЅРѕРІР»СЏРµРј РґР°С‚Сѓ РїРѕСЃР»РµРґРЅРµРіРѕ СЃР±СЂРѕСЃР°
        // РРЎРџР РђР’Р›Р•РќРР•: INSERT OR REPLACE СѓРґР°Р»СЏР» СЃСѓС‰РµСЃС‚РІСѓСЋС‰СѓСЋ СЃС‚СЂРѕРєСѓ users С†РµР»РёРєРѕРј
        // (РІРјРµСЃС‚Рµ СЃ xp, level, СЃС‚СЂРёРєР°РјРё Рё С‚.Рґ.), РµСЃР»Рё СЃР»СѓР¶РµР±РЅР°СЏ Р·Р°РїРёСЃСЊ СѓР¶Рµ Р±С‹Р»Р° РІ Р‘Р”.
        // РўРµРїРµСЂСЊ Р±РµР·РѕРїР°СЃРЅС‹Р№ UPDATE, Р° INSERT вЂ” С‚РѕР»СЊРєРѕ РµСЃР»Рё Р·Р°РїРёСЃРё РµС‰С‘ РЅРµС‚.
        const updateResetResult = await db.execute({
          sql: 'UPDATE users SET last_week_reset = ? WHERE user_id = ? AND guild_id = ?',
          args: [currentWeekKey, guildId, guildId],
        });

        if (!updateResetResult.rowsAffected || updateResetResult.rowsAffected === 0) {
          // РЎР»СѓР¶РµР±РЅРѕР№ Р·Р°РїРёСЃРё РµС‰С‘ РЅРµС‚ вЂ” СЃРѕР·РґР°С‘Рј РµС‘ СЃ РЅСѓР»РµРІС‹РјРё Р·РЅР°С‡РµРЅРёСЏРјРё
          await db.execute({
            sql: `INSERT OR IGNORE INTO users (user_id, guild_id, xp, level, messages_count, last_message_at, last_activity_at, last_week_reset)
                  VALUES (?, ?, 0, 0, 0, 0, ?, ?)`,
            args: [guildId, guildId, Date.now(), currentWeekKey],
          });
        }
      }
    }
  } catch (err) {
    console.error('[WeeklyReset] Error during reset:', err);
  }
}

// ============================================
// Р¤СѓРЅРєС†РёСЏ РїСЂРѕРІРµСЂРєРё РґРµР·РµСЂС‚РёСЂРѕРІ (Р­С‚Р°Рї 12+)
// ============================================

/**
 * РџСЂРѕРІРµСЂСЏРµС‚ РїРѕР»СЊР·РѕРІР°С‚РµР»РµР№ РЅР° РґРµР·РµСЂС‚РёСЂСЃС‚РІРѕ (7 РґРЅРµР№ РЅРµР°РєС‚РёРІРЅРѕСЃС‚Рё)
 * Р’С‹Р·С‹РІР°РµС‚СЃСЏ РєР°Р¶РґС‹Рµ 6 С‡Р°СЃРѕРІ
 */
async function checkDeserters(db: any, bot: Client): Promise<void> {
  const now = Date.now();
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000; // 7 РґРЅРµР№ РІ РјСЃ

  try {
    // РџРѕР»СѓС‡Р°РµРј РІСЃРµ РіРёР»СЊРґРёРё
    const guildsResult = await db.execute({
      sql: 'SELECT DISTINCT guild_id FROM users',
      args: [],
    });
    const guildIds = (guildsResult.rows || []).map((r: any) => r.guild_id as string);

    console.log(`[DeserterCheck] Checking ${guildIds.length} guilds for deserters...`);

    for (const guildId of guildIds) {
      // РќР°С…РѕРґРёРј РІСЃРµС… РїРѕР»СЊР·РѕРІР°С‚РµР»РµР№ СЃ РєР»Р°СЃСЃРѕРј, РєРѕС‚РѕСЂС‹Рµ РЅРµ РїСЂРѕСЏРІР»СЏР»Рё Р°РєС‚РёРІРЅРѕСЃС‚СЊ 7+ РґРЅРµР№
      // last_activity_at > 0 - Р·Р°С‰РёС‚Р° РѕС‚ РѕР±РЅСѓР»РµРЅРёСЏ РїРѕР»СЊР·РѕРІР°С‚РµР»РµР№ СЃ РїСѓСЃС‚С‹Рј Р·РЅР°С‡РµРЅРёРµРј
      const desertersResult = await db.execute({
        sql: `SELECT user_id, class_id, last_activity_at
              FROM users
              WHERE guild_id = ?
                AND class_id IS NOT NULL
                AND class_id != 'stripped'
                AND last_activity_at > 0
                AND (? - last_activity_at) > ?`,
        args: [guildId, now, sevenDaysMs],
      });

      const deserters = desertersResult.rows || [];
      if (deserters.length === 0) continue;

      console.log(`[DeserterCheck] Found ${deserters.length} deserters in guild ${guildId}`);

      const guild = bot.guilds.cache.get(guildId);
      let systemChannel: any = null;

      if (guild) {
        // РђРЅРѕРЅСЃС‹ Рѕ РґРµР·РµСЂС‚РёСЂСЃС‚РІРµ вЂ” СЃС‚СЂРѕРіРѕ РІ РіР»Р°РІРЅС‹Р№ РєР°РЅР°Р» РёРІРµРЅС‚РѕРІ
        systemChannel = getEventTargetChannel(guild);
      }

      for (const deseter of deserters) {
        const userId = deseter.user_id as string;
        const classId = deseter.class_id as string;
        const classDisplayName = getClassDisplayNameForDeserter(classId);

        // 1. РђРЅРЅСѓР»РёСЂРѕРІР°С‚СЊ РєР»Р°СЃСЃ
        await db.execute({
          sql: 'UPDATE users SET class_id = ? WHERE user_id = ? AND guild_id = ?',
          args: ['stripped', userId, guildId],
        });
        console.log(`[DeserterCheck] User ${userId} stripped of class ${classId} in guild ${guildId}`);

        // 2. РћС‚РїСЂР°РІРёС‚СЊ РїРѕР·РѕСЂРЅС‹Р№ Р°РЅРѕРЅСЃ
        if (systemChannel) {
          try {
            const embed = {
              embeds: [{
                title: 'рџҐЂ РљР»Р°СЃСЃРѕРІС‹Рµ РЅР°РІС‹РєРё Р°С‚СЂРѕС„РёСЂРѕРІР°Р»РёСЃСЊ!',
                description: `<@${userId}> РѕС‚СЃСѓС‚СЃС‚РІРѕРІР°Р» РЅР° СЃРµСЂРІРµСЂРµ 7 РґРЅРµР№ РїРѕРґСЂСЏРґ! Р—Р° РґРµР·РµСЂС‚РёСЂСЃС‚РІРѕ РµРіРѕ РєР»Р°СЃСЃРѕРІС‹Рµ СЂРµРіР°Р»РёРё РѕР±СЂР°С‚РёР»РёСЃСЊ РІ РїСЂР°С….\n\n*Р’РѕСЃСЃС‚Р°РЅРѕРІРёС‚СЊ РїСЂР°РІРѕ РЅР° РІС‹Р±РѕСЂ Р±РѕРµРІРѕРіРѕ РїСѓС‚Рё РјРѕР¶РЅРѕ С‚РѕР»СЊРєРѕ РґРѕРєР°Р·Р°РІ РІРµСЂРЅРѕСЃС‚СЊ вЂ” СЃРѕРІРµСЂС€РёРІ СЃР±СЂРѕСЃ РџСЂРµСЃС‚РёР¶Р° РЅР° 100 СѓСЂРѕРІРЅРµ!*`,
                color: 0x747f8d,
                footer: { text: 'РЈС‡С‚РёС‚Рµ: РїСЂРё СЃР±СЂРѕСЃРµ РџСЂРµСЃС‚РёР¶Р° РЅР° 100 СѓСЂРѕРІРЅРµ РїСЂРѕРєР»СЏС‚РёРµ СЃРЅРёРјРµС‚СЃСЏ Р°РІС‚РѕРјР°С‚РёС‡РµСЃРєРё' },
              }],
            };
            await systemChannel.send(embed);
            console.log(`[DeserterCheck] Notification sent for ${userId} in guild ${guildId}`);
          } catch (sendErr) {
            console.error(`[DeserterCheck] Failed to send notification for ${userId}:`, sendErr);
          }
        }
      }
    }
  } catch (err) {
    console.error('[DeserterCheck] Error during check:', err);
  }
}

// Р’СЃРїРѕРјРѕРіР°С‚РµР»СЊРЅР°СЏ С„СѓРЅРєС†РёСЏ РґР»СЏ РѕС‚РѕР±СЂР°Р¶РµРЅРёСЏ РєР»Р°СЃСЃР° (Р±РµР· РїСЂРµС„РёРєСЃРѕРІ)
function getClassDisplayNameForDeserter(classId: string): string {
  const classes: Record<string, string> = {
    warrior: 'РџР°Р»Р°РґРёРЅ',
    berserker: 'Р‘РµСЂСЃРµСЂРє',
    mage: 'РђСЂС…РёРјР°Рі',
    necromancer: 'РќРµРєСЂРѕРјР°РЅС‚',
    ranger: 'РЎР»РµРґРѕРїС‹С‚',
    assassin: 'РђСЃСЃР°СЃРёРЅ',
    artificer: 'РўРµС…РЅРѕРјР°Рі',
    bard: 'Р‘Р°СЂРґ',
  };
  return classes[classId] || classId;
}

// ============================================
// Р¤СѓРЅРєС†РёРё РґР»СЏ РЅР°С‡РёСЃР»РµРЅРёСЏ РѕРЅР»Р°Р№РЅ-СЃРµРєСѓРЅРґ (Р­С‚Р°Рї 8 - Server King)
// ============================================

/**
 * РќР°С‡РёСЃР»СЏРµС‚ +300 СЃРµРєСѓРЅРґ РѕРЅР»Р°Р№РЅ-РІСЂРµРјРµРЅРё РІСЃРµРј Р°РєС‚РёРІРЅС‹Рј РїРѕР»СЊР·РѕРІР°С‚РµР»СЏРј
 * Р’С‹Р·С‹РІР°РµС‚СЃСЏ СЂР°Р· РІ 5 РјРёРЅСѓС‚ С‡РµСЂРµР· setInterval
 */
async function awardOnlineSeconds(db: any, bot: Client): Promise<void> {
  const now = Date.now();
  const onlineSeconds = 300; // 5 РјРёРЅСѓС‚

  try {
    const guilds = bot.guilds.cache;

    for (const guild of guilds.values()) {
      const guildId = guild.id;
      const members = guild.members.cache;

      for (const [memberId, member] of members) {
        // РџСЂРѕРїСѓСЃРєР°РµРј Р±РѕС‚РѕРІ
        if (member.user.bot) continue;

        // РџСЂРѕРІРµСЂСЏРµРј СЃС‚Р°С‚СѓСЃ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ (online, idle, dnd)
        // status === 'offline' РѕР·РЅР°С‡Р°РµС‚ РѕС„С„Р»Р°Р№РЅ
        const status = member.presence?.status;
        if (!status || status === 'offline') continue;

        // РќР°С‡РёСЃР»СЏРµРј +300 СЃРµРєСѓРЅРґ РѕРЅР»Р°Р№РЅ-РІСЂРµРјРµРЅРё Рё РѕР±РЅРѕРІР»СЏРµРј last_activity_at
        try {
          await db.execute({
            sql: 'UPDATE users SET online_seconds = online_seconds + ?, last_activity_at = ? WHERE user_id = ? AND guild_id = ?',
            args: [onlineSeconds, Date.now(), memberId, guildId],
          });
        } catch (err) {
          // Р•СЃР»Рё РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ РЅРµС‚ РІ Р±Р°Р·Рµ - РїСЂРѕРїСѓСЃРєР°РµРј
          console.debug(`[OnlineSeconds] User ${memberId} not found in DB for guild ${guildId}`);
        }
      }
    }

    console.log(`[OnlineSeconds] Awarded ${onlineSeconds}s to active users across ${guilds.size} guilds`);
  } catch (err) {
    console.error('[OnlineSeconds] Error awarding seconds:', err);
  }
}

// ============================================
// РњРёСЂРѕРІРѕР№ Р‘РѕСЃСЃ РЎРµСЂРІРµСЂР° (Р­С‚Р°Рї 13 - 4 Р±РѕСЃСЃР° РІ СЂРѕС‚Р°С†РёРё)
// ============================================

const BOSS_CHANNEL_ID = '1051085743839260694';

// 4 РїСЂРµСЃРµС‚Р° Р±РѕСЃСЃРѕРІ
const WORLD_BOSS_PRESETS = [
  {
    boss_id: 'dragon',
    boss_name: 'рџ”Ґ РџРµРїРµР»СЊРЅС‹Р№ Р”СЂР°РєРѕРЅ Р—РѕР»РѕС‚РѕРіРѕ Р РѕРіР°',
    boss_type: 'dragon',
    max_hp: 7500,
    hours: 24,
    xp_reward: 800,
    coins_reward: 200,
    desc: 'РћР±С‹С‡РЅС‹Рµ С‚С‹С‡РєРё РЅР°РЅРѕСЃСЏС‚ -25% СѓСЂРѕРЅР°. РџСЂРѕР±РёРІР°СЋС‚ СЃРєРёР»Р»С‹ Рё СѓР»СЊС‚С‹!'
  },
  {
    boss_id: 'mimic',
    boss_name: 'рџ’° Р–Р°РґРЅС‹Р№ РњРёРјРёРє СЃ РЁР°РјРѕСЂС‹',
    boss_type: 'mimic',
    max_hp: 4200,
    hours: 12,
    xp_reward: 300,
    coins_reward: 600,
    desc: 'Р‘С‹СЃС‚СЂС‹Р№ Р±РѕСЃСЃ РЅР° 12С‡! РљР°Р¶РґС‹Р№ СѓРґР°СЂ РІС‹Р±РёРІР°РµС‚ +15..40 рџЄ™ РїСЂСЏРјРѕ РІ РєР°СЂРјР°РЅ!'
  },
  {
    boss_id: 'leviathan',
    boss_name: 'рџЊЉ РљРёР±РµСЂ-Р›РµРІРёР°С„Р°РЅ РЇРїРѕРЅСЃРєРѕРіРѕ РњРѕСЂСЏ',
    boss_type: 'leviathan',
    max_hp: 6000,
    hours: 24,
    xp_reward: 500,
    coins_reward: 350,
    desc: 'Р’РѕР№СЃ-Р±СѓСЃС‚ СЂР°Р±РѕС‚Р°РµС‚ РІ 2 СЂР°Р·Р° СЃРёР»СЊРЅРµРµ (+50%/С‡Р°СЃ, РєР°Рї +100%)!'
  },
  {
    boss_id: 'phantom',
    boss_name: 'рџ‘ЃпёЏ Р¤Р°РЅС‚РѕРјРЅС‹Р№ РђСЂС…РёС‚РµРєС‚РѕСЂ Р‘РµР·РґРЅС‹',
    boss_type: 'phantom',
    max_hp: 5500,
    hours: 24,
    xp_reward: 600,
    coins_reward: 250,
    desc: 'РљСѓР»РґР°СѓРЅ СѓРґР°СЂРѕРІ 6 РјРёРЅСѓС‚ РІРјРµСЃС‚Рѕ 10! РЎРєРѕСЂРѕСЃС‚РЅРѕР№ Р±РѕР№.'
  }
] as const;

/**
 * Р¤РѕСЂРјРёСЂСѓРµС‚ РѕРїРёСЃР°РЅРёРµ С‚РµРєСѓС‰РµРіРѕ СЃРѕСЃС‚РѕСЏРЅРёСЏ Р±РѕСЃСЃР° РґР»СЏ Embed
 */
function renderBossEmbed(boss: any): any {
  const maxHp = boss.max_hp as number;
  const currentHp = boss.current_hp as number;
  const hoursLeft = Math.ceil((boss.expires_at - Date.now()) / 3600000);

  // РџСЂРѕРіСЂРµСЃСЃ-Р±Р°СЂ HP (20 СЃРёРјРІРѕР»РѕРІ)
  const hpRatio = Math.max(0, Math.min(currentHp / maxHp, 1));
  const filled = Math.round(hpRatio * 20);
  const empty = 20 - filled;
  const hpBar = 'в–€'.repeat(filled) + 'в–‘'.repeat(empty);

  return {
    embeds: [{
      title: `вљ”пёЏ РњРР РћР’РћР™ Р‘РћРЎРЎ: ${boss.boss_name as string}`,
      description: `${boss.desc as string}\n\n` +
        `вќ¤пёЏ **HP:** \`${hpBar}\` **${currentHp.toLocaleString()} / ${maxHp.toLocaleString()}**\n` +
        `вЏі **РСЃС‡РµР·РЅРµС‚ С‡РµСЂРµР·:** ${hoursLeft} С‡.\n\n` +
        `рџ’Ґ **РўРѕРї РѕС…РѕС‚РЅРёРєРѕРІ:**`,
      color: 0xE74C3C,
    }],
    components: [
      {
        type: 1,
        components: [
          { type: 2, custom_id: 'boss_atk_basic', style: 4, label: 'вљ”пёЏ РћР±С‹С‡РЅС‹Р№ СѓРґР°СЂ' },
          { type: 2, custom_id: 'boss_atk_skill', style: 1, label: 'вњЁ РЎРїРµС†-СЃРєРёР»Р»' },
          { type: 2, custom_id: 'boss_atk_ult', style: 3, label: 'рџ‘‘ РЈР»СЊС‚Р°' },
        ],
      },
    ],
  };
}

/**
 * Р¤РѕСЂРјРёСЂСѓРµС‚ РїРѕР±РµРґРЅС‹Р№ Embed РґР»СЏ Р±РѕСЃСЃР°
 */
function renderVictoryEmbed(boss: any, topDamageers: Array<{ user_id: string; total_dmg: number }>): any {
  const maxHp = boss.max_hp as number;
  const hpBar = 'в–€'.repeat(20) + 'в–‘'.repeat(0);

  let topDescription = '';
  topDamageers.forEach((d, i) => {
    const pos = i === 0 ? 'рџҐ‡' : i === 1 ? 'рџҐ€' : i === 2 ? 'рџҐ‰' : `#${i + 1}`;
    topDescription += `${pos} <@${d.user_id as string}> вЂ” **${(d.total_dmg as number).toLocaleString()}** СѓСЂРѕРЅР°\n`;
  });
  if (topDamageers.length === 0) {
    topDescription = '*РЈРґР°СЂРѕРІ РїРѕРєР° РЅРµ РЅР°РЅРµСЃРµРЅРѕ*';
  }

  return {
    embeds: [{
      title: `рџЋ‰ РњРР РћР’РћР™ Р‘РћРЎРЎ ${boss.boss_name as string} РџРћР’Р•Р Р–Р•Рќ!`,
      description: `РџРѕР±РµРґР°! Р‘РѕСЃСЃ РїРѕРІРµСЂР¶РµРЅ!\n\n` +
        `**РќР°РіСЂР°РґР° РєР°Р¶РґРѕРјСѓ СѓС‡Р°СЃС‚РЅРёРєСѓ:**\n` +
        `вЂў рџЋЇ **+${boss.xp_reward as number} XP**\n` +
        `вЂў рџЄ™ **+${boss.coins_reward as number} РјРѕРЅРµС‚**\n\n` +
        `**РўРѕРї РґР°РјР°РіРµСЂРѕРІ:**\n${topDescription}`,
      color: 0xF1C40F,
    }],
    components: [],
  };
}

/**
 * РџРѕР»СѓС‡Р°РµС‚ С†РµР»РµРІРѕР№ РєР°РЅР°Р» РґР»СЏ РІСЃРµС… РёРіСЂРѕРІС‹С… РѕРїРѕРІРµС‰РµРЅРёР№, Р°РЅРѕРЅСЃРѕРІ Рё СЃРёСЃС‚РµРјРЅС‹С… СЃРѕРѕР±С‰РµРЅРёР№.
 * Р“Р»Р°РІРЅС‹Р№ С†РµР»РµРІРѕР№ РєР°РЅР°Р» вЂ” Р·Р°РєСЂРµРїР»С‘РЅРЅС‹Р№ '1051085743839260694'.
 * Fallback РЅР° СЃРёСЃС‚РµРјРЅС‹Р№ РєР°РЅР°Р» вЂ” С‚РѕР»СЊРєРѕ РµСЃР»Рё Р·Р°РєСЂРµРїР»С‘РЅРЅС‹Р№ РЅРµ РЅР°Р№РґРµРЅ РёР»Рё РЅРµРґРѕСЃС‚СѓРїРµРЅ.
 */
function getEventTargetChannel(guild: any): any | null {
  const EVENT_CHANNEL_ID = '1051085743839260694';

  // 1. Р—Р°РєСЂРµРїР»С‘РЅРЅС‹Р№ РєР°РЅР°Р» вЂ” СЃС‚СЂРѕРіРѕ РіР»Р°РІРЅС‹Р№ С†РµР»РµРІРѕР№ РєР°РЅР°Р» РґР»СЏ РІСЃРµС… Р°РЅРѕРЅСЃРѕРІ
  const pinned = guild.channels.cache.get(EVENT_CHANNEL_ID);
  if (pinned && pinned.type === 0 && pinned.permissionsFor(guild.members.me!)?.has('SendMessages')) {
    return pinned;
  }

  // 2. Fallback: СЃРёСЃС‚РµРјРЅС‹Р№ РєР°РЅР°Р» РіРёР»СЊРґРёРё (С‚РѕР»СЊРєРѕ РµСЃР»Рё Р·Р°РєСЂРµРїР»С‘РЅРЅС‹Р№ РЅРµ РЅР°Р№РґРµРЅ)
  if (guild.systemChannelId) {
    const system = guild.channels.cache.get(guild.systemChannelId);
    if (system && system.type === 0 && system.permissionsFor(guild.members.me!)?.has('SendMessages')) {
      return system;
    }
  }

  // 3. РџРѕСЃР»РµРґРЅРёР№ СЂРµР·РµСЂРІ: Р»СЋР±РѕР№ РґРѕСЃС‚СѓРїРЅС‹Р№ С‚РµРєСЃС‚РѕРІС‹Р№ РєР°РЅР°Р» СЃ РїСЂР°РІР°РјРё РѕС‚РїСЂР°РІРєРё
  return (guild.channels.cache.find((c: any) =>
    c.type === 0 && // GuildText
    c.permissionsFor(guild.members.me!)?.has('SendMessages')
  ) as any) || null;
}

// ============================================
// Р РµРґРєРёР№ СЃРїР°РІРЅ РњРёСЂРѕРІРѕРіРѕ Р‘РѕСЃСЃР°: СЂР°СЃРїРёСЃР°РЅРёРµ 60-120 С‡Р°СЃРѕРІ РјРµР¶РґСѓ РїРѕСЏРІР»РµРЅРёСЏРјРё
// ============================================

/**
 * РџР»Р°РЅРёСЂСѓРµС‚ СЃР»РµРґСѓСЋС‰РёР№ СЃРїР°РІРЅ Р±РѕСЃСЃР°: now + СЃР»СѓС‡Р°Р№РЅС‹Рµ 60-120 С‡Р°СЃРѕРІ (2.5-5 РґРЅРµР№).
 * Р’СЂРµРјСЏ С…СЂР°РЅРёС‚СЃСЏ РІ СЃР»СѓР¶РµР±РЅРѕР№ Р·Р°РїРёСЃРё users (user_id = guild_id), РєРѕР»РѕРЅРєР° next_boss_spawn_at.
 */
async function scheduleNextBossSpawn(db: any, guildId: string): Promise<number> {
  const delayHours = 60 + Math.random() * 60; // 60-120 С‡Р°СЃРѕРІ
  const nextSpawnAt = Date.now() + Math.round(delayHours * 3600 * 1000);

  try {
    const updateResult = await db.execute({
      sql: 'UPDATE users SET next_boss_spawn_at = ? WHERE user_id = ? AND guild_id = ?',
      args: [nextSpawnAt, guildId, guildId],
    });

    if (!updateResult.rowsAffected || updateResult.rowsAffected === 0) {
      // РЎР»СѓР¶РµР±РЅРѕР№ Р·Р°РїРёСЃРё РµС‰С‘ РЅРµС‚ вЂ” СЃРѕР·РґР°С‘Рј РµС‘ (РєР°Рє РІ checkWeeklyReset)
      await db.execute({
        sql: `INSERT OR IGNORE INTO users (user_id, guild_id, xp, level, messages_count, last_message_at, last_activity_at, next_boss_spawn_at)
              VALUES (?, ?, 0, 0, 0, 0, ?, ?)`,
        args: [guildId, guildId, Date.now(), nextSpawnAt],
      });
    }

    console.log(`[WorldBoss] Guild ${guildId}: next boss spawn in ~${Math.round(delayHours)}h (${new Date(nextSpawnAt).toISOString()})`);
  } catch (err) {
    console.error(`[WorldBoss] Guild ${guildId}: Failed to schedule next boss spawn:`, err);
  }

  return nextSpawnAt;
}

/**
 * Р’РѕР·РІСЂР°С‰Р°РµС‚ Р·Р°РїР»Р°РЅРёСЂРѕРІР°РЅРЅРѕРµ РІСЂРµРјСЏ СЃР»РµРґСѓСЋС‰РµРіРѕ СЃРїР°РІРЅР° Р±РѕСЃСЃР° (0 вЂ” СЃРїР°РІРЅ СЂР°Р·СЂРµС€С‘РЅ СЃСЂР°Р·Сѓ)
 */
async function getNextBossSpawnAt(db: any, guildId: string): Promise<number> {
  try {
    const result = await db.execute({
      sql: 'SELECT next_boss_spawn_at FROM users WHERE user_id = ? AND guild_id = ?',
      args: [guildId, guildId],
    });
    return (result.rows[0]?.next_boss_spawn_at as number) || 0;
  } catch (err) {
    return 0;
  }
}

/**
 * РџСЂРѕРІРµСЂСЏРµС‚ Рё СЃРїР°РІРЅРёС‚ РњРёСЂРѕРІРѕРіРѕ Р‘РѕСЃСЃР° РґР»СЏ РѕРґРЅРѕР№ РіРёР»СЊРґРёРё
 */
async function checkAndSpawnWorldBossForGuild(db: any, bot: Client, guildId: string): Promise<void> {
  try {
    const now = Date.now();

    // РџСЂРѕРІРµСЂРєР°: СЂР°Р·СЂРµС€РµРЅРѕ Р»Рё СЃРµР№С‡Р°СЃ Р·Р°РїСѓСЃРєР°С‚СЊ РёРІРµРЅС‚С‹
    if (!isEventTimeAllowed('Asia/Vladivostok')) {
      console.log(`[WorldBoss] Guild ${guildId}: Skipped - РІРЅРµ СЂР°Р·СЂРµС€С‘РЅРЅРѕРіРѕ РІСЂРµРјРµРЅРё РёРІРµРЅС‚РѕРІ`);
      return;
    }

    // РС‰РµРј Р°РєС‚РёРІРЅРѕРіРѕ Р±РѕСЃСЃР° РґР»СЏ РєРѕРЅРєСЂРµС‚РЅРѕР№ РіРёР»СЊРґРёРё
    const activeBossResult = await db.execute({
      sql: 'SELECT * FROM world_boss WHERE guild_id = ? AND status = ? LIMIT 1',
      args: [guildId, 'active'],
    });

    if (activeBossResult.rows.length > 0) {
      const boss = activeBossResult.rows[0];
      const expiresAt = boss.expires_at as number;

      // РџСЂРѕРІРµСЂСЏРµРј РёСЃС‚РµРє Р»Рё СЃСЂРѕРє Р±РѕСЃСЃР°
      if (now > expiresAt) {
        // Р‘РѕСЃСЃ СЃР±РµР¶Р°Р»
        await db.execute({
          sql: "UPDATE world_boss SET status = ? WHERE guild_id = ? AND id = ?",
          args: ['escaped', guildId, boss.id],
        });

        // РџР»Р°РЅРёСЂСѓРµРј СЂРµРґРєРёР№ СЃР»РµРґСѓСЋС‰РёР№ СЃРїР°РІРЅ: now + 60-120 С‡Р°СЃРѕРІ (2.5-5 РґРЅРµР№)
        await scheduleNextBossSpawn(db, guildId);

        // Р РµРґР°РєС‚РёСЂСѓРµРј СЃРѕРѕР±С‰РµРЅРёРµ РІ РєР°РЅР°Р»Рµ
        const channelId = boss.channel_id as string;
        const messageId = boss.message_id as string;

        if (channelId && messageId) {
          try {
            const guild = bot.guilds.cache.get(guildId);
            if (guild) {
              const channel = getEventTargetChannel(guild);
              if (channel) {
                await (channel as any).messages.fetch(messageId).then((msg: any) => {
                  return msg.edit({
                    embeds: [{
                      title: 'рџ’Ё Р‘РѕСЃСЃ СЃРєСЂС‹Р»СЃСЏ РІ С‚СѓРјР°РЅРµ!',
                      description: 'Р РµР№Рґ РЅРµ СѓСЃРїРµР» РѕРґРѕР»РµС‚СЊ Р±РѕСЃСЃР° Р·Р° РѕС‚РІРµРґРµРЅРЅРѕРµ РІСЂРµРјСЏ.',
                      color: 0x747f8d,
                    }],
                    components: [],
                  });
                });
                console.log(`[WorldBoss] Guild ${guildId}: Edited escaped boss message in channel ${channel.id}`);
              }
            }
          } catch (err) {
            console.error(`[WorldBoss] Guild ${guildId}: Failed to edit escaped boss message:`, err);
          }
        }
      }
    } else {
      // РќРµС‚ Р°РєС‚РёРІРЅРѕРіРѕ Р±РѕСЃСЃР° - РїСЂРѕРІРµСЂСЏРµРј СЂР°СЃРїРёСЃР°РЅРёРµ СЂРµРґРєРѕРіРѕ СЃРїР°РІРЅР°.
      // РЎРїР°РІРЅ РўРћР›Р¬РљРћ РµСЃР»Рё РІС‹С€Р»Рѕ РѕРєРЅРѕ РѕР¶РёРґР°РЅРёСЏ next_boss_spawn_at (60-120 С‡ РїРѕСЃР»Рµ
      // РїРѕСЂР°Р¶РµРЅРёСЏ/РїРѕР±РµРіР° РїСЂРѕС€Р»РѕРіРѕ Р±РѕСЃСЃР°). Р Р°Р·СЂРµС€С‘РЅРЅРѕРµ РІСЂРµРјСЏ РёРІРµРЅС‚РѕРІ (17:00-22:00 Р’Р»Рґ)
      // СѓР¶Рµ РїСЂРѕРІРµСЂРµРЅРѕ С‡РµСЂРµР· isEventTimeAllowed РІ РЅР°С‡Р°Р»Рµ С„СѓРЅРєС†РёРё.
      const nextSpawnAt = await getNextBossSpawnAt(db, guildId);
      if (Date.now() < nextSpawnAt) {
        const hoursLeft = Math.ceil((nextSpawnAt - Date.now()) / 3600000);
        console.log(`[WorldBoss] Guild ${guildId}: Spawn skipped - СЂРµРґРєРёР№ СЃРїР°РІРЅ, СЃР»РµРґСѓСЋС‰РёР№ Р±РѕСЃСЃ С‡РµСЂРµР· ~${hoursLeft} С‡.`);
        return;
      }

      const preset = WORLD_BOSS_PRESETS[Math.floor(Math.random() * WORLD_BOSS_PRESETS.length)];
      const spawnedAt = now;
      const expiresAt = now + preset.hours * 3600 * 1000;

      // Р’СЃС‚Р°РІР»СЏРµРј Р·Р°РїРёСЃСЊ Р±РѕСЃСЃР° СЃ guild_id
      const insertResult = await db.execute({
        sql: `INSERT INTO world_boss (guild_id, channel_id, boss_id, boss_name, boss_type, max_hp, current_hp, status, spawned_at, expires_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
        args: [guildId, BOSS_CHANNEL_ID, preset.boss_id, preset.boss_name, preset.boss_type, preset.max_hp, preset.max_hp, spawnedAt, expiresAt],
      });

      // РћР±РЅРѕРІР»СЏРµРј message_id СЃС‚СЂРѕРіРѕ Рє РїРѕСЃР»РµРґРЅРµР№ Р°РєС‚РёРІРЅРѕР№ Р·Р°РїРёСЃРё РґР»СЏ СЌС‚РѕР№ РіРёР»СЊРґРёРё
      const lastBossResult = await db.execute({
        sql: 'SELECT * FROM world_boss WHERE guild_id = ? AND status = ? ORDER BY id DESC LIMIT 1',
        args: [guildId, 'active'],
      });
      const boss = lastBossResult.rows[0];

      // РћС‚РїСЂР°РІР»СЏРµРј Embed РІ РєР°РЅР°Р»
      if (boss) {
        const guild = bot.guilds.cache.get(guildId);
        if (guild) {
          const channel = getEventTargetChannel(guild);
          if (channel) {
            try {
              const embed = renderBossEmbed({
                boss_id: preset.boss_id,
                boss_name: preset.boss_name,
                boss_type: preset.boss_type,
                max_hp: preset.max_hp,
                current_hp: preset.max_hp,
                desc: preset.desc,
                expires_at: expiresAt,
              });

              const msg = await (channel as any).send(embed);

              await db.execute({
                sql: 'UPDATE world_boss SET message_id = ? WHERE guild_id = ? AND id = ?',
                args: [msg.id, guildId, boss.id],
              });

              console.log(`[WorldBoss] Guild ${guildId}: Spawned ${preset.boss_name} in channel ${channel.id}, expires in ${preset.hours}h`);
              console.log(`[WorldBoss] Guild ${guildId}: Successfully linked message_id ${msg.id} to active boss`);
            } catch (err) {
              console.error(`[WorldBoss] Guild ${guildId}: Failed to send spawn message:`, err);
            }
          } else {
            console.log(`[WorldBoss] Guild ${guildId}: No suitable channel found for spawn message`);
          }
        }
      }
    }
  } catch (err) {
    console.error(`[WorldBoss] Guild ${guildId}: Error in checkAndSpawnWorldBoss:`, err);
  }
}

/**
 * РџСЂРѕРІРµСЂСЏРµС‚ Рё СЃРїР°РІРЅРёС‚ РњРёСЂРѕРІРѕРіРѕ Р‘РѕСЃСЃР° РґР»СЏ РІСЃРµС… РіРёР»СЊРґРёР№
 */
async function checkAndSpawnWorldBoss(db: any, bot: Client): Promise<void> {
  try {
    // РџРµСЂРµР±РёСЂР°РµРј РІСЃРµ РіРёР»СЊРґРёРё, РІ РєРѕС‚РѕСЂС‹С… СЃРѕСЃС‚РѕРёС‚ Р±РѕС‚
    for (const [guildId, guild] of bot.guilds.cache) {
      console.log(`[WorldBoss] Checking world boss for guild: ${guild.name} (${guildId})`);
      await checkAndSpawnWorldBossForGuild(db, bot, guildId);
    }
  } catch (err) {
    console.error('[WorldBoss] Error in checkAndSpawnWorldBoss loop:', err);
  }
}

// ============================================
// Р¤СѓРЅРєС†РёРё РґР»СЏ Р°РІС‚РѕРјР°С‚РёС‡РµСЃРєРѕРіРѕ РёСЃС‚РµС‡РµРЅРёСЏ РґСѓСЌР»РµР№ (Р­С‚Р°Рї 11+)
// ============================================

/**
 * РџСЂРѕРІРµСЂСЏРµС‚ РёСЃС‚С‘РєС€РёРµ РґСѓСЌР»Рё Рё РѕР±РЅРѕРІР»СЏРµС‚ РёС… СЃС‚Р°С‚СѓСЃ РЅР° 'expired'
 * Р’С‹Р·С‹РІР°РµС‚СЃСЏ РєР°Р¶РґС‹Рµ 20-30 СЃРµРєСѓРЅРґ
 */
async function checkExpiredDuels(db: any, bot: Client): Promise<void> {
  const nowMs = Date.now();
  const nowSeconds = Math.floor(nowMs / 1000);
  const duelTimeoutSeconds = 300; // 5 РјРёРЅСѓС‚

  try {
    // РС‰РµРј РґСѓСЌР»Рё СЃРѕ СЃС‚Р°С‚СѓСЃРѕРј 'pending', СЃРѕР·РґР°РЅРЅС‹Рµ Р±РѕР»РµРµ 5 РјРёРЅСѓС‚ РЅР°Р·Р°Рґ
    const expiredDuels = await db.execute({
      sql: "SELECT * FROM duels WHERE status = 'pending' AND (created_at + ?) < ?",
      args: [duelTimeoutSeconds, nowSeconds],
    });

    if (!expiredDuels.rows || expiredDuels.rows.length === 0) {
      return;
    }

    console.log(`[Duel] Found ${expiredDuels.rows.length} expired duels, processing...`);

    // РђС‚РѕРјР°СЂРЅРѕ РѕР±РЅРѕРІР»СЏРµРј СЃС‚Р°С‚СѓСЃ РІСЃРµС… РёСЃС‚С‘РєС€РёС… РґСѓСЌР»РµР№
    for (const duel of expiredDuels.rows) {
      const duelId = duel.id as string;
      const channelId = duel.channel_id as string;
      const messageId = duel.message_id as string;
      const guildId = duel.guild_id as string;

      // РђС‚РѕРјР°СЂРЅРѕРµ РѕР±РЅРѕРІР»РµРЅРёРµ: С‚РѕР»СЊРєРѕ РµСЃР»Рё СЃС‚Р°С‚СѓСЃ РІСЃС‘ РµС‰С‘ 'pending'
      const updateResult = await db.execute({
        sql: "UPDATE duels SET status = 'expired' WHERE id = ? AND status = 'pending'",
        args: [duelId],
      });

      if (!updateResult.rowsAffected || updateResult.rowsAffected === 0) {
        // Р”СѓСЌР»СЊ СѓР¶Рµ Р±С‹Р»Р° РѕР±СЂР°Р±РѕС‚Р°РЅР° РґСЂСѓРіРёРј С‚РёРєРµСЂРѕРј РёР»Рё РёР·РјРµРЅРµРЅР°
        continue;
      }

      console.log(`[Duel] Duel ${duelId} expired, editing message...`);

      // Р РµРґР°РєС‚РёСЂСѓРµРј СЃРѕРѕР±С‰РµРЅРёРµ РІ Discord, РµСЃР»Рё РµСЃС‚СЊ channel_id Рё message_id
      if (channelId && messageId) {
        try {
          const guild = bot.guilds.cache.get(guildId);
          if (guild) {
            const channel = getEventTargetChannel(guild);
            if (channel) {
              await (channel as any).messages.fetch(messageId).then((msg: any) => {
                return msg.edit({
                  embeds: [{
                    title: "вЏі Р”СѓСЌР»СЊ РѕС‚РєР»РѕРЅРµРЅР° РїРѕ С‚Р°Р№РјР°СѓС‚Сѓ",
                    description: "Р’СЂРµРјСЏ РЅР° РїСЂРёРЅСЏС‚РёРµ РІС‹Р·РѕРІР° (5 РјРёРЅСѓС‚) РёСЃС‚РµРєР»Рѕ. Р”СѓСЌР»СЊ Р°РІС‚РѕРјР°С‚РёС‡РµСЃРєРё Р°РЅРЅСѓР»РёСЂРѕРІР°РЅР°.",
                    color: 0x747f8d,
                  }],
                  components: [],
                });
              });
              console.log(`[Duel] Edited expired duel message in channel ${channelId}`);
            }
          }
        } catch (err) {
          console.error(`[Duel] Failed to edit expired duel message ${messageId}:`, err);
        }
      }
    }
  } catch (err) {
    console.error('[Duel] Error in checkExpiredDuels:', err);
  }
}

// ============================================
// Р¤СѓРЅРєС†РёРё РґР»СЏ Happy Hours (Р­С‚Р°Рї 4 - РЎС‡Р°СЃС‚Р»РёРІС‹Рµ С‡Р°СЃС‹)
// ============================================

/**
 * РџСЂРѕРІРµСЂСЏРµС‚, Р°РєС‚РёРІРµРЅ Р»Рё Happy Hour РґР»СЏ РіРёР»СЊРґРёРё
 * @returns multiplier (2.0) РµСЃР»Рё Р°РєС‚РёРІРµРЅ, РёРЅР°С‡Рµ 1.0
 */
async function isHappyHourActive(db: any, guildId: string): Promise<number> {
  try {
    const now = Date.now();
    const result = await db.execute({
      sql: 'SELECT multiplier FROM guild_events WHERE guild_id = ? AND event_type = ? AND ends_at > ? LIMIT 1',
      args: [guildId, 'happy_hour', now],
    });

    if (result.rows.length > 0) {
      const multiplier = result.rows[0].multiplier as number;
      console.log(`[HappyHour] Guild ${guildId} has active happy hour with multiplier ${multiplier}`);
      return multiplier;
    }
    return 1.0;
  } catch (err) {
    console.error('[HappyHour] Error checking active hour:', err);
    return 1.0;
  }
}

/**
 * Р—Р°РїСѓСЃРєР°РµС‚ Happy Hour РЅР° 60 РјРёРЅСѓС‚
 */
async function startHappyHour(db: any, guildId: string, bot: Client): Promise<void> {
  // РџСЂРѕРІРµСЂРєР°: СЂР°Р·СЂРµС€РµРЅРѕ Р»Рё СЃРµР№С‡Р°СЃ Р·Р°РїСѓСЃРєР°С‚СЊ РёРІРµРЅС‚С‹
  if (!isEventTimeAllowed('Asia/Vladivostok')) {
    console.log(`[HappyHour] Guild ${guildId}: Skipped - РІРЅРµ СЂР°Р·СЂРµС€С‘РЅРЅРѕРіРѕ РІСЂРµРјРµРЅРё РёРІРµРЅС‚РѕРІ`);
    return;
  }

  const now = Date.now();
  const endsAt = now + 60 * 60 * 1000; // 60 РјРёРЅСѓС‚

  try {
    await db.execute({
      sql: 'INSERT OR REPLACE INTO guild_events (guild_id, event_type, ends_at, multiplier) VALUES (?, ?, ?, ?)',
      args: [guildId, 'happy_hour', endsAt, 2.0],
    });
    console.log(`[HappyHour] Started for guild ${guildId}, ends at ${new Date(endsAt).toISOString()}`);

    // РС‰РµРј Р·Р°РєСЂРµРїР»С‘РЅРЅС‹Р№ РєР°РЅР°Р» СЃ fallback РЅР° СЃРёСЃС‚РµРјпїЅпїЅС‹Р№
    const guild = bot.guilds.cache.get(guildId);
    if (guild) {
      const channel = getEventTargetChannel(guild);

      if (channel) {
        const embed = {
          embeds: [{
            title: 'вљЎ РЎР§РђРЎРўР›РР’Р«Р™ Р§РђРЎ РќРђР§РђР›РЎРЇ!',
            description: 'Р”РІРѕР№РЅРѕР№ РѕРїС‹С‚ (2X XP) Р·Р° РІСЃРµ СЃРѕРѕР±С‰РµРЅРёСЏ Рё РІРѕР№СЃ РЅР° Р±Р»РёР¶Р°Р№С€РёРµ 60 РјРёРЅСѓС‚!',
            color: 0xFFD700,
            footer: { text: 'РќРµ РїСЂРѕРїСѓСЃС‚РёС‚Рµ СЌС‚РѕС‚ СЂРµРґРєРёР№ РёРІРµРЅС‚!' },
          }],
        };

        try {
          await channel.send(embed);
          console.log(`[HappyHour] Notification sent to guild ${guildId} channel ${channel.id}`);
        } catch (err) {
          console.error(`[HappyHour] Failed to send notification to guild ${guildId}:`, err);
        }
      } else {
        console.log(`[HappyHour] No suitable channel found for guild ${guildId}`);
      }
    }
  } catch (err) {
    console.error('[HappyHour] Error starting happy hour:', err);
  }
}

/**
 * РџСЂРѕРІРµСЂСЏРµС‚ Рё Р·Р°РїСѓСЃРєР°РµС‚ Happy Hour РґР»СЏ РІСЃРµС… РіРёР»СЊРґРёР№, РіРґРµ СЃРµРіРѕРґРЅСЏ РµС‰С‘ РЅРµ Р±С‹Р»Рѕ
 */
async function checkAndStartHappyHours(db: any, bot: Client): Promise<void> {
  const today = getVladivostokDate();
  const now = Date.now();

  try {
    // РџРѕР»СѓС‡Р°РµРј РІСЃРµ РіРёР»СЊРґРёРё (РёР· С‚Р°Р±Р»РёС†С‹ users)
    const guildsResult = await db.execute({
      sql: 'SELECT DISTINCT guild_id FROM users',
      args: [],
    });

    const guildIds = guildsResult.rows.map((r: any) => r.guild_id as string);
    console.log(`[HappyHour] Checking ${guildIds.length} guilds for happy hour...`);

    for (const guildId of guildIds) {
      // РџСЂРѕРІРµСЂСЏРµРј, Р±С‹Р» Р»Рё СѓР¶Рµ Р·Р°РїСѓС‰РµРЅ happy hour СЃРµРіРѕРґРЅСЏ
      const existingResult = await db.execute({
        sql: 'SELECT COUNT(*) as count FROM guild_events WHERE guild_id = ? AND event_type = ? AND ends_at > ?',
        args: [guildId, 'happy_hour', now - 24 * 60 * 60 * 1000], // Р—Р° РїРѕСЃР»РµРґРЅРёРµ 24 С‡Р°СЃР°
      });

      const existing = (existingResult.rows[0]?.count as number) || 0;

      if (existing === 0) {
        // РЁР°РЅСЃ 30% С‡С‚Рѕ Happy Hour Р·Р°РїСѓСЃС‚РёС‚СЃСЏ (С‡С‚РѕР±С‹ РЅРµ СЃРїР°РјРёС‚СЊ РєР°Р¶РґС‹Р№ С‡Р°СЃ)
        if (Math.random() < 0.3) {
          console.log(`[HappyHour] Rolling happy hour for guild ${guildId}...`);
          await startHappyHour(db, guildId, bot);
        } else {
          console.log(`[HappyHour] No roll for guild ${guildId}`);
        }
      } else {
        console.log(`[HappyHour] Already had happy hour today for guild ${guildId}`);
      }
    }
  } catch (err) {
    console.error('[HappyHour] Error checking starting hours:', err);
  }
}

// ============================================
// Р¤СѓРЅРєС†РёРё РґР»СЏ Р’РѕР№СЃ-РґСЂРѕРїРѕРІ (Р­С‚Р°Рї 4 - Air Drops)
// ============================================

// РҐСЂР°РЅРµРЅРёРµ РєСѓР»РґР°СѓРЅРѕРІ РґСЂРѕРїРѕРІ РІ РїР°РјСЏС‚Рё (channel_id -> timestamp)
const airDropCooldowns = new Map<string, number>();

/**
 * РџСЂРѕРІРµСЂСЏРµС‚, РјРѕР¶РЅРѕ Р»Рё СЃРґРµР»Р°С‚СЊ РґСЂРѕРї РІ РєР°РЅР°Р»Рµ (СѓС‡РёС‚С‹РІР°РµС‚ РєСѓР»РґР°СѓРЅ)
 */
function canSpawnDrop(channelId: string): boolean {
  const cooldownMs = 30 * 60 * 1000; // 30 РјРёРЅСѓС‚
  const lastSpawn = airDropCooldowns.get(channelId) || 0;
  return Date.now() - lastSpawn > cooldownMs;
}

/**
 * РџРѕРјРµС‡Р°РµС‚ РєР°РЅР°Р» РєР°Рє РёСЃРїРѕР»СЊР·СѓСЋС‰РёР№ РєСѓР»РґР°СѓРЅ РґСЂРѕРїР°
 */
function setDropCooldown(channelId: string): void {
  airDropCooldowns.set(channelId, Date.now());
}

/**
 * РЎРѕР·РґР°С‘С‚ Р·Р°РїРёСЃСЊ РґСЂРѕРїР° РІ Р‘Р”
 */
async function createAirDrop(db: any, guildId: string, channelId: string, rewardXp: number, rewardType: 'xp' | 'freeze'): Promise<string> {
  const dropId = `drop_${Date.now()}_${channelId.slice(-4)}`;
  const now = Math.floor(Date.now() / 1000);

  await db.execute({
    sql: 'INSERT INTO air_drops (id, guild_id, channel_id, reward_xp, reward_type, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    args: [dropId, guildId, channelId, rewardXp, rewardType, now],
  });

  return dropId;
}

/**
 * РћСЃСѓС‰РµСЃС‚РІР»СЏРµС‚ СЃРїР°РІРЅ РІРѕР№СЃ-РґСЂРѕРїР° РІ РєР°РЅР°Р»Рµ
 * РЎРїР°РІРЅ С‚РѕР»СЊРєРѕ РІ СЂР°Р·СЂРµС€С‘РЅРЅРѕРµ РІСЂРµРјСЏ РёРІРµРЅС‚РѕРІ
 */
async function spawnAirDrop(db: any, channel: any, guildId: string, bot: Client): Promise<void> {
  // РџСЂРѕРІРµСЂРєР°: СЂР°Р·СЂРµС€РµРЅРѕ Р»Рё СЃРµР№С‡Р°СЃ Р·Р°РїСѓСЃРєР°С‚СЊ РёРІРµРЅС‚С‹
  if (!isEventTimeAllowed('Asia/Vladivostok')) {
    return;
  }

  const channelId = channel.id;

  if (!canSpawnDrop(channelId)) {
    return;
  }

  // Р Р°РЅРґРѕРјРёР·Р°С†РёСЏ РЅР°РіСЂР°РґС‹:
  // 90% С€Р°РЅСЃ - XP (50-200), 10% С€Р°РЅСЃ - Р·Р°РјРѕСЂРѕР·РєР°
  const isFreeze = Math.random() < 0.10;
  const rewardXp = isFreeze ? 0 : Math.floor(Math.random() * 151) + 50; // 50-200
  const rewardType = isFreeze ? 'freeze' : 'xp';

  const dropId = await createAirDrop(db, guildId, channelId, rewardXp, rewardType);
  setDropCooldown(channelId);

  console.log(`[AirDrop] Spawned ${rewardType === 'freeze' ? 'freeze' : rewardXp + ' XP'} in ${channelId}`);

  // Р¤РѕСЂРјРёСЂСѓРµРј Embed
  const embed = {
    embeds: [{
      title: 'рџЋЃ РЎ РЅРµР±Р° СѓРїР°Р» РєРѕРЅС‚РµР№РЅРµСЂ СЃ РїСЂРёРїР°СЃР°РјРё!',
      description: 'РљС‚Рѕ РїРµСЂРІС‹Р№ РІСЃРєСЂРѕРµС‚ СЏС‰РёРє, Р·Р°Р±РµСЂС‘С‚ С†РµРЅРЅС‹Р№ Р»СѓС‚!',
      color: 0x3498DB,
      footer: { text: 'Р‘С‹СЃС‚СЂРµРµ РІСЃРµС… СѓСЃРїРµРµС€СЊ Р·Р°Р±СЂР°С‚СЊ!' },
    }],
    components: [{
      type: 1,
      components: [{
        type: 2,
        custom_id: `airdrop_claim_${dropId}`,
        style: 1, // Primary
        label: 'рџ“¦ Р—Р°Р±СЂР°С‚СЊ РґСЂРѕРї!',
      }],
    }],
  };

  try {
    await channel.send(embed);
    console.log(`[AirDrop] Message sent to channel ${channelId}`);
  } catch (err) {
    console.error(`[AirDrop] Failed to send to channel ${channelId}:`, err);
  }
}

/**
 * РџСЂРѕРІРµСЂСЏРµС‚ РіРѕР»РѕСЃРѕРІС‹Рµ РєР°РЅР°Р»С‹ Рё СЃРїР°РІРЅРёС‚ РґСЂРѕРїС‹
 */
async function checkAndSpawnAirDrops(db: any, bot: Client): Promise<void> {
  const guilds = bot.guilds.cache;

  for (const guild of guilds.values()) {
    const voiceChannels = guild.channels.cache.filter(c =>
      c.type === 2 // GuildVoice
    ) as any;

    for (const channel of voiceChannels.values()) {
      const members = channel.members;

      // Р¤РёР»СЊС‚СЂСѓРµРј: >= 3 С‡РµР»РѕРІРµРє, РЅРµ Р±РѕС‚С‹, РЅРµ deaf + mute
      const eligibleMembers = members.filter((m: any) =>
        !m.user.bot &&
        !m.voice.selfDeaf &&
        !m.voice.selfMute
      );

      if (eligibleMembers.size >= 3) {
        console.log(`[AirDrop] Checking voice channel ${channel.id} with ${eligibleMembers.size} eligible members`);
        await spawnAirDrop(db, channel, guild.id, bot);
      }
    }
  }
}

// ============================================
// Р¤СѓРЅРєС†РёРё РґР»СЏ СЂР°Р±РѕС‚С‹ СЃ РєРІРµСЃС‚Р°РјРё Рё РµР¶РµРґРЅРµРІРЅРѕР№ Р°РєС‚РёРІРЅРѕСЃС‚СЊСЋ
// ============================================
async function ensureQuestsPool(db: any): Promise<void> {
  try {
    const checkResult = await db.execute({
      sql: 'SELECT COUNT(*) as count FROM quests_pool',
      args: [],
    });
    const count = (checkResult.rows[0]?.count as number) || 0;

    if (count === 0) {
      console.log('[Quests] Pool is empty, initializing...');
      const placeholders = QUESTS_POOL.map(() => '(?, ?, ?, ?, ?, ?, ?)').join(', ');
      const values = QUESTS_POOL.flatMap(q => [
        q.id,
        q.title,
        q.desc,
        q.type === 'combo' ? 'messages' : q.type, // Р”Р»СЏ combo РёСЃРїРѕР»СЊР·СѓРµРј messages РєР°Рє Р±Р°Р·РѕРІС‹Р№ С‚РёРї
        q.target,
        q.xp,
        1
      ]);

      await db.execute({
        sql: `INSERT INTO quests_pool (id, title, description, quest_type, target_value, reward_xp, is_active) VALUES ${placeholders}`,
        args: values,
      });
      console.log(`[Quests] Initialized ${QUESTS_POOL.length} quests in pool`);
    }
  } catch (err) {
    console.error('[Quests] Error ensuring pool:', err);
  }
}

// РџРѕР»СѓС‡РµРЅРёРµ Р°РєС‚РёРІРЅС‹С… РєРІРµСЃС‚РѕРІ РіРёР»СЊРґРёРё РЅР° СЃРµРіРѕРґРЅСЏ
async function getDailyQuests(db: any, guildId: string): Promise<any[]> {
  const today = getVladivostokDate();
  try {
    const result = await db.execute({
      sql: `SELECT qd.*, qp.title, qp.description, qp.quest_type, qp.reward_xp
            FROM quests_daily qd
            JOIN quests_pool qp ON qd.quest_id = qp.id
            WHERE qd.guild_id = ? AND qd.active_date = ?`,
      args: [guildId, today],
    });
    return result.rows || [];
  } catch (err) {
    console.error('[Quests] Error getting daily quests:', err);
    return [];
  }
}

// Р“РµРЅРµСЂР°С†РёСЏ ID РґР»СЏ daily quest Р·Р°РїРёСЃРё
function generateDailyQuestId(guildId: string, questId: string, index: number): string {
  return `${guildId}_${getVladivostokDate()}_${index}`;
}

// РќР°Р·РЅР°С‡РµРЅРёРµ РєРІРµСЃС‚РѕРІ РіРёР»СЊРґРёРё РЅР° СЃРµРіРѕРґРЅСЏ (РµСЃР»Рё РЅРµ РЅР°Р·РЅР°С‡РµРЅС‹)
async function ensureDailyQuests(db: any, guildId: string): Promise<any[]> {
  const today = getVladivostokDate();
  try {
    // РџСЂРѕРІРµСЂСЏРµРј, РµСЃС‚СЊ Р»Рё СѓР¶Рµ РєРІРµСЃС‚С‹ РЅР° СЃРµРіРѕРґРЅСЏ
    const existing = await db.execute({
      sql: 'SELECT COUNT(*) as count FROM quests_daily WHERE guild_id = ? AND active_date = ?',
      args: [guildId, today],
    });
    const count = (existing.rows[0]?.count as number) || 0;

    if (count > 0) {
      return getDailyQuests(db, guildId);
    }

    console.log(`[Quests] Assigning daily quests for guild ${guildId}...`);

    // РџРѕР»СѓС‡Р°РµРј РґРѕСЃС‚СѓРїРЅС‹Рµ РєРІРµСЃС‚С‹ РёР· РїСѓР»Р°
    const poolResult = await db.execute({
      sql: 'SELECT * FROM quests_pool WHERE is_active = 1',
      args: [],
    });
    const pool = poolResult.rows || [];

    if (pool.length === 0) {
      console.warn('[Quests] No quests in pool!');
      return [];
    }

    // Р’С‹Р±РёСЂР°РµРј 3-4 СЃР»СѓС‡Р°Р№РЅС‹С… РєРІРµСЃС‚Р°:
    // 1 С‚РµРєСЃС‚РѕРІС‹Р№ (messages), 1 РіРѕР»РѕСЃРѕРІРѕР№ (voice), 1 СЃР»РѕР¶РЅС‹Р№/РєРѕРјР±Рѕ
    const messagesQuests = pool.filter((q: any) => q.quest_type === 'messages' && q.quest_type !== 'voice');
    const voiceQuests = pool.filter((q: any) => q.quest_type === 'voice');
    const otherQuests = pool.filter((q: any) => q.quest_type === 'combo' || (q.quest_type !== 'messages' && q.quest_type !== 'voice'));

    const selected: any[] = [];

    // 1 С‚РµРєСЃС‚РѕРІС‹Р№ РєРІРµСЃС‚ (Р»РµРіРєРёР№)
    if (messagesQuests.length > 0) {
      const msg = messagesQuests[Math.floor(Math.random() * messagesQuests.length)];
      selected.push({ ...msg, quest_type: 'messages' });
    }

    // 1 РіРѕР»РѕСЃРѕРІРѕР№ РєРІРµСЃС‚
    if (voiceQuests.length > 0) {
      const vo = voiceQuests[Math.floor(Math.random() * voiceQuests.length)];
      selected.push({ ...vo, quest_type: 'voice' });
    }

    // 1 СЃР»РѕР¶РЅС‹Р№/РєРѕРјР±Рѕ РєРІРµСЃС‚
    if (otherQuests.length > 0) {
      const oth = otherQuests[Math.floor(Math.random() * otherQuests.length)];
      selected.push({ ...oth, quest_type: oth.quest_type });
    }

    // Р’СЃС‚Р°РІР»СЏРµРј daily quests
    const insertValues: any[] = [];
    const insertPlaceholders: string[] = [];
    selected.forEach((quest, idx) => {
      insertPlaceholders.push('(?, ?, ?, ?, ?)');
      insertValues.push(
        generateDailyQuestId(guildId, quest.id, idx),
        guildId,
        quest.id,
        today,
        quest.target_value || quest.target,
        quest.reward_xp || quest.xp
      );
    });

    if (insertPlaceholders.length > 0) {
      await db.execute({
        sql: `INSERT INTO quests_daily (id, guild_id, quest_id, active_date, target, reward_xp) VALUES ${insertPlaceholders.join(', ')}`,
        args: insertValues,
      });
      console.log(`[Quests] Assigned ${insertPlaceholders.length} quests for guild ${guildId}`);
    }

    return getDailyQuests(db, guildId);
  } catch (err) {
    console.error('[Quests] Error ensuring daily quests:', err);
    return [];
  }
}

// РћР±РЅРѕРІР»РµРЅРёРµ РїСЂРѕРіСЂРµСЃСЃР° РєРІРµСЃС‚Р° РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ
async function updateQuestProgress(db: any, userId: string, guildId: string, questDailyId: string, increment: number, questType: string): Promise<void> {
  try {
    // UPSERT РІ РїСЂРѕРіСЂРµСЃСЃ
    const upsertResult = await db.execute({
      sql: `INSERT INTO user_quest_progress (user_id, guild_id, quest_daily_id, current_progress)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(user_id, guild_id, quest_daily_id)
            DO UPDATE SET current_progress = current_progress + ?`,
      args: [userId, guildId, questDailyId, increment, increment],
    });

    // РџРѕР»СѓС‡Р°РµРј С‚РµРєСѓС‰РёР№ РїСЂРѕРіСЂРµСЃСЃ Рё С†РµР»СЊ
    const progressResult = await db.execute({
      sql: `SELECT uqp.current_progress, uqp.completed_at, qd.target, qd.reward_xp
            FROM user_quest_progress uqp
            JOIN quests_daily qd ON uqp.quest_daily_id = qd.id
            WHERE uqp.user_id = ? AND uqp.guild_id = ? AND uqp.quest_daily_id = ?`,
      args: [userId, guildId, questDailyId],
    });

    if (progressResult.rows.length === 0) return;

    const row = progressResult.rows[0];
    const current = (row.current_progress as number) || 0;
    const completedAt = row.completed_at as number | null;
    const target = (row.target as number) || 0;
    const rewardXp = (row.reward_xp as number) || 0;

    // Р•СЃР»Рё Р·Р°РІРµСЂС€РµРЅ - РїСЂРѕРїСѓСЃРєР°РµРј
    if (completedAt !== null) return;

    // РџСЂРѕРІРµСЂСЏРµРј РґРѕСЃС‚РёР¶РµРЅРёРµ С†РµР»Рё
    if (current >= target) {
      // M1: Р°С‚РѕРјР°СЂРЅР°СЏ РїРѕРјРµС‚РєР° РІС‹РїРѕР»РЅРµРЅРёСЏ (СѓСЃР»РѕРІРёРµ completed_at IS NULL) вЂ”
      // РЅР°РіСЂР°РґР° РЅР°С‡РёСЃР»СЏРµС‚СЃСЏ РўРћР›Р¬РљРћ РµСЃР»Рё СЌС‚РѕС‚ РІС‹Р·РѕРІ РІС‹РёРіСЂР°Р» РіРѕРЅРєСѓ Р·Р° РІС‹РїРѕР»РЅРµРЅРёРµ
      const claimResult = await db.execute({
        sql: `UPDATE user_quest_progress SET completed_at = ?
              WHERE user_id = ? AND guild_id = ? AND quest_daily_id = ? AND completed_at IS NULL`,
        args: [Date.now(), userId, guildId, questDailyId],
      });

      if ((claimResult.rowsAffected as number) === 1) {
        // РќР°С‡РёСЃР»СЏРµРј XP
        await db.execute({
          sql: `UPDATE users SET xp = xp + ? WHERE user_id = ? AND guild_id = ?`,
          args: [rewardXp, userId, guildId],
        });

        // РќР°С‡РёСЃР»СЏРµРј РјРѕРЅРµС‚С‹ Р·Р° РІС‹РїРѕР»РЅРµРЅРёРµ РєРІРµСЃС‚Р° (+100 рџЄ™)
        await db.execute({
          sql: `UPDATE users SET coins = coins + 100 WHERE user_id = ? AND guild_id = ?`,
          args: [userId, guildId],
        });

        console.log(`[Quest] User ${userId} completed quest ${questDailyId} - +${rewardXp} XP, +100 рџЄ™`);
      }
    }
  } catch (err) {
    console.error('[Quest] Error updating progress:', err);
  }
}

// РћР±РЅРѕРІР»РµРЅРёРµ РµР¶РµРґРЅРµРІРЅРѕР№ Р°РєС‚РёРІРЅРѕСЃС‚Рё РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ
async function updateDailyActivity(db: any, userId: string, guildId: string, messages: number, voiceSeconds: number): Promise<void> {
  const today = getVladivostokDate();
  try {
    await db.execute({
      sql: `INSERT INTO user_daily_activity (user_id, guild_id, activity_date, messages_count, voice_seconds)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(user_id, guild_id, activity_date)
            DO UPDATE SET
              messages_count = messages_count + excluded.messages_count,
              voice_seconds = voice_seconds + excluded.voice_seconds`,
      args: [userId, guildId, today, messages, voiceSeconds],
    });
  } catch (err) {
    console.error('[Activity] Error updating daily activity:', err);
  }
}

// РџСЂРѕРІРµСЂРєР° РєРІРµСЃС‚РѕРІ С‚РёРїР° messages РїСЂРё СЃРѕР·РґР°РЅРёРё СЃРѕРѕР±С‰РµРЅРёСЏ
async function checkQuestsForMessage(db: any, userId: string, guildId: string, message: Message): Promise<void> {
  const today = getVladivostokDate();

  try {
    // РџРѕР»СѓС‡Р°РµРј Р°РєС‚РёРІРЅС‹Рµ РєРІРµСЃС‚С‹ РіРёР»СЊРґРёРё РЅР° СЃРµРіРѕРґРЅСЏ С‚РёРїР° messages
    const questsResult = await db.execute({
      sql: `SELECT qd.*, qp.quest_type
            FROM quests_daily qd
            JOIN quests_pool qp ON qd.quest_id = qp.id
            WHERE qd.guild_id = ? AND qd.active_date = ? AND qp.quest_type IN ('messages', 'combo')`,
      args: [guildId, today],
    });

    const quests = questsResult.rows || [];
    if (quests.length === 0) return;

    // Р”Р»СЏ РєРІРµСЃС‚РѕРІ С‚РёРїР° combo РїСЂРѕРІРµСЂСЏРµРј Рё РіРѕР»РѕСЃ
    for (const quest of quests) {
      const questDailyId = quest.id as string;
      const questType = quest.quest_type as string;

      if (questType === 'messages') {
        // РћР±С‹С‡РЅС‹Р№ С‚РµРєСЃС‚РѕРІС‹Р№ РєРІРµСЃС‚ - РёРЅРєСЂРµРјРµРЅС‚ РЅР° 1
        await updateQuestProgress(db, userId, guildId, questDailyId, 1, 'messages');
      } else if (questType === 'combo') {
        // РљРѕРјР±Рѕ РєРІРµСЃС‚ - РїСЂРѕРІРµСЂСЏРµРј С‚РµРєСѓС‰РёР№ РїСЂРѕРіСЂРµСЃСЃ
        // Р”Р»СЏ combo РЅСѓР¶РЅР° СЃРїРµС†РёР°Р»СЊРЅР°СЏ Р»РѕРіРёРєР° - РѕР±РЅРѕРІР»СЏРµРј РЅР° 1, РЅРѕ С†РµР»СЊ РІС‹С€Рµ
        await updateQuestProgress(db, userId, guildId, questDailyId, 1, 'combo');
      }
    }

    // РџСЂРѕРІРµСЂРєР° РєРІРµСЃС‚Р° "Р¤РёР»РѕСЃРѕС„" (СЃРѕРѕР±С‰РµРЅРёСЏ > 100 СЃРёРјРІРѕР»РѕРІ)
    const longTextQuestResult = await db.execute({
      sql: `SELECT qd.id
            FROM quests_daily qd
            JOIN quests_pool qp ON qd.quest_id = qp.id
            WHERE qd.guild_id = ? AND qd.active_date = ? AND qp.id = 'messages_long_20_100xp'`,
      args: [guildId, today],
    });

    if (longTextQuestResult.rows.length > 0 && (message.content?.length || 0) > 100) {
      const questDailyId = longTextQuestResult.rows[0].id as string;
      await updateQuestProgress(db, userId, guildId, questDailyId, 1, 'messages');
    }
  } catch (err) {
    console.error('[Quests] Error checking quests for message:', err);
  }
}

// РџСЂРѕРІРµСЂРєР° РєРІРµСЃС‚РѕРІ С‚РёРїР° voice РїСЂРё РёР·РјРµРЅРµРЅРёРё РіРѕР»РѕСЃРѕРІРѕРіРѕ СЃС‚Р°С‚СѓСЃР°
async function checkQuestsForVoice(db: any, userId: string, guildId: string, voiceSeconds: number, now: Date): Promise<void> {
  const today = getVladivostokDate();

  try {
    // РџРѕР»СѓС‡Р°РµРј Р°РєС‚РёРІРЅС‹Рµ РєРІРµСЃС‚С‹ РіРёР»СЊРґРёРё РЅР° СЃРµРіРѕРґРЅСЏ С‚РёРїР° voice
    const questsResult = await db.execute({
      sql: `SELECT qd.*, qp.quest_type
            FROM quests_daily qd
            JOIN quests_pool qp ON qd.quest_id = qp.id
            WHERE qd.guild_id = ? AND qd.active_date = ? AND qp.quest_type IN ('voice', 'combo')`,
      args: [guildId, today],
    });

    const quests = questsResult.rows || [];
    if (quests.length === 0) return;

    // РџРµСЂРµРІРѕРґРёРј СЃРµРєСѓРЅРґС‹ РІ РјРёРЅСѓС‚С‹
    const voiceMinutes = Math.floor(voiceSeconds / 60);
    if (voiceMinutes === 0) return;

    // Р”Р»СЏ РєРІРµСЃС‚РѕРІ С‚РёРїР° voice Рё combo РёРЅРєСЂРµРјРµРЅС‚РёСЂСѓРµРј РїРѕ РјРёРЅСѓС‚Р°Рј
    for (const quest of quests) {
      const questDailyId = quest.id as string;
      const questType = quest.quest_type as string;

      if (questType === 'voice') {
        // Р“РѕР»РѕСЃРѕРІРѕР№ РєРІРµСЃС‚ - РёРЅРєСЂРµРјРµРЅС‚РёСЂСѓРµРј РїРѕ РјРёРЅСѓС‚Р°Рј
        await updateQuestProgress(db, userId, guildId, questDailyId, voiceMinutes, 'voice');
      } else if (questType === 'combo') {
        // РљРѕРјР±Рѕ РєРІРµСЃС‚ - РёРЅРєСЂРµРјРµРЅС‚РёСЂСѓРµРј РїРѕ РјРёРЅСѓС‚Р°Рј
        await updateQuestProgress(db, userId, guildId, questDailyId, voiceMinutes, 'combo');
      }
    }

    // РџСЂРѕРІРµСЂРєР° РєРІРµСЃС‚Р° "РќРѕС‡РЅРѕР№ РґРѕР·РѕСЂ" (РїРѕСЃР»Рµ 00:00 UTC)
    const hour = now.getUTCHours();
    if (hour >= 0 && hour < 6) {
      const nightQuestResult = await db.execute({
        sql: `SELECT qd.id
              FROM quests_daily qd
              JOIN quests_pool qp ON qd.quest_id = qp.id
              WHERE qd.guild_id = ? AND qd.active_date = ? AND qp.id = 'voice_night_30_200xp'`,
        args: [guildId, today],
      });

      if (nightQuestResult.rows.length > 0) {
        const questDailyId = nightQuestResult.rows[0].id as string;
        await updateQuestProgress(db, userId, guildId, questDailyId, voiceMinutes, 'voice');
      }
    }
  } catch (err) {
    console.error('[Quests] Error checking quests for voice:', err);
  }
}

// ============================================
// Р•Р¶РµРЅРµРґРµР»СЊРЅР°СЏ AI-РіР°Р·РµС‚Р° (РҐСЂРѕРЅРёРєР° РЅРµРґРµР»Рё Р·Р° 7 РґРЅРµР№)
// ============================================

const GAZETTE_CHANNEL_ID = '1051085743839260694';
const PROXYAPI_KEY = process.env.PROXYAPI_KEY || 'sk-7vNVmFz9SukzwvLQ7VEfd8ZLXG4O76iE';
const PROXYAPI_URL = 'https://api.proxyapi.ru/v1/chat/completions';
const PROXYAPI_MODEL = 'z-ai/glm-5.3-flash';

const GAZETTE_PROMPT = `РўС‹ вЂ” Р°РІС‚РѕСЂ РµР¶РµРЅРµРґРµР»СЊРЅРѕР№ РіР°Р·РµС‚С‹ Discord-СЃРµСЂРІРµСЂР°. РўРІРѕСЏ Р·Р°РґР°С‡Р° вЂ” РїСЂРѕС‡РёС‚Р°С‚СЊ Р’РЎР® РїРµСЂРµРїРёСЃРєСѓ СѓС‡Р°СЃС‚РЅРёРєРѕРІ Р·Р° РїСЂРѕС€РµРґС€РёРµ 7 РґРЅРµР№ РёР· СЌС‚РѕРіРѕ РєР°РЅР°Р»Р° Рё РЅР°РїРёСЃР°С‚СЊ Р¶РёРІРѕР№, СЃРІСЏР·РЅС‹Р№ Рё Р·Р°Р±Р°РІРЅС‹Р№ РїРµСЂРµСЃРєР°Р· РѕСЃРЅРѕРІРЅС‹С… СЃРѕР±С‹С‚РёР№ РЅРµРґРµР»Рё.
РћРїРёСЂР°Р№СЃСЏ РЎРўР РћР“Рћ РЅР° СЂРµР°Р»СЊРЅС‹Р№ РєРѕРЅС‚РµРєСЃС‚ РїРµСЂРµРїРёСЃРєРё:
- Рћ С‡РµРј СЃРїРѕСЂРёР»Рё РёР»Рё СѓРІР»РµС‡РµРЅРЅРѕ РѕР±С‰Р°Р»РёСЃСЊ СѓС‡Р°СЃС‚РЅРёРєРё РІ СЂР°Р·РЅС‹Рµ РґРЅРё?
- РљР°РєРёРµ Р·Р°Р±Р°РІРЅС‹Рµ РґРёР°Р»РѕРіРё, С„Р°РєР°РїС‹ РёР»Рё Р»РѕРєР°Р»СЊРЅС‹Рµ СЃРѕР±С‹С‚РёСЏ РїСЂРѕРёР·РѕС€Р»Рё?
- РљС‚Рѕ Р±С‹Р» СЃР°РјС‹Рј Р°РєС‚РёРІРЅС‹Рј Рё С‡РµРј РѕС‚Р»РёС‡РёР»СЃСЏ?
РџРёС€Рё Р±РѕРґСЂРѕ, СЃ Р»РµРіРєРёРј СЃРµСЂРІРµСЂРЅС‹Рј СЋРјРѕСЂРѕРј, Р±РµР· РєР»РёС€Рµ.
Р¤РѕСЂРјР°С‚:
**Р“РђР—Р•РўРђ РЎР•Р Р’Р•Р Рђ: РҐР РћРќРРљРђ РЎРћР‘Р«РўРР™ Р—Рђ РќР•Р”Р•Р›Р®**
(СЃРІСЏР·РЅС‹Р№ СЂР°СЃСЃРєР°Р· Рѕ РіР»Р°РІРЅС‹С… С‚РµРјР°С… Рё РїСЂРёРєРѕР»Р°С… РЅРµРґРµР»Рё СЃ С†РёС‚Р°С‚Р°РјРё Рё С‚РµРіР°РјРё СѓС‡Р°СЃС‚РЅРёРєРѕРІ С‡РµСЂРµР· РЅРёРєРЅРµР№Рј)`;

/**
 * Р¤РѕСЂРјР°С‚РёСЂСѓРµС‚ РґР°С‚Сѓ СЃРѕРѕР±С‰РµРЅРёСЏ РїРѕ РІСЂРµРјРµРЅРё Р’Р»Р°РґРёРІРѕСЃС‚РѕРєР°: "YYYY-MM-DD HH:mm"
 */
function formatVladivostokDateTime(timestamp: number): string {
  const shifted = new Date(timestamp + 10 * 60 * 60 * 1000); // UTC+10
  const dateStr = shifted.toISOString().slice(0, 10); // YYYY-MM-DD
  const timeStr = shifted.toISOString().slice(11, 16); // HH:mm
  return `${dateStr} ${timeStr}`;
}

/**
 * РЎРѕР±РёСЂР°РµС‚ С…СЂРѕРЅРѕР»РѕРіРёСЋ Р’РЎР•РҐ СЃРѕРѕР±С‰РµРЅРёР№ РєР°РЅР°Р»Р° Р·Р° РїРѕСЃР»РµРґРЅРёРµ 7 РґРЅРµР№
 * С‡РµСЂРµР· С†РёРєР» РїР°РіРёРЅР°С†РёРё Discord (fetch + before)
 */
async function collectWeeklyChronology(channel: any): Promise<string[]> {
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const lines: string[] = [];
  let lastId: string | undefined = undefined;

  while (true) {
    const fetchOptions: any = { limit: 100 };
    if (lastId) fetchOptions.before = lastId;

    const messages = await channel.messages.fetch(fetchOptions);
    if (messages.size === 0) break;

    let reachedCutoff = false;
    for (const msg of messages.values()) {
      if (msg.createdTimestamp < sevenDaysAgo) {
        reachedCutoff = true;
        break;
      }
      // РРіРЅРѕСЂРёСЂСѓРµРј Р±РѕС‚РѕРІ Рё СЃРѕРѕР±С‰РµРЅРёСЏ Р±РµР· С‚РµРєСЃС‚Р° (РІР»РѕР¶РµРЅРёСЏ/СЃС‚РёРєРµСЂС‹)
      if (msg.author.bot) continue;
      const content = (msg.content || '').trim();
      if (!content) continue;
      lines.push(`${formatVladivostokDateTime(msg.createdTimestamp)} ${msg.author.username}: ${content}`);
    }

    if (reachedCutoff || messages.size < 100) break;
    lastId = messages.last().id;
  }

  // РҐСЂРѕРЅРѕР»РѕРіРёСЏ РѕС‚ СЃС‚Р°СЂС‹С… Рє РЅРѕРІС‹Рј
  return lines.reverse();
}

/**
 * РћС‚РїСЂР°РІР»СЏРµС‚ С…СЂРѕРЅРѕРіСЂР°С„РёСЋ РЅРµРґРµР»Рё РІ ProxyAPI Рё РїРѕР»СѓС‡Р°РµС‚ С‚РµРєСЃС‚ РіР°Р·РµС‚С‹
 */
async function generateDigestWithAI(chronology: string[]): Promise<string> {
  const response = await fetch(PROXYAPI_URL, {
    method: 'POST', // РРјРµРЅРЅРѕ POST: GET РЅР° СЌС‚РѕРј СЌРЅРґРїРѕРёРЅС‚Рµ РґР°С‘С‚ "Method Not Allowed"
    headers: {
      'Authorization': `Bearer ${PROXYAPI_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: PROXYAPI_MODEL,
      messages: [
        { role: 'system', content: GAZETTE_PROMPT },
        { role: 'user', content: `РҐСЂРѕРЅРёРєР° СЃРѕРѕР±С‰РµРЅРёР№ Р·Р° РїРѕСЃР»РµРґРЅРёРµ 7 РґРЅРµР№:\n\n${chronology.join('\n')}` },
      ],
      temperature: 0.8,
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`ProxyAPI ${response.status}: ${errText.slice(0, 300)}`);
  }

  const data: any = await response.json();
  const digest = data?.choices?.[0]?.message?.content;
  if (!digest || typeof digest !== 'string') {
    throw new Error('ProxyAPI РІРµСЂРЅСѓР» РїСѓСЃС‚РѕР№ РѕС‚РІРµС‚');
  }
  return digest.trim();
}

/**
 * РџСѓР±Р»РёРєСѓРµС‚ РµР¶РµРЅРµРґРµР»СЊРЅСѓСЋ AI-РіР°Р·РµС‚Сѓ РІ РєР°РЅР°Р» РёРІРµРЅС‚РѕРІ
 */
async function runWeeklyDigest(guild: any): Promise<void> {
  const channel = guild.channels.cache.get(GAZETTE_CHANNEL_ID);
  if (!channel || channel.type !== 0) {
    throw new Error(`РљР°РЅР°Р» ${GAZETTE_CHANNEL_ID} РЅРµ РЅР°Р№РґРµРЅ РЅР° СЃРµСЂРІРµСЂРµ ${guild.id}`);
  }

  console.log(`[Gazeta] Collecting messages for guild ${guild.id}...`);
  const chronology = await collectWeeklyChronology(channel);

  if (chronology.length === 0) {
    throw new Error('Р—Р° РїРѕСЃР»РµРґРЅРёРµ 7 РґРЅРµР№ РЅРµ РЅР°Р№РґРµРЅРѕ СЃРѕРѕР±С‰РµРЅРёР№ вЂ” РІС‹РїСѓСЃРє РѕС‚РјРµРЅС‘РЅ');
  }

  console.log(`[Gazeta] Collected ${chronology.length} messages, generating digest...`);
  const digest = await generateDigestWithAI(chronology);

  const embed = {
    embeds: [{
      title: 'рџ“° РЎРІРµР¶РёР№ РІС‹РїСѓСЃРє: РҐСЂРѕРЅРёРєР° РЅРµРґРµР»Рё',
      description: digest.slice(0, 4000), // Р›РёРјРёС‚ РѕРїРёСЃР°РЅРёСЏ Embed вЂ” 4096 СЃРёРјРІРѕР»РѕРІ
      color: 0x5865F2,
      footer: { text: 'Р•Р¶РµРЅРµРґРµР»СЊРЅР°СЏ AI-РіР°Р·РµС‚Р° вЂў РЎРѕР±С‹С‚РёСЏ Р·Р° РїРѕСЃР»РµРґРЅРёРµ 7 РґРЅРµР№' },
      timestamp: new Date().toISOString(),
    }],
  };

  await channel.send(embed);
  console.log(`[Gazeta] Weekly digest published to channel ${GAZETTE_CHANNEL_ID}`);
}

/**
 * РџР»Р°РЅРёСЂСѓРµС‚ РµР¶РµРЅРµРґРµР»СЊРЅС‹Р№ Р·Р°РїСѓСЃРє РіР°Р·РµС‚С‹: РєР°Р¶РґРѕРµ РІРѕСЃРєСЂРµСЃРµРЅСЊРµ РІ 20:00 (Asia/Vladivostok)
 */
function scheduleWeeklyDigest(bot: Client): void {
  const scheduleNext = () => {
    const now = new Date();
    // Р’Р»Р°РґРёРІРѕСЃС‚РѕРє: С„РёРєСЃРёСЂРѕРІР°РЅРЅС‹Р№ UTC+10, Р±РµР· РїРµСЂРµРІРѕРґР° С‡Р°СЃРѕРІ
    const vlad = new Date(now.getTime() + 10 * 60 * 60 * 1000);
    const dayOfWeek = vlad.getUTCDay(); // 0 = РІРѕСЃРєСЂРµСЃРµРЅСЊРµ
    const secondsOfDay = vlad.getUTCHours() * 3600 + vlad.getUTCMinutes() * 60 + vlad.getUTCSeconds();
    const targetSeconds = 20 * 3600; // 20:00

    let daysAhead = (7 - dayOfWeek) % 7;
    if (daysAhead === 0 && secondsOfDay >= targetSeconds) {
      // РЎРµРіРѕРґРЅСЏ РІРѕСЃРєСЂРµСЃРµРЅСЊРµ, РЅРѕ 20:00 СѓР¶Рµ РїСЂРѕС€Р»Рѕ вЂ” Р¶РґС‘Рј СЃР»РµРґСѓСЋС‰СѓСЋ РЅРµРґРµР»СЋ
      daysAhead = 7;
    }

    const delayMs = daysAhead * 86400000 + (targetSeconds - secondsOfDay) * 1000 - now.getMilliseconds();

    console.log(`[Gazeta] Next digest in ${Math.round(delayMs / 3600000)}h (Sunday 20:00 Vladivostok)`);

    setTimeout(async () => {
      try {
        for (const guild of bot.guilds.cache.values()) {
          try {
            await runWeeklyDigest(guild as any);
          } catch (err) {
            console.error(`[Gazeta] Digest failed for guild ${guild.id}:`, err);
          }
        }
      } finally {
        scheduleNext(); // РџР»Р°РЅРёСЂСѓРµРј СЃР»РµРґСѓСЋС‰РёР№ РІС‹РїСѓСЃРє
      }
    }, Math.max(delayMs, 1000));
  };

  scheduleNext();
}

// ============================================
// РРґРµРјРїРѕС‚РµРЅС‚РЅС‹Р№ СЃСѓС‚РѕС‡РЅС‹Р№ СЂРѕСЃС‚ РєР°Р·РЅС‹ РєРѕРјРїР°РЅРёР№ (Р‘РёСЂР¶Р°)
// ============================================

/**
 * Р Р°Р· РІ СЃСѓС‚РєРё РЅР°С‡РёСЃР»СЏРµС‚ РєРѕРјРїР°РЅРёСЏРј СЂРѕСЃС‚ РєР°Р·РЅС‹ РёР· СЂРµР·РµСЂРІР° СЃРµСЂРІРµСЂР°.
 * РРґРµРјРїРѕС‚РµРЅС‚РЅРѕСЃС‚СЊ: РєРѕРјРїР°РЅРёСЏ РѕР±СЂР°Р±Р°С‚С‹РІР°РµС‚СЃСЏ С‚РѕР»СЊРєРѕ РµСЃР»Рё last_growth_day
 * РїСѓСЃС‚ РёР»Рё РјРµРЅСЊС€Рµ СЃРµРіРѕРґРЅСЏС€РЅРµР№ РґР°С‚С‹ (Р’Р»Р°РґРёРІРѕСЃС‚РѕРє). РљРѕРјРїР°РЅРёРё РІС‹Р±РёСЂР°СЋС‚СЃСЏ
 * РІ СЃР»СѓС‡Р°Р№РЅРѕРј РїРѕСЂСЏРґРєРµ (ORDER BY RANDOM()), РєР°Р¶РґР°СЏ вЂ” РІ СЃРІРѕРµР№ С‚СЂР°РЅР·Р°РєС†РёРё.
 */
async function processDailyCompanyGrowth(db: any, bot: Client): Promise<void> {
  const todayStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Vladivostok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
  // Р•РґРёРЅС‹Р№ ts РґР»СЏ СЃС‚СЂРѕРє РёСЃС‚РѕСЂРёРё NAV СЌС‚РѕРіРѕ Р·Р°РїСѓСЃРєР° (СЃРµРєСѓРЅРґС‹, РєР°Рє РІ РѕСЃС‚Р°Р»СЊРЅС‹С… С‚Р°Р±Р»РёС†Р°С… Р±РёСЂР¶Рё)
  const nowSec = Math.floor(Date.now() / 1000);

  try {
    // Р“РёР»СЊРґРёРё, РІ РєРѕС‚РѕСЂС‹С… РµСЃС‚СЊ РєРѕРјРїР°РЅРёРё
    const guildsResult = await db.execute({
      sql: 'SELECT DISTINCT guild_id FROM companies',
      args: [],
    });
    const guildIds = (guildsResult.rows || []).map((r: any) => r.guild_id as string);

    for (const guildId of guildIds) {
      // РљРѕРјРїР°РЅРёРё, РіРѕС‚РѕРІС‹Рµ Рє СЂРѕСЃС‚Сѓ, СЃС‚СЂРѕРіРѕ РІ СЃР»СѓС‡Р°Р№РЅРѕРј РїРѕСЂСЏРґРєРµ
      const companiesResult = await db.execute({
        sql: 'SELECT id FROM companies WHERE guild_id = ? AND (last_growth_day IS NULL OR last_growth_day < ?) ORDER BY RANDOM()',
        args: [guildId, todayStr],
      });
      const companies = companiesResult.rows || [];

      if (companies.length === 0) {
        continue;
      }

      for (const it of companies) {
        try {
          // C2: РёРЅС‚РµСЂР°РєС‚РёРІРЅС‹Рµ С‚СЂР°РЅР·Р°РєС†РёРё РЅРµРґРѕСЃС‚СѓРїРЅС‹ РІ @libsql/client/web вЂ”
          // Р·Р°РјРµРЅСЏРµРј РЅР° Р°С‚РѕРјР°СЂРЅС‹Р№ batch СЃ СѓСЃР»РѕРІРЅС‹РјРё UPDATE
          // (balance >= grant, last_growth_day < todayStr)
          const companyResult = await db.execute({
            sql: 'SELECT treasury FROM companies WHERE id = ?',
            args: [it.id],
          });
          if (companyResult.rows.length === 0) continue;
          const freshTreasury = companyResult.rows[0].treasury;

          // РџРµСЂРµС‡РёС‚С‹РІР°РµРј СЃРІРµР¶РёР№ Р±Р°Р»Р°РЅСЃ СЂРµР·РµСЂРІР° (0, РµСЃР»Рё СЃС‚СЂРѕРєРё РЅРµС‚)
          const reserveResult = await db.execute({
            sql: 'SELECT balance FROM server_reserve WHERE guild_id = ?',
            args: [guildId],
          });
          const reserveBalance = reserveResult.rows.length > 0 ? reserveResult.rows[0].balance : 0;

          // Р–РµР»Р°РµРјС‹Р№ СЂРѕСЃС‚: 1% РѕС‚ РєР°Р·РЅС‹, РЅРѕ РЅРµ Р±РѕР»РµРµ 100
          const desired = Math.min(Math.floor(Number(freshTreasury) * 0.01), 100);
          const grant = Math.min(desired, Number(reserveBalance));

          if (grant > 0) {
            // РђС‚РѕРјР°СЂРЅС‹Р№ batch (РѕРґРЅР° С‚СЂР°РЅР·Р°РєС†РёСЏ, РїРѕСЃР»РµРґРѕРІР°С‚РµР»СЊРЅРѕРµ РІС‹РїРѕР»РЅРµРЅРёРµ):
            // 1) РєРѕРјРїР°РЅРёСЏ РєСЂРµРґРёС‚СѓРµС‚СЃСЏ С‚РѕР»СЊРєРѕ РµСЃР»Рё СЃРµРіРѕРґРЅСЏ РµС‰С‘ РЅРµ СЂРѕСЃР»Р° Р РІ СЂРµР·РµСЂРІРµ С…РІР°С‚Р°РµС‚ СЃСЂРµРґСЃС‚РІ
            // 2) СЂРµР·РµСЂРІ СЃРїРёСЃС‹РІР°РµС‚СЃСЏ С‚РѕР»СЊРєРѕ РµСЃР»Рё РєРѕРјРїР°РЅРёСЏ СЂРµР°Р»СЊРЅРѕ Р±С‹Р»Р° РїСЂРѕРєСЂРµРґРёС‚РѕРІР°РЅР° (РјР°СЂРєРµСЂ last_growth_day = todayStr)
            const writeResults = await db.batch(
              [
                {
                  sql: `UPDATE companies
                        SET treasury = treasury + ?, last_growth_day = ?
                        WHERE id = ?
                          AND (last_growth_day IS NULL OR last_growth_day < ?)
                          AND ? <= COALESCE((SELECT balance FROM server_reserve WHERE guild_id = ?), 0)`,
                  args: [grant, todayStr, it.id, todayStr, grant, guildId],
                },
                {
                  sql: `UPDATE server_reserve
                        SET balance = balance - ?
                        WHERE guild_id = ?
                          AND balance >= ?
                          AND (SELECT last_growth_day FROM companies WHERE id = ?) = ?`,
                  args: [grant, guildId, grant, it.id, todayStr],
                },
                {
                  // РСЃС‚РѕСЂРёСЏ NAV (reason='growth') вЂ” РІ С‚РѕРј Р¶Рµ Р±Р°С‚С‡Рµ, С‡С‚Рѕ Рё СЂРѕСЃС‚.
                  // Guard: last_growth_day = todayStr, С‚.Рµ. РіСЂР°РЅС‚ СЂРµР°Р»СЊРЅРѕ РЅР°С‡РёСЃР»РµРЅ.
                  // treasury/circulating/mood С‡РёС‚Р°СЋС‚СЃСЏ SELECT-РѕРј РџРћРЎР›Р• РїРµСЂРІРѕРіРѕ statement,
                  // РїРѕСЌС‚РѕРјСѓ СЃРЅРёРјРѕРє РѕС‚СЂР°Р¶Р°РµС‚ СЃРѕСЃС‚РѕСЏРЅРёРµ СѓР¶Рµ СЃ СѓС‡С‘С‚РѕРј РіСЂР°РЅС‚Р°.
                  sql: `INSERT INTO company_nav_history (guild_id, company_id, ts, treasury, circulating, mood_bps, reason)
                        SELECT ?, ?, ?,
                               (SELECT treasury FROM companies WHERE id = ?),
                               100 - (SELECT available_shares FROM companies WHERE id = ?),
                               (SELECT mood_bps FROM companies WHERE id = ?),
                               'growth'
                        WHERE (SELECT last_growth_day FROM companies WHERE id = ?) = ?`,
                  args: [guildId, it.id, nowSec, it.id, it.id, it.id, it.id, todayStr],
                },
              ],
              'write'
            );
            if ((writeResults[0].rowsAffected as number) === 1 && (writeResults[1].rowsAffected as number) === 1) {
              console.log(`[Growth] Company ${it.id} in guild ${guildId}: treasury +${grant}`);
            }
            // РРЅР°С‡Рµ вЂ” РіРѕРЅРєР°/РЅРµРґРѕСЃС‚Р°С‚РѕРє СЃСЂРµРґСЃС‚РІ: РЅРёС‡РµРіРѕ РЅРµ РёР·РјРµРЅРёР»РѕСЃСЊ,
            // РёРґРµРјРїРѕС‚РµРЅС‚РЅРѕ РїРѕРІС‚РѕСЂРёС‚СЃСЏ РЅР° СЃР»РµРґСѓСЋС‰РµРј С‚РёРєРµ
          } else {
            // Р РµР·РµСЂРІ РїСѓСЃС‚ РёР»Рё СЂРѕСЃС‚ 0 вЂ” РёРґРµРјРїРѕС‚РµРЅС‚РЅРѕ С„РёРєСЃРёСЂСѓРµРј РґР°С‚Сѓ
            await db.execute({
              sql: 'UPDATE companies SET last_growth_day = ? WHERE id = ? AND (last_growth_day IS NULL OR last_growth_day < ?)',
              args: [todayStr, it.id, todayStr],
            });
          }
        } catch (e) {
          console.error('[Growth] Error processing company', it.id, e);
        }
      }
    }
  } catch (err) {
    console.error('[Growth] Error in processDailyCompanyGrowth:', err);
  }
}

// ============================================
// РЎРµР·РѕРЅРЅР°СЏ Р»РёРєРІРёРґР°С†РёСЏ РєРѕРјРїР°РЅРёР№ (Р‘РёСЂР¶Р°)
// ============================================

/**
 * РџСЂРѕРїРѕСЂС†РёРѕРЅР°Р»СЊРЅР°СЏ Р»РёРєРІРёРґР°С†РёСЏ РєРѕРјРїР°РЅРёР№ РїСЂРё СЃРјРµРЅРµ СЃРµР·РѕРЅР° (СЂР°Р· РІ 3 РјРµСЃСЏС†Р°).
 *
 * РњР°СЂРєРµСЂ СЃРµР·РѕРЅР° last_season_reset С…СЂР°РЅРёС‚СЃСЏ РџРћ Р“РР›Р¬Р”РРЇРњ вЂ” РІ СЃР»СѓР¶РµР±РЅРѕР№ Р·Р°РїРёСЃРё
 * users (user_id = guild_id), РєР°Рє last_week_reset Рё next_boss_spawn_at.
 *
 * Р“Р°СЂР°РЅС‚РёРё:
 * 1. Р›РёРєРІРёРґР°С†РёСЏ РІС‹РїРѕР»РЅСЏРµС‚СЃСЏ РІ РѕС‚РґРµР»СЊРЅРѕР№ С‚СЂР°РЅР·Р°РєС†РёРё РЅР° РіРёР»СЊРґРёСЋ; РѕС€РёР±РєР° РІ РѕРґРЅРѕР№
 *    РіРёР»СЊРґРёРё С‚РѕР»СЊРєРѕ Р»РѕРіРёСЂСѓРµС‚СЃСЏ Рё РЅРµ РїСЂРµСЂС‹РІР°РµС‚ РѕР±СЂР°Р±РѕС‚РєСѓ РѕСЃС‚Р°Р»СЊРЅС‹С….
 * 2. РћС‚РјРµС‚РєР° Рѕ Р·Р°РІРµСЂС€РµРЅРёРё СЃРµР·РѕРЅР° СЃС‚Р°РІРёС‚СЃСЏ РЎРўР РћР“Рћ РїРѕСЃР»Рµ СѓСЃРїРµС€РЅРѕРіРѕ tx.commit():
 *    РїСЂРё СЃР±РѕРµ С‚СЂР°РЅР·Р°РєС†РёСЏ РѕС‚РєР°С‚С‹РІР°РµС‚СЃСЏ С†РµР»РёРєРѕРј, РјР°СЂРєРµСЂ РѕСЃС‚Р°С‘С‚СЃСЏ СЃС‚Р°СЂС‹Рј, Рё
 *    Р»РёРєРІРёРґР°С†РёСЏ Р±СѓРґРµС‚ РїРѕРІС‚РѕСЂРµРЅР° РЅР° СЃР»РµРґСѓСЋС‰РµРј С‚РёРєРµ вЂ” РєРѕРјРїР°РЅРёРё РЅРµ РѕСЃС‚Р°РЅСѓС‚СЃСЏ
 *    Р±СЂРѕС€РµРЅРЅС‹РјРё Р±РµР· РІС‹РїР»Р°С‚.
 * 3. РџРµСЂРІС‹Р№ Р·Р°РїСѓСЃРє (РјР°СЂРєРµСЂ NULL) С‚РѕР»СЊРєРѕ РёРЅРёС†РёР°Р»РёР·РёСЂСѓРµС‚ РјР°СЂРєРµСЂ С‚РµРєСѓС‰РёРј СЃРµР·РѕРЅРѕРј
 *    Р‘Р•Р— Р»РёРєРІРёРґР°С†РёРё, С‡С‚РѕР±С‹ РґРµРїР»РѕР№ РІ СЃРµСЂРµРґРёРЅРµ СЃРµР·РѕРЅР° РЅРµ СѓРЅРёС‡С‚РѕР¶Р°Р» РєРѕРјРїР°РЅРёРё
 *    РІРЅРµ РіСЂР°РЅРёС†С‹ СЃРµР·РѕРЅР°.
 */
async function liquidateCompaniesOnSeasonChange(db: any): Promise<void> {
  const currentSeasonId = getSeasonId();

  try {
    // Р’СЃРµ РіРёР»СЊРґРёРё (РєР°Рє РІ checkWeeklyReset): РјР°СЂРєРµСЂ СЃС‚Р°РІРёС‚СЃСЏ Рё РіРёР»СЊРґРёСЏРј Р±РµР· РєРѕРјРїР°РЅРёР№,
    // С‡С‚РѕР±С‹ РёС… Р±СѓРґСѓС‰РёРµ РєРѕРјРїР°РЅРёРё РєРѕСЂСЂРµРєС‚РЅРѕ Р»РёРєРІРёРґРёСЂРѕРІР°Р»РёСЃСЊ РЅР° СЃР»РµРґСѓСЋС‰РµР№ РіСЂР°РЅРёС†Рµ СЃРµР·РѕРЅР°
    const guildsResult = await db.execute({
      sql: 'SELECT DISTINCT guild_id FROM users',
      args: [],
    });
    const guildIds = (guildsResult.rows || []).map((r: any) => r.guild_id as string);

    for (const guildId of guildIds) {
      try {
        // РњР°СЂРєРµСЂ СЃРµР·РѕРЅР° С‡РёС‚Р°РµС‚СЃСЏ Р·Р°РЅРѕРІРѕ РґР»СЏ РљРђР–Р”РћР™ РіРёР»СЊРґРёРё
        const markerResult = await db.execute({
          sql: 'SELECT last_season_reset FROM users WHERE user_id = ? AND guild_id = ?',
          args: [guildId, guildId],
        });
        const lastSeasonId = (markerResult.rows[0]?.last_season_reset as string | null) || null;

        if (lastSeasonId === currentSeasonId) {
          continue; // РЎРµР·РѕРЅ РЅРµ РјРµРЅСЏР»СЃСЏ вЂ” Р»РёРєРІРёРґР°С†РёСЏ РЅРµ С‚СЂРµР±СѓРµС‚СЃСЏ
        }

        if (lastSeasonId === null) {
          // РџРµСЂРІР°СЏ РёРЅРёС†РёР°Р»РёР·Р°С†РёСЏ РјР°СЂРєРµСЂР°: С„РёРєСЃРёСЂСѓРµРј С‚РµРєСѓС‰РёР№ СЃРµР·РѕРЅ Р‘Р•Р— Р»РёРєРІРёРґР°С†РёРё
          const initResult = await db.execute({
            sql: 'UPDATE users SET last_season_reset = ? WHERE user_id = ? AND guild_id = ?',
            args: [currentSeasonId, guildId, guildId],
          });
          if (!initResult.rowsAffected || initResult.rowsAffected === 0) {
            await db.execute({
              sql: `INSERT OR IGNORE INTO users (user_id, guild_id, xp, level, messages_count, last_message_at, last_activity_at, last_season_reset)
                    VALUES (?, ?, 0, 0, 0, 0, ?, ?)`,
              args: [guildId, guildId, Date.now(), currentSeasonId],
            });
          }
          console.log(`[Liquidation] Guild ${guildId}: season marker initialized to ${currentSeasonId} (no liquidation on first run)`);
          continue;
        }

        console.log(`[Liquidation] Season changed for guild ${guildId}: ${lastSeasonId} -> ${currentSeasonId}, liquidating companies...`);

        let committed = false;
        try {
          // C2: РёРЅС‚РµСЂР°РєС‚РёРІРЅС‹Рµ С‚СЂР°РЅР·Р°РєС†РёРё РЅРµРґРѕСЃС‚СѓРїРЅС‹ РІ @libsql/client/web вЂ”
          // РїСЂРµРґСЂР°СЃС‡РёС‚С‹РІР°РµРј РІСЃРµ РІС‹РїР»Р°С‚С‹ Рё РІС‹РїРѕР»РЅСЏРµРј РёС… РѕРґРЅРёРј Р°С‚РѕРјР°СЂРЅС‹Рј db.batch
          // (РѕС€РёР±РєР° Р»СЋР±РѕР№ Р·Р°РїРёСЃРё РѕС‚РєР°С‚С‹РІР°РµС‚ batch С†РµР»РёРєРѕРј)
          // РљРѕРјРїР°РЅРёРё РіРёР»СЊРґРёРё
          const companiesResult = await db.execute({
            sql: 'SELECT * FROM companies WHERE guild_id = ?',
            args: [guildId],
          });
          const companies = companiesResult.rows || [];

          const batchStmts: { sql: string; args: any[] }[] = [];

          // ============================================
          // РЁР°Рі 8: Р°РіСЂРµРіР°С‚С‹ СЃРґРµР»РѕРє Р·Р°РєСЂС‹РІР°СЋС‰РµРіРѕСЃСЏ СЃРµР·РѕРЅР°.
          // Р’РђР–РќРћ: СЃРґРµР»РєРё РїРёСЃР°Р»РёСЃСЊ РїРѕРґ season_id = lastSeasonId (СЃРµР·РѕРЅ, РєРѕС‚РѕСЂС‹Р№
          // Р»РёРєРІРёРґРёСЂСѓРµС‚СЃСЏ); РїРѕРґ currentSeasonId СЃРґРµР»РѕРє РµС‰С‘ РЅРµС‚, РїРѕСЌС‚РѕРјСѓ РёС‚РѕРіРё
          // СЃС‡РёС‚Р°РµРј Рё СЃРѕС…СЂР°РЅСЏРµРј РїРѕ lastSeasonId.
          // ============================================
          const seasonTradesResult = await db.execute({
            sql: `SELECT user_id, company_id, side, coins
                  FROM company_trades
                  WHERE guild_id = ? AND season_id = ?`,
            args: [guildId, lastSeasonId],
          });

          const investorStats = new Map<string, { invested: number; returned: number }>();
          const companyStats = new Map<number, { invested: number; returned: number }>();
          // Р’С‹РїР»Р°С‚С‹ Р»РёРєРІРёРґР°С†РёРё РґРѕР±Р°РІР»СЏСЋС‚СЃСЏ Рє returned РёРЅРІРµСЃС‚РѕСЂР°
          const liquidationPayouts = new Map<string, number>();

          for (const tr of seasonTradesResult.rows || []) {
            const tradeUserId = String(tr.user_id);
            const tradeCompanyId = Number(tr.company_id);
            const coins = Number(tr.coins) || 0;
            const isBuy = String(tr.side) === 'buy';

            const inv = investorStats.get(tradeUserId) || { invested: 0, returned: 0 };
            if (isBuy) inv.invested += coins; else inv.returned += coins;
            investorStats.set(tradeUserId, inv);

            const cst = companyStats.get(tradeCompanyId) || { invested: 0, returned: 0 };
            if (isBuy) cst.invested += coins; else cst.returned += coins;
            companyStats.set(tradeCompanyId, cst);
          }

          for (const comp of companies) {
            const circulating = 100 - Number(comp.available_shares);
            const treasury = Number(comp.treasury);
            let distributed = 0;

            if (circulating > 0 && treasury > 0) {
              // Р”РµСЂР¶Р°С‚РµР»Рё Р°РєС†РёР№ РєРѕРјРїР°РЅРёРё
              const holdersResult = await db.execute({
                sql: 'SELECT user_id, shares_count FROM company_shares WHERE company_id = ?',
                args: [comp.id],
              });

              for (const s of holdersResult.rows || []) {
                const payout = Math.floor(Number(s.shares_count) * treasury / circulating);
                if (payout > 0) {
                  batchStmts.push({
                    sql: 'UPDATE users SET coins = coins + ? WHERE user_id = ? AND guild_id = ?',
                    args: [payout, String(s.user_id), guildId],
                  });
                  distributed += payout;
                  liquidationPayouts.set(String(s.user_id), (liquidationPayouts.get(String(s.user_id)) || 0) + payout);
                }
              }
            }

            // РћСЃС‚Р°С‚РѕРє РѕС‚ floor-РѕРєСЂСѓРіР»РµРЅРёСЏ Рё РЅРµРІС‹РїР»Р°С‡РµРЅРЅС‹Рµ СЃСѓРјРјС‹ вЂ” РІ СЂРµР·РµСЂРІ СЃРµСЂРІРµСЂР°
            const remainder = treasury - distributed;
            if (remainder > 0) {
              batchStmts.push({
                sql: 'INSERT INTO server_reserve (guild_id, balance) VALUES (?, ?) ON CONFLICT(guild_id) DO UPDATE SET balance = balance + ?',
                args: [guildId, remainder, remainder],
              });
            }
          }

          // ============================================
          // РЁР°Рі 8: С‚РѕРї-3 РёРЅРІРµСЃС‚РѕСЂР° РїРѕ ROI (РІР»РѕР¶РµРЅРёСЏ РѕС‚ 500 рџЄ™) Рё С‚РѕРї-3 РєРѕРјРїР°РЅРёРё
          // РїРѕ РєР°Р·РЅРµ РїРµСЂРµРґ Р»РёРєРІРёРґР°С†РёРµР№. Р—Р°РїРёСЃРё season_results Рё СЃРѕР±С‹С‚РёРµ Р»РµРЅС‚С‹
          // СЃС‚Р°РІСЏС‚СЃСЏ РІ С‚РѕС‚ Р¶Рµ batch, С‡С‚Рѕ Рё Р»РёРєРІРёРґР°С†РёСЏ: Р»РёР±Рѕ РІСЃС‘, Р»РёР±Рѕ РЅРёС‡РµРіРѕ.
          // ============================================
          const resultsNowSec = Math.floor(Date.now() / 1000);

          const investorRatings: { targetId: string; label: string; invested: number; returned: number; roiBps: number }[] = [];
          for (const [invUserId, invStat] of investorStats) {
            if (invStat.invested < 500) continue;
            const returned = invStat.returned + (liquidationPayouts.get(invUserId) || 0);
            investorRatings.push({
              targetId: invUserId,
              label: `<@${invUserId}>`,
              invested: invStat.invested,
              returned,
              roiBps: Math.round(((returned - invStat.invested) / invStat.invested) * 10000),
            });
          }
          investorRatings.sort((a, b) => b.roiBps - a.roiBps);
          const topInvestors = investorRatings.slice(0, 3);

          const topCompanies = [...companies]
            .sort((a, b) => Number(b.treasury) - Number(a.treasury))
            .slice(0, 3)
            .map((comp) => {
              const compStat = companyStats.get(Number(comp.id)) || { invested: 0, returned: 0 };
              const returned = compStat.returned + Number(comp.treasury);
              const roiBps = compStat.invested >= 500
                ? Math.round(((returned - compStat.invested) / compStat.invested) * 10000)
                : 0;
              return {
                targetId: String(comp.id),
                label: `${String(comp.name)} (${String(comp.ticker)})`,
                invested: compStat.invested,
                returned,
                roiBps,
              };
            });

          let resultRank = 1;
          for (const inv of topInvestors) {
            batchStmts.push({
              sql: `INSERT INTO season_results (guild_id, season_id, kind, rank, target_id, label, invested, returned, roi_bps, created_at)
                    VALUES (?, ?, 'investor', ?, ?, ?, ?, ?, ?, ?)`,
              args: [guildId, lastSeasonId, resultRank++, inv.targetId, inv.label, inv.invested, inv.returned, inv.roiBps, resultsNowSec],
            });
          }

          resultRank = 1;
          for (const comp of topCompanies) {
            batchStmts.push({
              sql: `INSERT INTO season_results (guild_id, season_id, kind, rank, target_id, label, invested, returned, roi_bps, created_at)
                    VALUES (?, ?, 'company', ?, ?, ?, ?, ?, ?, ?)`,
              args: [guildId, lastSeasonId, resultRank++, comp.targetId, comp.label, comp.invested, comp.returned, comp.roiBps, resultsNowSec],
            });
          }

          if (topInvestors.length > 0 || topCompanies.length > 0) {
            const feedLines: string[] = [`РџРѕРґРІРµРґРµРЅС‹ РёС‚РѕРіРё СЃРµР·РѕРЅР° \`${lastSeasonId}\` РїРѕ РґРѕС…РѕРґРЅРѕСЃС‚Рё:`];
            if (topInvestors.length > 0) {
              feedLines.push('');
              feedLines.push('**рџ“€ РўРѕРї РёРЅРІРµСЃС‚РѕСЂРѕРІ (ROI):**');
              topInvestors.forEach((inv, i) => {
                const roiPct = inv.roiBps / 100;
                feedLines.push(`${i + 1}. ${inv.label} вЂ” ${roiPct >= 0 ? '+' : ''}${roiPct.toFixed(1)}% (${inv.invested.toLocaleString('ru-RU')} в†’ ${inv.returned.toLocaleString('ru-RU')} рџЄ™)`);
              });
            }
            if (topCompanies.length > 0) {
              feedLines.push('');
              feedLines.push('**рџЏў РўРѕРї РєРѕРјРїР°РЅРёР№ (РєР°Р·РЅР°):**');
              topCompanies.forEach((c, i) => {
                feedLines.push(`${i + 1}. ${c.label} вЂ” ${c.returned.toLocaleString('ru-RU')} рџЄ™`);
              });
            }

            batchStmts.push({
              sql: 'INSERT INTO market_events (guild_id, kind, payload_json, created_at) VALUES (?, ?, ?, ?)',
              args: [guildId, 'season_results', JSON.stringify({
                text: feedLines.join('\n'),
                seasonId: lastSeasonId,
                investors: topInvestors,
                companies: topCompanies,
              }), resultsNowSec],
            });
          }

          // РћС‡РёСЃС‚РєР° С‚Р°Р±Р»РёС† РєРѕРјРїР°РЅРёР№ РіРёР»СЊРґРёРё.
          // server_reserve РќР• РѕР±РЅСѓР»СЏРµРј вЂ” Р±Р°Р»Р°РЅСЃ СЂРµР·РµСЂРІР° РїРµСЂРµС…РѕРґРёС‚ РІ РЅРѕРІС‹Р№ СЃРµР·РѕРЅ.
          batchStmts.push({ sql: 'DELETE FROM company_crises WHERE guild_id = ?', args: [guildId] });
          batchStmts.push({ sql: 'DELETE FROM company_shares WHERE guild_id = ?', args: [guildId] });
          batchStmts.push({ sql: 'DELETE FROM companies WHERE guild_id = ?', args: [guildId] });

          await db.batch(batchStmts, 'write');
          committed = true;
          console.log(`[Liquidation] Guild ${guildId}: companies liquidated, batch committed`);
        } catch (e) {
          console.error('[Liquidation] Error in guild', guildId, e);
          // РњР°СЂРєРµСЂ РќР• РѕР±РЅРѕРІР»СЏРµРј вЂ” Р»РёРєРІРёРґР°С†РёСЏ Р±СѓРґРµС‚ РїРѕРІС‚РѕСЂРµРЅР° РЅР° СЃР»РµРґСѓСЋС‰РµРј С‚РёРєРµ
        }

        // РћС‚РјРµС‚РєР° Рѕ Р·Р°РІРµСЂС€РµРЅРёРё СЃРµР·РѕРЅР° вЂ” РЎРўР РћР“Рћ РїРѕСЃР»Рµ СѓСЃРїРµС€РЅРѕРіРѕ tx.commit()
        if (committed) {
          const markerUpdate = await db.execute({
            sql: 'UPDATE users SET last_season_reset = ? WHERE user_id = ? AND guild_id = ?',
            args: [currentSeasonId, guildId, guildId],
          });
          if (!markerUpdate.rowsAffected || markerUpdate.rowsAffected === 0) {
            // РЎР»СѓР¶РµР±РЅРѕР№ Р·Р°РїРёСЃРё РµС‰С‘ РЅРµС‚ вЂ” СЃРѕР·РґР°С‘Рј РµС‘ (РєР°Рє РІ checkWeeklyReset)
            await db.execute({
              sql: `INSERT OR IGNORE INTO users (user_id, guild_id, xp, level, messages_count, last_message_at, last_activity_at, last_season_reset)
                    VALUES (?, ?, 0, 0, 0, 0, ?, ?)`,
              args: [guildId, guildId, Date.now(), currentSeasonId],
            });
          }
        }
      } catch (guildErr) {
        // РћС€РёР±РєР° РІ РѕРґРЅРѕР№ РіРёР»СЊРґРёРё РЅРµ РїСЂРµСЂС‹РІР°РµС‚ РѕР±СЂР°Р±РѕС‚РєСѓ РѕСЃС‚Р°Р»СЊРЅС‹С… РіРёР»СЊРґРёР№
        console.error('[Liquidation] Error processing guild', guildId, guildErr);
      }
    }
  } catch (err) {
    console.error('[Liquidation] Error in liquidateCompaniesOnSeasonChange:', err);
  }
}

// ============================================
// Р§РёСЃС‚РєР° РёСЃС‚РѕСЂРёРё Р±РёСЂР¶Рё (Р‘РёСЂР¶Р°)
// ============================================

/**
 * Р Р°Р· РІ С‡Р°СЃ С‡РёСЃС‚РёС‚ РёСЃС‚РѕСЂРёСЋ Р±РёСЂР¶Рё:
 * - market_events: С‚РѕР»СЊРєРѕ РћРўРџР РђР’Р›Р•РќРќР«Р• (sent_at IS NOT NULL) Р·Р°РїРёСЃРё СЃС‚Р°СЂС€Рµ 14 РґРЅРµР№.
 *   РќРµРѕС‚РїСЂР°РІР»РµРЅРЅС‹Рµ РѕСЃС‚Р°СЋС‚СЃСЏ РІ РѕС‡РµСЂРµРґРё, С‡С‚РѕР±С‹ СЃРѕР±С‹С‚РёСЏ РЅРµ С‚РµСЂСЏР»РёСЃСЊ РїСЂРё СЃР±РѕСЏС… Discord;
 * - company_nav_history: Р·Р°РїРёСЃРё СЃС‚Р°СЂС€Рµ 60 РґРЅРµР№ (Р¶РёРІСѓС‚ РґРѕР»СЊС€Рµ Р»РµРЅС‚С‹, С‚.Рє.
 *   РЅСѓР¶РЅС‹ РґР»СЏ СЃРµР·РѕРЅРЅРѕРіРѕ СЂРµР№С‚РёРЅРіР°).
 * company_trades РЅРµ С‡РёСЃС‚РёРј вЂ” РїРѕРЅР°РґРѕР±РёС‚СЃСЏ РґР»СЏ СЂРµР№С‚РёРЅРіР° ROI СЃРµР·РѕРЅР°.
 */
async function cleanupExchangeHistory(db: any): Promise<void> {
  const nowSec = Math.floor(Date.now() / 1000);
  const marketCutoff = nowSec - 14 * 24 * 60 * 60; // 14 РґРЅРµР№ РЅР°Р·Р°Рґ
  const navCutoff = nowSec - 60 * 24 * 60 * 60; // 60 РґРЅРµР№ РЅР°Р·Р°Рґ

  try {
    await db.execute({
      sql: 'DELETE FROM market_events WHERE sent_at IS NOT NULL AND sent_at < ?',
      args: [marketCutoff],
    });
    await db.execute({
      sql: 'DELETE FROM company_nav_history WHERE ts < ?',
      args: [navCutoff],
    });
  } catch (err) {
    console.error('[ExchangeCleanup] Error cleaning exchange history:', err);
  }
}

// ============================================
// Р›РµРЅС‚Р° Р±РёСЂР¶Рё (Р­С‚Р°Рї 4.2): С…РµР»РїРµСЂС‹
// (РґСѓР±Р»РёСЂРѕРІР°РЅРѕ РёР· worker/exchange/* РґР»СЏ collector, РёР·Р±РµРіР°РµРј tsconfig issues)
// ============================================

// РЎРёРјРІРѕР»С‹ СЃРїР°СЂРєР»Р°Р№РЅР° РѕС‚ РјРёРЅРёРјСѓРјР° Рє РјР°РєСЃРёРјСѓРјСѓ
const SPARK_CHARS = 'в–Ѓв–‚в–ѓв–„в–…в–†в–‡в–€';

/**
 * Р РёСЃСѓРµС‚ СЃРїР°СЂРєР»Р°Р№РЅ РїРѕ Р·РЅР°С‡РµРЅРёСЏРј СЂСЏРґР°.
 */
function sparkline(values: number[]): string {
  if (values.length === 0) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) return "в–„".repeat(values.length);

  const range = max - min;
  const lastIdx = SPARK_CHARS.length - 1;
  return values
    .map((v) => {
      const idx = Math.max(0, Math.min(lastIdx, Math.round(((v - min) / range) * lastIdx)));
      return SPARK_CHARS[idx];
    })
    .join('');
}

/**
 * NAV РѕРґРЅРѕР№ Р°РєС†РёРё: РєР°Р·РЅР° СЃ РїРѕРїСЂР°РІРєРѕР№ РЅР° РЅР°СЃС‚СЂРѕРµРЅРёРµ СЂС‹РЅРєР° (mood_bps),
 * РґРµР»С‘РЅРЅР°СЏ РЅР° Р°РєС†РёРё РІ РѕР±СЂР°С‰РµРЅРёРё.
 */
function computeNav(treasury: number, circulating: number, moodBps: number): number {
  if (circulating <= 0) return 0;
  return (treasury * (1 + moodBps / 10000)) / circulating;
}

/**
 * РЎС‚СЂРѕРёС‚ РїРѕС‡Р°СЃРѕРІРѕР№ СЂСЏРґ NAV (РїРѕ СѓРјРѕР»С‡Р°РЅРёСЋ 24 С‚РѕС‡РєРё): РґР»СЏ РєР°Р¶РґРѕРіРѕ С‡Р°СЃРѕРІРѕРіРѕ Р±Р°РєРµС‚Р°
 * Р±РµСЂС‘С‚СЃСЏ РїРѕСЃР»РµРґРЅСЏСЏ Р·Р°РїРёСЃСЊ РёСЃС‚РѕСЂРёРё РЅР° РјРѕРјРµРЅС‚ РєРѕРЅС†Р° Р±Р°РєРµС‚Р°; РµСЃР»Рё РёСЃС‚РѕСЂРёРё РµС‰С‘ РЅРµС‚ вЂ”
 * РїРµСЂРІР°СЏ РёР·РІРµСЃС‚РЅР°СЏ Р·Р°РїРёСЃСЊ.
 */
function buildHourlyNavSeries(
  records: { ts: number; nav: number }[],
  nowSec: number,
  points: number = 24
): number[] {
  const sorted = [...records].sort((a, b) => a.ts - b.ts);
  const series: number[] = [];

  for (let i = points - 1; i >= 0; i--) {
    const bucketEnd = nowSec - i * 3600;
    let value: number | null = null;
    for (const r of sorted) {
      if (r.ts <= bucketEnd) {
        value = r.nav;
      } else {
        break;
      }
    }
    if (value === null) {
      value = sorted.length > 0 ? sorted[0].nav : 0;
    }
    series.push(value);
  }

  return series;
}

/**
 * РЎС‚Р°РІРёС‚ СЃРѕР±С‹С‚РёРµ Р±РёСЂР¶Рё РІ РѕС‡РµСЂРµРґСЊ outbox (market_events).
 * Р”РѕСЃС‚Р°РІРєСѓ РІ Discord РІС‹РїРѕР»РЅСЏРµС‚ С„РѕРЅРѕРІС‹Р№ processMarketEventsOutbox.
 */
async function enqueueMarketEvent(db: any, guildId: string, kind: string, payload: Record<string, any>): Promise<void> {
  try {
    await db.execute({
      sql: 'INSERT INTO market_events (guild_id, kind, payload_json, created_at) VALUES (?, ?, ?, ?)',
      args: [guildId, kind, JSON.stringify(payload), Math.floor(Date.now() / 1000)],
    });
  } catch (err) {
    console.error(`[ExchangeFeed] Failed to enqueue event ${kind} for guild ${guildId}:`, err);
  }
}

/**
 * Р¤РѕСЂРјРёСЂСѓРµС‚ Embed РґР»СЏ СЃРѕР±С‹С‚РёСЏ Р»РµРЅС‚С‹ РїРѕ РµРіРѕ С‚РёРїСѓ. payload_json РїРёС€РµС‚СЃСЏ Рё worker'РѕРј,
 * Рё collector'РѕРј, РїРѕСЌС‚РѕРјСѓ СЂРµРЅРґРµСЂ С‚РµСЂРїРёРј Рє РѕС‚СЃСѓС‚СЃС‚РІРёСЋ РїРѕР»РµР№: РµСЃР»Рё РІ payload РµСЃС‚СЊ
 * РіРѕС‚РѕРІС‹Р№ text вЂ” РёСЃРїРѕР»СЊР·СѓРµРј РµРіРѕ.
 */
function renderMarketEventEmbed(kind: string, payload: any): any {
  const blue = 0x5865F2;
  const green = 0x2ECC71;
  const red = 0xE74C3C;
  const text = typeof payload?.text === 'string' && payload.text.length > 0 ? payload.text : null;

  switch (kind) {
    case 'whale_trade':
      return {
        embeds: [{
          title: 'рџђ‹ РљСЂСѓРїРЅР°СЏ СЃРґРµР»РєР° РЅР° Р±РёСЂР¶Рµ',
          description: text ||
            `**${payload.companyName || 'РљРѕРјРїР°РЅРёСЏ'}** (\`${payload.ticker || '???'}\`): ` +
            `${payload.side === 'sell' ? 'рџ“‰ РїСЂРѕРґР°Р¶Р°' : 'рџ“€ РїРѕРєСѓРїРєР°'} **${payload.shares ?? 'вЂ”'}** Р°РєС†. РЅР° **${payload.coins ?? 'вЂ”'} рџЄ™**`,
          color: blue,
        }],
      };
    case 'nav_move': {
      const changePct = Number(payload.changePct) || 0;
      return {
        embeds: [{
          title: changePct >= 0 ? 'рџ“€ Р РµР·РєРёР№ СЂРѕСЃС‚ РєРѕС‚РёСЂРѕРІРѕРє' : 'рџ“‰ Р РµР·РєРѕРµ РїР°РґРµРЅРёРµ РєРѕС‚РёСЂРѕРІРѕРє',
          description: text ||
            `**${payload.companyName || 'РљРѕРјРїР°РЅРёСЏ'}** (\`${payload.ticker || '???'}\`): ` +
            `**${changePct >= 0 ? '+' : ''}${changePct}%** NAV Р·Р° 24С‡` +
            (payload.sparkline ? `\n\`${payload.sparkline}\`` : ''),
          color: changePct >= 0 ? green : red,
        }],
      };
    }
    case 'crisis_spawn':
      return {
        embeds: [{
          title: 'рџљЁ РљСЂРёР·РёСЃ РєРѕРјРїР°РЅРёРё',
          description: text || 'РљРѕРјРїР°РЅРёСЏ РїРѕРїР°Р»Р° РІ РєСЂРёР·РёСЃРЅСѓСЋ СЃРёС‚СѓР°С†РёСЋ!',
          color: red,
        }],
      };
    case 'crisis_resolved':
      return {
        embeds: [{
          title: 'вњ… РљСЂРёР·РёСЃ СЂР°Р·СЂРµС€С‘РЅ',
          description: text || 'РљСЂРёР·РёСЃРЅР°СЏ СЃРёС‚СѓР°С†РёСЏ СѓСЃРїРµС€РЅРѕ СЂР°Р·СЂРµС€РµРЅР°.',
          color: green,
        }],
      };
    case 'daily_digest':
      return {
        embeds: [{
          title: 'рџ“Љ Р”Р°Р№РґР¶РµСЃС‚ Р±РёСЂР¶Рё Р·Р° СЃСѓС‚РєРё',
          description: text || '',
          color: blue,
        }],
      };
    case 'season_results':
      return {
        embeds: [{
          title: `рџЏ† РС‚РѕРіРё СЃРµР·РѕРЅР°${payload?.seasonId ? ` ${payload.seasonId}` : ''} вЂ” СЂРµР№С‚РёРЅРі ROI`,
          description: text || 'РС‚РѕРіРё СЃРµР·РѕРЅР° Р·Р°С„РёРєСЃРёСЂРѕРІР°РЅС‹.',
          color: 0xF1C40F,
        }],
      };
    default:
      return {
        embeds: [{
          title: 'рџ“€ РЎРѕР±С‹С‚РёРµ Р±РёСЂР¶Рё',
          description: text || `\`${kind}\``,
          color: blue,
        }],
      };
  }
}

// ============================================
// Р¤РѕРЅРѕРІС‹Рµ РїСЂРѕС†РµСЃСЃС‹ Р»РµРЅС‚С‹ Р±РёСЂР¶Рё (Р­С‚Р°Рї 4.2)
// ============================================

/**
 * Р”РѕСЃС‚Р°РІР»СЏРµС‚ СЃРѕР±С‹С‚РёСЏ РёР· outbox (market_events) РІ РєР°РЅР°Р» Р»РµРЅС‚С‹ Р±РёСЂР¶Рё.
 * РљР°РЅР°Р»: exchange_guild_state.market_channel_id, fallback вЂ” process.env.MARKET_CHANNEL_ID.
 * РЈСЃРїРµС€РЅР°СЏ РѕС‚РїСЂР°РІРєР° РїРѕРјРµС‡Р°РµС‚СЃСЏ sent_at; РїСЂРё РѕС‚СЃСѓС‚СЃС‚РІРёРё РєР°РЅР°Р»Р° СЃРѕР±С‹С‚РёРµ РїРѕРјРµС‡Р°РµС‚СЃСЏ
 * sent_at СЃ last_error='no_channel', С‡С‚РѕР±С‹ РЅРµ Р±Р»РѕРєРёСЂРѕРІР°С‚СЊ РѕС‡РµСЂРµРґСЊ. РџР°СѓР·Р° 250 РјСЃ
 * РјРµР¶РґСѓ РѕС‚РїСЂР°РІРєР°РјРё вЂ” Р·Р°С‰РёС‚Р° РѕС‚ rate limit Discord.
 */
async function processMarketEventsOutbox(db: any, bot: Client): Promise<void> {
  try {
    const pendingResult = await db.execute({
      sql: `SELECT id, guild_id, kind, payload_json
            FROM market_events
            WHERE sent_at IS NULL AND attempts < 5
            ORDER BY id
            LIMIT 20`,
      args: [],
    });

    const events = pendingResult.rows || [];
    if (events.length === 0) return;

    for (const ev of events) {
      const eventId = ev.id as number;
      const guildId = ev.guild_id as string;
      const kind = ev.kind as string;

      // РљР°РЅР°Р» Р»РµРЅС‚С‹: РЅР°СЃС‚СЂРѕР№РєР° РіРёР»СЊРґРёРё, Р·Р°С‚РµРј РїРµСЂРµРјРµРЅРЅР°СЏ РѕРєСЂСѓР¶РµРЅРёСЏ
      let channelId: string | null = null;
      try {
        const stateResult = await db.execute({
          sql: 'SELECT market_channel_id FROM exchange_guild_state WHERE guild_id = ?',
          args: [guildId],
        });
        channelId = (stateResult.rows[0]?.market_channel_id as string | null) || null;
      } catch (stateErr) {
        console.error(`[ExchangeFeed] Failed to read exchange_guild_state for guild ${guildId}:`, stateErr);
      }
      if (!channelId) {
        channelId = process.env.MARKET_CHANNEL_ID || null;
      }

      // РљР°РЅР°Р» РґРѕР»Р¶РµРЅ СЃСѓС‰РµСЃС‚РІРѕРІР°С‚СЊ Рё Р±С‹С‚СЊ РґРѕСЃС‚СѓРїРµРЅ РґР»СЏ РѕС‚РїСЂР°РІРєРё
      let channel: any = null;
      const guild = bot.guilds.cache.get(guildId);
      if (guild && channelId) {
        const candidate = guild.channels.cache.get(channelId);
        if (candidate && candidate.type === 0 && candidate.permissionsFor(guild.members.me!)?.has('SendMessages')) {
          channel = candidate;
        }
      }

      if (!channel) {
        // РљР°РЅР°Р»Р° РЅРµС‚ вЂ” РїРѕРјРµС‡Р°РµРј СЃРѕР±С‹С‚РёРµ РґРѕСЃС‚Р°РІР»РµРЅРЅС‹Рј СЃ РѕС€РёР±РєРѕР№, С‡С‚РѕР±С‹ РЅРµ Р±Р»РѕРєРёСЂРѕРІР°С‚СЊ РѕС‡РµСЂРµРґСЊ
        await db.execute({
          sql: "UPDATE market_events SET sent_at = ?, attempts = attempts + 1, last_error = 'no_channel' WHERE id = ?",
          args: [Math.floor(Date.now() / 1000), eventId],
        });
        continue;
      }

      let payload: any = {};
      try {
        payload = JSON.parse(String(ev.payload_json || '{}'));
      } catch {
        payload = {};
      }

      try {
        if (kind === 'crisis_spawn') {
          // РљСЂРёР·РёСЃ РїСѓР±Р»РёРєСѓРµС‚СЃСЏ СЃ РєРЅРѕРїРєР°РјРё РІР°СЂРёР°РЅС‚РѕРІ; message_id РїРёС€РµС‚СЃСЏ РѕР±СЂР°С‚РЅРѕ
          // РІ company_crises РїРѕСЃР»Рµ СѓСЃРїРµС€РЅРѕР№ РѕС‚РїСЂР°РІРєРё
          const delivered = await sendCrisisSpawnEvent(db, channel, payload);
          if (!delivered) {
            // РљСЂРёР·РёСЃ СѓР¶Рµ СѓРґР°Р»С‘РЅ (РЅР°РїСЂРёРјРµСЂ, СЃРµР·РѕРЅРЅРѕР№ Р»РёРєРІРёРґР°С†РёРµР№) вЂ” РЅРµ Р±Р»РѕРєРёСЂСѓРµРј РѕС‡РµСЂРµРґСЊ
            await db.execute({
              sql: "UPDATE market_events SET sent_at = ?, attempts = attempts + 1, last_error = 'crisis_gone' WHERE id = ?",
              args: [Math.floor(Date.now() / 1000), eventId],
            });
            continue;
          }
        } else {
          await channel.send(renderMarketEventEmbed(kind, payload));
        }
        await db.execute({
          sql: 'UPDATE market_events SET sent_at = ?, attempts = attempts + 1, last_error = NULL WHERE id = ?',
          args: [Math.floor(Date.now() / 1000), eventId],
        });
        console.log(`[ExchangeFeed] Event ${kind} #${eventId} delivered to guild ${guildId} channel ${channelId}`);
      } catch (sendErr) {
        await db.execute({
          sql: 'UPDATE market_events SET attempts = attempts + 1, last_error = ? WHERE id = ?',
          args: [String((sendErr as any)?.message || sendErr).slice(0, 500), eventId],
        });
        console.error(`[ExchangeFeed] Failed to deliver event #${eventId}:`, sendErr);
      }

      // РџР°СѓР·Р° 250 РјСЃ РјРµР¶РґСѓ РѕС‚РїСЂР°РІРєР°РјРё (rate limit Discord)
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  } catch (err) {
    console.error('[ExchangeFeed] Error in processMarketEventsOutbox:', err);
  }
}

/**
 * РС‰РµС‚ СЂРµР·РєРёРµ РґРІРёР¶РµРЅРёСЏ NAV (>= 10% Р·Р° 24С‡) Рё СЃС‚Р°РІРёС‚ СЃРѕР±С‹С‚РёСЏ nav_move РІ РѕС‡РµСЂРµРґСЊ.
 * РђРЅС‚РёРґСѓР±Р»СЊ: РѕРґРЅР° РєРѕРјРїР°РЅРёСЏ РЅРµ С‡Р°С‰Рµ СЂР°Р·Р° РІ 6 С‡Р°СЃРѕРІ (РїРѕ СЃРІРµР¶РёРј nav_move РІ outbox).
 */
async function checkSharpNavMoves(db: any): Promise<void> {
  const nowSec = Math.floor(Date.now() / 1000);
  const dayAgoSec = nowSec - 24 * 3600;
  const antiDupWindowSec = 6 * 3600;

  try {
    const companiesResult = await db.execute({
      sql: 'SELECT id, guild_id, name, ticker FROM companies',
      args: [],
    });
    const companies = companiesResult.rows || [];
    if (companies.length === 0) return;

    // РЎРІРµР¶РёРµ nav_move Р·Р° РѕРєРЅРѕ Р°РЅС‚РёРґСѓР±Р»СЏ: С‡РёС‚Р°РµРј РѕРґРёРЅ СЂР°Р·, РєР»СЋС‡Рё СЃРѕР±РёСЂР°РµРј РІ РїР°РјСЏС‚Рё
    const recentResult = await db.execute({
      sql: `SELECT guild_id, payload_json, created_at
            FROM market_events
            WHERE kind = 'nav_move' AND created_at >= ?
            ORDER BY id DESC`,
      args: [nowSec - antiDupWindowSec],
    });
    const lastNavMoveAt = new Map<string, number>();
    for (const row of recentResult.rows || []) {
      try {
        const payload = JSON.parse(String(row.payload_json || '{}'));
        const moveCompanyId = payload.company_id ?? payload.companyId;
        if (moveCompanyId === undefined || moveCompanyId === null) continue;
        const key = `${row.guild_id}:${moveCompanyId}`;
        if (!lastNavMoveAt.has(key)) {
          lastNavMoveAt.set(key, Number(row.created_at) || 0);
        }
      } catch {
        // Р‘РёС‚С‹Р№ payload вЂ” РїСЂРѕРїСѓСЃРєР°РµРј
      }
    }

    for (const comp of companies) {
      try {
        const companyIdNum = Number(comp.id);
        const guildId = comp.guild_id as string;

        // РСЃС‚РѕСЂРёСЏ NAV Р·Р° РїРѕСЃР»РµРґРЅРёРµ 24 С‡Р°СЃР°
        const historyResult = await db.execute({
          sql: `SELECT ts, treasury, circulating, mood_bps
                FROM company_nav_history
                WHERE company_id = ? AND ts >= ?
                ORDER BY ts ASC`,
          args: [comp.id, dayAgoSec],
        });
        const records = (historyResult.rows || []).map((r: any) => ({
          ts: Number(r.ts),
          nav: computeNav(Number(r.treasury), Number(r.circulating), Number(r.mood_bps)),
        }));

        // РќСѓР¶РЅРѕ РјРёРЅРёРјСѓРј РґРІРµ С‚РѕС‡РєРё: РЅР°С‡Р°Р»Рѕ Рё РєРѕРЅРµС† РѕРєРЅР°
        if (records.length < 2) continue;

        const series = buildHourlyNavSeries(records, nowSec, 24);
        const firstNav = series[0];
        const lastNav = series[series.length - 1];
        if (!firstNav || firstNav <= 0) continue;

        const changePct = ((lastNav - firstNav) / firstNav) * 100;
        if (Math.abs(changePct) < 10) continue;

        // РђРЅС‚РёРґСѓР±Р»СЊ: РЅРµ СЃРїР°РјРёРј РѕРґРЅСѓ РєРѕРјРїР°РЅРёСЋ С‡Р°С‰Рµ СЂР°Р·Р° РІ 6 С‡Р°СЃРѕРІ
        const dupKey = `${guildId}:${companyIdNum}`;
        const lastAt = lastNavMoveAt.get(dupKey) || 0;
        if (nowSec - lastAt < antiDupWindowSec) continue;

        await enqueueMarketEvent(db, guildId, 'nav_move', {
          company_id: companyIdNum,
          companyName: comp.name,
          ticker: comp.ticker,
          changePct: Math.round(changePct * 10) / 10,
          sparkline: sparkline(series),
        });
        lastNavMoveAt.set(dupKey, nowSec);
        console.log(`[ExchangeFeed] NAV move queued: company ${companyIdNum} (${comp.ticker}) ${changePct.toFixed(1)}% / 24h`);
      } catch (e) {
        console.error('[ExchangeFeed] Error checking NAV moves for company', comp.id, e);
      }
    }
  } catch (err) {
    console.error('[ExchangeFeed] Error in checkSharpNavMoves:', err);
  }
}

/**
 * РЎРѕР±РёСЂР°РµС‚ С‚РµРєСЃС‚ СЃСѓС‚РѕС‡РЅРѕРіРѕ РґР°Р№РґР¶РµСЃС‚Р°: С‚РѕРї-5 СЂРѕСЃС‚Р° Рё С‚РѕРї-5 РїР°РґРµРЅРёСЏ NAV Р·Р° 24С‡.
 * Р’РѕР·РІСЂР°С‰Р°РµС‚ null, РµСЃР»Рё РґР°РЅРЅС‹С… Р·Р° СЃСѓС‚РєРё РЅРµС‚.
 */
async function buildDailyDigestText(db: any, guildId: string): Promise<string | null> {
  const nowSec = Math.floor(Date.now() / 1000);
  const dayAgoSec = nowSec - 24 * 3600;

  const companiesResult = await db.execute({
    sql: 'SELECT id, name, ticker FROM companies WHERE guild_id = ?',
    args: [guildId],
  });

  const movers: { name: string; ticker: string; changePct: number; spark: string }[] = [];

  for (const comp of companiesResult.rows || []) {
    const historyResult = await db.execute({
      sql: `SELECT ts, treasury, circulating, mood_bps
            FROM company_nav_history
            WHERE company_id = ? AND ts >= ?
            ORDER BY ts ASC`,
      args: [comp.id, dayAgoSec],
    });
    const records = (historyResult.rows || []).map((r: any) => ({
      ts: Number(r.ts),
      nav: computeNav(Number(r.treasury), Number(r.circulating), Number(r.mood_bps)),
    }));
    if (records.length < 2) continue;

    const series = buildHourlyNavSeries(records, nowSec, 24);
    const firstNav = series[0];
    const lastNav = series[series.length - 1];
    if (!firstNav || firstNav <= 0) continue;

    movers.push({
      name: String(comp.name || 'РљРѕРјРїР°РЅРёСЏ'),
      ticker: String(comp.ticker || '???'),
      changePct: Math.round(((lastNav - firstNav) / firstNav) * 1000) / 10,
      spark: sparkline(series),
    });
  }

  if (movers.length === 0) return null;

  const gainers = movers
    .filter((m) => m.changePct > 0)
    .sort((a, b) => b.changePct - a.changePct)
    .slice(0, 5);
  const losers = movers
    .filter((m) => m.changePct < 0)
    .sort((a, b) => a.changePct - b.changePct)
    .slice(0, 5);

  const lines: string[] = [];
  if (gainers.length > 0) {
    lines.push('**рџљЂ Р›РёРґРµСЂС‹ СЂРѕСЃС‚Р° Р·Р° 24С‡:**');
    for (const m of gainers) {
      lines.push(`вЂў **${m.name}** (\`${m.ticker}\`): +${m.changePct}% ${m.spark}`);
    }
  }
  if (losers.length > 0) {
    if (lines.length > 0) lines.push('');
    lines.push('**рџ“‰ Р›РёРґРµСЂС‹ РїР°РґРµРЅРёСЏ Р·Р° 24С‡:**');
    for (const m of losers) {
      lines.push(`вЂў **${m.name}** (\`${m.ticker}\`): ${m.changePct}% ${m.spark}`);
    }
  }
  if (lines.length === 0) {
    lines.push('Р—Р° СЃСѓС‚РєРё СЂС‹РЅРѕРє Р±РµР· Р·Р°РјРµС‚РЅС‹С… РґРІРёР¶РµРЅРёР№ вЂ” РїРѕР»РЅС‹Р№ С€С‚РёР»СЊ. рџЊЉ');
  }

  return lines.join('\n');
}

/**
 * Р Р°Р· РІ СЃСѓС‚РєРё С„РѕСЂРјРёСЂСѓРµС‚ СЃРІРѕРґРєСѓ Р±РёСЂР¶Рё (С‚РѕРї-5 СЂРѕСЃС‚Р° Рё С‚РѕРї-5 РїР°РґРµРЅРёСЏ NAV Р·Р° 24С‡)
 * Рё СЃС‚Р°РІРёС‚ СЃРѕР±С‹С‚РёРµ daily_digest РІ РѕС‡РµСЂРµРґСЊ. Р—Р°С…РІР°С‚ РґРЅСЏ РёРґРµРјРїРѕС‚РµРЅС‚РµРЅ С‡РµСЂРµР·
 * last_digest_day РІ exchange_guild_state: РґРµРЅСЊ РїРѕРјРµС‡Р°РµС‚СЃСЏ РґРѕ РїРѕСЃС‚Р°РЅРѕРІРєРё РІ
 * РѕС‡РµСЂРµРґСЊ, РїРѕСЌС‚РѕРјСѓ РїРѕРІС‚РѕСЂРЅС‹Рµ С‚РёРєРё РІ С‚РѕС‚ Р¶Рµ РґРµРЅСЊ РЅРµ РґСѓР±Р»РёСЂСѓСЋС‚ РІС‹РїСѓСЃРє.
 */
async function processDailyDigest(db: any, bot: Client): Promise<void> {
  const todayStr = getVladivostokDate();

  try {
    const guildsResult = await db.execute({
      sql: 'SELECT DISTINCT guild_id FROM companies',
      args: [],
    });
    const guildIds = (guildsResult.rows || []).map((r: any) => r.guild_id as string);

    for (const guildId of guildIds) {
      try {
        // Р—Р°С…РІР°С‚ РґРЅСЏ: РїСЂРѕРїСѓСЃРєР°РµРј РіРёР»СЊРґРёРё, Сѓ РєРѕС‚РѕСЂС‹С… РґР°Р№РґР¶РµСЃС‚ СЃРµРіРѕРґРЅСЏ СѓР¶Рµ РІС‹РїСѓСЃРєР°Р»СЃСЏ
        const stateResult = await db.execute({
          sql: 'SELECT last_digest_day FROM exchange_guild_state WHERE guild_id = ?',
          args: [guildId],
        });
        const lastDigestDay = (stateResult.rows[0]?.last_digest_day as string | null) || null;
        if (lastDigestDay === todayStr) continue;

        const digestText = await buildDailyDigestText(db, guildId);
        if (!digestText) continue; // РќРµС‚ РґР°РЅРЅС‹С… Р·Р° 24С‡ вЂ” РґРµРЅСЊ РЅРµ РїРѕРјРµС‡Р°РµРј

        // РџРѕРјРµС‡Р°РµРј РґРµРЅСЊ Р”Рћ РїРѕСЃС‚Р°РЅРѕРІРєРё РІ РѕС‡РµСЂРµРґСЊ (РёРґРµРјРїРѕС‚РµРЅС‚РЅРѕСЃС‚СЊ Р·Р°С…РІР°С‚Р° РґРЅСЏ)
        await db.execute({
          sql: `INSERT INTO exchange_guild_state (guild_id, last_digest_day)
                VALUES (?, ?)
                ON CONFLICT(guild_id) DO UPDATE SET last_digest_day = excluded.last_digest_day`,
          args: [guildId, todayStr],
        });

        await enqueueMarketEvent(db, guildId, 'daily_digest', { text: digestText });
        console.log(`[ExchangeFeed] Daily digest queued for guild ${guildId}`);
      } catch (e) {
        console.error('[ExchangeFeed] Error processing daily digest for guild', guildId, e);
      }
    }
  } catch (err) {
    console.error('[ExchangeFeed] Error in processDailyDigest:', err);
  }
}

client.on('ready', async () => {
  console.log(`[Collector] Starting migration...`);
  await migrateSchema();

  // РРЅРёС†РёР°Р»РёР·Р°С†РёСЏ РїСѓР»Р° РєРІРµСЃС‚РѕРІ
  await ensureQuestsPool(db);

  // РРЅРёС†РёР°Р»РёР·Р°С†РёСЏ РіРѕСЂРѕРґСЃРєРёС… СѓС‡Р°СЃС‚РєРѕРІ (12 РЅР° РіРёР»СЊРґРёСЋ, РёРґРµРјРїРѕС‚РµРЅС‚РЅРѕ)
  await ensureCityPlots(db, client);

  // ============================================
  // РђРІС‚РѕРјР°С‚РёС‡РµСЃРєР°СЏ СЂРµРіРёСЃС‚СЂР°С†РёСЏ СЃР»СЌС€-РєРѕРјР°РЅРґ: РіР°Р·РµС‚Р° + Р±РёСЂР¶Р°
  // (guild.commands.create вЂ” РјРіРЅРѕРІРµРЅРЅР°СЏ РіРёР»СЊРґРµР№СЃРєР°СЏ СЂРµРіРёСЃС‚СЂР°С†РёСЏ,
  // РїРѕСЏРІР»СЏРµС‚СЃСЏ РІ Discord РЎР РђР—РЈ, Р±РµР· РѕР¶РёРґР°РЅРёСЏ РіР»РѕР±Р°Р»СЊРЅРѕР№ СЃРёРЅС…СЂРѕРЅРёР·Р°С†РёРё)
  // ============================================
  try {
    for (const [, guild] of client.guilds.cache) {
      // РћР±РЅРѕРІР»СЏРµРј РєСЌС€ РєРѕРјР°РЅРґ РіРёР»СЊРґРёРё, С‡С‚РѕР±С‹ РїСЂРѕРІРµСЂРєР° РЅР° РґСѓР±Р»РёРєР°С‚С‹ Р±С‹Р»Р° РІР°Р»РёРґРЅРѕР№
      try {
        await guild.commands.fetch();
      } catch (fetchErr) {
        console.warn(`[Commands] Failed to fetch commands cache for guild ${guild.id}:`, fetchErr);
      }

      const existing = guild.commands.cache.find((cmd: any) => cmd.name === 'test-gazeta');
      if (!existing) {
        await guild.commands.create({
          name: 'test-gazeta',
          description: 'РЎРіРµРЅРµСЂРёСЂРѕРІР°С‚СЊ Рё РІС‹РїСѓСЃС‚РёС‚СЊ AI-РіР°Р·РµС‚Сѓ Р·Р° РЅРµРґРµР»СЋ (С‚РѕР»СЊРєРѕ РґР»СЏ Р°РґРјРёРЅРёСЃС‚СЂР°С†РёРё)',
        });
        console.log(`[Gazeta] Slash command test-gazeta registered in guild ${guild.id}`);
      }

      // ============================================
      // РЎР»СЌС€-РєРѕРјР°РЅРґС‹ Р±РёСЂР¶Рё (РјРіРЅРѕРІРµРЅРЅР°СЏ РіРёР»СЊРґРµР№СЃРєР°СЏ СЂРµРіРёСЃС‚СЂР°С†РёСЏ)
      // type 3 = STRING, type 4 = INTEGER, type 7 = CHANNEL
      // ============================================
      const exchangeCommands: any[] = [
        { name: 'stocks', description: 'РљРѕС‚РёСЂРѕРІРєРё Р°РєС†РёР№ РєРѕРјРїР°РЅРёР№ СЃРµСЂРІРµСЂР°' },
        { name: 'portfolio', description: 'Р’Р°С€ РёРЅРІРµСЃС‚РёС†РёРѕРЅРЅС‹Р№ РїРѕСЂС‚С„РµР»СЊ Р°РєС†РёР№' },
        {
          name: 'company-create',
          description: 'РЎРѕР·РґР°С‚СЊ РєРѕРјРїР°РЅРёСЋ РЅР° Р±РёСЂР¶Рµ',
          options: [
            { name: 'name', description: 'РќР°Р·РІР°РЅРёРµ РєРѕРјРїР°РЅРёРё', type: 3, required: true },
            { name: 'ticker', description: 'РўРёРєРµСЂ Р°РєС†РёР№ (2-5 Р»Р°С‚РёРЅСЃРєРёС… Р±СѓРєРІ, РѕРїС†РёРѕРЅР°Р»СЊРЅРѕ)', type: 3, required: false },
            { name: 'description', description: 'РћРїРёСЃР°РЅРёРµ РєРѕРјРїР°РЅРёРё', type: 3, required: true },
          ],
        },
        {
          name: 'invest',
          description: 'РљСѓРїРёС‚СЊ Р°РєС†РёРё РєРѕРјРїР°РЅРёРё',
          options: [
            { name: 'company', description: 'РўРёРєРµСЂ РёР»Рё РЅР°Р·РІР°РЅРёРµ РєРѕРјРїР°РЅРёРё', type: 3, required: true },
            { name: 'amount', description: 'РљРѕР»РёС‡РµСЃС‚РІРѕ Р°РєС†РёР№', type: 4, required: true },
          ],
        },
        {
          name: 'divest',
          description: 'РџСЂРѕРґР°С‚СЊ Р°РєС†РёРё РєРѕРјРїР°РЅРёРё',
          options: [
            { name: 'company', description: 'РўРёРєРµСЂ РёР»Рё РЅР°Р·РІР°РЅРёРµ РєРѕРјРїР°РЅРёРё', type: 3, required: true },
            { name: 'amount', description: 'РљРѕР»РёС‡РµСЃС‚РІРѕ Р°РєС†РёР№', type: 4, required: true },
          ],
        },
        {
          name: 'exchange-setup', description: 'Канал для ленты биржи (Manage Server)',
          options: [
            { name: 'channel', description: 'РўРµРєСЃС‚РѕРІС‹Р№ РєР°РЅР°Р» РґР»СЏ СЃРѕР±С‹С‚РёР№ Р±РёСЂР¶Рё', type: 7, required: true },
          ],
        },
        {
          name: 'exchange-top',
          description: 'Р РµР№С‚РёРЅРі РёРЅРІРµСЃС‚РѕСЂРѕРІ Рё РєРѕРјРїР°РЅРёР№ СЃРµР·РѕРЅР° РїРѕ РґРѕС…РѕРґРЅРѕСЃС‚Рё (ROI)',
          options: [
            { name: 'season', description: 'ID СЃРµР·РѕРЅР° (РїРѕ СѓРјРѕР»С‡Р°РЅРёСЋ С‚РµРєСѓС‰РёР№)', type: 3, required: false },
          ],
        },
      ];

      for (const cmd of exchangeCommands) {
        try {
          const existingCmd = guild.commands.cache.find((c: any) => c.name === cmd.name);
          if (!existingCmd) {
            await guild.commands.create(cmd);
            console.log(`[Exchange] Slash command ${cmd.name} registered in guild ${guild.id}`);
          }
        } catch (cmdErr) {
          console.error(`[Exchange] Failed to register slash command ${cmd.name} in guild ${guild.id}:`, cmdErr);
        }
      }

      // ============================================
      // РЎР»СЌС€-РєРѕРјР°РЅРґР° /plot (Р“РѕСЂРѕРґ вЂ” РЁР°Рі 2: info, buy, sell)
      // type 1 = SUB_COMMAND, type 3 = STRING, type 4 = INTEGER
      // ============================================
      const plotCommand: any = {
        name: 'plot',
        description: 'Р“РѕСЂРѕРґ: СѓС‡Р°СЃС‚РєРё РЅРµРґРІРёР¶РёРјРѕСЃС‚Рё',
        options: [
          {
            name: 'info',
            description: 'РРЅС„РѕСЂРјР°С†РёСЏ РѕР± СѓС‡Р°СЃС‚РєРµ',
            type: 1,
            options: [
              { name: 'plot_id', description: 'ID СѓС‡Р°СЃС‚РєР° (1-12)', type: 4, required: true },
            ],
          },
          {
            name: 'buy',
            description: 'РљСѓРїРёС‚СЊ СѓС‡Р°СЃС‚РѕРє (СЃРµР±Рµ РёР»Рё РєРѕРјРїР°РЅРёРё)',
            type: 1,
            options: [
              { name: 'plot_id', description: 'ID СѓС‡Р°СЃС‚РєР° (1-12)', type: 4, required: true },
              { name: 'company', description: 'РўРёРєРµСЂ РєРѕРјРїР°РЅРёРё-РїРѕРєСѓРїР°С‚РµР»СЏ (РѕРїС†РёРѕРЅР°Р»СЊРЅРѕ)', type: 3, required: false },
            ],
          },
          {
            name: 'sell',
            description: 'Р’С‹СЃС‚Р°РІРёС‚СЊ СѓС‡Р°СЃС‚РѕРє РЅР° РїСЂРѕРґР°Р¶Сѓ (price=0 вЂ” СЃРЅСЏС‚СЊ СЃ РїСЂРѕРґР°Р¶Рё)',
            type: 1,
            options: [
              { name: 'plot_id', description: 'ID СѓС‡Р°СЃС‚РєР° (1-12)', type: 4, required: true },
              { name: 'price', description: 'Р¦РµРЅР° РІ рџЄ™ (0 вЂ” СЃРЅСЏС‚СЊ СЃ РїСЂРѕРґР°Р¶Рё)', type: 4, required: true },
            ],
          },
        ],
      };

      try {
        const existingPlot = guild.commands.cache.find((c: any) => c.name === 'plot');
        if (!existingPlot) {
          await guild.commands.create(plotCommand);
          console.log(`[City] Slash command plot registered in guild ${guild.id}`);
        }
      } catch (plotErr) {
        console.error(`[City] Failed to register slash command plot in guild ${guild.id}:`, plotErr);
      }

      // ============================================
      // РЎР»СЌС€-РєРѕРјР°РЅРґС‹ /build Рё /upgrade (Р“РѕСЂРѕРґ вЂ” РЁР°Рі 3)
      // type 3 = STRING, type 4 = INTEGER
      // ============================================
      const buildCommand: any = {
        name: 'build',
        description: 'Р“РѕСЂРѕРґ: РїРѕСЃС‚СЂРѕРёС‚СЊ Р·РґР°РЅРёРµ РЅР° СѓС‡Р°СЃС‚РєРµ',
        options: [
          { name: 'plot_id', description: 'ID СѓС‡Р°СЃС‚РєР° (1-12)', type: 4, required: true },
          {
            name: 'type', description: 'РўРёРї Р±РёР·РЅРµСЃР°', type: 3, required: true,
            choices: [
              { name: 'в›ЏпёЏ РЁР°С…С‚Р°', value: 'mine' },
              { name: 'рџЊѕ Р¤РµСЂРјР°', value: 'farm' },
              { name: 'в›Ѕ РђР—РЎ', value: 'gas_station' },
              { name: 'рџ›’ РЎСѓРїРµСЂРјР°СЂРєРµС‚', value: 'shop' },
              { name: 'рџЌЅпёЏ Р РµСЃС‚РѕСЂР°РЅ', value: 'restaurant' },
              { name: 'рџЋ° РљР°Р·РёРЅРѕ', value: 'casino' },
              { name: 'рџЏ›пёЏ Р‘Р°РЅРє', value: 'bank' },
              { name: 'вљ“ РњРѕСЂСЃРєРѕР№ РїРѕСЂС‚', value: 'port' }
            ]
          }
        ],
      };

      try {
        const existingBuild = guild.commands.cache.find((c: any) => c.name === 'build');
        if (!existingBuild) {
          await guild.commands.create(buildCommand);
          console.log(`[City] Slash command build registered in guild ${guild.id}`);
        }
      } catch (buildErr) {
        console.error(`[City] Failed to register slash command build in guild ${guild.id}:`, buildErr);
      }

      const upgradeCommand: any = {
        name: 'upgrade',
        description: 'Р“РѕСЂРѕРґ: СѓР»СѓС‡С€РёС‚СЊ Р·РґР°РЅРёРµ РЅР° СѓС‡Р°СЃС‚РєРµ (РґРѕ СѓСЂРѕРІРЅСЏ 3)',
        options: [
          { name: 'plot_id', description: 'ID СѓС‡Р°СЃС‚РєР° (1-12)', type: 4, required: true }
        ],
      };

      try {
        const existingUpgrade = guild.commands.cache.find((c: any) => c.name === 'upgrade');
        if (!existingUpgrade) {
          await guild.commands.create(upgradeCommand);
          console.log(`[City] Slash command upgrade registered in guild ${guild.id}`);
        }
      } catch (upgradeErr) {
        console.error(`[City] Failed to register slash command upgrade in guild ${guild.id}:`, upgradeErr);
      }

      // ============================================
      // РЎР»СЌС€-РєРѕРјР°РЅРґР° /auction (Р“РѕСЂРѕРґ вЂ” РЁР°Рі 4: Р°СѓРєС†РёРѕРЅС‹ СѓС‡Р°СЃС‚РєРѕРІ)
      // type 1 = SUB_COMMAND, type 4 = INTEGER
      // ============================================
      const auctionCommand: any = {
        name: 'auction',
        description: 'Р“РѕСЂРѕРґ: Р°СѓРєС†РёРѕРЅС‹ СѓС‡Р°СЃС‚РєРѕРІ',
        options: [
          {
            name: 'list',
            description: 'РЎРїРёСЃРѕРє Р°РєС‚РёРІРЅС‹С… Р°СѓРєС†РёРѕРЅРѕРІ',
            type: 1,
          },
          {
            name: 'bid',
            description: 'РЎРґРµР»Р°С‚СЊ СЃС‚Р°РІРєСѓ РЅР° Р°СѓРєС†РёРѕРЅРµ',
            type: 1,
            options: [
              { name: 'plot_id', description: 'ID СѓС‡Р°СЃС‚РєР° (1-12)', type: 4, required: true },
              { name: 'amount', description: 'Р Р°Р·РјРµСЂ СЃС‚Р°РІРєРё РІ рџЄ™', type: 4, required: true },
            ],
          },
        ],
      };

      try {
        const existingAuction = guild.commands.cache.find((c: any) => c.name === 'auction');
        if (!existingAuction) {
          await guild.commands.create(auctionCommand);
          console.log(`[City] Slash command auction registered in guild ${guild.id}`);
        }
      } catch (auctionCmdErr) {
        console.error(`[City] Failed to register slash command auction in guild ${guild.id}:`, auctionCmdErr);
      }

      // ============================================
      // РЎР»СЌС€-РєРѕРјР°РЅРґР° /map (Р“РѕСЂРѕРґ вЂ” РЁР°Рі 5: РёРЅС‚РµСЂР°РєС‚РёРІРЅР°СЏ РєР°СЂС‚Р°)
      // ============================================
      const mapCommand: any = {
        name: 'map',
        description: 'Р“РѕСЂРѕРґ: РёРЅС‚РµСЂР°РєС‚РёРІРЅР°СЏ РєР°СЂС‚Р° СѓС‡Р°СЃС‚РєРѕРІ Рё РЅРµРґРІРёР¶РёРјРѕСЃС‚Рё',
      };

      try {
        const existingMap = guild.commands.cache.find((c: any) => c.name === 'map');
        if (!existingMap) {
          await guild.commands.create(mapCommand);
          console.log(`[City] Slash command map registered in guild ${guild.id}`);
        }
      } catch (mapCmdErr) {
        console.error(`[City] Failed to register slash command map in guild ${guild.id}:`, mapCmdErr);
      }
    }
  } catch (err) {
    console.error('[Gazeta] Failed to register slash command test-gazeta:', err);
  }

  console.log(`[Collector] Ready as ${client.user?.tag}`);
  const memUsage = Math.round(process.memoryUsage().rss / 1024 / 1024);
  console.log(`[Memory] RSS: ${memUsage}MB`);

  // ============================================
  // Р—Р°РїСѓСЃРє С„РѕРЅРѕРІС‹С… С‚Р°Р№РјРµСЂРѕРІ РґР»СЏ Р­С‚Р°РїР° 4-7
  // ============================================

  // Р•Р¶РµРЅРµРґРµР»СЊРЅС‹Р№ СЃР±СЂРѕСЃ Рё РЅР°РіСЂР°Р¶РґРµРЅРёРµ (СЂР°Р· РІ С‡Р°СЃ)
  console.log('[WeeklyReset] Starting weekly reset checker...');
  try {
    await checkWeeklyReset(db, client); // РџСЂРѕРІРµСЂРєР° СЃСЂР°Р·Сѓ РїСЂРё СЃС‚Р°СЂС‚Рµ
  } catch (err) {
    console.error('[WeeklyReset] Startup check failed, collector РїСЂРѕРґРѕР»Р¶Р°РµС‚ СЂР°Р±РѕС‚Сѓ:', err);
  }
  setInterval(async () => {
    try {
      console.log('[WeeklyReset] Checking for weekly reset...');
      await checkWeeklyReset(db, client);
    } catch (err) {
      console.error('[WeeklyReset] Interval check failed, collector РїСЂРѕРґРѕР»Р¶Р°РµС‚ СЂР°Р±РѕС‚Сѓ:', err);
    }
  }, 60 * 60 * 1000); // РљР°Р¶РґС‹Р№ С‡Р°СЃ

  // РўР°Р№РјРµСЂ РїСЂРѕРІРµСЂРєРё Рё Р·Р°РїСѓСЃРєР° Happy Hours (СЂР°Р· РІ С‡Р°СЃ)
  setInterval(async () => {
    console.log('[HappyHour] Checking for happy hours...');
    await checkAndStartHappyHours(db, client);
  }, 60 * 60 * 1000); // РљР°Р¶РґС‹Р№ С‡Р°СЃ

  // РўР°Р№РјРµСЂ РїСЂРѕРІРµСЂРєРё Рё СЃРїР°РІРЅР° Р’РѕР№СЃ-РґСЂРѕРїРѕРІ (СЂР°Р· РІ 7 РјРёРЅСѓС‚)
  setInterval(async () => {
    console.log('[AirDrop] Checking for air drops...');
    await checkAndSpawnAirDrops(db, client);
  }, 7 * 60 * 1000); // РљР°Р¶РґС‹Рµ 7 РјРёРЅСѓС‚ (СЃСЂР°Р·Сѓ Р·Р°РїСѓСЃРє)

  // РўР°Р№РјРµСЂ РЅР°С‡РёСЃР»РµРЅРёСЏ РѕРЅР»Р°Р№РЅ-СЃРµРєСѓРЅРґ (СЂР°Р· РІ 5 РјРёРЅСѓС‚ РґР»СЏ Р­С‚Р°РїР° 8)
  console.log('[OnlineSeconds] Starting online seconds ticker...');
  await awardOnlineSeconds(db, client); // РџСЂРѕРІРµСЂРєР° СЃСЂР°Р·Сѓ РїСЂРё СЃС‚Р°СЂС‚Рµ
  setInterval(async () => {
    await awardOnlineSeconds(db, client);
  }, 5 * 60 * 1000); // РљР°Р¶РґС‹Рµ 5 РјРёРЅСѓС‚ (300 СЃРµРєСѓРЅРґ)

  // РўР°Р№РјРµСЂ РїСЂРѕРІРµСЂРєРё РґРµР·РµСЂС‚РѕРІ (РєР°Р¶РґС‹Рµ 6 С‡Р°СЃРѕРІ)
  console.log('[DeserterCheck] Starting deseter checker...');
  await checkDeserters(db, client); // РџСЂРѕРІРµСЂРєР° СЃСЂР°Р·Сѓ РїСЂРё СЃС‚Р°СЂС‚Рµ
  setInterval(async () => {
    console.log('[DeserterCheck] Checking for deserters...');
    await checkDeserters(db, client);
  }, 6 * 60 * 60 * 1000); // РљР°Р¶РґС‹Рµ 6 С‡Р°СЃРѕРІ

  // РўР°Р№РјРµСЂ РїСЂРѕРІРµСЂРєРё Рё СЃРїР°РІРЅР° РњРёСЂРѕРІРѕРіРѕ Р‘РѕСЃСЃР° (РєР°Р¶РґС‹Рµ 10 РјРёРЅСѓС‚)
  console.log('[WorldBoss] Starting world boss checker...');
  try {
    await checkAndSpawnWorldBoss(db, client); // РџСЂРѕРІРµСЂРєР° СЃСЂР°Р·Сѓ РїСЂРё СЃС‚Р°СЂС‚Рµ
  } catch (err) {
    console.error('[WorldBoss] Startup check failed, collector РїСЂРѕРґРѕР»Р¶Р°РµС‚ СЂР°Р±РѕС‚Сѓ:', err);
  }
  setInterval(async () => {
    try {
      console.log('[WorldBoss] Checking for world boss...');
      await checkAndSpawnWorldBoss(db, client);
    } catch (err) {
      console.error('[WorldBoss] Interval check failed, collector РїСЂРѕРґРѕР»Р¶Р°РµС‚ СЂР°Р±РѕС‚Сѓ:', err);
    }
  }, 10 * 60 * 1000); // РљР°Р¶РґС‹Рµ 10 РјРёРЅСѓС‚

  // ============================================
  // РЎСѓС‚РѕС‡РЅС‹Р№ СЂРѕСЃС‚ РєР°Р·РЅС‹ РєРѕРјРїР°РЅРёР№ (РёРґРµРјРїРѕС‚РµРЅС‚РЅРѕ, РїСЂРѕРІРµСЂРєР° РєР°Р¶РґС‹Рµ 10 РјРёРЅСѓС‚)
  // ============================================
  console.log('[Growth] Starting company treasury growth ticker...');
  try {
    await processDailyCompanyGrowth(db, client); // РџСЂРѕРІРµСЂРєР° СЃСЂР°Р·Сѓ РїСЂРё СЃС‚Р°СЂС‚Рµ
  } catch (e) {
    console.error('[Growth] Startup error:', e);
  }
  setInterval(async () => {
    try {
      await processDailyCompanyGrowth(db, client);
    } catch (e) {
      console.error('[Growth] Interval error:', e);
    }
  }, 10 * 60 * 1000); // РљР°Р¶РґС‹Рµ 10 РјРёРЅСѓС‚

  // ============================================
  // РЎРµР·РѕРЅРЅР°СЏ Р»РёРєРІРёРґР°С†РёСЏ РєРѕРјРїР°РЅРёР№ (РїСЂРѕРІРµСЂРєР° СЃРјРµРЅС‹ СЃРµР·РѕРЅР° СЂР°Р· РІ С‡Р°СЃ).
  // РћС‚РґРµР»СЊРЅС‹Р№ С‚Р°Р№РјРµСЂ вЂ” РќР• С‡Р°СЃС‚СЊ РµР¶РµРЅРµРґРµР»СЊРЅРѕРіРѕ СЃР±СЂРѕСЃР° Р§РµРјРїРёРѕРЅР° РќРµРґРµР»Рё:
  // СЃСЂР°Р±Р°С‚С‹РІР°РЅРёРµ СЃС‚СЂРѕРіРѕ РїСЂРё СЃРјРµРЅРµ СЃРµР·РѕРЅР° (СЂР°Р· РІ 3 РјРµСЃСЏС†Р°).
  // ============================================
  console.log('[Liquidation] Starting season change checker...');
  try {
    await liquidateCompaniesOnSeasonChange(db); // РџСЂРѕРІРµСЂРєР° СЃСЂР°Р·Сѓ РїСЂРё СЃС‚Р°СЂС‚Рµ
  } catch (e) {
    console.error('[Liquidation] Startup error:', e);
  }
  setInterval(async () => {
    try {
      await liquidateCompaniesOnSeasonChange(db);
    } catch (e) {
      console.error('[Liquidation] Interval error:', e);
    }
  }, 60 * 60 * 1000); // РљР°Р¶РґС‹Р№ С‡Р°СЃ

  // ============================================
  // Р§РёСЃС‚РєР° РёСЃС‚РѕСЂРёРё Р±РёСЂР¶Рё (РєР°Р¶РґС‹Р№ С‡Р°СЃ): РѕС‚РїСЂР°РІР»РµРЅРЅС‹Рµ market_events СЃС‚Р°СЂС€Рµ 14 РґРЅРµР№,
  // company_nav_history СЃС‚Р°СЂС€Рµ 60 РґРЅРµР№.
  // ============================================
  console.log('[ExchangeCleanup] Starting exchange history cleanup ticker...');
  try {
    await cleanupExchangeHistory(db); // Р§РёСЃС‚РєР° СЃСЂР°Р·Сѓ РїСЂРё СЃС‚Р°СЂС‚Рµ
  } catch (e) {
    console.error('[ExchangeCleanup] Startup error:', e);
  }
  setInterval(async () => {
    try {
      await cleanupExchangeHistory(db);
    } catch (e) {
      console.error('[ExchangeCleanup] Interval error:', e);
    }
  }, 60 * 60 * 1000); // РљР°Р¶РґС‹Р№ С‡Р°СЃ

  // ============================================
  // Р›РµРЅС‚Р° Р±РёСЂР¶Рё (Р­С‚Р°Рї 4.2): С„РѕРЅРѕРІС‹Рµ РїСЂРѕС†РµСЃСЃС‹
  // ============================================

  // Outbox-РґРѕСЃС‚Р°РІРєР° СЃРѕР±С‹С‚РёР№ Р»РµРЅС‚С‹ (РєР°Р¶РґС‹Рµ 20 СЃРµРєСѓРЅРґ)
  console.log('[ExchangeFeed] Starting market events outbox ticker...');
  try {
    await processMarketEventsOutbox(db, client); // Р”РѕСЃС‚Р°РІРєР° СЃСЂР°Р·Сѓ РїСЂРё СЃС‚Р°СЂС‚Рµ
  } catch (e) {
    console.error('[ExchangeFeed] Outbox startup error:', e);
  }
  setInterval(async () => {
    try {
      await processMarketEventsOutbox(db, client);
    } catch (e) {
      console.error('[ExchangeFeed] Outbox interval error:', e);
    }
  }, 20 * 1000); // РљР°Р¶РґС‹Рµ 20 СЃРµРєСѓРЅРґ

  // Р РµР·РєРёРµ РґРІРёР¶РµРЅРёСЏ NAV (РєР°Р¶РґС‹Рµ 5 РјРёРЅСѓС‚)
  console.log('[ExchangeFeed] Starting sharp NAV moves ticker...');
  try {
    await checkSharpNavMoves(db); // РџСЂРѕРІРµСЂРєР° СЃСЂР°Р·Сѓ РїСЂРё СЃС‚Р°СЂС‚Рµ
  } catch (e) {
    console.error('[ExchangeFeed] NAV moves startup error:', e);
  }
  setInterval(async () => {
    try {
      await checkSharpNavMoves(db);
    } catch (e) {
      console.error('[ExchangeFeed] NAV moves interval error:', e);
    }
  }, 5 * 60 * 1000); // РљР°Р¶РґС‹Рµ 5 РјРёРЅСѓС‚

  // РЎСѓС‚РѕС‡РЅС‹Р№ РґР°Р№РґР¶РµСЃС‚ Р±РёСЂР¶Рё (РєР°Р¶РґС‹Рµ 15 РјРёРЅСѓС‚, Р·Р°С…РІР°С‚ РґРЅСЏ С‡РµСЂРµР· last_digest_day)
  console.log('[ExchangeFeed] Starting daily digest ticker...');
  try {
    await processDailyDigest(db, client); // РџСЂРѕРІРµСЂРєР° СЃСЂР°Р·Сѓ РїСЂРё СЃС‚Р°СЂС‚Рµ
  } catch (e) {
    console.error('[ExchangeFeed] Digest startup error:', e);
  }
  setInterval(async () => {
    try {
      await processDailyDigest(db, client);
    } catch (e) {
      console.error('[ExchangeFeed] Digest interval error:', e);
    }
  }, 15 * 60 * 1000); // РљР°Р¶РґС‹Рµ 15 РјРёРЅСѓС‚

  // ============================================
  // РљСЂРёР·РёСЃС‹ РєРѕРјРїР°РЅРёР№: СЃРїР°РІРЅ (РєР°Р¶РґС‹Рµ 30 РјРёРЅСѓС‚) Рё С‚Р°Р№РјР°СѓС‚С‹ (РєР°Р¶РґСѓСЋ РјРёРЅСѓС‚Сѓ).
  // РРЅС‚РµСЂРІР°Р»С‹ СЃРїР°РІРЅР°/TTL РЅР°СЃС‚СЂР°РёРІР°СЋС‚СЃСЏ env-РїРµСЂРµРјРµРЅРЅС‹РјРё РґР»СЏ С‚РµСЃС‚РѕРІРѕР№ РіРёР»СЊРґРёРё.
  // ============================================
  console.log('[Crises] Starting crisis tickers...');
  try {
    await processCompanyCrises(db, client); // РџСЂРѕРІРµСЂРєР° СЃСЂР°Р·Сѓ РїСЂРё СЃС‚Р°СЂС‚Рµ
  } catch (e) {
    console.error('[Crises] Spawn startup error:', e);
  }
  setInterval(async () => {
    try {
      await processCompanyCrises(db, client);
    } catch (e) {
      console.error('[Crises] Spawn interval error:', e);
    }
  }, 30 * 60 * 1000); // РљР°Р¶РґС‹Рµ 30 РјРёРЅСѓС‚

  try {
    await processCrisisTimeouts(db, client); // РџСЂРѕРІРµСЂРєР° СЃСЂР°Р·Сѓ РїСЂРё СЃС‚Р°СЂС‚Рµ
  } catch (e) {
    console.error('[Crises] Timeout startup error:', e);
  }
  setInterval(async () => {
    try {
      await processCrisisTimeouts(db, client);
    } catch (e) {
      console.error('[Crises] Timeout interval error:', e);
    }
  }, 60 * 1000); // РљР°Р¶РґСѓСЋ РјРёРЅСѓС‚Сѓ

  // ============================================
  // M11: С‚Р°Р№РјРµСЂ РїСЂРѕРІРµСЂРєРё Р·Р°РІРёСЃС€РёС… РґСѓСЌР»РµР№ (РєР°Р¶РґС‹Рµ 30 СЃРµРєСѓРЅРґ).
  // Pending-РґСѓСЌР»Рё СЃС‚Р°СЂС€Рµ 5 РјРёРЅСѓС‚ РёСЃС‚РµРєР°СЋС‚, СЃРѕРѕР±С‰РµРЅРёРµ СЂРµРґР°РєС‚РёСЂСѓРµС‚СЃСЏ.
  // ============================================
  console.log('[Duel] Starting expired duels ticker...');
  try {
    await checkExpiredDuels(db, client); // РџСЂРѕРІРµСЂРєР° СЃСЂР°Р·Сѓ РїСЂРё СЃС‚Р°СЂС‚Рµ
  } catch (e) {
    console.error('[Duel] Startup error:', e);
  }
  setInterval(async () => {
    try {
      await checkExpiredDuels(db, client);
    } catch (e) {
      console.error('[Duel tick]', e);
    }
  }, 30 * 1000);

  // ============================================
  // Р­РєРѕРЅРѕРјРёРєР° РіРѕСЂРѕРґР° (РЁР°Рі 4): СЃСѓС‚РѕС‡РЅС‹Р№ РґРѕС…РѕРґ, РЅРµРґРµР»СЊРЅС‹Р№ РЅР°Р»РѕРі, Р°СѓРєС†РёРѕРЅС‹
  // ============================================
  console.log('[CityEconomy] Starting city economy tickers...');
  try {
    await processDailyPlotRevenue(db, client); // РџСЂРѕРІРµСЂРєР° СЃСЂР°Р·Сѓ РїСЂРё СЃС‚Р°СЂС‚Рµ
  } catch (e) {
    console.error('[CityEconomy] Revenue startup error:', e);
  }
  setInterval(async () => {
    try {
      await processDailyPlotRevenue(db, client);
    } catch (e) {
      console.error('[CityEconomy] Revenue interval error:', e);
    }
  }, 60 * 60 * 1000); // РљР°Р¶РґС‹Р№ С‡Р°СЃ

  try {
    await processWeeklyPlotTaxes(db, client); // РџСЂРѕРІРµСЂРєР° СЃСЂР°Р·Сѓ РїСЂРё СЃС‚Р°СЂС‚Рµ
  } catch (e) {
    console.error('[CityEconomy] Tax startup error:', e);
  }
  setInterval(async () => {
    try {
      await processWeeklyPlotTaxes(db, client);
    } catch (e) {
      console.error('[CityEconomy] Tax interval error:', e);
    }
  }, 60 * 60 * 1000); // РљР°Р¶РґС‹Р№ С‡Р°СЃ

  try {
    await processExpiredAuctions(db, client); // РџСЂРѕРІРµСЂРєР° СЃСЂР°Р·Сѓ РїСЂРё СЃС‚Р°СЂС‚Рµ
  } catch (e) {
    console.error('[CityEconomy] Auction startup error:', e);
  }
  setInterval(async () => {
    try {
      await processExpiredAuctions(db, client);
    } catch (e) {
      console.error('[CityEconomy] Auction interval error:', e);
    }
  }, 5 * 60 * 1000); // РљР°Р¶РґС‹Рµ 5 РјРёРЅСѓС‚

  // Р•Р¶РµРЅРµРґРµР»СЊРЅР°СЏ AI-РіР°Р·РµС‚Р° (РєР°Р¶РґРѕРµ РІРѕСЃРєСЂРµСЃРµРЅСЊРµ РІ 20:00 РїРѕ Р’Р»Р°РґРёРІРѕСЃС‚РѕРєСѓ)
  console.log('[Gazeta] Starting weekly digest scheduler...');
  scheduleWeeklyDigest(client);
});

client.on('messageCreate', async (message: Message) => {
  if (message.author.bot) return;
  if (!message.guild) return;

  // РџСЂРѕРїСѓСЃРєР°РµРј СЃРёСЃС‚РµРјРЅС‹Рµ СЃРѕРѕР±С‰РµРЅРёСЏ Рё РІС‹Р·РѕРІС‹ СЃР»СЌС€-РєРѕРјР°РЅРґ,
  // С‡С‚РѕР±С‹ РІС‹Р·РѕРІС‹ РєРѕРјР°РЅРґ РЅРµ РЅР°РєСЂСѓС‡РёРІР°Р»Рё СЃС‡С‘С‚С‡РёРє СЃРѕРѕР±С‰РµРЅРёР№ Р·Р° РґРµРЅСЊ
  if (message.interaction || message.type !== 0) return;

  const { author, guild } = message;
  const guildId = guild.id;
  const userId = author.id;
  const today = getVladivostokDate();

  try {
    const now = Date.now();

    // ============================================
    // 0. РђРІС‚РѕСЃРѕР·РґР°РЅРёРµ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ (upsert), С‡С‚РѕР±С‹ РїРѕСЃР»РµРґСѓСЋС‰РёРµ
    //    РѕРїРµСЂР°С†РёРё (XP, СЃС‚СЂРёРєРё, РєРІРµСЃС‚С‹) РЅРµ РїР°РґР°Р»Рё СЃ "user not found in DB"
    // ============================================
    await db.execute({
      sql: `INSERT OR IGNORE INTO users (user_id, guild_id, xp, level, messages_count, last_message_at, last_activity_at)
            VALUES (?, ?, 0, 0, 0, 0, ?)`,
      args: [userId, guildId, now],
    });

    // Get user and guild settings
    const userResult = await db.execute({
      sql: 'SELECT * FROM users WHERE user_id = ? AND guild_id = ?',
      args: [userId, guildId],
    });

    const settingsResult = await db.execute({
      sql: 'SELECT * FROM guild_settings WHERE guild_id = ?',
      args: [guildId],
    });

    const xpPerMessage = (settingsResult.rows[0]?.xp_per_message as number) || 15;
    const cooldown = (settingsResult.rows[0]?.message_cooldown_seconds as number) || 45;

    if (userResult.rows.length === 0) {
      // First message from this user - INSERT СЃ last_activity_at
      const newXp = xpPerMessage;
      const newLevel = calculateLevel(newXp);

      await db.execute({
        sql: `INSERT INTO users (user_id, guild_id, xp, level, messages_count, last_message_at, last_activity_at)
              VALUES (?, ?, ?, ?, 1, ?, ?)`,
        args: [userId, guildId, newXp, newLevel, now, now],
      });
      console.log(`[Message] New user: ${author.username} (${userId}) in ${guild.name} - XP: ${newXp}, Level: ${newLevel}`);

      // РРЅРёС†РёР°Р»РёР·Р°С†РёСЏ РµР¶РµРґРЅРµРІРЅРѕР№ Р°РєС‚РёРІРЅРѕСЃС‚Рё РґР»СЏ РЅРѕРІРѕРіРѕ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ
      await db.execute({
        sql: `INSERT INTO user_daily_activity (user_id, guild_id, activity_date, messages_count)
              VALUES (?, ?, ?, 1)`,
        args: [userId, guildId, today],
      });
    } else {
      // ============================================
      // 1. Р Р°СЃС‡С‘С‚ РєСѓР»РґР°СѓРЅР° Рё РѕРїС‹С‚Р°
      // ============================================
      const row = userResult.rows[0];
      let lastMessageAt = Number(row.last_message_at || 0);
      if (lastMessageAt > 0 && lastMessageAt < 100000000000) {
        lastMessageAt = lastMessageAt * 1000;
      }

      const elapsedMs = now - lastMessageAt;
      const COOLDOWN_MS = cooldown * 1000;
      const canEarnXp = lastMessageAt === 0 || elapsedMs >= COOLDOWN_MS || elapsedMs < 0;

      // Р•СЃР»Рё РєСѓР»РґР°СѓРЅ РїСЂРѕС€С‘Р» вЂ” РЅР°С‡РёСЃР»СЏРµРј Р±Р°Р·РѕРІС‹Р№ XP, РёРЅР°С‡Рµ 0 XP
      const xpToAdd = canEarnXp ? xpPerMessage : 0;
      const lastMsgToSave = canEarnXp ? now : lastMessageAt;

      // ============================================
      // 2. Р—Р°РїСЂРѕСЃ РІ Р‘Р” - СЃС‡С‘С‚С‡РёРє СЃРѕРѕР±С‰РµРЅРёР№ Рё С‚Р°Р№РјСЃС‚РµРјРїС‹
      // C9: Р±Р°Р·РѕРІС‹Р№ XP Р·РґРµСЃСЊ Р±РѕР»СЊС€Рµ РќР• РїРёС€РµС‚СЃСЏ Р°Р±СЃРѕР»СЋС‚РЅС‹Рј Р·РЅР°С‡РµРЅРёРµРј (xp = ?),
      // РёР·-Р·Р° С‡РµРіРѕ РїСЂРё РїР°СЂР°Р»Р»РµР»СЊРЅС‹С… СЃРѕРѕР±С‰РµРЅРёСЏС… С‚РµСЂСЏР»РёСЃСЊ Р°РїРґРµР№С‚С‹. Р•РґРёРЅСЃС‚РІРµРЅРЅР°СЏ
      // С‚РѕС‡РєР° РЅР°С‡РёСЃР»РµРЅРёСЏ вЂ” awardXpWithAllMultipliers РЅРёР¶Рµ (С‚Р°Рј xp = xp + ?),
      // РёРЅР°С‡Рµ base XP РЅР°С‡РёСЃР»СЏР»СЃСЏ РґРІР°Р¶РґС‹ Р·Р° РѕРґРЅРѕ СЃРѕРѕР±С‰РµРЅРёРµ.
      // ============================================
      await db.execute({
        sql: `UPDATE users
              SET messages_count = messages_count + 1,
                  last_message_at = ?, last_activity_at = ?
              WHERE user_id = ? AND guild_id = ?`,
        args: [lastMsgToSave, now, userId, guildId],
      });

      // ============================================
      // 3. РќР°С‡РёСЃР»СЏРµРј XP СЃ РјРЅРѕР¶РёС‚РµР»СЏРјРё (Season + Week + HH)
      // ============================================
      let xpToAddFinal = 0;
      let finalLevel = Number(row.level || 0);
      if (xpToAdd > 0) {
        const happyHourMultiplier = await isHappyHourActive(db, guildId);
        const xpWithHH = xpToAdd * happyHourMultiplier;

        // РќР°С‡РёСЃР»СЏРµС‚ xp Р°С‚РѕРјР°СЂРЅРѕ (UPDATE users SET xp = xp + ?) СЃ СѓС‡С‘С‚РѕРј СЃС‚СЂРёРєР°/СЃРµР·РѕРЅР°/РЅРµРґРµР»Рё
        const { finalXp: finalXpWithMultipliers } = await awardXpWithAllMultipliers(db, userId, guildId, xpWithHH);
        xpToAddFinal = finalXpWithMultipliers;

        // РЈСЂРѕРІРµРЅСЊ СЃС‡РёС‚Р°РµС‚СЃСЏ РїРѕ Р¤РђРљРўРР§Р•РЎРљРћРњРЈ xp РёР· Р‘Р” Рё РѕР±СЏР·Р°С‚РµР»СЊРЅРѕ СЃРѕС…СЂР°РЅСЏРµС‚СЃСЏ
        const updatedUserResult = await db.execute({
          sql: 'SELECT xp FROM users WHERE user_id = ? AND guild_id = ?',
          args: [userId, guildId],
        });
        const newXpTotal = Number(updatedUserResult.rows[0]?.xp) || 0;
        finalLevel = calculateLevel(newXpTotal);

        await db.execute({
          sql: 'UPDATE users SET level = ? WHERE user_id = ? AND guild_id = ?',
          args: [finalLevel, userId, guildId],
        });

        console.log(`[XP] ${author.username}: base=${xpToAdd}, HH=${happyHourMultiplier}x, total=${newXpTotal} XP, level=${finalLevel}`);
      } else {
        console.log(`[Message] ${author.username} - Cooldown (${elapsedMs}ms elapsed, need ${COOLDOWN_MS}ms)`);
      }

      // ============================================
      // 4. РџСЂРѕРІРµСЂРєР° РґРѕСЃС‚РёР¶РµРЅРёР№ (Р­С‚Р°Рї 6)
      // ============================================
      const vladivostokDate = new Date(new Date().getTime() + 10 * 60 * 60 * 1000);
      const vh = vladivostokDate.getUTCHours();
      const vm = vladivostokDate.getUTCMinutes();
      const vs = vladivostokDate.getUTCSeconds();

      // witcher_plod: 30-35 СЃРµРє СЃ РїСЂРѕС€Р»РѕРіРѕ СЃРѕРѕР±С‰РµРЅРёСЏ
      const elapsedSeconds = elapsedMs / 1000;
      if (elapsedSeconds >= 30 && elapsedSeconds <= 35) {
        await unlockAchievement(db, userId, guildId, 'witcher_plod', client, message.channel);
      }

      // fbk_hello: 3+ РґРЅСЏ СЃ РїСЂРѕС€Р»РѕРіРѕ СЃРѕРѕР±С‰РµРЅРёСЏ
      const daysOffline = elapsedMs / (1000 * 60 * 60 * 24);
      if (daysOffline >= 3 && daysOffline < 4) {
        await unlockAchievement(db, userId, guildId, 'fbk_hello', client, message.channel);
      }

      // vlad_midnight: 00:00 (Р’Р»Р°РґРёРІРѕСЃС‚РѕРє)
      if (vh === 0 && vm === 0 && vs < 10) {
        await unlockAchievement(db, userId, guildId, 'vlad_midnight', client, message.channel);
      }

      // vlad_pyanse: 12:00-13:00 (Р’Р»Р°РґРёРІРѕСЃС‚РѕРє)
      if (vh >= 12 && vh < 13) {
        await unlockAchievement(db, userId, guildId, 'vlad_pyanse', client, message.channel);
      }

      // hl_wakeup: 06:00-07:00 (Р’Р»Р°РґРёРІРѕСЃС‚РѕРє)
      if (vh >= 6 && vh < 7) {
        await unlockAchievement(db, userId, guildId, 'hl_wakeup', client, message.channel);
      }

      // rdr_lenny: РєР°РїСЃ >= 10 Р±СѓРєРІ, РІСЂРµРјСЏ СЃ 02:00 РґРѕ 05:00
      if (message.content && message.content.length >= 10 && message.content === message.content.toUpperCase()) {
        if (vh >= 2 && vh < 5) {
          await unlockAchievement(db, userId, guildId, 'rdr_lenny', client, message.channel);
        }
      }

      // lucky_777, vlad_2000, witcher_coin: РѕРїСЂРµРґРµР»С‘РЅРЅС‹Рµ СЃСѓРјРјС‹ XP (РїСЂРѕРІРµСЂСЏРµРј РўР•РљРЈР©РР™ XP РёР· Р‘Р”)
      const checkUserResult = await db.execute({
        sql: 'SELECT xp FROM users WHERE user_id = ? AND guild_id = ?',
        args: [userId, guildId],
      });
      const currentXpInDb = (checkUserResult.rows[0]?.xp as number) || 0;

      if (currentXpInDb === 777) {
        await unlockAchievement(db, userId, guildId, 'lucky_777', client, message.channel);
      }
      if (currentXpInDb === 2000) {
        await unlockAchievement(db, userId, guildId, 'vlad_2000', client, message.channel);
      }
      if (currentXpInDb === 1000 || currentXpInDb === 2000 || currentXpInDb === 3000 || currentXpInDb === 5000) {
        await unlockAchievement(db, userId, guildId, 'witcher_coin', client, message.channel);
      }

      // ============================================
      // 5. РћР±РЅРѕРІР»РµРЅРёРµ РµР¶РµРґРЅРµРІРЅРѕР№ Р°РєС‚РёРІРЅРѕСЃС‚Рё - Р’РЎР•Р“Р”Рђ
      // ============================================
      await db.execute({
        sql: `INSERT INTO user_daily_activity (user_id, guild_id, activity_date, messages_count)
              VALUES (?, ?, ?, 1)
              ON CONFLICT(user_id, guild_id, activity_date)
              DO UPDATE SET messages_count = messages_count + 1`,
        args: [userId, guildId, today],
      });

      if (xpToAddFinal > 0) {
        console.log(`[Message] ${author.username} - ${xpToAddFinal} XP (total: ${currentXpInDb}, level: ${finalLevel})`);
      } else {
        console.log(`[Message] ${author.username} - Cooldown (total messages: ${(row.messages_count as number) + 1})`);
      }

      // ============================================
      // 6. РџСЂРѕРІРµСЂРєР° РєРІРµСЃС‚РѕРІ С‚РёРїР° messages - Р’РЎР•Р“Р”Рђ
      // ============================================
      await checkQuestsForMessage(db, userId, guildId, message);
    }

    // РћР±РЅРѕРІР»РµРЅРёРµ РєРІРµСЃС‚РѕРІ (РїСЂРѕРІРµСЂРєР° РµР¶РµРґРЅРµРІРЅС‹С… РєРІРµСЃС‚РѕРІ РєР°Р¶РґС‹Рµ 10 СЃРѕРѕР±С‰РµРЅРёР№ РґР»СЏ РѕРїС‚РёРјРёР·Р°С†РёРё)
    if (Math.random() < 0.1) {
      await ensureDailyQuests(db, guildId);
    }
  } catch (err) {
    console.error('[Error] messageCreate:', err);
  }
});

client.on('voiceStateUpdate', async (oldState: VoiceState, newState: VoiceState) => {
  const userId = newState.member?.id;
  const { guild } = newState;
  if (!guild || !userId) return;

  const today = getVladivostokDate();

  try {
    const now = Date.now();
    const userResult = await db.execute({
      sql: 'SELECT * FROM users WHERE user_id = ? AND guild_id = ?',
      args: [userId, guild.id],
    });

    if (userResult.rows.length === 0) {
      // Create user entry if doesn't exist
      await db.execute({
        sql: `INSERT INTO users (user_id, guild_id) VALUES (?, ?)`,
        args: [userId, guild.id],
      });
      // РРЅРёС†РёР°Р»РёР·Р°С†РёСЏ РµР¶РµРґРЅРµРІРЅРѕР№ Р°РєС‚РёРІРЅРѕСЃС‚Рё РґР»СЏ РЅРѕРІРѕРіРѕ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ
      await db.execute({
        sql: `INSERT INTO user_daily_activity (user_id, guild_id, activity_date, voice_seconds)
              VALUES (?, ?, ?, 0)`,
        args: [userId, guild.id, today],
      });
    }

    const joinedAtRow = await db.execute({
      sql: 'SELECT voice_joined_at, voice_segment_muted FROM users WHERE user_id = ? AND guild_id = ?',
      args: [userId, guild.id],
    });

    // VOICE JOIN (РІС…РѕРґ РІ РіРѕР»РѕСЃРѕРІРѕР№ РєР°РЅР°Р»)
    if (!oldState.channelId && newState.channelId) {
      const isMuted = newState.selfDeaf && newState.selfMute;
      await db.execute({
        sql: `UPDATE users
              SET voice_joined_at = ?, voice_segment_muted = ?, last_activity_at = ?
              WHERE user_id = ? AND guild_id = ?`,
        args: [now, isMuted ? 1 : 0, now, userId, guild.id],
      });
      console.log(`[Voice] ${newState.member?.displayName} joined voice - muted: ${isMuted}`);
      return;
    }

    // VOICE EXIT or MUTE/DEAF CHANGE
    // РџСЂРѕРІРµСЂСЏРµРј: РІС‹С…РѕРґ РёР· РєР°РЅР°Р»Р° РР›Р СЃРјРµРЅР° mute/deaf СЃС‚Р°С‚СѓСЃР°
    const oldChannelId = oldState.channelId;
    const newChannelId = newState.channelId;
    const muteChanged = oldState.selfDeaf !== newState.selfDeaf || oldState.selfMute !== newState.selfMute;

    if (oldChannelId && (!newChannelId || muteChanged)) {
      if (joinedAtRow.rows[0]?.voice_joined_at) {
        let joinedAt = joinedAtRow.rows[0].voice_joined_at as number;

        // Р—Р°С‰РёС‚Р° РѕС‚ СЃС‚Р°СЂС‹С… Р·Р°РїРёСЃРµР№ РІ СЃРµРєСѓРЅРґР°С…: РµСЃР»Рё С‡РёСЃР»Рѕ 10-Р·РЅР°С‡РЅРѕРµ (< 100 РјР»СЂРґ), РїРµСЂРµРІРѕРґРёРј РІ РјРёР»Р»РёСЃРµРєСѓРЅРґС‹
        if (joinedAt > 0 && joinedAt < 100000000000) {
          joinedAt = joinedAt * 1000;
        }

        // C4: РѕРіСЂР°РЅРёС‡РёРІР°РµРј РЅР°С‡РёСЃР»РµРЅРёРµ Р·Р° РѕРґРЅСѓ СЃРµСЃСЃРёСЋ 4 С‡Р°СЃР°РјРё
        // (Р·Р°С‰РёС‚Р° РѕС‚ Р·Р°РІРёСЃС€РµРіРѕ voice_joined_at, РµСЃР»Рё СЃРѕР±С‹С‚РёРµ РІС‹С…РѕРґР° РїРѕС‚РµСЂСЏР»РѕСЃСЊ)
        const MAX_SESSION_MS = 4 * 60 * 60 * 1000;
        const elapsedMs = Math.max(0, Math.min(now - joinedAt, MAX_SESSION_MS));
        const elapsedSeconds = Math.floor(elapsedMs / 1000);
        const wasMuted = joinedAtRow.rows[0].voice_segment_muted as number;

        let voiceSecondsToAdd = 0;
        if (wasMuted === 0) {
          voiceSecondsToAdd = elapsedSeconds;
        }

        // РћР±РЅРѕРІР»РµРЅРёРµ РµР¶РµРґРЅРµРІРЅРѕР№ Р°РєС‚РёРІРЅРѕСЃС‚Рё
        if (voiceSecondsToAdd > 0) {
          await db.execute({
            sql: `INSERT INTO user_daily_activity (user_id, guild_id, activity_date, voice_seconds)
                  VALUES (?, ?, ?, ?)
                  ON CONFLICT(user_id, guild_id, activity_date)
                  DO UPDATE SET voice_seconds = voice_seconds + ?`,
            args: [userId, guild.id, today, voiceSecondsToAdd, voiceSecondsToAdd],
          });
        }

        if (!newChannelId) {
          // Exiting voice completely
          await db.execute({
            sql: `UPDATE users
                  SET voice_seconds = voice_seconds + ?, voice_joined_at = NULL, voice_segment_muted = 0, last_activity_at = ?
                  WHERE user_id = ? AND guild_id = ?`,
            args: [voiceSecondsToAdd, now, userId, guild.id],
          });

          // РќР°С‡РёСЃР»РµРЅРёРµ XP Р·Р° РІРѕР№СЃ С‡РµСЂРµР· awardXpWithAllMultipliers (Season + Week СѓС‡С‘С‚)
          if (voiceSecondsToAdd > 0) {
            const xpPerMinute = 5; // Р‘Р°Р·РѕРІС‹Р№ XP Р·Р° РјРёРЅСѓС‚Сѓ РІ РІРѕР№СЃРµ
            const xpToAdd = Math.floor(voiceSecondsToAdd / 60) * xpPerMinute;

            if (xpToAdd > 0) {
              // РџРѕР»СѓС‡Р°РµРј РјРЅРѕР¶РёС‚РµР»СЊ Happy Hours
              const happyHourMultiplier = await isHappyHourActive(db, guild.id);
              // РџСЂРёРјРµРЅСЏРµРј РјРЅРѕР¶РёС‚РµР»СЊ Happy Hours Рє Р±Р°Р·РѕРІРѕРјСѓ XP
              const xpWithHH = xpToAdd * happyHourMultiplier;

              // РСЃРїРѕР»СЊР·СѓРµРј awardXpWithAllMultipliers РґР»СЏ СЃРµР·РѕРЅРЅРѕРіРѕ/РЅРµРґРµР»СЊРЅРѕРіРѕ СѓС‡С‘С‚Р°
              const { finalXp } = await awardXpWithAllMultipliers(db, userId, guild.id, xpWithHH);

              console.log(`[Voice XP] ${newState.member?.displayName}: base=${xpToAdd} (${xpWithHH} with HH), season/week recorded, total +${finalXp} XP`);
            }
          }

          console.log(`[Voice] ${newState.member?.displayName} exited voice - added ${voiceSecondsToAdd}s (was muted: ${!!wasMuted})`);

          // РџСЂРѕРІРµСЂРєР° РєРІРµСЃС‚РѕРІ С‚РёРїР° voice
          if (voiceSecondsToAdd > 0) {
            await checkQuestsForVoice(db, userId, guild.id, voiceSecondsToAdd, new Date(now));
          }
        } else {
          // Mute/deaf change, staying in voice
          const newMuteState = (newState.selfDeaf && newState.selfMute) ? 1 : 0;
          await db.execute({
            sql: `UPDATE users
                  SET voice_seconds = voice_seconds + ?, voice_joined_at = ?, voice_segment_muted = ?, last_activity_at = ?
                  WHERE user_id = ? AND guild_id = ?`,
            args: [voiceSecondsToAdd, now, newMuteState, now, userId, guild.id],
          });
          console.log(`[Voice] ${newState.member?.displayName} mute changed - added ${voiceSecondsToAdd}s, new state: ${newMuteState}`);

          // РџСЂРѕРІРµСЂРєР° РєРІРµСЃС‚РѕРІ С‚РёРїР° voice
          if (voiceSecondsToAdd > 0) {
            await checkQuestsForVoice(db, userId, guild.id, voiceSecondsToAdd, new Date(now));
          }
        }
      }
    }
  } catch (err) {
    console.error('[Error] voiceStateUpdate:', err);
  }
});

// ============================================
// РЎР»СЌС€-РєРѕРјР°РЅРґР° /test-gazeta (С‚РѕР»СЊРєРѕ РґР»СЏ Р°РґРјРёРЅРёСЃС‚СЂР°С†РёРё)
// ============================================
client.on('interactionCreate', async (interaction: any) => {
  if (!interaction.isChatInputCommand?.()) return;
  if (interaction.commandName !== 'test-gazeta') return;

  // РџСЂРѕРІРµСЂРєР° РїСЂР°РІ: Administrator РёР»Рё ManageGuild
  const perms = interaction.memberPermissions;
  if (!perms || (!perms.has('Administrator') && !perms.has('ManageGuild'))) {
    await interaction.reply({ content: 'в›” Р­С‚Р° РєРѕРјР°РЅРґР° РґРѕСЃС‚СѓРїРЅР° С‚РѕР»СЊРєРѕ Р°РґРјРёРЅРёСЃС‚СЂР°С†РёРё', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    if (!interaction.guild) {
      await interaction.editReply('вќЊ РљРѕРјР°РЅРґР° РґРѕСЃС‚СѓРїРЅР° С‚РѕР»СЊРєРѕ РЅР° СЃРµСЂРІРµСЂРµ.');
      return;
    }

    await runWeeklyDigest(interaction.guild);
    await interaction.editReply('вњ… Р’С‹РїСѓСЃРє РіР°Р·РµС‚С‹ Р·Р° РЅРµРґРµР»СЋ СѓСЃРїРµС€РЅРѕ РѕРїСѓР±Р»РёРєРѕРІР°РЅ РІ РєР°РЅР°Р»Рµ!');
  } catch (err: any) {
    const errText = String(err?.message || err || 'РќРµРёР·РІРµСЃС‚РЅР°СЏ РѕС€РёР±РєР°');
    console.error('[Gazeta] Error in /test-gazeta:', err);
    await interaction.editReply(`вќЊ РћС€РёР±РєР° РіРµРЅРµСЂР°С†РёРё РіР°Р·РµС‚С‹: ${errText.slice(0, 1500)}`);
  }
});

const token = process.env.DISCORD_BOT_TOKEN || process.env.DISCORD_TOKEN;
client.login(token);


