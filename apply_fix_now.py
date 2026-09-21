import re

file_path = 'collector/src/collector.ts'
with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
    content = f.read()

# 1. Убираем синтаксический хвост после mapCommand на строке 5300
idx_map = content.find("const existingMap = guild.commands.cache.find")
idx_ready = content.find("console.log(`[Collector] Ready as", idx_map)
if idx_map != -1 and idx_ready != -1:
    clean_map_block = """const existingMap = guild.commands.cache.find((c: any) => c.name === 'map');
        if (existingMap) {
          await existingMap.edit(mapCommand);
        } else {
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

  """
    content = content[:idx_map] + clean_map_block + content[idx_ready:]
    print("✓ 1. Синтаксис регистрации команд исправлен")

# 2. Обновляем unlockAchievement (ачивки, эмбед, подсчет)
idx_fn = content.find("async function unlockAchievement")
if idx_fn != -1:
    idx_chan = content.find("if (channel) {", idx_fn)
    idx_send = content.find("await channel.send(embed);", idx_chan)
    if idx_chan != -1 and idx_send != -1:
        ach_clean = """if (channel) {
          let unlockedCount = 1;
          try {
            const countRes = await db.execute({
              sql: 'SELECT COUNT(*) as count FROM user_achievements WHERE user_id = ? AND guild_id = ?',
              args: [userId, guildId],
            });
            unlockedCount = Number(countRes.rows[0]?.count) || 1;
          } catch {}
          const totalCount = ACHIEVEMENTS_LIST.length;

          const embed = {
            embeds: [{
              title: '🏆 СЕКРЕТНОЕ ДОСТИЖЕНИЕ РАЗБЛОКИРОВАНО!',
              description: `<@${userId}> открыл(а) секретное достижение **«${achievement.title}»**!`,
              color: 0xF1C40F,
              fields: [
                { name: 'Описание', value: achievement.description, inline: false },
                { name: 'Цитата', value: `*${achievement.quote}*`, inline: false },
                { name: 'Награда', value: `+${achievement.reward} XP`, inline: true },
              ],
              footer: { text: `Открыто секретов: ${unlockedCount}/${totalCount}` },
            }],
          };

          try {
            """
        content = content[:idx_chan] + ach_clean + content[idx_send:]
        print("✓ 2. unlockAchievement обновлен")

# 3. Заменяем системные уведомления
replacements = {
    "title: 'вљЎ РЎР§РђРЎРўР›РР’Р«Р™ Р§РђРЎ РќРђР§РђР›РЎРЇ!'": "title: '⚡ СЧАСТЛИВЫЙ ЧАС НАЧАЛСЯ!'",
    "description: 'Р”РІРѕР№РЅРѕР№ РѕРїС‹С‚ (2X XP) Р·Р° РІСЃРµ СЃРѕРѕР±С‰РµРЅРёСЏ Рё РІРѕР№СЃ РЅР° Р±Р»РёР¶Р°Р№С€РёРµ 60 РјРёРЅСѓС‚!'": "description: 'Двойной опыт (2X XP) за все сообщения и войс на ближайшие 60 минут!'",
    "footer: { text: 'РќРµ РїСЂРѕРїСѓСЃС‚РёС‚Рµ СЌС‚РѕС‚ СЂРµРґРєРёР№ РёРІРµРЅС‚!' }": "footer: { text: 'Не пропустите этот редкий ивент!' }",
    "title: 'рџ‘‘ Р§Р•РњРџРРћРќ РќР•Р”Р•Р›Р РћРџР Р•Р”Р•Р›РЃРќ!'": "title: '👑 ЧЕМПИОН НЕДЕЛИ ОПРЕДЕЛЁН!'",
    "footer: { text: 'РќРµРґРµР»СЏ Р·Р°РІРµСЂС€Р°РµС‚СЃСЏ РІ 00:00 (Р’Р»Р°РґРёРІРѕСЃС‚РѕРє)' }": "footer: { text: 'Неделя завершается в 00:00 (Владивосток)' }",
    "title: 'рџ“° РЎРІРµР¶РёР№ РІС‹РїСѓСЃРє: РҐСЂРѕРЅРёРєР° РЅРµРґРµР»Рё'": "title: '📰 Свежий выпуск: Хроника недели'",
    "title: 'рџЋЃ РЎ РЅРµР±Р° СѓРїР°Р» РєРѕРЅС‚РµР№РЅРµСЂ СЃ РїСЂРёРїР°СЃР°РјРё!'": "title: '🎁 С неба упал контейнер с припасами!'",
    "title: 'рџ’Ё Р‘РѕСЃСЃ СЃРєСЂС‹Р»СЃСЏ РІ С‚СѓРјР°РЅРµ!'": "title: '💨 Босс скрылся в тумане!'",
    "title: 'рџҐЂ РљР»Р°СЃСЃРѕРІС‹Рµ РЅР°РІС‹РєРё Р°С‚СЂРѕС„РёСЂРѕРІР°Р»РёСЃСЊ!'": "title: '🥀 Классовые навыки атрофировались!'",
    "title: \"вЏі Р”СѓСЌР»СЊ РѕС‚РєР»РѕРЅРµРЅР° РїРѕ С‚Р°Р№РјР°СѓС‚Сѓ\"": "title: '⏳ Дуэль отклонена по таймауту'",
    "title: 'рџђ‹ РљСЂСѓРїРЅР°СЏ СЃРґРµР»РєР° РЅР° Р±РёСЂР¶Рµ'": "title: '🐳 Крупная сделка на бирже'",
    "title: 'рџ“Љ Р”Р°Р№РґР¶РµСЃС‚ Р±РёСЂР¶Рё Р·Р° СЃСѓС‚РєРё'": "title: '📊 Дайджест биржи за сутки'",
    "title: 'рџ“€ РЎРѕР±С‹С‚РёРµ Р±РёСЂР¶Рё'": "title: '📈 Событие биржи'"
}
for old, new in replacements.items():
    content = content.replace(old, new)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)
print("✓ collector.ts успешно сохранен!")
