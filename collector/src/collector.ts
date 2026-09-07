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

// Re-export from shared types (duplicate for collector to avoid tsconfig issues)
const calculateLevel = (xp: number): number => {
  return Math.floor(0.1 * Math.sqrt(xp));
};

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

client.on('ready', async () => {
  console.log(`[Collector] Starting migration...`);
  await migrateSchema();

  console.log(`[Collector] Ready as ${client.user?.tag}`);
  const memUsage = Math.round(process.memoryUsage().rss / 1024 / 1024);
  console.log(`[Memory] RSS: ${memUsage}MB`);
});

client.on('messageCreate', async (message: Message) => {
  if (message.author.bot) return;
  if (!message.guild) return;

  const { author, guild } = message;
  const guildId = guild.id;

  try {
    const now = Date.now();

    // Get user and guild settings
    const userResult = await db.execute({
      sql: 'SELECT * FROM users WHERE user_id = ? AND guild_id = ?',
      args: [author.id, guildId],
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
        args: [author.id, guildId, newXp, newLevel, Math.floor(now / 1000)],
      });
      console.log(`[Message] New user: ${author.username} (${author.id}) in ${guild.name} - XP: ${newXp}, Level: ${newLevel}`);
    } else {
      const row = userResult.rows[0];
      const lastMessageAt = (row.last_message_at as number) || 0;
      const timeSinceLastMessage = (now - lastMessageAt * 1000) / 1000;

      let xpToAdd = 0;
      if (timeSinceLastMessage >= cooldown) {
        xpToAdd = xpPerMessage;
      }

      const oldXp = (row.xp as number) || 0;
      const newXp = oldXp + xpToAdd;
      const newLevel = calculateLevel(newXp);

      await db.execute({
        sql: `UPDATE users
              SET xp = ?, level = ?, messages_count = messages_count + 1, last_message_at = ?
              WHERE user_id = ? AND guild_id = ?`,
        args: [newXp, newLevel, Math.floor(now / 1000), author.id, guildId],
      });

      if (xpToAdd > 0) {
        console.log(`[Message] ${author.username} - ${xpToAdd} XP (total: ${newXp}, level: ${newLevel})`);
      } else {
        console.log(`[Message] ${author.username} - Cooldown (total messages: ${(row.messages_count as number) + 1})`);
      }
    }
  } catch (err) {
    console.error('[Error] messageCreate:', err);
  }
});

client.on('voiceStateUpdate', async (oldState: VoiceState, newState: VoiceState) => {
  const userId = newState.member?.id;
  const { guild } = newState;
  if (!guild || !userId) return;

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

        if (!newChannelId) {
          // Exiting voice completely
          await db.execute({
            sql: `UPDATE users
                  SET voice_seconds = voice_seconds + ?, voice_joined_at = NULL, voice_segment_muted = 0
                  WHERE user_id = ? AND guild_id = ?`,
            args: [voiceSecondsToAdd, userId, guild.id],
          });
          console.log(`[Voice] ${newState.member?.displayName} exited voice - added ${voiceSecondsToAdd}s (was muted: ${!!wasMuted})`);
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
        }
      }
    }
  } catch (err) {
    console.error('[Error] voiceStateUpdate:', err);
  }
});

const token = process.env.DISCORD_BOT_TOKEN || process.env.DISCORD_TOKEN;
client.login(token);
