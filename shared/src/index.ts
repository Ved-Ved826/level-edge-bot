export interface User {
  user_id: string;
  guild_id: string;
  xp: number;
  level: number;
  messages_count: number;
  voice_seconds: number;
  last_message_at: number | null;
  voice_joined_at: number | null;
  voice_segment_muted: number;
}

export interface GuildSettings {
  guild_id: string;
  xp_per_message: number;
  message_cooldown_seconds: number;
}

export const calculateLevel = (xp: number): number => {
  return Math.floor(0.1 * Math.sqrt(xp));
};

export const calculateXpForLevel = (level: number): number => {
  const base = level / 0.1;
  return Math.round(base * base);
};
