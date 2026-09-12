const fs = require("fs");
const path = "collector/src/collector.ts";
let code = fs.readFileSync(path, "utf8");

if (code.includes("checkExpiredDuels(db")) {
  console.log("✓ Таймер checkExpiredDuels уже был добавлен ранее!");
  process.exit(0);
}

// Определяем, как назван клиент в файле: client или bot
const clientVar = code.includes("const bot = new Client") ? "bot" : "client";

const timerCode = `\n    // Проверка истёкших дуэлей каждые 30 секунд\n    setInterval(() => checkExpiredDuels(db, ${clientVar}), 30000);\n`;

if (code.includes("checkAndSpawnWorldBoss")) {
  code = code.replace(/([^\n]*checkAndSpawnWorldBoss[^\n]*\n)/, "$1" + timerCode);
} else if (code.includes("checkWorldBoss")) {
  code = code.replace(/([^\n]*checkWorldBoss[^\n]*\n)/, "$1" + timerCode);
} else {
  code = code.replace(/(\[Collector\] Ready[^\n]*\n)/, "$1" + timerCode);
}

fs.writeFileSync(path, code, "utf8");
console.log("✓ Таймер checkExpiredDuels успешно внедрён в collector.ts!");
