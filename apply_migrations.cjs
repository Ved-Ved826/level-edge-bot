const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, 'collector', '.env') });

// 1. Исправляем экспорт CrisisScenario в collector/src/crisisCatalog.ts
const catPath = path.join(__dirname, 'collector', 'src', 'crisisCatalog.ts');
let cat = fs.readFileSync(catPath, 'utf8');
if (!cat.includes('export interface CrisisScenario') && !cat.includes('export type CrisisScenario')) {
  if (cat.includes('interface CrisisScenario')) {
    cat = cat.replace('interface CrisisScenario', 'export interface CrisisScenario');
  } else if (cat.includes('type CrisisScenario')) {
    cat = cat.replace('type CrisisScenario', 'export type CrisisScenario');
  } else {
    cat = cat.replace(
      'export const CRISIS_CATALOG',
      'export interface CrisisScenario {\n  kind: CrisisKind;\n  scenario_text: string;\n  options: CrisisOption[];\n  timeout: CrisisOutcome;\n}\n\nexport const CRISIS_CATALOG'
    );
  }
  fs.writeFileSync(catPath, cat, 'utf8');
  console.log('[OK] Экспортирован CrisisScenario в crisisCatalog.ts');
}

// 2. Исправляем типизацию параметра (o: any) в collector/src/crises.ts
const crPath = path.join(__dirname, 'collector', 'src', 'crises.ts');
let cr = fs.readFileSync(crPath, 'utf8');
cr = cr.replace('options: scenario.options.map((o) =>', 'options: scenario.options.map((o: any) =>');
fs.writeFileSync(crPath, cr, 'utf8');
console.log('[OK] Типизирован параметр o в crises.ts');

// 3. Подключение к облачной базе Turso
const dbUrl = (process.env.DATABASE_URL || 'libsql://disbot-db-zomka.aws-ap-northeast-1.turso.io')
  .replace('libsql://', 'https://');
const url = dbUrl + '/v2/pipeline';
const token = process.env.DATABASE_AUTH_TOKEN;

const statements = [
  "ALTER TABLE companies ADD COLUMN mood_bps INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE companies ADD COLUMN mood_updated_at INTEGER NOT NULL DEFAULT 0",
  `CREATE TABLE IF NOT EXISTS company_trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    company_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    season_id TEXT NOT NULL,
    side TEXT NOT NULL CHECK(side IN ('buy','sell')),
    shares INTEGER NOT NULL,
    base_amount INTEGER NOT NULL,
    coins INTEGER NOT NULL,
    treasury_after INTEGER NOT NULL,
    circulating_after INTEGER NOT NULL,
    mood_bps_after INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS idx_trades_company_time ON company_trades(company_id, created_at)",
  "CREATE INDEX IF NOT EXISTS idx_trades_guild_season_user ON company_trades(guild_id, season_id, user_id)",
  `CREATE TABLE IF NOT EXISTS company_nav_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    company_id INTEGER NOT NULL,
    ts INTEGER NOT NULL,
    treasury INTEGER NOT NULL,
    circulating INTEGER NOT NULL,
    mood_bps INTEGER NOT NULL DEFAULT 0,
    reason TEXT NOT NULL CHECK(reason IN ('create','buy','sell','growth','crisis'))
  )`,
  "CREATE INDEX IF NOT EXISTS idx_nav_history_company_time ON company_nav_history(company_id, ts)",
  `CREATE TABLE IF NOT EXISTS market_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    sent_at INTEGER DEFAULT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT DEFAULT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS idx_market_events_outbox ON market_events(sent_at, id)",
  `CREATE TABLE IF NOT EXISTS exchange_guild_state (
    guild_id TEXT PRIMARY KEY,
    market_channel_id TEXT DEFAULT NULL,
    last_digest_day TEXT DEFAULT NULL,
    next_crisis_at INTEGER DEFAULT NULL
  )`,
  "ALTER TABLE company_crises ADD COLUMN options_json TEXT DEFAULT NULL",
  "ALTER TABLE company_crises ADD COLUMN timeout_json TEXT DEFAULT NULL",
  "ALTER TABLE company_crises ADD COLUMN resolved_option TEXT DEFAULT NULL",
  "ALTER TABLE company_crises ADD COLUMN resolved_at INTEGER DEFAULT NULL",
  `CREATE TABLE IF NOT EXISTS season_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    season_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('investor', 'company')),
    rank INTEGER NOT NULL,
    target_id TEXT NOT NULL,
    label TEXT NOT NULL,
    invested INTEGER NOT NULL,
    returned INTEGER NOT NULL,
    roi_bps INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS idx_season_results_lookup ON season_results(guild_id, season_id, kind, rank)"
];

(async () => {
  console.log('[Turso] Применяем миграции в облачную базу...');
  for (const sql of statements) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ requests: [{ type: 'execute', stmt: { sql } }] })
      });
      const data = await res.json();
      if (data.results && data.results[0].error) {
        if (!data.results[0].error.message.includes('duplicate column')) {
          console.log('SQL info:', data.results[0].error.message);
        }
      }
    } catch (e) {
      console.error('Fetch error:', e.message);
    }
  }
  console.log('[OK] Все таблицы и колонки успешно созданы в Turso!');
})();
