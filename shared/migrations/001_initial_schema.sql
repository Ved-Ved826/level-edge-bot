-- Users table with XP, level, message and voice tracking
CREATE TABLE IF NOT EXISTS users (
  user_id TEXT NOT NULL,
  guild_id TEXT NOT NULL,
  xp INTEGER NOT NULL DEFAULT 0,
  level INTEGER NOT NULL DEFAULT 0,
  messages_count INTEGER NOT NULL DEFAULT 0,
  voice_seconds INTEGER NOT NULL DEFAULT 0,
  last_message_at INTEGER,
  voice_joined_at INTEGER,
  voice_segment_muted INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, guild_id)
);

-- Guild settings for XP rates and cooldowns
CREATE TABLE IF NOT EXISTS guild_settings (
  guild_id TEXT PRIMARY KEY,
  xp_per_message INTEGER NOT NULL DEFAULT 15,
  message_cooldown_seconds INTEGER NOT NULL DEFAULT 30
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_users_guild_xp ON users(guild_id, xp DESC);
CREATE INDEX IF NOT EXISTS idx_users_guild_voice ON users(guild_id, voice_seconds DESC);
CREATE INDEX IF NOT EXISTS idx_users_guild_messages ON users(guild_id, messages_count DESC);
