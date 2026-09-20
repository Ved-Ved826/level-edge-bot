import { createClient } from "@libsql/client";

import { CommandInteraction, Env, ExecutionContext } from "../types";
import { getSeasonId } from "../exchange/season";

// Минимальный порог вложений для попадания в рейтинг ROI
const MIN_INVESTED_COINS = 500;
// Сколько лидеров показываем в каждой категории
const TOP_LIMIT = 3;

interface InvestorRating {
  targetId: string;
  invested: number;
  returned: number;
  roiBps: number;
}

interface CompanyRating {
  targetId: string;
  label: string;
  invested: number;
  returned: number;
  roiBps: number;
}

const MEDALS = ['🥇', '🥈', '🥉'];

function positionLabel(idx: number): string {
  return MEDALS[idx] || `#${idx + 1}`;
}

function formatRoi(roiBps: number): string {
  const pct = roiBps / 100;
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
}

function formatCoins(value: number): string {
  return Math.round(value).toLocaleString('ru-RU');
}

/**
 * /exchange-top — рейтинг инвесторов и компаний сезона по доходности (ROI).
 *
 * Текущий сезон: живой агрегат по company_trades (вложения от 500 🪙).
 * Прошлый сезон: готовые итоги из season_results, зафиксированные при
 * сезонной ликвидации (см. liquidateCompaniesOnSeasonChange в collector).
 */
export async function handleExchangeTop(inter: CommandInteraction, env: Env, _ctx: ExecutionContext): Promise<Response> {
  const db = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });
  const guildId = inter.guild_id;

  if (!guildId) {
    return Response.json({ type: 4, data: { content: "❌ Команда доступна только на сервере.", flags: 64 } });
  }

  const seasonOption = inter.data?.options?.find((o) => o.name === "season")?.value;
  const season = (typeof seasonOption === "string" && seasonOption.trim().length > 0)
    ? seasonOption.trim()
    : getSeasonId();
  const isCurrentSeason = season === getSeasonId();

  try {
    let investors: InvestorRating[] = [];
    let companies: CompanyRating[] = [];

    if (isCurrentSeason) {
      // Живой рейтинг: агрегат сделок текущего сезона
      const tradesResult = await db.execute({
        sql: `SELECT user_id,
                     SUM(CASE WHEN side = 'buy' THEN coins ELSE 0 END) AS invested,
                     SUM(CASE WHEN side = 'sell' THEN coins ELSE 0 END) AS returned
              FROM company_trades
              WHERE guild_id = ? AND season_id = ?
              GROUP BY user_id`,
        args: [guildId, season],
      });

      investors = (tradesResult.rows || [])
        .map((r) => ({
          targetId: String(r.user_id),
          invested: Number(r.invested) || 0,
          returned: Number(r.returned) || 0,
        }))
        .filter((r) => r.invested >= MIN_INVESTED_COINS)
        .map((r) => ({
          targetId: r.targetId,
          invested: r.invested,
          returned: r.returned,
          roiBps: Math.round(((r.returned - r.invested) / r.invested) * 10000),
        }))
        .sort((a, b) => b.roiBps - a.roiBps)
        .slice(0, TOP_LIMIT);
    } else {
      // Прошлый сезон: готовые итоги из season_results
      const resultsResult = await db.execute({
        sql: `SELECT kind, target_id, label, invested, returned, roi_bps
              FROM season_results
              WHERE guild_id = ? AND season_id = ?
              ORDER BY kind ASC, rank ASC`,
        args: [guildId, season],
      });

      for (const r of resultsResult.rows || []) {
        if (String(r.kind) === "investor") {
          investors.push({
            targetId: String(r.target_id),
            invested: Number(r.invested) || 0,
            returned: Number(r.returned) || 0,
            roiBps: Number(r.roi_bps) || 0,
          });
        } else if (String(r.kind) === "company") {
          companies.push({
            targetId: String(r.target_id),
            label: String(r.label || "???"),
            invested: Number(r.invested) || 0,
            returned: Number(r.returned) || 0,
            roiBps: Number(r.roi_bps) || 0,
          });
        }
      }
    }

    const fields: { name: string; value: string; inline: boolean }[] = [];

    if (investors.length > 0) {
      fields.push({
        name: isCurrentSeason ? "📈 Инвесторы (live-рейтинг)" : "📈 Инвесторы сезона",
        value: investors.map((inv, idx) =>
          `${positionLabel(idx)} <@${inv.targetId}> — **${formatRoi(inv.roiBps)}** ` +
          `(вложено ${formatCoins(inv.invested)} 🪙, вернулось ${formatCoins(inv.returned)} 🪙)`
        ).join("\n"),
        inline: false,
      });
    }

    if (companies.length > 0) {
      fields.push({
        name: "🏢 Компании сезона",
        value: companies.map((c, idx) =>
          `${positionLabel(idx)} **${c.label}** — казна ${formatCoins(c.returned)} 🪙 • ROI ${formatRoi(c.roiBps)}`
        ).join("\n"),
        inline: false,
      });
    }

    if (fields.length === 0) {
      const hint = isCurrentSeason
        ? `В текущем сезоне ещё нет инвесторов с вложениями от ${MIN_INVESTED_COINS} 🪙. Купите акции через \`/invest\`!`
        : "По этому сезону нет сохранённых итогов (сезон закрылся до введения рейтинга ROI или прошёл без сделок).";
      return Response.json({
        type: 4,
        data: {
          embeds: [{
            title: `🏆 Рейтинг ROI • ${season}`,
            description: hint,
            color: 0x5865F2,
          }],
          flags: 64,
        },
      });
    }

    const embed = {
      title: `🏆 Рейтинг ROI • ${season}${isCurrentSeason ? " • сезон идёт" : ""}`,
      description: isCurrentSeason
        ? "Доходность считается по сделкам текущего сезона. Финальные итоги зафиксируются при ликвидации сезона."
        : "Финальные итоги сезона, зафиксированные при ликвидации компаний.",
      color: 0xF1C40F,
      fields,
      footer: { text: `Порог рейтинга: вложения от ${MIN_INVESTED_COINS} 🪙 • ROI = (вернулось − вложено) / вложено` },
    };

    return Response.json({ type: 4, data: { embeds: [embed], flags: 64 } });
  } catch (e: any) {
    console.error("[ExchangeTop] Error:", e);
    return Response.json({
      type: 4,
      data: { content: `❌ Ошибка рейтинга биржи: ${String(e?.message || e).slice(0, 500)}`, flags: 64 },
    });
  }
}
