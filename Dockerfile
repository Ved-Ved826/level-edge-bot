FROM node:20-slim

WORKDIR /app

# Копируем package-файлы для кэширования зависимостей
COPY package*.json ./
COPY collector/package*.json ./collector/
COPY shared/package*.json ./shared/

# Устанавливаем зависимости
RUN npm install

# Копируем исходный код
COPY shared ./shared
COPY collector ./collector

# Собираем shared и collector
RUN npm run build --workspace=shared || true
RUN npm run build --workspace=collector

WORKDIR /app/collector

# Запуск коллектора
CMD ["node", "dist/collector.js"]