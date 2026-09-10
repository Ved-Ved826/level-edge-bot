#!/data/data/com.termux/files/usr/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "🔧 Настройка LevelEdge Bot для Termux (Samsung A25 / arm64)"
echo "📁 Директория проекта: $SCRIPT_DIR"

termux-wake-lock

echo "📦 Установка зависимостей (--ignore-scripts, обход сборки workerd под arm64)..."
npm install --force --ignore-scripts

echo "🏗️  Сборка shared и collector..."
npm run build -w shared
npm run build -w collector

if ! command -v pm2 &> /dev/null; then
  echo "📥 Установка PM2..."
  npm install -g pm2
fi

mkdir -p "$HOME/.termux/boot"
cat > "$HOME/.termux/boot/start-bot.sh" << EOF
#!/data/data/com.termux/files/usr/bin/bash
termux-wake-lock
cd "$SCRIPT_DIR"
pm2 resurrect
EOF
chmod +x "$HOME/.termux/boot/start-bot.sh"

echo "🚀 Запуск бота через PM2..."
cd "$SCRIPT_DIR/collector"
pm2 start dist/collector.js --name disbot
pm2 save

echo "✅ Готово! Бот запущен и настроен на автозапуск при загрузке устройства."
