import { calculateLevel, getXpProgress } from '@shared/types';

interface Env {
  DATABASE_URL: string;
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
  };
  member?: {
    user: {
      id: string;
      username: string;
      avatar: string;
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

const handleRankCommand = async (
  interaction: DiscordInteraction,
  env: Env
): Promise<string> => {
  const userId = interaction.member?.user.id;
  const guildId = interaction.guild_id;
  const username = interaction.member?.user.username || 'Unknown';

  if (!userId || !guildId) {
    return 'Не удалось получить информацию о пользователе или сервере.';
  }

  try {
    // Placeholder data for now - will be replaced with actual DB queries
    const xp = 1500;
    const level = calculateLevel(xp);
    const messagesCount = 152;
    const voiceSeconds = 18000; // 5 hours
    const voiceHours = Math.floor(voiceSeconds / 3600);
    const rank = 4;
    const totalUsers = 1500;

    const progress = getXpProgress(xp);
    const progressPercent = Math.round(progress.progress);

    const progressBar =
      '█'.repeat(Math.floor(progressPercent / 5)) +
      '░'.repeat(20 - Math.floor(progressPercent / 5));

    return `
📊 **Статистика ${username}**

⭐ Уровень: **${level}**
🏆 Позиция: **#${rank} из ${totalUsers}**
💬 Сообщений: **${messagesCount}**
🎙️ В войсе: **${voiceHours}ч**

📈 XP: **${xp}** / ${progress.nextLevelXp}
${progressBar} ${progressPercent}%
    `.trim();
  } catch (err) {
    console.error('[Error] handleRankCommand:', err);
    return 'Произошла ошибка при получении статистики.';
  }
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
        // Respond with deferred message (type 5 = DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE)
        const deferResponse = Response.json({
          type: 5,
        });

        // Process command in background
        (async () => {
          try {
            const rankMessage = await handleRankCommand(interaction, env);

            const webhookUrl = `https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${interaction.token}`;

            await fetch(webhookUrl, {
              method: 'PATCH',
              headers: {
                'Authorization': `Bot ${env.DISCORD_BOT_TOKEN}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                content: rankMessage,
              }),
            });
          } catch (err) {
            console.error('[Error] Command processing:', err);
          }
        })();

        return deferResponse;
      }

      return Response.json({ error: 'Unknown interaction type' }, { status: 400 });
    }

    if (url.pathname === '/health') {
      return Response.json({ status: 'ok' });
    }

    return Response.json({ error: 'Not found' }, { status: 404 });
  },
};
