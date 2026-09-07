import { createClient } from '@libsql/client';
import { getXpProgress } from '@shared/types';
import satori from 'satori';
import { Resvg, initWasm } from '@resvg/resvg-wasm';
// @ts-ignore
import resvgWasm from '@resvg/resvg-wasm/index_bg.wasm';
// @ts-ignore
import fontData from '../assets/Inter-Regular.ttf';
import { Card, CardProps } from './Card';

interface Env {
  DATABASE_URL: string;
  DATABASE_AUTH_TOKEN: string;
  DISCORD_PUBLIC_KEY: string;
  DISCORD_APPLICATION_ID: string;
  DISCORD_BOT_TOKEN: string;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

interface DiscordInteraction {
  id: string;
  token: string;
  type: number;
  data?: { name: string };
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

let wasmInitialized = false;

async function ensureWasmInitialized(): Promise<void> {
  if (!wasmInitialized) {
    await initWasm(resvgWasm);
    wasmInitialized = true;
  }
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

async function verifyDiscordSignature(signature: string, timestamp: string, body: string, publicKey: string): Promise<boolean> {
  const message = timestamp + body;
  const encoder = new TextEncoder();
  const messageData = encoder.encode(message);
  const signatureBytes = hexToBytes(signature);
  const publicKeyBytes = hexToBytes(publicKey);
  try {
    const key = await crypto.subtle.importKey('raw', publicKeyBytes, { name: 'Ed25519' } as any, false, ['verify']);
    const isValid = await crypto.subtle.verify('Ed25519', key, signatureBytes, messageData);
    return isValid;
  } catch (err) {
    console.error('[Error] Signature verification failed:', err);
    return false;
  }
}

async function fetchAvatarAsBase64(user: { id: string; avatar: string | null; discriminator: string }): Promise<string> {
  let url = 'https://cdn.discordapp.com/embed/avatars/0.png';
  if (user.avatar) {
    url = `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=256`;
  } else {
    const defaultIndex = (parseInt(user.discriminator, 10) % 5) || 0;
    url = `https://cdn.discordapp.com/embed/avatars/${defaultIndex}.png`;
  }
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch avatar: ${res.statusText}`);
    const buffer = await res.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
    return `data:image/png;base64,${base64}`;
  } catch (err) {
    console.error('Error fetching avatar:', err);
    return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  }
}

async function renderCardToPng(props: CardProps): Promise<Uint8Array> {
  await ensureWasmInitialized();
  const svg = await satori(Card(props), {
    width: 800,
    height: 280,
    fonts: [{ name: 'Inter', data: fontData as ArrayBuffer, weight: 400, style: 'normal' }],
  });
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: 800 } });
  const pngData = resvg.render();
  return pngData.asPng();
}

async function handleRankCommand(interaction: DiscordInteraction, env: Env): Promise<{ png: Uint8Array; username: string } | { error: string }> {
  const userId = interaction.member?.user.id;
  const guildId = interaction.guild_id;
  const user = interaction.member?.user;

  if (!userId || !guildId || !user) {
    return { error: 'Could not get user or server information.' };
  }

  try {
    const db = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });

    const userResult = await db.execute({
      sql: `SELECT xp, messages_count, voice_seconds FROM users WHERE user_id = ? AND guild_id = ?`,
      args: [userId, guildId],
    });

    if (userResult.rows.length === 0) {
      return { error: `User **${user.username}** hasn't started earning XP on this server yet.` };
    }

    const userData = userResult.rows[0];
    const xp = (userData.xp as number) || 0;
    const messagesCount = (userData.messages_count as number) || 0;
    const voiceSeconds = (userData.voice_seconds as number) || 0;
    const voiceHours = Math.floor(voiceSeconds / 3600);

    const rankResult = await db.execute({
      sql: `SELECT COUNT(*) as rank FROM users WHERE guild_id = ? AND xp > ?`,
      args: [guildId, xp],
    });
    const rank = ((rankResult.rows[0]?.rank as number) || 0) + 1;

    const totalResult = await db.execute({
      sql: `SELECT COUNT(*) as total FROM users WHERE guild_id = ?`,
      args: [guildId],
    });
    const totalUsers = (totalResult.rows[0]?.total as number) || 1;

    const level = Math.floor(0.1 * Math.sqrt(xp));
    const progress = getXpProgress(xp);
    const avatarBase64 = await fetchAvatarAsBase64(user);

    const png = await renderCardToPng({
      username: user.username,
      avatarBase64,
      level,
      rank,
      totalUsers,
      xp,
      nextLevelXp: progress.nextLevelXp,
      progress: Math.round(progress.progress),
      messagesCount,
      voiceHours,
      statusColor: '#43b581',
    });

    return { png, username: user.username };
  } catch (err) {
    console.error('[Error] handleRankCommand:', err);
    return { error: 'An error occurred while fetching statistics from the database.' };
  }
}

async function sendFollowUp(token: string, appId: string, botToken: string, result: { png: Uint8Array; username: string } | { error: string }): Promise<Response> {
  const webhookUrl = `https://discord.com/api/v10/webhooks/${appId}/${token}/messages/@original`;
  const formData = new FormData();

  if ('error' in result) {
    formData.append('payload_json', JSON.stringify({ content: result.error }));
  } else {
    formData.append('payload_json', JSON.stringify({ attachments: [{ id: 0, filename: `rank-${result.username}.png`, description: `Rank card for ${result.username}` }] }));
    formData.append('files[0]', new Blob([result.png], { type: 'image/png' }), `rank-${result.username}.png`);
  }

  return fetch(webhookUrl, {
    method: 'PATCH',
    headers: { Authorization: `Bot ${botToken}` },
    body: formData,
  });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/interactions') {
      const rawBody = await request.text();
      const signature = request.headers.get('x-signature-ed25519');
      const timestamp = request.headers.get('x-signature-timestamp');

      if (!signature || !timestamp) {
        return Response.json({ error: 'Missing signature headers' }, { status: 401 });
      }

      const isValid = await verifyDiscordSignature(signature, timestamp, rawBody, env.DISCORD_PUBLIC_KEY);

      if (!isValid) {
        return Response.json({ error: 'Invalid signature' }, { status: 401 });
      }

      const interaction: DiscordInteraction = JSON.parse(rawBody);

      if (interaction.type === 1) {
        return Response.json({ type: 1 });
      }

      if (interaction.type === 2 && interaction.data?.name === 'rank') {
        ctx.waitUntil(
          (async () => {
            try {
              const result = await handleRankCommand(interaction, env);
              const res = await sendFollowUp(interaction.token, env.DISCORD_APPLICATION_ID, env.DISCORD_BOT_TOKEN, result);
              if (!res.ok) {
                console.error('Failed to send follow up:', await res.text());
              }
            } catch (e) {
              console.error('Async task failed:', e);
            }
          })()
        );

        return Response.json({ type: 5 });
      }

      return Response.json({ error: 'Unknown interaction' }, { status: 400 });
    }

    if (url.pathname === '/health') {
      return Response.json({ status: 'ok' });
    }

    return Response.json({ error: 'Not found' }, { status: 404 });
  },
};
