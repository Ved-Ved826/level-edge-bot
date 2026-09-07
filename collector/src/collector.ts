import { Client, GatewayIntentBits, Message, VoiceState } from 'discord.js';
import { createClient } from '@libsql/client';
import { calculateLevel, calculateXpForLevel } from '@shared/types';

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

client.on('ready', () => {
  console.log(`[Collector] Ready as ${client.user?.tag}`);
  const memUsage = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
  console.log(`[Memory] Heap: ${memUsage}MB`);
});

client.on('messageCreate', async (message: Message) => {
  if (message.author.bot) return;

  const { author, guildId } = message;
  if (!guildId) return;

  try {
    const now = Date.now();

    // Get user and guild settings
    const user = await db.execute({
      sql: 'SELECT * FROM users WHERE user_id = ? AND guild_id = ?',
      args: [author.id, guildId],
    });

    const settings = await db.execute({
      sql: 'SELECT * FROM guild_settings WHERE guild_id = ?',
      args: [guildId],
    });

    const xpPerMessage = (settings.rows[0]?.xp_per_message as number) || 15;
    const cooldown = (settings.rows[0]?.message_cooldown_seconds as number) || 30;

    if (user.rows.length === 0) {
      // First message from this user
      const newXp = xpPerMessage;
      const newLevel = calculateLevel(newXp);

      await db.execute({
        sql: `INSERT INTO users (user_id, guild_id, xp, level, messages_count, last_message_at)
              VALUES (?, ?, ?, ?, 1, ?)`,
        args: [author.id, guildId, newXp, newLevel, now],
      });
    } else {
      const row = user.rows[0];
      const lastMessageAt = (row.last_message_at as number) || 0;
      const timeSinceLastMessage = (now - lastMessageAt) / 1000;

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
        args: [newXp, newLevel, now, author.id, guildId],
      });
    }
  } catch (err) {
    console.error('[Error] messageCreate:', err);
  }
});

client.on('voiceStateUpdate', async (oldState: VoiceState, newState: VoiceState) => {
  const { userId, guild } = newState;
  if (!guild) return;

  try {
    const now = Date.now();
    const user = await db.execute({
      sql: 'SELECT * FROM users WHERE user_id = ? AND guild_id = ?',
      args: [userId, guild.id],
    });

    if (user.rows.length === 0) {
      // Create user entry if doesn't exist
      await db.execute({
        sql: `INSERT INTO users (user_id, guild_id) VALUES (?, ?)`,
        args: [userId, guild.id],
      });
    }

    // VOICE JOIN
    if (!oldState.channelId && newState.channelId) {
      await db.execute({
        sql: `UPDATE users
              SET voice_joined_at = ?, voice_segment_muted = ?
              WHERE user_id = ? AND guild_id = ?`,
        args: [now, newState.selfDeaf && newState.selfMute ? 1 : 0, userId, guild.id],
      });
      return;
    }

    // VOICE EXIT or MUTE/DEAF CHANGE
    if (oldState.channelId && (!newState.channelId || oldState.selfDeaf !== newState.selfDeaf || oldState.selfMute !== newState.selfMute)) {
      const voiceRow = await db.execute({
        sql: 'SELECT voice_joined_at, voice_segment_muted FROM users WHERE user_id = ? AND guild_id = ?',
        args: [userId, guild.id],
      });

      if (voiceRow.rows[0]?.voice_joined_at) {
        const joinedAt = voiceRow.rows[0].voice_joined_at as number;
        const elapsed = Math.floor((now - joinedAt) / 1000);
        const wasMuted = voiceRow.rows[0].voice_segment_muted as number;

        let voiceSecondsToAdd = 0;
        if (!wasMuted) {
          voiceSecondsToAdd = elapsed;
        }

        if (!newState.channelId) {
          // Exiting voice completely
          await db.execute({
            sql: `UPDATE users
                  SET voice_seconds = voice_seconds + ?, voice_joined_at = NULL, voice_segment_muted = 0
                  WHERE user_id = ? AND guild_id = ?`,
            args: [voiceSecondsToAdd, userId, guild.id],
          });
        } else {
          // Mute/deaf change, staying in voice
          const newMuteState = newState.selfDeaf && newState.selfMute ? 1 : 0;
          await db.execute({
            sql: `UPDATE users
                  SET voice_seconds = voice_seconds + ?, voice_joined_at = ?, voice_segment_muted = ?
                  WHERE user_id = ? AND guild_id = ?`,
            args: [voiceSecondsToAdd, now, newMuteState, userId, guild.id],
          });
        }
      }
    }
  } catch (err) {
    console.error('[Error] voiceStateUpdate:', err);
  }
});

client.login(process.env.DISCORD_TOKEN);
