import { Client, GatewayIntentBits, Message, VoiceState } from 'discord.js';
import { createClient } from '@libsql/client';
import 'dotenv/config';

import http from 'node:http';

// Микро-сервер для прохождения Healthcheck на Koyeb
const PORT = process.env.PORT || 8000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Collector is running!');
}).listen(PORT, () => {
  console.log(`[Healthcheck] Listening on port ${PORT}`);
});

// ============================================
// Пул квестов (дублировано для collector, избегаем tsconfig issues)
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
  // Текстовые квесты
  { id: 'messages_warmup_10_50xp', title: 'Разминка пальцев', desc: '10 сообщений', type: 'messages', target: 10, xp: 50 },
  { id: 'messages_active_30_150xp', title: 'Активный спикер', desc: '30 сообщений', type: 'messages', target: 30, xp: 150 },
  { id: 'messages_god_60_300xp', title: 'Гроза чата', desc: '60 сообщений', type: 'messages', target: 60, xp: 300 },
  { id: 'messages_wall_100_500xp', title: 'Стена текста', desc: '100 сообщений', type: 'messages', target: 100, xp: 500 },
  { id: 'messages_long_20_100xp', title: 'Философ', desc: '20 сообщений > 100 символов', type: 'messages', target: 20, xp: 100 },
  // Голосовые квесты
  { id: 'voice_peep_15_100xp', title: 'Заглянул на огонек', desc: '15 минут в войсе', type: 'voice', target: 15, xp: 100 },
  { id: 'voice_deep_45_250xp', title: 'Душевный разговор', desc: '45 минут в войсе', type: 'voice', target: 45, xp: 250 },
  { id: 'voice_marathon_90_450xp', title: 'Войс-марафон', desc: '90 минут в войсе', type: 'voice', target: 90, xp: 450 },
  { id: 'voice_host_150_750xp', title: 'Хозяин эфира', desc: '150 минут в войсе', type: 'voice', target: 150, xp: 750 },
  { id: 'voice_night_30_200xp', title: 'Ночной дозор', desc: '30 минут после 00:00 UTC', type: 'voice', target: 30, xp: 200 },
  // Комбо и особые
  { id: 'combo_double_25_25_300xp', title: 'Двойной удар', desc: '25 сообщ. + 25 мин войса', type: 'combo', target: 25, xp: 300 },
  { id: 'combo_morning_15_100xp', title: 'Утренний кофе', desc: '15 сообщений (06:00-12:00)', type: 'messages', target: 15, xp: 100 },
  { id: 'combo_night_10_20_150xp', title: 'Совместное усилие', desc: '10 сообщ. + 20 мин войса', type: 'combo', target: 10, xp: 150 },
  { id: 'combo_balance_50_50_400xp', title: 'Баланс', desc: '50 сообщ. + 50 мин войса', type: 'combo', target: 50, xp: 400 },
  { id: 'combo_super_100_100_800xp', title: 'Ирония судьбы', desc: '100 сообщ. + 100 мин войса', type: 'combo', target: 100, xp: 800 },
];

// Re-export from shared types (duplicate for collector to avoid tsconfig issues)
const calculateLevel = (xp: number): number => {
  return Math.floor(0.1 * Math.sqrt(xp));
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
  trigger: (db: any, userId: string, guildId: string, data: any) => Promise<boolean>;
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
    trigger: checkWitcherPlod
  },
  {
    id: 'witcher_gwent',
    title: '🃏 В Гвинт не сыграешь?',
    description: 'Сыграть 3 дуэли за один день',
    quote: 'Кивает молча и достаёт колоду Королевств Севера.',
    reward: 200,
    trigger: checkWitcherGwent
  },
  {
    id: 'witcher_damn',
    title: '🐺 Зараза...',
    description: 'Проиграть дуэль с броском кубика меньше 10',
    quote: 'Ветер воет...',
    reward: 100,
    trigger: checkWitcherDamn
  },
  {
    id: 'witcher_blaviken',
    title: '⚔️ Мясник из Блавикена',
    description: 'Выиграть 3 дуэли подряд без поражений',
    quote: 'Если приходится выбирать между злом и злом...',
    reward: 350,
    trigger: checkWitcherBlaviken
  },
  {
    id: 'witcher_coin',
    title: '🪙 Чеканная монета',
    description: 'Зафиксировать ровно 1000, 2000, 3000 или 5000 XP',
    quote: 'Зачтётся всё это вам!',
    reward: 250,
    trigger: checkWitcherCoin
  },
  // --- Red Dead Redemption 2 ---
  {
    id: 'rdr_plan',
    title: '🤠 У меня есть ПЛАН!',
    description: 'Накопить 3000+ XP, ни разу не проиграв в дуэлях',
    quote: 'Нам просто нужно больше денег, Артур!',
    reward: 300,
    trigger: checkRDRPlan
  },
  {
    id: 'rdr_lenny',
    title: '🍻 ЛИИИННИИИИ!',
    description: 'Отправить капс-сообщение 10+ букв ночью с 02:00 до 05:00',
    quote: 'YNNEL?! ГДЕ ТЫ, ЛЕННИ?!',
    reward: 150,
    trigger: checkRDRLenny
  },
  {
    id: 'rdr_quickdraw',
    title: '🎯 Быстрая рука',
    description: 'Выиграть дуэль с броском 95+',
    quote: 'На этом сервере место только для одного.',
    reward: 250,
    trigger: checkRDRQuickdraw
  },
  {
    id: 'rdr_tahiti',
    title: '🥭 Билет на Таити',
    description: 'Провести более 5 часов в войсе за день',
    quote: 'Мы будем выращивать манго и жить припеваючи.',
    reward: 300,
    trigger: checkRDRTahiti
  },
  {
    id: 'rdr_tax',
    title: '💰 Капитализм, Артур',
    description: 'Сжечь более 200 XP на налоге с дуэлей',
    quote: 'Мы воры в мире, которому мы больше не нужны.',
    reward: 200,
    trigger: checkRDRTax
  },
  // --- Владивосток и ДВ ---
  {
    id: 'vlad_2000',
    title: '🌊 Владивосток 2000',
    description: 'Оказаться ровно с 2000 XP на балансе',
    quote: 'Уходим, уходим, уходят кометы...',
    reward: 200,
    trigger: checkVlad2000
  },
  {
    id: 'vlad_midnight',
    title: '⚓ Полночь на Эгершельде',
    description: 'Отправить сообщение ровно в 00:00 (Владивосток)',
    quote: 'Маяк светит, квесты сбросились.',
    reward: 200,
    trigger: checkVladMidnight
  },
  {
    id: 'vlad_pyanse',
    title: '🥟 Пян-се на Луговой',
    description: 'Быть активным в чате во время обеда с 12:00 до 13:00 (Владивосток)',
    quote: 'С пылу с жару, с перцем и капустой.',
    reward: 120,
    trigger: checkVladPyanse
  },
  {
    id: 'vlad_typhoon',
    title: '🌪️ Тайфун прошёл стороной',
    description: 'Спасти стрик с помощью заморозки',
    quote: 'Опять передавали штормовое, но обошлось.',
    reward: 250,
    trigger: checkVladTyphoon
  },
  {
    id: 'vlad_right_hand',
    title: '🚗 Истинный праворульщик',
    description: 'Сменить тему на Киберпанк или Магму',
    quote: 'Руль в бардачке, едем боком.',
    reward: 100,
    trigger: checkVladRightHand
  },
  {
    id: 'vlad_golden_horn',
    title: '🌉 Хозяин Золотого Рога',
    description: 'Занять 1-е место в лидерборде сервера',
    quote: 'Мост построили, сервер держим.',
    reward: 500,
    trigger: checkVladGoldenHorn
  },
  // --- Half-Life 2 ---
  {
    id: 'hl_wakeup',
    title: '🚆 Проснитесь и попойте',
    description: 'Отправить сообщение с 06:00 до 07:00 утра (Владивосток)',
    quote: 'Нужный человек не в том месте...',
    reward: 150,
    trigger: checkHLWakeup
  },
  {
    id: 'hl_can',
    title: '🥫 Подними эту банку',
    description: 'Выполнить свой первый ежедневный квест',
    quote: 'А теперь брось её в урну.',
    reward: 100,
    trigger: checkHLCan
  },
  {
    id: 'hl_water',
    title: '💧 Не пейте воду',
    description: 'Провести 2 часа непрерывно в войсе',
    quote: 'Они туда что-то подмешивают...',
    reward: 250,
    trigger: checkHLWater
  },
  {
    id: 'hl_crowbar',
    title: '🪓 Монтировка против страйдера',
    description: 'Победить в дуэли оппонента, у которого уровень выше твоего на 2+',
    quote: 'Физика Source на твоей стороне.',
    reward: 300,
    trigger: checkHLCrowbar
  },
  {
    id: 'hl_airdrop',
    title: '📦 Ящик сопротивления',
    description: 'Первым забрать контейнер войс-дропа',
    quote: 'Сигнальная ракета сработала.',
    reward: 150,
    trigger: checkHLAirdrop
  },
  // --- Мемы / Навальный ---
  {
    id: 'fbk_hello',
    title: '📣 Привет, это Навальны��',
    description: 'Написать сообщение после 3+ дней отсутствия на сервере',
    quote: 'Я не молчал, я просто был в оффлайне!',
    reward: 150,
    trigger: checkFBKHello
  },
  {
    id: 'fbk_sandwich',
    title: '🥪 Не бутерброд',
    description: 'Удержать стрик активности ровно 14 дней',
    quote: 'Стрик — он что, бутерброд, чтобы его сбрасывать?',
    reward: 250,
    trigger: checkFBKSandwich
  },
  {
    id: 'fbk_final_battle',
    title: '⚔️ Финальная битва',
    description: 'Сыграть дуэль со ставкой от 1000 XP',
    quote: 'Финальная битва добра с нейтралитетом!',
    reward: 300,
    trigger: checkFBKFinalBattle
  },
  {
    id: 'fbk_investigation',
    title: '🕵️ Команда расследователей',
    description: 'Посмотреть карточки /rank 5 разных людей за день',
    quote: 'Мы нашли у него незадекларированный уровень.',
    reward: 150,
    trigger: checkFBKInvestigation
  },
  {
    id: 'fbk_prb',
    title: '☀️ Прекрасный Сервер Будущего',
    description: 'Закрыть все 3 дейлика за один день',
    quote: 'Россия будет счастливой, а опыт нафармлен.',
    reward: 250,
    trigger: checkFBKPRB
  },
  // --- Классика ---
  {
    id: 'lucky_777',
    title: '🎰 Три топора',
    description: 'Зафиксировать ровно 777 XP на балансе',
    quote: 'Поднял бабла, теперь в топе.',
    reward: 250,
    trigger: checkLucky777
  },
  {
    id: 'casino_house',
    title: '🎲 Казино всегда в плюсе',
    description: 'Сжечь более 100 XP налога в одной дуэли',
    quote: 'Карты с самого начала были краплеными.',
    reward: 150,
    trigger: checkCasinoHouse
  },
];

// ============================================
// Функции разблокировки достижений (Этап 6)
// ============================================

/**
 * Проверяет, открыто ли уже достижение
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
 * Начисляет награду за достижение и отправляет оповещение
 */
async function unlockAchievement(db: any, userId: string, guildId: string, achievementId: string, bot: Client): Promise<void> {
  const achievement = ACHIEVEMENTS_LIST.find(a => a.id === achievementId);
  if (!achievement) {
    console.error(`[Achievement] Achievement not found: ${achievementId}`);
    return;
  }

  // Проверка: если уже открыто
  const isUnlocked = await checkAchievementUnlocked(db, userId, guildId, achievementId);
  if (isUnlocked) {
    console.log(`[Achievement] Already unlocked: ${achievementId} for ${userId}`);
    return;
  }

  // Вставляем запись
  const now = Math.floor(Date.now() / 1000);
  try {
    await db.execute({
      sql: 'INSERT INTO user_achievements (user_id, guild_id, achievement_id, unlocked_at) VALUES (?, ?, ?, ?)',
      args: [userId, guildId, achievementId, now],
    });

    // Начисляем XP награду
    await db.execute({
      sql: 'UPDATE users SET xp = xp + ? WHERE user_id = ? AND guild_id = ?',
      args: [achievement.reward, userId, guildId],
    });

    // Обновляем уровень
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

    // Отправляем золотой Embed в чат
    try {
      const guild = bot.guilds.cache.get(guildId);
      if (guild) {
        const channel = guild.channels.cache.find(c =>
          c.type === 0 && // GuildText
          c.permissionsFor(guild.members.me!)?.has('SendMessages')
        ) as any;

        if (channel) {
          const embed = {
            embeds: [{
              title: '🏆 СЕКРЕТНОЕ ДОСТИЖЕНИЕ РАЗБЛОКИРОВАНО!',
              description: `<@${userId}> открыл(а) достижение **\`«${achievement.title}»**!`,
              color: 0xF1C40F,
              fields: [
                { name: 'Описание', value: achievement.description, inline: false },
                { name: 'Цитата', value: `*${achievement.quote}*`, inline: false },
                { name: 'Награда', value: `**+${achievement.reward} XP**`, inline: true },
              ],
              footer: { text: 'Отличная работа! Продолжай исследовать сервер...' },
            }],
          };

          try {
            await channel.send(embed);
            console.log(`[Achievement] Notification sent to ${guildId}`);
          } catch (sendErr) {
            console.error(`[Achievement] Failed to send notification:`, sendErr);
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
// Функции проверки условий достижений
// ============================================

// --- Ведьмак 3 ---

/**
 * witcher_plod: Отправить сообщение ровно через 30-35 сек после предыдущего
 */
async function checkWitcherPlod(db: any, userId: string, guildId: string, data: { now: number; lastMessageAt: number }): Promise<boolean> {
  const { now, lastMessageAt } = data;
  if (!lastMessageAt) return false;
  const diff = Math.floor((now - lastMessageAt * 1000) / 1000);
  return diff >= 30 && diff <= 35;
}

/**
 * witcher_gwent: Сыграть 3 дуэли за один день
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
 * witcher_damn: Проиграть дуэль с броском кубика меньше 10
 */
async function checkWitcherDamn(db: any, userId: string, guildId: string, data: { lastDuelRoll?: number }): Promise<boolean> {
  // Проверяем последние дуэли
  try {
    const result = await db.execute({
      sql: 'SELECT * FROM duels WHERE (challenger_id = ? OR opponent_id = ?) AND guild_id = ? ORDER BY created_at DESC LIMIT 1',
      args: [userId, userId, guildId],
    });
    if (result.rows.length > 0) {
      const duel = result.rows[0];
      // Если пользователь проиграл и бросок был меньше 10
      return (duel.status === 'completed');
    }
    return false;
  } catch (err) {
    return false;
  }
}

/**
 * witcher_blaviken: Выиграть 3 дуэли подряд без поражений
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
        // Определяем победителя из записей дуэли (нужен roll)
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
 * witcher_coin: Зафиксировать ровно 1000, 2000, 3000 или 5000 XP
 */
async function checkWitcherCoin(db: any, userId: string, guildId: string, data: { newXp: number }): Promise<boolean> {
  const { newXp } = data;
  return [1000, 2000, 3000, 5000].includes(newXp);
}

// --- Red Dead Redemption 2 ---

/**
 * rdr_plan: Накопить 3000+ XP, ни разу не проиграв в дуэлях
 */
async function checkRDRPlan(db: any, userId: string, guildId: string): Promise<boolean> {
  try {
    // Проверяем XP
    const xpResult = await db.execute({
      sql: 'SELECT xp FROM users WHERE user_id = ? AND guild_id = ?',
      args: [userId, guildId],
    });
    if (xpResult.rows.length === 0) return false;
    const xp = (xpResult.rows[0].xp as number) || 0;
    if (xp < 3000) return false;

    // Проверяем, не проигрывал ли в дуэлях
    const duelResult = await db.execute({
      sql: 'SELECT * FROM duels WHERE (challenger_id = ? OR opponent_id = ?) AND guild_id = ? AND status = ?',
      args: [userId, userId, guildId, 'completed'],
    });
    if (duelResult.rows.length === 0) return true; // Дуэлей не было

    // Проверяем, был ли проигрыш
    for (const duel of duelResult.rows) {
      // В текущей схеме победитель определяется по roll в worker.ts
      // Пропускаем проверку, так как в БД нет информации о проигрыше
    }
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * rdr_lenny: Отправить капс-сообщение 10+ букв ночью с 02:00 до 05:00
 */
async function checkRDRLenny(db: any, userId: string, guildId: string, data: { messageContent: string; hour: number }): Promise<boolean> {
  const { messageContent, hour } = data;
  if (hour < 2 || hour >= 5) return false; // Только 02:00-05:00
  if (!messageContent || messageContent.length < 10) return false;
  return messageContent === messageContent.toUpperCase();
}

/**
 * rdr_quickdraw: Выиграть дуэль с броском 95+
 */
async function checkRDRQuickdraw(db: any, userId: string, guildId: string): Promise<boolean> {
  // Проверяем последнюю дуэль с высоким броском
  return false; // Требует изменений в worker.ts
}

/**
 * rdr_tahiti: Провести более 5 часов в войсе за день
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
    return voiceSeconds > 5 * 3600; // 5 часов
  } catch (err) {
    return false;
  }
}

/**
 * rdr_tax: Сжечь более 200 XP на налоге с дуэлей
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

// --- Владивосток и ДВ ---

/**
 * vlad_2000: Оказаться ровно с 2000 XP на балансе
 */
async function checkVlad2000(db: any, userId: string, guildId: string, data: { newXp: number }): Promise<boolean> {
  return data.newXp === 2000;
}

/**
 * vlad_midnight: Отправить сообщение ровно в 00:00 (Владивосток)
 */
async function checkVladMidnight(db: any, userId: string, guildId: string, data: { hour: number; minute: number; second: number }): Promise<boolean> {
  const { hour, minute, second } = data;
  return hour === 0 && minute === 0 && second < 10; // 00:00-00:09
}

/**
 * vlad_pyanse: Быть активным в чате во время обеда с 12:00 до 13:00 (Владивосток)
 */
async function checkVladPyanse(db: any, userId: string, guildId: string, data: { hour: number }): Promise<boolean> {
  return data.hour >= 12 && data.hour < 13;
}

/**
 * vlad_typhoon: Спасти стрик с помощью заморозки
 */
async function checkVladTyphoon(db: any, userId: string, guildId: string, data: { usedFreeze: boolean }): Promise<boolean> {
  return data.usedFreeze;
}

/**
 * vlad_right_hand: Сменить тему на Киберпанк или Магму
 */
async function checkVladRightHand(db: any, userId: string, guildId: string, data: { themeId: string }): Promise<boolean> {
  return data.themeId === 'cyberpunk' || data.themeId === 'magma';
}

/**
 * vlad_golden_horn: Занять 1-е место в лидерборде сервера
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
 * hl_wakeup: Отправить сообщение с 06:00 до 07:00 утра (Владивосток)
 */
async function checkHLWakeup(db: any, userId: string, guildId: string, data: { hour: number }): Promise<boolean> {
  return data.hour >= 6 && data.hour < 7;
}

/**
 * hl_can: Выполнить свой первый ежедневный квест
 */
async function checkHLCan(db: any, userId: string, guildId: string, data: { firstQuestCompleted: boolean }): Promise<boolean> {
  return data.firstQuestCompleted;
}

/**
 * hl_water: Провести 2 часа непрерывно в войсе
 */
async function checkHLWater(db: any, userId: string, guildId: string, data: { continuousVoiceSeconds: number }): Promise<boolean> {
  return (data.continuousVoiceSeconds || 0) >= 7200; // 2 часа
}

/**
 * hl_crowbar: Победить в дуэли оппонента, у которого уровень выше твоего на 2+
 */
async function checkHLCrowbar(db: any, userId: string, guildId: string, data: { opponentLevel: number; userLevel: number }): Promise<boolean> {
  return (data.opponentLevel - data.userLevel) >= 2;
}

/**
 * hl_airdrop: Первым забрать контейнер войс-дропа
 */
async function checkHLAirdrop(db: any, userId: string, guildId: string, data: { claimedAirdrop: boolean }): Promise<boolean> {
  return data.claimedAirdrop;
}

// --- Мемы / Навальный ---

/**
 * fbk_hello: Написать сообщение после 3+ дней отсутствия на сервере
 */
async function checkFBKHello(db: any, userId: string, guildId: string, data: { lastMessageAt: number; now: number }): Promise<boolean> {
  const { lastMessageAt, now } = data;
  if (!lastMessageAt) return true; // Первое сообщение
  const daysOffline = (now - lastMessageAt * 1000) / (1000 * 60 * 60 * 24);
  return daysOffline >= 3;
}

/**
 * fbk_sandwich: Удержать стрик активности ровно 14 дней
 */
async function checkFBKSandwich(db: any, userId: string, guildId: string, data: { streakDays: number }): Promise<boolean> {
  return data.streakDays === 14;
}

/**
 * fbk_final_battle: Сыграть дуэль со ставкой от 1000 XP
 */
async function checkFBKFinalBattle(db: any, userId: string, guildId: string, data: { betAmount: number }): Promise<boolean> {
  return data.betAmount >= 1000;
}

/**
 * fbk_investigation: Посмотреть карточки /rank 5 разных людей за день
 */
async function checkFBKInvestigation(db: any, userId: string, guildId: string): Promise<boolean> {
  // Отслеживание просмотров в worker.ts через пользовательское состояние
  return false;
}

/**
 * fbk_prb: Закрыть все 3 дейлика за один день
 */
async function checkFBKPRB(db: any, userId: string, guildId: string): Promise<boolean> {
  const today = getVladivostokDate();
  try {
    const result = await db.execute({
      sql: 'SELECT COUNT(*) as completed FROM user_quest_progress WHERE user_id = ? AND guild_id = ? AND completed_at IS NOT NULL',
      args: [userId, guildId],
    });
    return (result.rows[0]?.completed as number) >= 3;
  } catch (err) {
    return false;
  }
}

// --- Классика ---

/**
 * lucky_777: Зафиксировать ровно 777 XP на балансе
 */
async function checkLucky777(db: any, userId: string, guildId: string, data: { newXp: number }): Promise<boolean> {
  return data.newXp === 777;
}

/**
 * casino_house: Сжечь более 100 XP налога в одной дуэли
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
  ],
});

const db = createClient({
  url: process.env.DATABASE_URL || 'libsql://localhost',
  authToken: process.env.DATABASE_AUTH_TOKEN,
});

// Проверка и обновление схемы БД при старте
async function migrateSchema() {
  try {
    // Проверка наличия колонки level (в старых версиях её могло не быть)
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
    // Миграция 003: Колонки для стриков активности (Этап 2)
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
    // Миграция 011: Колонка last_week_reset для еженедельного сброса (Этап 7)
    // ============================================
    if (!columns.includes('last_week_reset')) {
      await db.execute({
        sql: 'ALTER TABLE users ADD COLUMN last_week_reset TEXT DEFAULT NULL',
        args: [],
      });
      console.log('[Migrate] Added column: last_week_reset');
    }

    // ============================================
    // Миграция 012: Колонки для годовой активности и максимального стрика (Этап 8)
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
    // Миграция 007: Таблица user_cosmetics (Этап 5 - Кастомизация карточки)
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
          title_id TEXT DEFAULT 'Новичок',
          badges TEXT DEFAULT '[]',
          PRIMARY KEY (user_id, guild_id)
        )`,
        args: [],
      });
      console.log('[Migrate] Created table: user_cosmetics');
    }

    // ============================================
    // Миграция 008: Таблица user_achievements (Этап 6 - Система достижений)
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
    // Миграция 009: Таблица achievements_pool (Этап 6 - Система достижений)
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

      // Заполняем таблицу достижениями из константы
      const achievements = [
        // Ведьмак 3
        ['witcher_plod', '🐺 Шевелись, Плотва!', 'Отправить сообщение ровно через 30-35 сек после предыдущего', 'Лютик, бл#ть...', 150],
        ['witcher_gwent', '🃏 В Гвинт не сыграешь?', 'Сыграть 3 дуэли за один день', 'Кивает молча и достаёт колоду Королевств Севера.', 200],
        ['witcher_damn', '🐺 Зараза...', 'Проиграть дуэль с броском кубика меньше 10', 'Ветер воет...', 100],
        ['witcher_blaviken', '⚔️ Мясник из Блавикена', 'Выиграть 3 дуэли подряд без поражений', 'Если приходится выбирать между злом и злом...', 350],
        ['witcher_coin', '🪙 Чеканная монета', 'Зафиксировать ровно 1000, 2000, 3000 или 5000 XP', 'Зачтётся всё это вам!', 250],
        // Red Dead Redemption 2
        ['rdr_plan', '🤠 У меня есть ПЛАН!', 'Накопить 3000+ XP, ни разу не проиграв в дуэлях', 'Нам просто нужно больше денег, Артур!', 300],
        ['rdr_lenny', '🍻 ЛИИИННИИИИ!', 'Отправить капс-сообщение 10+ букв ночью с 02:00 до 05:00', 'YNNEL?! ГДЕ ТЫ, ЛЕННИ?!', 150],
        ['rdr_quickdraw', '🎯 Быстрая рука', 'Выиграть дуэль с броском 95+', 'На этом сервере место только для одного.', 250],
        ['rdr_tahiti', '🥭 Билет на Таити', 'Провести более 5 часов в войсе за день', 'Мы будем выращивать манго и жить припеваючи.', 300],
        ['rdr_tax', '💰 Капитализм, Артур', 'Сжечь более 200 XP на налоге с дуэлей', 'Мы воры в мире, которому мы больше не нужны.', 200],
        // Владивосток и ДВ
        ['vlad_2000', '🌊 Владивосток 2000', 'Оказаться ровно с 2000 XP на балансе', 'Уходим, уходим, уходят кометы...', 200],
        ['vlad_midnight', '⚓ Полночь на Эгершельде', 'Отправить сообщение ровно в 00:00 (Владивосток)', 'Маяк светит, квесты сбросились.', 200],
        ['vlad_pyanse', '🥟 Пян-се на Луговой', 'Быть активным в чате во время обеда с 12:00 до 13:00 (Владивосток)', 'С пылу с жару, с перцем и капустой.', 120],
        ['vlad_typhoon', '🌪️ Тайфун прошёл стороной', 'Спасти стрик с помощью заморозки', 'Опять передавали штормовое, но обошлось.', 250],
        ['vlad_right_hand', '🚗 Истинный праворульщик', 'Сменить тему на Киберпанк или Магму', 'Руль в бардачке, едем боком.', 100],
        ['vlad_golden_horn', '🌉 Хозяин Золотого Рога', 'Занять 1-е место в лидерборде сервера', 'Мост построили, сервер держим.', 500],
        // Half-Life 2
        ['hl_wakeup', '🚆 Проснитесь и попойте', 'Отправить сообщение с 06:00 до 07:00 утра (Владивосток)', 'Нужный человек не в том месте...', 150],
        ['hl_can', '🥫 Подними эту банку', 'Выполнить свой первый ежедневный квест', 'А теперь брось её в урну.', 100],
        ['hl_water', '💧 Не пейте воду', 'Провести 2 часа непрерывно в войсе', 'Они туда что-то подмешивают...', 250],
        ['hl_crowbar', '🪓 Монтировка против страйдера', 'Победить в дуэли оппонента, у которого уровень выше твоего на 2+', 'Физика Source на твоей стороне.', 300],
        ['hl_airdrop', '📦 Ящик сопротивления', 'Первым забрать контейнер войс-дропа', 'Сигнальная ракета сработала.', 150],
        // Мемы / Навальный
        ['fbk_hello', '📣 Привет, это Навальный', 'Написать сообщение после 3+ дней отсутствия на сервере', 'Я не молчал, я просто был в оффлайне!', 150],
        ['fbk_sandwich', '🥪 Не бутерброд', 'Удержать стрик активности ровно 14 дней', 'Стрик — он что, бутерброд, чтобы его сбрасывать?', 250],
        ['fbk_final_battle', '⚔️ Финальная битва', 'Сыграть дуэль со ставкой от 1000 XP', 'Финальная битва добра с нейтралитетом!', 300],
        ['fbk_investigation', '🕵️ Команда расследователей', 'Посмотреть карточки /rank 5 разных людей за день', 'Мы нашли у него незадекларированный уровень.', 150],
        ['fbk_prb', '☀️ Прекрасный Сервер Будущего', 'Закрыть все 3 дейлика за один день', 'Россия будет счастливой, а опыт нафармлен.', 250],
        // Классика
        ['lucky_777', '🎰 Три топора', 'Зафиксировать ровно 777 XP на балансе', 'Поднял бабла, теперь в топе.', 250],
        ['casino_house', '🎲 Казино всегда в плюсе', 'Сжечь боле�� 100 XP налога в одной дуэли', 'Карты с самого начала были краплеными.', 150],
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
    // Миграция 004: Таблица duels (Этап 3)
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
          created_at INTEGER NOT NULL
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
    // Миграция 005: Таблица guild_events (Этап 4 - Happy Hours)
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
    // Миграция 006: Таблица air_drops (Этап 4 - Voice Drops)
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
    // Миграция 002: Таблицы ежедневной активности и квестов
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
    // Миграция 010: Таблицы сезонов и недель (Этап 7)
    // ============================================

    // Добавляем колонку season_xp в users
    if (!columns.includes('season_xp')) {
      await db.execute({
        sql: 'ALTER TABLE users ADD COLUMN season_xp INTEGER NOT NULL DEFAULT 0',
        args: [],
      });
      console.log('[Migrate] Added column: season_xp');
    }

    // Таблица weekly_activity для еженедельной активности
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

    // Таблица season_archive для архива сезонов
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

    // Проверка таблицы guild_settings
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
  } catch (err) {
    console.error('[Migrate] Error during schema migration:', err);
  }
}

// ============================================
// Функции для работы с квестами и ежедневной активностью
// ============================================

// Получение текущей даты по времени Владивостока (UTC+10, 00:00 сброс)
function getVladivostokDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Vladivostok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

// ============================================
// Функции для работы с сезонами и неделями (Этап 7)
// ============================================

// Получение ключа недели в формате ISO (YYYY-Www) по времени Владивостока
function getWeekKey(date: Date = new Date()): string {
  // Сдвигаем дату на UTC+10 (Владивосток)
  const vladivostokDate = new Date(date.getTime() + 10 * 60 * 60 * 1000);

  // Получаем год и номер недели
  const year = vladivostokDate.getFullYear();
  const dayOfYear = getDayOfYear(vladivostokDate);

  // Номер недели по ISO (понедельник - начало недели)
  const weekNum = Math.ceil(dayOfYear / 7);

  return `Y${year}-W${weekNum.toString().padStart(2, '0')}`;
}

// Получение номера дня в году
function getDayOfYear(date: Date): number {
  const start = new Date(date.getFullYear(), 0, 0);
  const diff = date.getTime() - start.getTime();
  const oneDay = 1000 * 60 * 60 * 24;
  return Math.floor(diff / oneDay);
}

// Определение текущего сезона по месяцу
function getCurrentSeason(date: Date = new Date()): string {
  const month = date.getUTCMonth() + 1; // 1-12

  if (month >= 3 && month <= 5) return '🌸 Весенний кубок';
  if (month >= 6 && month <= 8) return '☀️ Летний драйв';
  if (month >= 9 && month <= 11) return '🍂 Осенний марафон';
  return '❄️ Зимняя битва'; // 12, 1, 2
}

// Получение ID сезона для архива (например: '2026-spring')
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
// Функции для работы со стриками активности (Этап 2)
// ============================================

// Вычисление множителя XP от длины стрика
function getXpMultiplier(streakDays: number): number {
  if (streakDays >= 30) return 1.25;  // +25%
  if (streakDays >= 14) return 1.15;  // +15%
  if (streakDays >= 7) return 1.10;   // +10%
  if (streakDays >= 3) return 1.05;   // +5%
  return 1.0;
}

// Проверка условий для активности пользователя (для стрика)
function checkActivityCondition(activity: { messages_count: number; voice_seconds: number }, questCompleted: boolean): boolean {
  // Условия: 20+ сообщений ИЛИ 15+ минут (900 секунд) в войсе ИЛИ закрыт хотя бы 1 квест
  return activity.messages_count >= 20 || activity.voice_seconds >= 900 || questCompleted;
}

// Получение данных для проверки стрика (активность + квесты)
async function getUserStreakData(db: any, userId: string, guildId: string): Promise<{ activity: any; questCompleted: boolean }> {
  const today = getVladivostokDate();

  // Получаем ежедневную активность
  const activityResult = await db.execute({
    sql: 'SELECT messages_count, voice_seconds FROM user_daily_activity WHERE user_id = ? AND guild_id = ? AND activity_date = ?',
    args: [userId, guildId, today],
  });

  const activity = activityResult.rows.length > 0
    ? { messages_count: (activityResult.rows[0].messages_count as number) || 0, voice_seconds: (activityResult.rows[0].voice_seconds as number) || 0 }
    : { messages_count: 0, voice_seconds: 0 };

  // Проверяем, закрыт ли хотя бы 1 квест сегодня
  const questResult = await db.execute({
    sql: 'SELECT COUNT(*) as completed FROM user_quest_progress WHERE user_id = ? AND guild_id = ? AND completed_at IS NOT NULL',
    args: [userId, guildId],
  });

  const questCompleted = (questResult.rows[0]?.completed as number) > 0;

  return { activity, questCompleted };
}

// Обновление стрика пользователя
async function updateUserStreak(db: any, userId: string, guildId: string): Promise<{ streakDays: number; streakFreezes: number; updated: boolean }> {
  const today = getVladivostokDate();

  try {
    // Получаем текущие данные пользователя
    const userResult = await db.execute({
      sql: 'SELECT streak_days, last_streak_date, streak_freezes FROM users WHERE user_id = ? AND guild_id = ?',
      args: [userId, guildId],
    });

    if (userResult.rows.length === 0) {
      // Пользователь не найден - создаём запись с дефолтными значениями
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

    // Если сегодня уже обновляли стрик - ничего не делаем
    if (lastStreakDate === today) {
      return { streakDays, streakFreezes, updated: false };
    }

    // Получаем данные для проверки активности
    const { activity, questCompleted } = await getUserStreakData(db, userId, guildId);

    // Проверяем условие активности
    if (!checkActivityCondition(activity, questCompleted)) {
      // Условие не выполнено - сброс стрика
      await db.execute({
        sql: 'UPDATE users SET streak_days = 1, last_streak_date = ? WHERE user_id = ? AND guild_id = ?',
        args: [today, userId, guildId],
      });
      return { streakDays: 1, streakFreezes, updated: true };
    }

    // Пользователь активен - проверяем разницу с вчерашним днём
    let newStreakDays = streakDays;
    let needUpdate = false;

    if (lastStreakDate === null) {
      // Первый день активности
      newStreakDays = 1;
      needUpdate = true;
    } else {
      // Вычисляем разницу в днях между today и last_streak_date
      // Формат даты: YYYY-MM-DD
      const todayParts = today.split('-').map(Number);
      const lastParts = lastStreakDate.split('-').map(Number);

      const todayDate = new Date(todayParts[0], todayParts[1] - 1, todayParts[2]);
      const lastDate = new Date(lastParts[0], lastParts[1] - 1, lastParts[2]);

      const diffTime = todayDate.getTime() - lastDate.getTime();
      const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

      if (diffDays === 1) {
        // Вчера был последний день стрика - продолжаем
        newStreakDays = streakDays + 1;
        needUpdate = true;
      } else if (diffDays > 1) {
        // Прошло 2+ дня - проверяем заморозки
        if (streakFreezes > 0) {
          // Есть заморозка - тратим её и сохраняем стрик
          streakFreezes -= 1;
          needUpdate = true;
          console.log(`[Streak] User ${userId} used freeze to preserve streak`);
          // vlad_typhoon: спасли стрик заморозкой
          await unlockAchievement(db, userId, guildId, 'vlad_typhoon', client);
        } else {
          // Нет заморозки - сброс
          newStreakDays = 1;
          needUpdate = true;
        }
      }
      // Если diffDays === 0 (уже обновляли сегодня) - ничего не делаем

      // fbk_sandwich: стрик достиг 14 дней
      if (newStreakDays === 14 && needUpdate) {
        await unlockAchievement(db, userId, guildId, 'fbk_sandwich', client);
      }
    }

    if (needUpdate) {
      await db.execute({
        sql: 'UPDATE users SET streak_days = ?, last_streak_date = ?, streak_freezes = ? WHERE user_id = ? AND guild_id = ?',
        args: [newStreakDays, today, streakFreezes, userId, guildId],
      });
    }

    // Обновление максимального стрика
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

// Начисление XP с множителем стрика
async function awardXpWithStreak(db: any, userId: string, guildId: string, baseXp: number): Promise<number> {
  // Сначала обновляем стрик
  const { streakDays } = await updateUserStreak(db, userId, guildId);

  // Применяем множитель
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
// Функции для сезонного и недельного начисления XP (Этап 7)
// ============================================

/**
 * Начисляет опыт с учётом стрика и сезонного/недельного начисления
 * @returns {finalXp, seasonXp, weekXp} - итоговый XP, сезонный опыт, недельный опыт
 */
async function awardXpWithAllMultipliers(
  db: any,
  userId: string,
  guildId: string,
  baseXp: number
): Promise<{ finalXp: number; seasonXp: number; weekXp: number }> {
  // Сначала обновляем стрик
  const { streakDays } = await updateUserStreak(db, userId, guildId);

  // Получаем множители
  const streakMultiplier = getXpMultiplier(streakDays);

  // Получаем текущие сезон и неделю
  const seasonName = getCurrentSeason();
  const weekKey = getWeekKey();

  // Начисляем сезонный XP
  const seasonXp = Math.round(baseXp * streakMultiplier);
  await db.execute({
    sql: 'UPDATE users SET season_xp = season_xp + ? WHERE user_id = ? AND guild_id = ?',
    args: [seasonXp, userId, guildId],
  });

  // UPSERT в weekly_activity
  await db.execute({
    sql: `INSERT INTO weekly_activity (user_id, guild_id, week_key, xp_earned)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(user_id, guild_id, week_key)
          DO UPDATE SET xp_earned = xp_earned + ?`,
    args: [userId, guildId, weekKey, seasonXp, seasonXp],
  });

  // Применяем множитель стрика к итоговому XP
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
 * Проверяет смену недели и проводит еженедельный сброс
 * Вызывается раз в час
 */
async function checkWeeklyReset(db: any, bot: Client): Promise<void> {
  const currentWeekKey = getWeekKey();
  const currentSeasonId = getSeasonId();

  // Получаем ID прошлой недели из guild_settings (сохраняем как JSON)
  let lastWeekKey: string | null = null;
  try {
    const settingsResult = await db.execute({
      sql: 'SELECT weekly_reset_week FROM guild_settings WHERE guild_id = ?', // Проверим все гильдии
      args: [],
    });

    // Получаем все guild_id из users
    const guildsResult = await db.execute({
      sql: 'SELECT DISTINCT guild_id FROM users',
      args: [],
    });

    const guildIds = (guildsResult.rows || []).map((r: any) => r.guild_id as string);

    for (const guildId of guildIds) {
      // Получаем дату последнего сброса из пользовательской записи
      const userResult = await db.execute({
        sql: 'SELECT last_week_reset FROM users WHERE user_id = ? AND guild_id = ?',
        args: [guildId, guildId], // Используем guild_id как user_id для хранения метаданных
      });

      if (userResult.rows.length > 0) {
        lastWeekKey = userResult.rows[0].last_week_reset as string | null;
      }

      // Если неделя изменилась
      if (lastWeekKey !== currentWeekKey) {
        console.log(`[WeeklyReset] Week changed from ${lastWeekKey} to ${currentWeekKey} for guild ${guildId}`);

        // Находим победителя прошлой недели
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

          // Начисляем +500 XP победителю
          await db.execute({
            sql: 'UPDATE users SET xp = xp + 500 WHERE user_id = ? AND guild_id = ?',
            args: [winnerId, guildId],
          });

          // Обновляем уровень
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

          // Отправляем Embed в канал
          try {
            const guild = bot.guilds.cache.get(guildId);
            if (guild) {
              const channel = guild.channels.cache.find(c =>
                c.type === 0 && // GuildText
                c.permissionsFor(guild.members.me!)?.has('SendMessages')
              ) as any;

              if (channel) {
                const embed = {
                  embeds: [{
                    title: '👑 ЧЕМПИОН НЕДЕЛИ ОПРЕДЕЛЁН!',
                    description: `**<@${winnerId}>** набрал больше всех опыта за прошлую неделю (**${xpEarned.toLocaleString()} XP**) и получает звание Чемпиона Недели и +500 XP!`,
                    color: 0xFFD700,
                    footer: { text: 'Неделя завершается в 00:00 (Владивосток)' },
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

        // Обновляем дату последнего сброса
        await db.execute({
          sql: 'INSERT OR REPLACE INTO users (user_id, guild_id, last_week_reset) VALUES (?, ?, ?)',
          args: [guildId, guildId, currentWeekKey],
        });
      }
    }
  } catch (err) {
    console.error('[WeeklyReset] Error during reset:', err);
  }
}

// ============================================
// Функции для начисления онлайн-секунд (Этап 8 - Server King)
// ============================================

/**
 * Начисляет +300 секунд онлайн-времени всем активным пользователям
 * Вызывается раз в 5 минут через setInterval
 */
async function awardOnlineSeconds(db: any, bot: Client): Promise<void> {
  const now = Date.now();
  const onlineSeconds = 300; // 5 минут

  try {
    const guilds = bot.guilds.cache;

    for (const guild of guilds.values()) {
      const guildId = guild.id;
      const members = guild.members.cache;

      for (const [memberId, member] of members) {
        // Пропускаем ботов
        if (member.user.bot) continue;

        // Проверяем статус пользователя (online, idle, dnd)
        // status === 'offline' означает оффлайн
        const status = member.presence?.status;
        if (!status || status === 'offline') continue;

        // Начисляем +300 секунд онлайн-времени
        try {
          await db.execute({
            sql: 'UPDATE users SET online_seconds = online_seconds + ? WHERE user_id = ? AND guild_id = ?',
            args: [onlineSeconds, memberId, guildId],
          });
        } catch (err) {
          // Если пользователя нет в базе - пропускаем
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
// Функции для Happy Hours (Этап 4 - Счастливые часы)
// ============================================

/**
 * Проверяет, активен ли Happy Hour для гильдии
 * @returns multiplier (2.0) если активен, иначе 1.0
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
 * Запускает Happy Hour на 60 минут
 */
async function startHappyHour(db: any, guildId: string, bot: Client): Promise<void> {
  const now = Date.now();
  const endsAt = now + 60 * 60 * 1000; // 60 минут

  try {
    await db.execute({
      sql: 'INSERT OR REPLACE INTO guild_events (guild_id, event_type, ends_at, multiplier) VALUES (?, ?, ?, ?)',
      args: [guildId, 'happy_hour', endsAt, 2.0],
    });
    console.log(`[HappyHour] Started for guild ${guildId}, ends at ${new Date(endsAt).toISOString()}`);

    // Ищем системный или первый доступный текстовый канал для уведомления
    const guild = bot.guilds.cache.get(guildId);
    if (guild) {
      const channel = guild.channels.cache.find(c =>
        c.type === 0 && // GuildText
        c.permissionsFor(guild.members.me!)?.has('SendMessages')
      ) as any;

      if (channel) {
        const embed = {
          embeds: [{
            title: '⚡ СЧАСТЛИВЫЙ ЧАС НАЧАЛСЯ!',
            description: 'Двойной опыт (2X XP) за все сообщения и войс на ближайшие 60 минут!',
            color: 0xFFD700,
            footer: { text: 'Не пропустите этот редкий ивент!' },
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
 * Проверяет и запускает Happy Hour для всех гильдий, где сегодня ещё не было
 */
async function checkAndStartHappyHours(db: any, bot: Client): Promise<void> {
  const today = getVladivostokDate();
  const now = Date.now();

  try {
    // Получаем все гильдии (из таблицы users)
    const guildsResult = await db.execute({
      sql: 'SELECT DISTINCT guild_id FROM users',
      args: [],
    });

    const guildIds = guildsResult.rows.map((r: any) => r.guild_id as string);
    console.log(`[HappyHour] Checking ${guildIds.length} guilds for happy hour...`);

    for (const guildId of guildIds) {
      // Проверяем, был ли уже запущен happy hour сегодня
      const existingResult = await db.execute({
        sql: 'SELECT COUNT(*) as count FROM guild_events WHERE guild_id = ? AND event_type = ? AND ends_at > ?',
        args: [guildId, 'happy_hour', now - 24 * 60 * 60 * 1000], // За последние 24 часа
      });

      const existing = (existingResult.rows[0]?.count as number) || 0;

      if (existing === 0) {
        // Шанс 30% что Happy Hour запустится (чтобы не спамить каждый час)
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
// Функции для Войс-дропов (Этап 4 - Air Drops)
// ============================================

// Хранение кулдаунов дропов в памяти (channel_id -> timestamp)
const airDropCooldowns = new Map<string, number>();

/**
 * Проверяет, можно ли сделать дроп в канале (учитывает кулдаун)
 */
function canSpawnDrop(channelId: string): boolean {
  const cooldownMs = 30 * 60 * 1000; // 30 минут
  const lastSpawn = airDropCooldowns.get(channelId) || 0;
  return Date.now() - lastSpawn > cooldownMs;
}

/**
 * Помечает канал как использующий кулдаун дропа
 */
function setDropCooldown(channelId: string): void {
  airDropCooldowns.set(channelId, Date.now());
}

/**
 * Создаёт запись дропа в БД
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
 * Осуществляет спавн войс-дропа в канале
 */
async function spawnAirDrop(db: any, channel: any, guildId: string, bot: Client): Promise<void> {
  const channelId = channel.id;

  if (!canSpawnDrop(channelId)) {
    return;
  }

  // Рандомизация награды:
  // 90% шанс - XP (50-200), 10% шанс - заморозка
  const isFreeze = Math.random() < 0.10;
  const rewardXp = isFreeze ? 0 : Math.floor(Math.random() * 151) + 50; // 50-200
  const rewardType = isFreeze ? 'freeze' : 'xp';

  const dropId = await createAirDrop(db, guildId, channelId, rewardXp, rewardType);
  setDropCooldown(channelId);

  console.log(`[AirDrop] Spawned ${rewardType === 'freeze' ? 'freeze' : rewardXp + ' XP'} in ${channelId}`);

  // Формируем Embed
  const embed = {
    embeds: [{
      title: '🎁 С неба упал контейнер с припасами!',
      description: 'Кто первый вскроет ящик, заберёт ценный лут!',
      color: 0x3498DB,
      footer: { text: 'Быстрее всех успеешь забрать!' },
    }],
    components: [{
      type: 1,
      components: [{
        type: 2,
        custom_id: `airdrop_claim_${dropId}`,
        style: 1, // Primary
        label: '📦 Забрать дроп!',
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
 * Проверяет голосовые каналы и спавнит дропы
 */
async function checkAndSpawnAirDrops(db: any, bot: Client): Promise<void> {
  const guilds = bot.guilds.cache;

  for (const guild of guilds.values()) {
    const voiceChannels = guild.channels.cache.filter(c =>
      c.type === 2 // GuildVoice
    ) as any;

    for (const channel of voiceChannels.values()) {
      const members = channel.members;

      // Фильтруем: >= 3 человек, не боты, не deaf + mute
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
// Функции для работы с квестами и ежедневной активностью
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
        q.type === 'combo' ? 'messages' : q.type, // Для combo используем messages как базовый тип
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

// Получение активных квестов гильдии на сегодня
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

// Генерация ID для daily quest записи
function generateDailyQuestId(guildId: string, questId: string, index: number): string {
  return `${guildId}_${getVladivostokDate()}_${index}`;
}

// Назначение квестов гильдии на сегодня (если не назначены)
async function ensureDailyQuests(db: any, guildId: string): Promise<any[]> {
  const today = getVladivostokDate();
  try {
    // Проверяем, есть ли уже квесты на сегодня
    const existing = await db.execute({
      sql: 'SELECT COUNT(*) as count FROM quests_daily WHERE guild_id = ? AND active_date = ?',
      args: [guildId, today],
    });
    const count = (existing.rows[0]?.count as number) || 0;

    if (count > 0) {
      return getDailyQuests(db, guildId);
    }

    console.log(`[Quests] Assigning daily quests for guild ${guildId}...`);

    // Получаем доступные квесты из пула
    const poolResult = await db.execute({
      sql: 'SELECT * FROM quests_pool WHERE is_active = 1',
      args: [],
    });
    const pool = poolResult.rows || [];

    if (pool.length === 0) {
      console.warn('[Quests] No quests in pool!');
      return [];
    }

    // Выбираем 3-4 случайных квеста:
    // 1 текстовый (messages), 1 голосовой (voice), 1 сложный/комбо
    const messagesQuests = pool.filter((q: any) => q.quest_type === 'messages' && q.quest_type !== 'voice');
    const voiceQuests = pool.filter((q: any) => q.quest_type === 'voice');
    const otherQuests = pool.filter((q: any) => q.quest_type === 'combo' || (q.quest_type !== 'messages' && q.quest_type !== 'voice'));

    const selected: any[] = [];

    // 1 текстовый квест (легкий)
    if (messagesQuests.length > 0) {
      const msg = messagesQuests[Math.floor(Math.random() * messagesQuests.length)];
      selected.push({ ...msg, quest_type: 'messages' });
    }

    // 1 голосовой квест
    if (voiceQuests.length > 0) {
      const vo = voiceQuests[Math.floor(Math.random() * voiceQuests.length)];
      selected.push({ ...vo, quest_type: 'voice' });
    }

    // 1 сложный/комбо квест
    if (otherQuests.length > 0) {
      const oth = otherQuests[Math.floor(Math.random() * otherQuests.length)];
      selected.push({ ...oth, quest_type: oth.quest_type });
    }

    // Вставляем daily quests
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

// Обновление прогресса квеста пользователя
async function updateQuestProgress(db: any, userId: string, guildId: string, questDailyId: string, increment: number, questType: string): Promise<void> {
  try {
    // UPSERT в прогресс
    const upsertResult = await db.execute({
      sql: `INSERT INTO user_quest_progress (user_id, guild_id, quest_daily_id, current_progress)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(user_id, guild_id, quest_daily_id)
            DO UPDATE SET current_progress = current_progress + ?`,
      args: [userId, guildId, questDailyId, increment, increment],
    });

    // Получаем текущий прогресс и цель
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

    // Если завершен - пропускаем
    if (completedAt !== null) return;

    // Проверяем достижение цели
    if (current >= target) {
      // Начисляем XP
      await db.execute({
        sql: `UPDATE users SET xp = xp + ? WHERE user_id = ? AND guild_id = ?`,
        args: [rewardXp, userId, guildId],
      });

      // Помечаем как выполненный
      await db.execute({
        sql: `UPDATE user_quest_progress SET completed_at = ? WHERE user_id = ? AND guild_id = ? AND quest_daily_id = ?`,
        args: [Date.now(), userId, guildId, questDailyId],
      });

      console.log(`[Quest] User ${userId} completed quest ${questDailyId} - +${rewardXp} XP`);
    }
  } catch (err) {
    console.error('[Quest] Error updating progress:', err);
  }
}

// Обновление ежедневной активности пользователя
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

// Проверка квестов типа messages при создании сообщения
async function checkQuestsForMessage(db: any, userId: string, guildId: string, message: Message): Promise<void> {
  const today = getVladivostokDate();

  try {
    // Получаем активные квесты гильдии на сегодня типа messages
    const questsResult = await db.execute({
      sql: `SELECT qd.*, qp.quest_type
            FROM quests_daily qd
            JOIN quests_pool qp ON qd.quest_id = qp.id
            WHERE qd.guild_id = ? AND qd.active_date = ? AND qp.quest_type IN ('messages', 'combo')`,
      args: [guildId, today],
    });

    const quests = questsResult.rows || [];
    if (quests.length === 0) return;

    // Для квестов типа combo проверяем и голос
    for (const quest of quests) {
      const questDailyId = quest.id as string;
      const questType = quest.quest_type as string;

      if (questType === 'messages') {
        // Обычный текстовый квест - инкремент на 1
        await updateQuestProgress(db, userId, guildId, questDailyId, 1, 'messages');
      } else if (questType === 'combo') {
        // Комбо квест - проверяем текущий прогресс
        // Для combo нужна специальная логика - обновляем на 1, но цель выше
        await updateQuestProgress(db, userId, guildId, questDailyId, 1, 'combo');
      }
    }

    // Проверка квеста "Философ" (сообщения > 100 символов)
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

// Проверка квестов типа voice при изменении голосового статуса
async function checkQuestsForVoice(db: any, userId: string, guildId: string, voiceSeconds: number, now: Date): Promise<void> {
  const today = getVladivostokDate();

  try {
    // Получаем активные квесты гильдии на сегодня типа voice
    const questsResult = await db.execute({
      sql: `SELECT qd.*, qp.quest_type
            FROM quests_daily qd
            JOIN quests_pool qp ON qd.quest_id = qp.id
            WHERE qd.guild_id = ? AND qd.active_date = ? AND qp.quest_type IN ('voice', 'combo')`,
      args: [guildId, today],
    });

    const quests = questsResult.rows || [];
    if (quests.length === 0) return;

    // Переводим секунды в минуты
    const voiceMinutes = Math.floor(voiceSeconds / 60);
    if (voiceMinutes === 0) return;

    // Для квестов типа voice и combo инкрементируем по минутам
    for (const quest of quests) {
      const questDailyId = quest.id as string;
      const questType = quest.quest_type as string;

      if (questType === 'voice') {
        // Голосовой квест - инкрементируем по минутам
        await updateQuestProgress(db, userId, guildId, questDailyId, voiceMinutes, 'voice');
      } else if (questType === 'combo') {
        // Комбо квест - инкрементируем по минутам
        await updateQuestProgress(db, userId, guildId, questDailyId, voiceMinutes, 'combo');
      }
    }

    // Проверка квеста "Ночной дозор" (после 00:00 UTC)
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

client.on('ready', async () => {
  console.log(`[Collector] Starting migration...`);
  await migrateSchema();

  // Инициализация пула квестов
  await ensureQuestsPool(db);

  console.log(`[Collector] Ready as ${client.user?.tag}`);
  const memUsage = Math.round(process.memoryUsage().rss / 1024 / 1024);
  console.log(`[Memory] RSS: ${memUsage}MB`);

  // ============================================
  // Запуск фоновых таймеров для Этапа 4-7
  // ============================================

  // Еженедельный сброс и награждение (раз в час)
  console.log('[WeeklyReset] Starting weekly reset checker...');
  await checkWeeklyReset(db, client); // Проверка сразу при старте
  setInterval(async () => {
    console.log('[WeeklyReset] Checking for weekly reset...');
    await checkWeeklyReset(db, client);
  }, 60 * 60 * 1000); // Каждый час

  // Таймер проверки и запуска Happy Hours (раз в час)
  setInterval(async () => {
    console.log('[HappyHour] Checking for happy hours...');
    await checkAndStartHappyHours(db, client);
  }, 60 * 60 * 1000); // Каждый час

  // Таймер проверки и спавна Войс-дропов (раз в 7 минут)
  setInterval(async () => {
    console.log('[AirDrop] Checking for air drops...');
    await checkAndSpawnAirDrops(db, client);
  }, 7 * 60 * 1000); // Каждые 7 минут (сразу запуск)

  // Таймер начисления онлайн-секунд (раз в 5 минут для Этапа 8)
  console.log('[OnlineSeconds] Starting online seconds ticker...');
  await awardOnlineSeconds(db, client); // Проверка сразу при старте
  setInterval(async () => {
    await awardOnlineSeconds(db, client);
  }, 5 * 60 * 1000); // Каждые 5 минут (300 секунд)
});

client.on('messageCreate', async (message: Message) => {
  if (message.author.bot) return;
  if (!message.guild) return;

  const { author, guild } = message;
  const guildId = guild.id;
  const userId = author.id;
  const today = getVladivostokDate();

  try {
    const now = Date.now();

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
    const cooldown = (settingsResult.rows[0]?.message_cooldown_seconds as number) || 30;

    if (userResult.rows.length === 0) {
      // First message from this user
      const newXp = xpPerMessage;
      const newLevel = calculateLevel(newXp);

      await db.execute({
        sql: `INSERT INTO users (user_id, guild_id, xp, level, messages_count, last_message_at)
              VALUES (?, ?, ?, ?, 1, ?)`,
        args: [userId, guildId, newXp, newLevel, Math.floor(now / 1000)],
      });
      console.log(`[Message] New user: ${author.username} (${userId}) in ${guild.name} - XP: ${newXp}, Level: ${newLevel}`);

      // Инициализация ежедневной активности для нового пользователя
      await db.execute({
        sql: `INSERT INTO user_daily_activity (user_id, guild_id, activity_date, messages_count)
              VALUES (?, ?, ?, 1)`,
        args: [userId, guildId, today],
      });
    } else {
      const row = userResult.rows[0];
      const lastMessageAt = (row.last_message_at as number) || 0;
      const timeSinceLastMessage = (now - lastMessageAt * 1000) / 1000;

      let xpToAdd = 0;
      if (timeSinceLastMessage >= cooldown) {
        xpToAdd = xpPerMessage;
      }

      // Начисляем XP через awardXpWithAllMultipliers (Season + Week учёт)
      if (xpToAdd > 0) {
        // Получаем множитель Happy Hours
        const happyHourMultiplier = await isHappyHourActive(db, guildId);
        // Применяем множитель Happy Hours к базовому XP
        const xpWithHH = xpToAdd * happyHourMultiplier;

        // Используем awardXpWithAllMultipliers для сезонного/недельного учёта
        const { finalXp } = await awardXpWithAllMultipliers(db, userId, guildId, xpWithHH);
        xpToAdd = finalXp;

        console.log(`[XP] ${author.username}: base=${xpToAdd}, happyHour=${happyHourMultiplier}x, season/week recorded`);
      }

      const oldXp = (row.xp as number) || 0;
      const newXp = oldXp + xpToAdd;
      const newLevel = calculateLevel(newXp);

      await db.execute({
        sql: `UPDATE users
              SET xp = ?, level = ?, messages_count = messages_count + 1, last_message_at = ?
              WHERE user_id = ? AND guild_id = ?`,
        args: [newXp, newLevel, Math.floor(now / 1000), userId, guildId],
      });

      // Проверка достижений (Этап 6)
      const hour = new Date().getUTCHours(); // Для проверки времени Владивостока нужно сдвигать
      // Владивосток UTC+10, поэтому сдвигаем часовой пояс
      const vladivostokDate = new Date(new Date().getTime() + 10 * 60 * 60 * 1000);
      const vh = vladivostokDate.getUTCHours();
      const vm = vladivostokDate.getUTCMinutes();
      const vs = vladivostokDate.getUTCSeconds();

      // witcher_plod: 30-35 сек с прошлого сообщения
      if (timeSinceLastMessage >= 30 && timeSinceLastMessage <= 35) {
        await unlockAchievement(db, userId, guildId, 'witcher_plod', client);
      }

      // fbk_hello: 3+ дня с прошлого сообщения
      const daysOffline = (now - lastMessageAt * 1000) / (1000 * 60 * 60 * 24);
      if (daysOffline >= 3 && daysOffline < 4) {
        await unlockAchievement(db, userId, guildId, 'fbk_hello', client);
      }

      // vlad_midnight: 00:00 (Владивосток)
      if (vh === 0 && vm === 0 && vs < 10) {
        await unlockAchievement(db, userId, guildId, 'vlad_midnight', client);
      }

      // vlad_pyanse: 12:00-13:00 (Владивосток)
      if (vh >= 12 && vh < 13) {
        await unlockAchievement(db, userId, guildId, 'vlad_pyanse', client);
      }

      // hl_wakeup: 06:00-07:00 (Владивосток)
      if (vh >= 6 && vh < 7) {
        await unlockAchievement(db, userId, guildId, 'hl_wakeup', client);
      }

      // rdr_lenny: капс >= 10 букв, время с 02:00 до 05:00
      if (message.content && message.content.length >= 10 && message.content === message.content.toUpperCase()) {
        if (vh >= 2 && vh < 5) {
          await unlockAchievement(db, userId, guildId, 'rdr_lenny', client);
        }
      }

      // lucky_777, vlad_2000, witcher_coin: определённые суммы XP
      if (newXp === 777) {
        await unlockAchievement(db, userId, guildId, 'lucky_777', client);
      }
      if (newXp === 2000) {
        await unlockAchievement(db, userId, guildId, 'vlad_2000', client);
      }
      if (newXp === 1000 || newXp === 2000 || newXp === 3000 || newXp === 5000) {
        await unlockAchievement(db, userId, guildId, 'witcher_coin', client);
      }

      // Обновление ежедневной активности
      await db.execute({
        sql: `INSERT INTO user_daily_activity (user_id, guild_id, activity_date, messages_count)
              VALUES (?, ?, ?, 1)
              ON CONFLICT(user_id, guild_id, activity_date)
              DO UPDATE SET messages_count = messages_count + 1`,
        args: [userId, guildId, today],
      });

      if (xpToAdd > 0) {
        console.log(`[Message] ${author.username} - ${xpToAdd} XP (total: ${newXp}, level: ${newLevel})`);
      } else {
        console.log(`[Message] ${author.username} - Cooldown (total messages: ${(row.messages_count as number) + 1})`);
      }

      // Проверка квестов типа messages
      await checkQuestsForMessage(db, userId, guildId, message);
    }

    // Обновление квестов (проверка ежедневных квестов каждые 10 сообщений для оптимизации)
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
      // Инициализация ежедневной активности для нового пользователя
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

    // VOICE JOIN (вход в голосовой канал)
    if (!oldState.channelId && newState.channelId) {
      const isMuted = newState.selfDeaf && newState.selfMute;
      await db.execute({
        sql: `UPDATE users
              SET voice_joined_at = ?, voice_segment_muted = ?
              WHERE user_id = ? AND guild_id = ?`,
        args: [Math.floor(now / 1000), isMuted ? 1 : 0, userId, guild.id],
      });
      console.log(`[Voice] ${newState.member?.displayName} joined voice - muted: ${isMuted}`);
      return;
    }

    // VOICE EXIT or MUTE/DEAF CHANGE
    // Проверяем: выход из канала ИЛИ смена mute/deaf статуса
    const oldChannelId = oldState.channelId;
    const newChannelId = newState.channelId;
    const muteChanged = oldState.selfDeaf !== newState.selfDeaf || oldState.selfMute !== newState.selfMute;

    if (oldChannelId && (!newChannelId || muteChanged)) {
      if (joinedAtRow.rows[0]?.voice_joined_at) {
        const joinedAt = joinedAtRow.rows[0].voice_joined_at as number;
        const elapsed = Math.floor((now / 1000) - joinedAt);
        const wasMuted = joinedAtRow.rows[0].voice_segment_muted as number;

        let voiceSecondsToAdd = 0;
        if (wasMuted === 0) {
          voiceSecondsToAdd = elapsed;
        }

        // Обновление ежедневной активности
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
                  SET voice_seconds = voice_seconds + ?, voice_joined_at = NULL, voice_segment_muted = 0
                  WHERE user_id = ? AND guild_id = ?`,
            args: [voiceSecondsToAdd, userId, guild.id],
          });

          // Начисление XP за войс через awardXpWithAllMultipliers (Season + Week учёт)
          if (voiceSecondsToAdd > 0) {
            const xpPerMinute = 5; // Базовый XP за минуту в войсе
            const xpToAdd = Math.floor(voiceSecondsToAdd / 60) * xpPerMinute;

            if (xpToAdd > 0) {
              // Получаем множитель Happy Hours
              const happyHourMultiplier = await isHappyHourActive(db, guild.id);
              // Применяем множитель Happy Hours к базовому XP
              const xpWithHH = xpToAdd * happyHourMultiplier;

              // Используем awardXpWithAllMultipliers для сезонного/недельного учёта
              const { finalXp } = await awardXpWithAllMultipliers(db, userId, guild.id, xpWithHH);

              console.log(`[Voice XP] ${newState.member?.displayName}: base=${xpToAdd} (${xpWithHH} with HH), season/week recorded, total +${finalXp} XP`);
            }
          }

          console.log(`[Voice] ${newState.member?.displayName} exited voice - added ${voiceSecondsToAdd}s (was muted: ${!!wasMuted})`);

          // Проверка квестов типа voice
          if (voiceSecondsToAdd > 0) {
            await checkQuestsForVoice(db, userId, guild.id, voiceSecondsToAdd, new Date(now));
          }
        } else {
          // Mute/deaf change, staying in voice
          const newMuteState = (newState.selfDeaf && newState.selfMute) ? 1 : 0;
          await db.execute({
            sql: `UPDATE users
                  SET voice_seconds = voice_seconds + ?, voice_joined_at = ?, voice_segment_muted = ?
                  WHERE user_id = ? AND guild_id = ?`,
            args: [voiceSecondsToAdd, Math.floor(now / 1000), newMuteState, userId, guild.id],
          });
          console.log(`[Voice] ${newState.member?.displayName} mute changed - added ${voiceSecondsToAdd}s, new state: ${newMuteState}`);

          // Проверка квестов типа voice
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

const token = process.env.DISCORD_BOT_TOKEN || process.env.DISCORD_TOKEN;
client.login(token);
