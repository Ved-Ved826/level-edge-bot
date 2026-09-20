import { createClient } from "@libsql/client";

import { calculateLevel } from "@shared/types";



// ============================================

// Каталог уникальных реликвий (Этап 14)

// ============================================

import { UNIQUE_ITEMS, getRarityColor, getRarityEmoji, findItemById } from "./itemsCatalog";

// Вынесенные модули (Этап 1: утилиты, типы, доступ к БД, справочники)
import { ACHIEVEMENTS_LIST } from "./data/achievements";
import { BOSS_DESCRIPTIONS } from "./data/bosses";
import { ButtonInteraction, CommandInteraction, DiscordInteraction, Env, ExecutionContext } from "./types";
import { addMarketListing, checkUserExists, createDuelRecord, ensureColumnExists, ensureDailyQuests, getDuelById, getInventoryItem, getInventoryItemByItemId, getMarketListings, getUserCoins, getUserDailyActivity, getUserGear, getUserInventory, getUserQuestProgress, getUserXp, isItemUniqueOnServer, unlockAchievement, updateCoins, updateDuelStatus, updateXpAndLevel } from "./db/queries";
import { formatInventoryItem, getCurrentSeason, getVladivostokDate, renderProgressBar } from "./utils/formatters";
import { getClassDisplayName, getClassSkills } from "./data/classes";
import { sendFollowUp, verifyDiscordSignature } from "./utils/discord";

// Обработчики команд (Этап 2)
import { handleAchievements } from "./commands/achievements";
import { handleAirdropClaim } from "./commands/airdrop";
import { handleBoss, handleBossAttack, handleBossSpawn } from "./commands/boss";
import { handleClass, handleClassPick } from "./commands/class";
import { handleDuel, handleDuelButtons } from "./commands/duel";
import { handleExport } from "./commands/export";
import { handleForge } from "./commands/forge";
import { handleRecap, handleServerKings } from "./commands/hall-of-fame";
import { handleEquip, handleGear, handleInventory, handleUnequip } from "./commands/inventory";
import { handleLeaderboard, handleLeaderboardButtons } from "./commands/leaderboard";
import { handleMarket, handleSellJunk } from "./commands/market";
import { handlePrestige, handlePrestigeButtons } from "./commands/prestige";
import { handleQuests } from "./commands/quests";
import { handleRank, handleRankToday } from "./commands/rank";
import { handleSettings } from "./commands/settings";
import { handleCardCustomize, handleCardSelectTheme, handleShop } from "./commands/shop";
import { handleGiveRelic, handleTrade } from "./commands/trade";
import { handleTestGazeta } from "./commands/gazeta";
import { handleCourt } from "./commands/court";
import { handleCompanyCreate } from "./commands/company";
import { handlePortfolio, handleStocks } from "./commands/stocks";
import { handleInvest, handleDivest } from "./commands/invest";
import { handleExchangeSetup } from "./commands/exchange-setup";



// ============================================

// Описания Мировых Боссов (Этап 13)

// ============================================




// ============================================

// Система достижений (Этап 6 - 27 секретных пасхалок)

// ============================================






// 27 достижений из CLAUDE.md













// ============================================

// Вспомогательные утилиты (WASM, Дата, Бары)

// ============================================



















// Безопасное добавление колонки в таблицу, если её ещё нет (fallback для старых БД)



// ============================================

// Система реликвий и экипировки (Этап 14)

// ============================================



// Формат строки предмета в инвентаре




// Достать предмет по ID




// Достать предмет по item_id (для проверки уникальности)




// Достать все предметы пользователя




// Достать все надетые предметы пользователя (объединённый запрос с IN)




// Достать лоты рынка




// Добавить лот на рынок




// Проверка уникальности предмета на сервере




// ============================================

// Система RPG-классов (Этап 12)

// ============================================












// ============================================

// Генерация карточки ранга (/rank)

// ============================================















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




// ============================================

// Квесты и Дейли-активность

// ============================================





















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



async function handleRequest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {

  const url = new URL(request.url);



    if (request.method === "POST" && url.pathname === "/interactions") {

      const sig = request.headers.get("x-signature-ed25519");

      const ts = request.headers.get("x-signature-timestamp");

      if (!sig || !ts) { return Response.json({ error: "No sig" }, { status: 401 }); }



      const body = await request.text();

      const valid = await verifyDiscordSignature(sig, ts, body, env.DISCORD_PUBLIC_KEY);

      if (!valid) { return Response.json({ error: "Bad sig" }, { status: 401 }); }



      const inter: DiscordInteraction = JSON.parse(body);



      // 1. PING

      if (inter.type === 1) { return Response.json({ type: 1 }); }



      // 2. Слэш-команда /rank

      if (inter.type === 2 && inter.data?.name === "rank") { return handleRank(inter as CommandInteraction, env, ctx); }



      // 3. Слэш-команда /leaderboard

      if (inter.type === 2 && inter.data?.name === "leaderboard") { return handleLeaderboard(inter as CommandInteraction, env, ctx); }



      // 4. Кнопки пагинации и режимов лидерборда (Type 3)

      if (inter.type === 3 && inter.data?.custom_id?.startsWith("lb_")) { return handleLeaderboardButtons(inter as ButtonInteraction, env, ctx); }



      // 5. Слэш-команда /rank-today

      if (inter.type === 2 && inter.data?.name === "rank-today") { return handleRankToday(inter as CommandInteraction, env, ctx); }



      // 6. Слэш-команда /quests

      if (inter.type === 2 && inter.data?.name === "quests") { return handleQuests(inter as CommandInteraction, env, ctx); }



      // 7. Слэш-команда /duel

      if (inter.type === 2 && inter.data?.name === "duel") { return handleDuel(inter as CommandInteraction, env, ctx); }



      // 8. Обработка кнопок дуэли (Type 3)

      if (inter.type === 3 && (inter.data?.custom_id?.startsWith("duel_accept_") || inter.data?.custom_id?.startsWith("duel_decline_"))) { return handleDuelButtons(inter as ButtonInteraction, env, ctx); }



      // ============================================

      // Обработка кнопок атаки Мирового Босса (Этап 13)

      // ============================================



      // 24. Обработка кнопок атаки босса (Type 3)

      // ИСПРАВЛЕНО: type: 4 для ранних валидаций, единственный type: 5 defer перед тяжёлой работой

      if (inter.type === 3 && inter.data?.custom_id?.startsWith("boss_atk_")) { return handleBossAttack(inter as ButtonInteraction, env, ctx); }



      // 25. Слэш-команда /boss (Этап 13 - Показать статус босса)

      if (inter.type === 2 && inter.data?.name === "boss") { return handleBoss(inter as CommandInteraction, env, ctx); }



      // 10. Обработка кнопок сброса престижа (Type 3 - Этап 9)

      if (inter.type === 3 && (inter.data?.custom_id?.startsWith("prestige_confirm_") || inter.data?.custom_id?.startsWith("prestige_cancel_"))) { return handlePrestigeButtons(inter as ButtonInteraction, env, ctx); }



      // 11. Обработка кнопок Войс-дропов (Type 3)

      if (inter.type === 3 && inter.data?.custom_id?.startsWith("airdrop_claim_")) { return handleAirdropClaim(inter as ButtonInteraction, env, ctx); }



      // 10. Слэш-команда /card-customize (Этап 5 - Кастомизация карточки)

      if (inter.type === 2 && inter.data?.name === "card-customize") { return handleCardCustomize(inter as CommandInteraction, env, ctx); }



      // 11. Обработка Select Menu для смены темы (Type 3)

      if (inter.type === 3 && inter.data?.custom_id === "card_select_theme") { return handleCardSelectTheme(inter as ButtonInteraction, env, ctx); }



      // 12. Обработка кнопок выбора класса (Type 3 - Этап 12)

      if (inter.type === 3 && inter.data?.custom_id?.startsWith("class_pick_")) { return handleClassPick(inter as ButtonInteraction, env, ctx); }



      // 13. Слэш-команда /achievements (Этап 6 - Система достижений)

      if (inter.type === 2 && inter.data?.name === "achievements") { return handleAchievements(inter as CommandInteraction, env, ctx); }



      // 13. Слэш-команда /server-kings (Этап 8 - Короли сервера)

      if (inter.type === 2 && inter.data?.name === 'server-kings') { return handleServerKings(inter as CommandInteraction, env, ctx); }



      // 14. Слэш-команда /recap (Этап 8 - Discord Wrapped)

      if (inter.type === 2 && inter.data?.name === 'recap') { return handleRecap(inter as CommandInteraction, env, ctx); }

// 16. Слэш-команда /export (Этап 10 - CSV-экспорт аналитики)

      if (inter.type === 2 && inter.data?.name === "export") { return handleExport(inter as CommandInteraction, env, ctx); }

// 16. Слэш-команда /sell-junk (Этап 11 - Быстрый автобай хлама)

      if (inter.type === 2 && inter.data?.name === "sell-junk") { return handleSellJunk(inter as CommandInteraction, env, ctx); }



      // 15. Слэш-команда /class (Этап 12 - Система RPG-классов)

      if (inter.type === 2 && inter.data?.name === "class") { return handleClass(inter as CommandInteraction, env, ctx); }



      // 17. Слэш-команда /inventory [page]

      if (inter.type === 2 && inter.data?.name === "inventory") { return handleInventory(inter as CommandInteraction, env, ctx); }



      // 18. Слэш-команда /gear [user]

      if (inter.type === 2 && inter.data?.name === "gear") { return handleGear(inter as CommandInteraction, env, ctx); }



      // 19. Слэш-команда /equip [id]

      if (inter.type === 2 && inter.data?.name === "equip") { return handleEquip(inter as CommandInteraction, env, ctx); }



      // 20. Слэш-команда /unequip [slot]

      if (inter.type === 2 && inter.data?.name === "unequip") { return handleUnequip(inter as CommandInteraction, env, ctx); }



      // 21. Слэш-команда /trade user:@User item_id:number price:number

      if (inter.type === 2 && inter.data?.name === "trade") { return handleTrade(inter as CommandInteraction, env, ctx); }



      // 22. Слэш-команда /market [action] [page] [item_id] [price]

      if (inter.type === 2 && inter.data?.name === "market") { return handleMarket(inter as CommandInteraction, env, ctx); }



      // 23. Слэш-команда /give-relic (только для администраторов)

      if (inter.type === 2 && inter.data?.name === "give-relic") { return handleGiveRelic(inter as CommandInteraction, env, ctx); }






      // 17. Слэш-команда /boss-spawn (только для администраторов)

      if (inter.type === 2 && inter.data?.name === "boss-spawn") { return handleBossSpawn(inter as CommandInteraction, env, ctx); }



      // 16. Слэш-команда /prestige (Этап 9 - Система престижа)

      if (inter.type === 2 && inter.data?.name === "prestige") { return handlePrestige(inter as CommandInteraction, env, ctx); }



      // 26. Слэш-команда /forge id:number (Кузница с кулдауном 12 часов)

      if (inter.type === 2 && inter.data?.name === "forge") { return handleForge(inter as CommandInteraction, env, ctx); }



      // 27. Слэш-команда /shop (Элитный магазин титулов и заморозок)

      if (inter.type === 2 && inter.data?.name === "shop") { return handleShop(inter as CommandInteraction, env, ctx); }



      // 28. Слэш-команда /settings level-notify [step]

      if (inter.type === 2 && inter.data?.name === "settings") { return handleSettings(inter as CommandInteraction, env, ctx); }

      // 29. Слэш-команда /test-gazeta (только для администрации)

      if (inter.type === 2 && inter.data?.name === "test-gazeta") { return handleTestGazeta(inter as CommandInteraction, env, ctx); }

      // 30. Слэш-команда /court target:@user reason:text (ИИ-суд по последним сообщениям канала)
      if (inter.type === 2 && inter.data?.name === "court") { return handleCourt(inter as CommandInteraction, env, ctx); }

      // 31. Слэш-команда /company-create name:text ticker:text [description:text] (Биржа компаний)
      if (inter.type === 2 && inter.data?.name === "company-create") { return handleCompanyCreate(inter as CommandInteraction, env, ctx); }

      // 32. Слэш-команда /stocks (Биржа компаний — список компаний, read-only)
      if (inter.type === 2 && inter.data?.name === "stocks") { return handleStocks(inter as CommandInteraction, env, ctx); }

      // 33. Слэш-команда /portfolio (Биржа компаний — портфель игрока, read-only)
      if (inter.type === 2 && inter.data?.name === "portfolio") { return handlePortfolio(inter as CommandInteraction, env, ctx); }

      // 34. Слэш-команда /invest ticker amount (Биржа компаний — покупка акций)
      if (inter.type === 2 && inter.data?.name === "invest") { return handleInvest(inter as CommandInteraction, env, ctx); }

      // 35. Слэш-команда /divest ticker amount (Биржа компаний — продажа акций)
      if (inter.type === 2 && inter.data?.name === "divest") { return handleDivest(inter as CommandInteraction, env, ctx); }

      // 36. Слэш-команда /exchange-setup channel (Биржа — канал событий, только Manage Guild)
      if (inter.type === 2 && inter.data?.name === "exchange-setup") { return handleExchangeSetup(inter as CommandInteraction, env, ctx); }



      return Response.json({ error: "Unknown interaction" }, { status: 400 });

    }



    if (url.pathname === "/health") return new Response("OK");

    return new Response("Not Found", { status: 404 });

}

export default {

  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {

    // Глобальная страховка: любой неперехваченный сбой возвращает Discord
    // валидный type 4 с текстом ошибки вместо пустого таймаута/500.
    try {

      return await handleRequest(request, env, ctx);

    } catch (e) {

      console.error("[Worker] Unhandled interaction error:", e);

      const msg = e instanceof Error && e.message ? e.message : String(e);

      return Response.json({ type: 4, data: { content: `Ошибка выполнения команды: ${msg}`, flags: 64 } });

    }

  },

};

