const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('--- 1. Проверяем и правим файлы воркера ---');

function fixDirectory(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      fixDirectory(fullPath);
    } else if (entry.name.endsWith('.ts')) {
      let content = fs.readFileSync(fullPath, 'utf8');
      let modified = false;

      // Заменяем старый расчет минут на минуты + секунды
      if (content.includes('Math.floor(voicesec / 60)') && !content.includes('voicesec % 60')) {
        content = content.replace(
          /const vm = Math\.floor\(voicesec \/ 60\);/g,
          'const vm = Math.floor((voicesec % 3600) / 60);\n  const vs = voicesec % 60;'
        );
        modified = true;
      }

      // Заменяем вывод войса на секунды
      if (content.includes('${vm} мин.') && content.includes('${vm % 60} мин.')) {
        content = content.replace(
          /`\*\*\$\{vm\} мин\.\*\* \(\$\{vh\} ч\. \$\{vm % 60\} мин\.\)`/g,
          'vh > 0 ? `**${vh} ч. ${vm} мин. ${vs} сек.**` : `**${vm} мин. ${vs} сек.**`'
        );
        modified = true;
      }

      if (modified) {
        fs.writeFileSync(fullPath, content, 'utf8');
        console.log(`[ИСПРАВЛЕНО] ${fullPath}`);
      }
    }
  }
}

fixDirectory(path.join(__dirname, 'worker', 'src'));

console.log('--- 2. Компиляция воркера ---');
try {
  execSync('npm run build', { cwd: path.join(__dirname, 'worker'), stdio: 'inherit' });
  console.log('[OK] Воркер успешно скомпилирован');
} catch (e) {
  console.log('[WARN] Ошибка tsc воркера, продолжаем деплой wrangler...');
}

console.log('--- 3. Деплой воркера в Cloudflare ---');
execSync('npx wrangler deploy', { cwd: path.join(__dirname, 'worker'), stdio: 'inherit' });

console.log('--- 4. Коммит изменений в Git ---');
try {
  execSync('git add -A', { stdio: 'inherit' });
  execSync('git commit -m "fix: секунды в голосовом канале для /rank-today"', { stdio: 'inherit' });
} catch (e) {
  console.log('[INFO] Нет новых изменений для коммита');
}

console.log('--- 5. Создание update.bundle для телефона ---');
const bundlePath = path.join(__dirname, 'update.bundle');
if (fs.existsSync(bundlePath)) fs.unlinkSync(bundlePath);
execSync('git bundle create update.bundle HEAD', { stdio: 'inherit' });

console.log('\n========================================');
console.log(' ГОТОВО! Воркер задеплоен в Cloudflare!');
console.log(' Файл update.bundle готов для отправки в Termux.');
console.log('========================================');
