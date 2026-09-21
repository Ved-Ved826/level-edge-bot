const fs = require('fs');
const filePath = 'collector/src/collector.ts';
let code = fs.readFileSync(filePath, 'utf8');

// 1. unlockAchievement
const achSearch = /if\s*\(channel\)\s*\{\s*(?:let unlockedCount[\s\S]*?)?const embed = \{\s*embeds: \[\{\s*title: '[^']*СЕКРЕТНОЕ ДОСТИЖЕНИЕ РАЗБЛОКИРОВАНО!'[\s\S]*?\}\s*\];\s*\};\s*try\s*\{\s*await channel\.send\(embed\);/;

const achReplace = `if (channel) {
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
              description: \`<@\${userId}> открыл(а) секретное достижение **«\${achievement.title}»**!\`,
              color: 0xF1C40F,
              fields: [
                { name: 'Описание', value: achievement.description, inline: false },
                { name: 'Цитата', value: \`*\${achievement.quote}*\`, inline: false },
                { name: 'Награда', value: \`+\${(achievement.reward_xp || achievement.reward)} XP\`, inline: true },
              ],
              footer: { text: \`Открыто секретов: \${unlockedCount}/\${totalCount}\` },
            }],
          };

          try {
            await channel.send(embed);`;

if (achSearch.test(code)) {
  code = code.replace(achSearch, achReplace);
  console.log('✓ 1. unlockAchievement обновлён');
}

// 2 & 3. Команды и .edit()
const startMarker = "const existing = guild.commands.cache.find((cmd: any) => cmd.name === 'test-gazeta');";
const endMarker = "console.error(`[City] Failed to register slash command map in guild ${guild.id}:`, mapCmdErr);";

const idx1 = code.indexOf(startMarker);
const idx2 = code.indexOf(endMarker);

if (idx1 !== -1 && idx2 !== -1) {
  const closeBraceIdx = code.indexOf('}', idx2) + 1;
  const newCommandsBlock = `const existing = guild.commands.cache.find((cmd: any) => cmd.name === 'test-gazeta');
      const testGazetaCmd = {
        name: 'test-gazeta',
        description: 'Сгенерировать и выпустить AI-газету за неделю (только для администрации)',
      };
      if (existing) {
        await existing.edit(testGazetaCmd);
      } else {
        await guild.commands.create(testGazetaCmd);
        console.log(\`[Gazeta] Slash command test-gazeta registered in guild \${guild.id}\`);
      }

      const exchangeCommands: any[] = [
        { name: 'stocks', description: 'Котировки акций компаний сервера' },
        { name: 'portfolio', description: 'Ваш инвестиционный портфель акций' },
        {
          name: 'company-create',
          description: 'Создать компанию на бирже',
          options: [
            { name: 'name', description: 'Название компании', type: 3, required: true },
            { name: 'ticker', description: 'Тикер акций (2-5 латинских букв, опционально)', type: 3, required: false },
            { name: 'description', description: 'Описание компании', type: 3, required: true },
          ],
        },
        {
          name: 'invest',
          description: 'Купить акции компании',
          options: [
            { name: 'company', description: 'Тикер или название компании', type: 3, required: true },
            { name: 'amount', description: 'Количество акций', type: 4, required: true },
          ],
        },
        {
          name: 'divest',
          description: 'Продать акции компании',
          options: [
            { name: 'company', description: 'Тикер или название компании', type: 3, required: true },
            { name: 'amount', description: 'Количество акций', type: 4, required: true },
          ],
        },
        {
          name: 'exchange-setup',
          description: 'Канал для публичной ленты биржи (Manage Server)',
          options: [
            { name: 'channel', description: 'Текстовый канал для событий биржи', type: 7, required: true },
          ],
        },
        {
          name: 'exchange-top',
          description: 'Рейтинг инвесторов и компаний сезона по ROI',
          options: [
            { name: 'season', description: 'ID сезона (по умолчанию текущий)', type: 3, required: false },
          ],
        },
      ];

      for (const cmd of exchangeCommands) {
        try {
          const existingCmd = guild.commands.cache.find((c: any) => c.name === cmd.name);
          if (existingCmd) {
            await existingCmd.edit(cmd);
          } else {
            await guild.commands.create(cmd);
            console.log(\`[Exchange] Slash command \${cmd.name} registered in guild \${guild.id}\`);
          }
        } catch (cmdErr) {
          console.error(\`[Exchange] Failed to register slash command \${cmd.name} in guild \${guild.id}:\`, cmdErr);
        }
      }

      const plotCommand: any = {
        name: 'plot',
        description: 'Город: управление участками недвижимости',
        options: [
          {
            name: 'info',
            description: 'Информация об участке',
            type: 1,
            options: [
              { name: 'plot_id', description: 'ID участка (1-12)', type: 4, required: true },
            ],
          },
          {
            name: 'buy',
            description: 'Купить участок (себе или компании)',
            type: 1,
            options: [
              { name: 'plot_id', description: 'ID участка (1-12)', type: 4, required: true },
              { name: 'company', description: 'Тикер компании-покупателя (опционально)', type: 3, required: false },
            ],
          },
          {
            name: 'sell',
            description: 'Выставить участок на продажу (price=0 — снять с продажи)',
            type: 1,
            options: [
              { name: 'plot_id', description: 'ID участка (1-12)', type: 4, required: true },
              { name: 'price', description: 'Цена в 🪙 (0 — снять с продажи)', type: 4, required: true },
            ],
          },
        ],
      };

      try {
        const existingPlot = guild.commands.cache.find((c: any) => c.name === 'plot');
        if (existingPlot) {
          await existingPlot.edit(plotCommand);
        } else {
          await guild.commands.create(plotCommand);
          console.log(\`[City] Slash command plot registered in guild \${guild.id}\`);
        }
      } catch (plotErr) {
        console.error(\`[City] Failed to register slash command plot in guild \${guild.id}:\`, plotErr);
      }

      const buildCommand: any = {
        name: 'build',
        description: 'Город: построить бизнес на своём участке',
        options: [
          { name: 'plot_id', description: 'ID участка (1-12)', type: 4, required: true },
          {
            name: 'type', description: 'Тип бизнеса', type: 3, required: true,
            choices: [
              { name: '⛏️ Шахта', value: 'mine' },
              { name: '🌾 Ферма', value: 'farm' },
              { name: '⛽ АЗС', value: 'gas_station' },
              { name: '🛒 Супермаркет', value: 'shop' },
              { name: '🍽️ Ресторан', value: 'restaurant' },
              { name: '🎰 Казино', value: 'casino' },
              { name: '🏛️ Банк', value: 'bank' },
              { name: '⚓ Морской порт', value: 'port' }
            ]
          }
        ],
      };

      try {
        const existingBuild = guild.commands.cache.find((c: any) => c.name === 'build');
        if (existingBuild) {
          await existingBuild.edit(buildCommand);
        } else {
          await guild.commands.create(buildCommand);
          console.log(\`[City] Slash command build registered in guild \${guild.id}\`);
        }
      } catch (buildErr) {
        console.error(\`[City] Failed to register slash command build in guild \${guild.id}:\`, buildErr);
      }

      const upgradeCommand: any = {
        name: 'upgrade',
        description: 'Город: улучшить здание на участке (до уровня 3)',
        options: [
          { name: 'plot_id', description: 'ID участка (1-12)', type: 4, required: true }
        ],
      };

      try {
        const existingUpgrade = guild.commands.cache.find((c: any) => c.name === 'upgrade');
        if (existingUpgrade) {
          await existingUpgrade.edit(upgradeCommand);
        } else {
          await guild.commands.create(upgradeCommand);
          console.log(\`[City] Slash command upgrade registered in guild \${guild.id}\`);
        }
      } catch (upgradeErr) {
        console.error(\`[City] Failed to register slash command upgrade in guild \${guild.id}:\`, upgradeErr);
      }

      const auctionCommand: any = {
        name: 'auction',
        description: 'Город: аукционы участков недвижимости',
        options: [
          {
            name: 'list',
            description: 'Список активных аукционов',
            type: 1,
          },
          {
            name: 'bid',
            description: 'Сделать ставку на аукционе',
            type: 1,
            options: [
              { name: 'plot_id', description: 'ID участка (1-12)', type: 4, required: true },
              { name: 'amount', description: 'Размер ставки в 🪙', type: 4, required: true },
            ],
          },
        ],
      };

      try {
        const existingAuction = guild.commands.cache.find((c: any) => c.name === 'auction');
        if (existingAuction) {
          await existingAuction.edit(auctionCommand);
        } else {
          await guild.commands.create(auctionCommand);
          console.log(\`[City] Slash command auction registered in guild \${guild.id}\`);
        }
      } catch (auctionCmdErr) {
        console.error(\`[City] Failed to register slash command auction in guild \${guild.id}:\`, auctionCmdErr);
      }

      const mapCommand: any = {
        name: 'map',
        description: 'Город: интерактивная карта участков и недвижимости',
      };

      try {
        const existingMap = guild.commands.cache.find((c: any) => c.name === 'map');
        if (existingMap) {
          await existingMap.edit(mapCommand);
        } else {
          await guild.commands.create(mapCommand);
          console.log(\`[City] Slash command map registered in guild \${guild.id}\`);
        }
      } catch (mapCmdErr) {
        console.error(\`[City] Failed to register slash command map in guild \${guild.id}:\`, mapCmdErr);
      }`;

  code = code.slice(0, idx1) + newCommandsBlock + code.slice(closeBraceIdx);
  console.log('✓ 2 & 3. Описания команд и existingCmd.edit(cmd) применены');
}

fs.writeFileSync(filePath, code, 'utf8');
console.log('Готово! Файл collector/src/collector.ts полностью исправлен.');
