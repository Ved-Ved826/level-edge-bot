const fs = require('fs');
const dotenv = require('dotenv');

let envConfig = {};
if (fs.existsSync('collector/.env')) {
  envConfig = dotenv.parse(fs.readFileSync('collector/.env'));
} else if (fs.existsSync('.env')) {
  envConfig = dotenv.parse(fs.readFileSync('.env'));
}

const url = envConfig.DATABASE_URL || process.env.DATABASE_URL;
const authToken = envConfig.DATABASE_AUTH_TOKEN || process.env.DATABASE_AUTH_TOKEN;

const { createClient } = require('@libsql/client');
const db = createClient({ url, authToken });

async function run() {
  const userId = "912191843729547376";
  const amount = 15000;

  // Начисляем монеты
  await db.execute({
    sql: "UPDATE users SET coins = coins + ? WHERE user_id = ?",
    args: [amount, userId]
  });

  // Проверяем итоговый баланс
  const check = await db.execute({
    sql: "SELECT user_id, coins, level FROM users WHERE user_id = ?",
    args: [userId]
  });

  console.log(`✓ Успешно начислено ${amount} 🪙!`);
  console.log(`Пользователь: ${userId}`);
  console.log(`Новый баланс: ${check.rows[0]?.coins} 🪙`);
}

run().catch(console.error);
