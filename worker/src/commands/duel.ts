// Команда /duel и кнопки принятия/отклонения дуэлей.

import { createClient } from "@libsql/client";
import { calculateLevel } from "@shared/types";
import { ButtonInteraction, CommandInteraction, Env, ExecutionContext } from "../types";
import { checkUserExists, createDuelRecord, expireDuelById, getDuelById, getExpiredDuels, getUserCoins, getUserXp, unlockAchievement, updateCoins, updateDuelStatus, updateXpAndLevel } from "../db/queries";

const DUEL_TIMEOUT_SECONDS = 300; // 5 минут

export function buildDuelEmbed(challengerId: string, opponentId: string, bet: number, duelId: string, currency: string = 'xp') {
  const totalPot = bet * 2;
  const tax = Math.round(totalPot * 0.26);
  const winPot = totalPot - tax;
  const winnerProfit = winPot - bet;
  const isCoins = currency === 'coins';
  const currencyLabel = isCoins ? '🪙' : 'XP';
  const title = isCoins ? "⚔️ Дуэль на монеты!" : "⚔️ Дуэль на опыт!";
  const timeoutTimestamp = Math.floor(Date.now() / 1000) + DUEL_TIMEOUT_SECONDS;
  return {
    embeds: [
      {
        title: title,
        description: `**<@${challengerId}>** бросает вызов **<@${opponentId}>**!\n\n` +
          `💰 Ставка: **${bet.toLocaleString()} ${currencyLabel}**\n` +
          `🏆 Чистый выигрыш победителя: **+${winnerProfit.toLocaleString()} ${currencyLabel}**\n` +
          `🔥 Сгораемый налог сервера (26%): **${tax.toLocaleString()} ${currencyLabel}**\n\n` +
          `*У оппонента есть 5 минут, чтобы принять вызов.*\n` +
          `⏳ *Вызов действует 5 минут (истекает <t:${timeoutTimestamp}:R>).*`,
        color: 0xFF8800,
        footer: { text: "У оппонента есть 5 минут на ответ" },
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

export function buildDuelDeclineEmbed(challengerId: string, opponentId: string) {
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

export function buildDuelResultEmbed(challengerId: string, opponentId: string, winnerId: string, loserId: string, roll1: number, roll2: number, bet: number, tax: number, winnerProfit: number, currency: string = 'xp') {
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

export async function handleDuel(
  inter: CommandInteraction,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
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

  const response = Response.json({ type: 4, data: result });

  // Добавляем фоновую задачу для получения message_id через webhook @original
  ctx.waitUntil((async () => {
    try {
      // Получаем message_id из оригинального сообщения Discord
      const webhookUrl = `https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${inter.token}/messages/@original`;
      const response = await fetch(webhookUrl);
      if (response.ok) {
        const msg = await response.json() as { id: string };
        // Обновляем запись дуэли с реальным message_id и channel_id
        await db.execute({
          sql: "UPDATE duels SET message_id = ?, channel_id = ? WHERE id = ?",
          args: [msg.id, inter.channel_id || null, duelId],
        });
      }
    } catch (err) {
      // Игнорируем ошибку - collector будет работать без message_id
      console.error("Failed to capture duel message_id:", err);
    }
  })());

  return response;
}

export async function handleDuelButtons(
  inter: ButtonInteraction,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
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
        // C2: если с challenger монеты УЖЕ списаны — вернуть их перед отменой дуэли,
        // иначе ставка вызывавшего теряется навсегда.
        if (challengerDeduct.rowsAffected) {
          await db.execute({
            sql: "UPDATE users SET coins = coins + ? WHERE user_id = ? AND guild_id = ?",
            args: [bet, challengerId, guildId],
          });
        }
        await updateDuelStatus(db, duelId, "declined");
        return Response.json({
          type: 4,
          data: { content: `⚠️ У одного из участников недостаточно 🪙 для дуэли. Дуэль отменена.`, flags: 64 },
        });
      }
      // C3: статус переводим ДО выплаты. Если перевод не прошёл (дуэль уже
      // завершена/отменена) — возвращаем списанные ставки обоим.
      const coinsStatusCompleted = await updateDuelStatus(db, duelId, "completed");
      if (!coinsStatusCompleted) {
        await db.execute({
          sql: "UPDATE users SET coins = coins + ? WHERE user_id = ? AND guild_id = ?",
          args: [bet, challengerId, guildId],
        });
        await db.execute({
          sql: "UPDATE users SET coins = coins + ? WHERE user_id = ? AND guild_id = ?",
          args: [bet, opponentId, guildId],
        });
        return Response.json({
          type: 4,
          data: { content: "⚠️ Эта дуэль уже завершена — ставки возвращены.", flags: 64 },
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
        // C2: возврат уже списанной ставки challenger'у перед отменой дуэли
        if (challengerDeduct.rowsAffected) {
          await db.execute({
            sql: "UPDATE users SET xp = xp + ? WHERE user_id = ? AND guild_id = ?",
            args: [bet, challengerId, guildId],
          });
        }
        await updateDuelStatus(db, duelId, "declined");
        return Response.json({
          type: 4,
          data: { content: `⚠️ У одного из участников недостаточно XP для дуэли. Дуэль отменена.`, flags: 64 },
        });
      }
      // C3: статус переводим ДО выплаты; при неудаче возвращаем ставки обоим
      const xpStatusCompleted = await updateDuelStatus(db, duelId, "completed");
      if (!xpStatusCompleted) {
        await db.execute({
          sql: "UPDATE users SET xp = xp + ? WHERE user_id = ? AND guild_id = ?",
          args: [bet, challengerId, guildId],
        });
        await db.execute({
          sql: "UPDATE users SET xp = xp + ? WHERE user_id = ? AND guild_id = ?",
          args: [bet, opponentId, guildId],
        });
        return Response.json({
          type: 4,
          data: { content: "⚠️ Эта дуэль уже завершена — ставки возвращены.", flags: 64 },
        });
      }
      // Начисляем выигрыши и обновляем уровни
      await updateXpAndLevel(db, winnerId, guildId, winnerProfit);
    }
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
  // Недостижимо: роутер вызывает этот обработчик только при совпадении custom_id.
  // Ветка нужна лишь для полноты типизации возвращаемого значения.
  return Response.json({ type: 4, data: { content: "❌ Неизвестная кнопка дуэли.", flags: 64 } });
}
