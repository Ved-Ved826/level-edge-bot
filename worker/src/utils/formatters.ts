// Форматирование дат, прогресс-баров и строк инвентаря.

import { getRarityEmoji } from "../itemsCatalog";

export function getVladivostokDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Vladivostok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function renderProgressBar(current: number, target: number, length: number = 10): string {
  const ratio = Math.min(Math.max(current / target, 0), 1);
  const filled = Math.round(ratio * length);
  const empty = length - filled;
  return "█".repeat(filled) + "░".repeat(empty);
}

export function formatInventoryItem(item: any, itemId: number): string {
  const atk = (item.atk_bonus as number) || 0;
  const def = (item.def_bonus as number) || 0;
  const crit = (item.crit_bonus as number) || 0;
  const coin = (item.coin_bonus as number) || 0;
  const isEquipped = (item.is_equipped as number) || 0;
  const rarityEmoji = getRarityEmoji(item.rarity as string);
  return `[ID #${itemId}] ${rarityEmoji} **${item.item_name}** (${item.rarity}) ${isEquipped ? '⭐ [НАДЕТО]' : ''}\n` +
    `└ ⚔️ +${atk} | 🛡️ +${def} | 🎯 +${crit}% | 🪙 +${coin}%\n`;
}

export function getCurrentSeason(): string {
  const month = new Date().getUTCMonth() + 1;
  if (month >= 3 && month <= 5) return "🌸 Весенний кубок";
  if (month >= 6 && month <= 8) return "☀️ Летний драйв";
  if (month >= 9 && month <= 11) return "🍂 Осенний марафон";
  return "❄️ Зимняя битва";
}
