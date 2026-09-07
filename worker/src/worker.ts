import { createClient } from '@libsql/client';
import { getXpProgress } from '@shared/types';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-wasm';
import { Card } from './Card';
// @ts-ignore
import fontData from '../assets/Inter-Regular.ttf';

interface Env {
  DATABASE_URL: string;
  DATABASE_AUTH_TOKEN: string;
  DISCORD_PUBLIC_KEY: string;
  DISCORD_APPLICATION_ID: string;
  DISCORD_BOT_TOKEN: string;
}

interface DiscordInteraction {
  type: number;
  token: string;
  id: string;
  data?: {
    name: string;
    options?: Array<{
      name: string;
      value: string;
    }>;
  };
  member?: {
    user: {
      id: string;
      username: string;
      avatar: string | null;
      discriminator: string;
    };
  };
  guild_id?: string;
}

const hexToBytes = (hex: string): Uint8Array => {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
};

const verifyDiscordSignature = async (
  signature: string,
  timestamp: string,
  body: string,
  publicKey: string
): Promise<boolean> => {
  const message = timestamp + body;
  const encoder = new TextEncoder();
  const messageData = encoder.encode(message);
  const signatureBytes = hexToBytes(signature);
  const publicKeyBytes = hexToBytes(publicKey);

  try {
    const key = await crypto.subtle.importKey(
      'raw',
      publicKeyBytes,
      { name: 'Ed25519' } as any,
      false,
      ['verify']
    );

    const isValid = await crypto.subtle.verify(
      'Ed25519',
      key,
      signatureBytes,
      messageData
    );

    return isValid;
  } catch (err) {
    console.error('[Error] Signature verification failed:', err);
    return false;
  }
};

const getAvatarUrl = (user: { id: string; avatar: string | null; discriminator: string }): string => {
  if (user.avatar) {
    return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=256`;
  }
  // Default avatar based on discriminator
  const defaultAvatarIndex = parseInt(user.discriminator) % 5;
  return `https://cdn.discordapp.com/embed/avatars/${defaultAvatarIndex}.png`;
};

const getStatusColor = (): string => {
  // For now, return a default color (online green)
  // In future, this can be enhanced to fetch real presence data
  return '#43b581'; // Discord online green
};

const renderCard = async (props: {
  username: string;
  avatarUrl: string;
  level: number;
  rank: number;
  totalUsers: number;
  xp: number;
  nextLevelXp: number;
  progress: number;
  messagesCount: number;
  voiceHours: number;
  statusColor: string;
}): Promise<Uint8Array> => {
  // Render JSX to SVG using Satori
  const svg = await satori(
    Card(props),
    {
      width: 800,
      height: 280,
      fonts: [
        {
          name: 'Inter',
          data: fontData,
          weight: 400,
          style: 'normal',
        },
      ],
    }
  );

  // Convert SVG to PNG using resvg-wasm
  const resvg = new Resvg(svg, {
    fitTo: {
      mode: 'width',
      value: 800,
    },
  });

  const pngData = resvg.render();
  return pngData.asPng();
};

const handleRankCommand = async (
  interaction: DiscordInteraction,
  env: Env
): Promise<{ png: Uint8Array; username: string } | { error: string }> => {
  const userId = interaction.member?.user.id;
  const guildId = interaction.guild_id;
  const username = interaction.member?.user.username || 'Unknown';
  const user = interaction.member?.user;

  if (!userId || !guildId || !user) {
    return { error: 'Не удалось получить информацию о пользователе или сервере.' };
  }

  try {
    // Connect to database
    const db = createClient({
      url: env.DATABASE_URL,
      authToken: env.DATABASE_AUTH_TOKEN,
    });

    // Fetch user stats from database
    const userResult = await db.execute({
      sql: `
        SELECT xp, level, messages_count, voice_seconds
        FROM users
        WHERE user_id = ? AND guild_id = ?
      `,
      args: [userId, guildId],
    });

    if (userResult.rows.length === 0) {
      return { error: `Пользователь **${username}** ещё не начал зарабатывать XP на этом сервере.` };
    }

    const userData = userResult.rows[0];
    const xp = (userData.xp as number) || 0;
    const level = (userData.level as number) || 0;
    const messagesCount = (userData.messages_count as number) || 0;
    const voiceSeconds = (userData.voice_seconds as number) || 0;
    const voiceHours = Math.floor(voiceSeconds / 3600);

    // Get user rank
    const rankResult = await db.execute({
      sql: `
        SELECT COUNT(*) as rank
        FROM users
        WHERE guild_id = ? AND xp > ?
      `,
      args: [guildId, xp],
    });

    const rank = ((rankResult.rows[0]?.rank as number) || 0) + 1;

    // Get total users count
    const totalResult = await db.execute({
      sql: `
        SELECT COUNT(*) as total
        FROM users
        WHERE guild_id = ?
      `,
      args: [guildId],
    });

    const totalUsers = (totalResult.rows[0]?.total as number) || 0;

    // Calculate progress
    const progress = getXpProgress(xp);
    const progressPercent = Math.round(progress.progress);

    // Get avatar URL and status color
    const avatarUrl = getAvatarUrl(user);
    const statusColor = getStatusColor();

    // Render PNG card
    const png = await renderCard({
      username,
      avatarUrl,
      level,
      rank,
      totalUsers,
      xp,
      nextLevelXp: progress.nextLevelXp,
      progress: progressPercent,
      messagesCount,
      voiceHours,
      statusColor,
    });

    return { png, username };
  } catch (err) {
    console.error('[Error] handleRankCommand:', err);
    return { error: 'Произошла ошибка при получении статистики.' };
  }
};

const sendFollowUp = async (
  interactionToken: string,
  applicationId: string,
  botToken: string,
  content?: string,
  file?: { data: Uint8Array; filename: string }
): Promise<Response> => {
  const webhookUrl = `https://discord.com/api/v10/webhooks/${applicationId}/${interactionToken}/messages/@original`;

  const formData = new FormData();

  if (content) {
    formData.append(
      'payload_json',
      JSON.stringify({
        content,
      })
    );
  }

  if (file) {
    formData.append('files[0]', new Blob([file.data], { type: 'image/png' }), file.filename);
  }

  return fetch(webhookUrl, {
    method: 'PATCH',
    headers: {
      Authorization: `Bot ${botToken}`,
    },
    body: formData,
  });
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/interactions') {
      // Get raw body for verification
      const rawBody = await request.text();

      // Verify Discord signature
      const signature = request.headers.get('x-signature-ed25519');
      const timestamp = request.headers.get('x-signature-timestamp');

      if (!signature || !timestamp) {
        return Response.json({ error: 'Missing signature headers' }, { status: 401 });
      }

      const isValid = await verifyDiscordSignature(
        signature,
        timestamp,
        rawBody,
        env.DISCORD_PUBLIC_KEY
      );

      if (!isValid) {
        return Response.json({ error: 'Invalid signature' }, { status: 401 });
      }

      const interaction: DiscordInteraction = JSON.parse(rawBody);

      // Handle PING
      if (interaction.type === 1) {
        return Response.json({ type: 1 });
      }

      // Handle slash command
      if (interaction.type === 2 && interaction.data?.name === 'rank') {
        // Process command in background (use ctx.waitUntil in production)
        setTimeout(async () => {
          try {
            const result = await handleRankCommand(interaction, env);

            if ('error' in result) {
              await sendFollowUp(
                interaction.token,
                env.DISCORD_APPLICATION_ID,
                env.DISCORD_BOT_TOKEN,
                result.error
              );
            } else {
              await sendFollowUp(
                interaction.token,
                env.DISCORD_APPLICATION_ID,
                env.DISCORD_BOT_TOKEN,
                undefined,
                {
                  data: result.png,
                  filename: `rank-${result.username}.png`,
                }
              );
            }
          } catch (err) {
            console.error('[Error] Command processing:', err);
            await sendFollowUp(
              interaction.token,
              env.DISCORD_APPLICATION_ID,
              env.DISCORD_BOT_TOKEN,
              'Произошла ошибка при обработке команды.'
            );
          }
        }, 0);

        // Respond with deferred message (type 5 = DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE)
        return Response.json({
          type: 5,
        });
      }

      return Response.json({ error: 'Unknown interaction type' }, { status: 400 });
    }

    if (url.pathname === '/health') {
      return Response.json({ status: 'ok' });
    }

    return Response.json({ error: 'Not found' }, { status: 404 });
  },
};
