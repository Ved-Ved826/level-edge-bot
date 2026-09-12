// Общие типы воркера: окружение, контекст выполнения и структура Discord-интеракции.

export interface Env {
  DATABASE_URL: string;
  DATABASE_AUTH_TOKEN: string;
  DISCORD_PUBLIC_KEY: string;
  DISCORD_APPLICATION_ID: string;
  DISCORD_BOT_TOKEN: string;
}

export interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

export interface DiscordInteraction {
  id: string;
  token: string;
  type: number;
  channel_id?: string;
  data?: {
    name?: string;
    options?: { name: string; value: any }[];
    custom_id?: string;
    values?: string[];
    resolved?: { users?: { [id: string]: { username: string; discriminator: string; avatar?: string | null } }; members?: { [id: string]: any } };
  } | {
    name: string;
    options?: { name: string; value: any }[];
    custom_id?: string;
    values?: string[];
    resolved?: { users?: { [id: string]: { username: string; discriminator: string; avatar?: string | null } }; members?: { [id: string]: any } };
  };
  member?: {
    user: { id: string; username: string; avatar: string | null; discriminator: string };
    id: string;
    permissions?: string;
  };
  guild_id?: string;
  message?: { components?: any[]; embeds?: any[] };
}

/** Данные интеракции (роутер уже проверил их наличие перед вызовом обработчика). */
export type InteractionData = NonNullable<DiscordInteraction["data"]>;

/** Интеракция слэш-команды: имя команды гарантированно присутствует. */
export type CommandInteraction = DiscordInteraction & { data: InteractionData & { name: string } };

/** Интеракция кнопки/селекта: custom_id гарантированно присутствует. */
export type ButtonInteraction = DiscordInteraction & { data: InteractionData & { custom_id: string } };
