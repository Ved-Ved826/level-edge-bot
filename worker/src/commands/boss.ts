// Мировой Босс: /boss, /boss-spawn и обработка атак boss_atk_*.

import { createClient } from "@libsql/client";
import { BOSS_DESCRIPTIONS } from "../data/bosses";
import { ButtonInteraction, CommandInteraction, Env, ExecutionContext } from "../types";
import { UNIQUE_ITEMS, getRarityEmoji } from "../itemsCatalog";
import { getUserGear, isItemUniqueOnServer } from "../db/queries";
import { getVladivostokDate } from "../utils/formatters";

export async function handleBossAttack(
  inter: ButtonInteraction,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
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
      const webhookUrl = `https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${inter.token}/messages/@original`;
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
        const hpUpdateResult = await db.execute({
          sql: 'UPDATE world_boss SET current_hp = MAX(0, current_hp - ?) WHERE id = ? AND guild_id = ? AND status = ?',
          args: [finalDamage, bossId, gid, 'active'],
        });
        // Защита от гонки: если статус уже не 'active' (босс повержен/исчез другим ударом), урон не засчитывается
        if (!hpUpdateResult.rowsAffected) {
          await fetch(webhookUrl, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              content: '⚠️ Босс уже повержен или исчез! Ваш удар не засчитан.',
              flags: 64,
            }),
          });
          return;
        }
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
        let coinsReward = 40;
        // Комбинируем награды в зависимости от типа босса (нерф монет: Мимик даёт больше, остальные — по 40)
        if (bossType === 'mimic') {
          coinsReward = 75; // Мимик даёт больше монет, но уже не 300
        } else if (bossType === 'leviathan') {
          xpReward = 1000; // Левиафан выдаёт больше опыта
        } else if (bossType === 'phantom') {
          xpReward = 900; // Фантом чуть дороже
        }
        const bossName = updatedBoss.boss_name as string;
        const bossChannelId = boss.channel_id as string;
        // Ветка: БОСС ПОВЕРЖЕН
        if (newCurrentHp <= 0) {
          // Список выпавших реликвий для отображения в victory embed
          const droppedLoot: { userId: string; itemName: string; rarity: string }[] = [];
          // Атомарное переключение статуса: только если он ещё 'active'.
          // Защищает от повторного начисления наград при гонке/дублирующемся клике.
          const statusSwitch = await db.execute({
            sql: "UPDATE world_boss SET status = 'defeated' WHERE id = ? AND guild_id = ? AND status = 'active'",
            args: [bossId, gid],
          });
          if (statusSwitch.rowsAffected) {
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
            if (batchOps.length > 0) {
              await db.batch(batchOps);
            }
            // Хардкорный дроп экипировки: Топ-1 дамагер — 5%, остальные участники — 3%
            const sortedParticipants = [...participants].sort((a: any, b: any) => (b.total_dmg as number) - (a.total_dmg as number));
            const topDamagerUserId = sortedParticipants.length > 0 ? (sortedParticipants[0].user_id as string) : null;
            for (const p of sortedParticipants) {
              const participantUserId = p.user_id as string;
              const participantGuildId = p.guild_id as string;
              const isTopDamager = participantUserId === topDamagerUserId;
              const dropChance = isTopDamager ? 0.05 : 0.03;
              if (Math.random() < dropChance) {
                const candidate = UNIQUE_ITEMS[Math.floor(Math.random() * UNIQUE_ITEMS.length)];
                const isUnique = await isItemUniqueOnServer(db, candidate.item_id, participantGuildId);
                if (isUnique) {
                  const dropNow = Math.floor(Date.now() / 1000);
                  await db.execute({
                    sql: 'INSERT INTO user_inventory (user_id, guild_id, item_name, item_id, item_type, rarity, slot, atk_bonus, def_bonus, crit_bonus, coin_bonus, is_equipped, description, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)',
                    args: [participantUserId, participantGuildId, candidate.name, candidate.item_id, 'relic', candidate.rarity, candidate.slot, candidate.atk, candidate.def, candidate.crit, candidate.coin, candidate.description, dropNow],
                  });
                  droppedLoot.push({ userId: participantUserId, itemName: candidate.name, rarity: candidate.rarity });
                }
              }
            }
          }
          // Топ-3 дамагеров
          const topDamageersResult = await db.execute({
            sql: 'SELECT user_id, SUM(damage) as total_dmg FROM boss_damage_logs WHERE boss_id = ? GROUP BY user_id ORDER BY total_dmg DESC LIMIT 3',
            args: [bossId],
          });
          const topDamageers = topDamageersResult.rows || [];
          // Редактируем Embed в канале через Discord Bot API (не через webhook!)
          const victoryMessageId = (updatedBoss.message_id as string) || (boss.message_id as string);
          const editUrl = `https://discord.com/api/v10/channels/${bossChannelId}/messages/${victoryMessageId}`;
          let lootText = '';
          if (droppedLoot.length > 0) {
            lootText = '\n\n**💎 Выпала реликвия:**\n' + droppedLoot.map((l) => `🎁 <@${l.userId}> получил **${l.itemName}** (${getRarityEmoji(l.rarity)} ${l.rarity})!`).join('\n');
          }
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
                }).join('\n') || '*Ударов пока не нанесено*') + lootText,
              color: 0xF1C40F,
            }],
            components: [],
          };
          try {
            const victoryResp = await fetch(editUrl, {
              method: 'PATCH',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bot ${env.DISCORD_BOT_TOKEN}`,
              },
              body: JSON.stringify(victoryEmbed),
            });
            if (!victoryResp.ok) {
              console.error('[WorldBoss] Victory message edit failed:', await victoryResp.text());
            }
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
              title: `⚔️ МИРОВОЙ БОСС: ${boss.boss_name as string}`,
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
        try {
          await fetch(webhookUrl, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              content: '❌ Произошла ошибка при обработке атаки босса. Попробуйте позже.',
            }),
          });
        } catch (notifyErr) {
          console.error('[WorldBoss] Failed to notify about error:', notifyErr);
        }
      }
    })()
  );
  // ЕДИНСТВЕННЫЙ type: 5 (DEFERRED) — сразу после всех быстрых проверок
  return Response.json({ type: 5 });
}

export async function handleBoss(
  inter: CommandInteraction,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
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

export async function handleBossSpawn(
  inter: CommandInteraction,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
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



              // Сбрасываем кулдаун атак для пользователей текущей гильдии ТОЛЬКО

              // КРИТИЧНО: добавляем guild_id фильтр, чтобы не сбрасывать cooldown в других гильдиях

              await db.execute({

                sql: 'UPDATE users SET last_boss_attack_at = 0 WHERE guild_id = ?',

                args: [gid],

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
