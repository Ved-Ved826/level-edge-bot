const fs = require('fs');
const path = require('path');

// 1. Исправляем 2 ошибки TypeScript в коллекторе
const catalogPath = path.join(__dirname, 'collector', 'src', 'crisisCatalog.ts');
if (fs.existsSync(catalogPath)) {
  let catContent = fs.readFileSync(catalogPath, 'utf8');
  if (!catContent.includes('export interface CrisisScenario')) {
    catContent = catContent.replace(
      'export const CRISIS_CATALOG: {',
      'export interface CrisisScenario {\n  kind: CrisisKind;\n  scenario_text: string;\n  options: CrisisOption[];\n  timeout: CrisisOutcome;\n}\n\nexport const CRISIS_CATALOG: CrisisScenario[] = ['
    );
    catContent = catContent.replace(/}\[\]\s*=\s*\[/, '');
    fs.writeFileSync(catalogPath, catContent, 'utf8');
    console.log('[OK] Исправлен collector/src/crisisCatalog.ts (экспортирован CrisisScenario)');
  }
}

const crisesPath = path.join(__dirname, 'collector', 'src', 'crises.ts');
if (fs.existsSync(crisesPath)) {
  let crContent = fs.readFileSync(crisesPath, 'utf8');
  crContent = crContent.replace(
    'options: scenario.options.map((o) =>',
    'options: scenario.options.map((o: any) =>'
  );
  fs.writeFileSync(crisesPath, crContent, 'utf8');
  console.log('[OK] Исправлен collector/src/crises.ts (типизирован параметр o)');
}

// 2. Накатываем миграции в облачную базу Turso
const envPath = path.join(__dirname, 'collector', '.env');
const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
  const m = line.match(/^([^=]+)=(.*)$/);
  if (m) env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
});

const url = env.DATABASE_URL.replace('libsql://', 'https://') + '/v2/pipeline';
const token = env.DATABASE_AUTH_TOKEN;

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
        // Игнорируем ошибку "колонка уже существует"
        if (!data.results[0].error.message.includes('duplicate column')) {
          console.log('SQL Warning:', data.results[0].error.message);
        }
      }
    } catch (e) {
      console.error('Fetch error:', e);
    }
  }
  console.log('[OK] Все таблицы и колонки успешно созданы в Turso!');
})();
