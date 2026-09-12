// Команда /quests: ежедневные задания.

import { createClient } from "@libsql/client";
import { CommandInteraction, Env, ExecutionContext } from "../types";
import { ensureDailyQuests, getUserQuestProgress } from "../db/queries";
import { getVladivostokDate, renderProgressBar } from "../utils/formatters";

export function buildQuestsEmbed(questProgress: any, today: string) {
  let description = "";
  if (questProgress.quests.length === 0) {
    description = "Сегодня квестов нет. Приходите завтра!";
  } else {
    questProgress.quests.forEach((q: any) => {
      const progress = q.current_progress;
      const target = q.target;
      const completed = q.completed_at !== null;
      if (completed) {
        description += `✅ **${q.title}** — ${q.description}\n`;
        description += `\`[██████████]\` **${target} / ${target}** • **Выполнено! (+${q.reward_xp} XP)**\n\n`;
      } else {
        const bar = renderProgressBar(progress, target, 10);
        const percent = target > 0 ? Math.round((progress / target) * 100) : 0;
        const typeIcon = q.quest_type === "voice" ? "🎙" : "💬";
        description += `${typeIcon} **${q.title}** — *${q.description}*\n`;
        description += `\`[${bar}]\` **${progress} / ${target}** (${percent}%) • Награда: **+${q.reward_xp} XP**\n\n`;
      }
    });
  }
  return {
    embeds: [
      {
        title: `🎯 Ежедневные квесты на ${today}`,
        description: description,
        color: 0x5865f2,
        footer: { text: `Сброс квестов каждый день в 00:00 (Владивосток, UTC+10)` },
      },
    ],
  };
}

export async function handleQuests(
  inter: CommandInteraction,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const gid = inter.guild_id;
  const uid = inter.member?.user.id;
  if (!gid || !uid) return Response.json({ error: "No guild or user" }, { status: 400 });
  ctx.waitUntil(
    (async () => {
      try {
        const db = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });
        await ensureDailyQuests(db, gid);
        const questProgress = await getUserQuestProgress(db, uid, gid);
        const today = getVladivostokDate();
        const result = buildQuestsEmbed(questProgress, today);
        const resp = await fetch(`https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${inter.token}/messages/@original`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(result),
        });
        if (!resp.ok) console.error("Quests update fail:", await resp.text());
      } catch (e) {
        console.error("Quests error:", e);
      }
    })()
  );
  return Response.json({ type: 5 });
}
