\---

paths:

&#x20; - "worker/\*\*"

\---

\# Регламент подсистемы Worker (Cloudflare Workers / Edge)



\- \*\*Среда\*\*: V8 Isolates (Cloudflare Workers).

\- ❌ \*\*Запрет Node API\*\*: Никаких `fs`, `child\_process`, `net`, нативного `crypto`.

\- \*\*Discord Interactions (лимит 3 секунды)\*\*:

&#x20; - Если обработчик делает >2 внешних запросов к Turso или сторонний `fetch`:

&#x20;   - ❌ Ответ `type: 4` запрещен.

&#x20;   - ✅ Сразу вернуть `type: 5` (DEFERRED), выполнить логику и обновить вебхук `@original`.

\- \*\*БД\*\*: Использовать HTTP-драйвер `@libsql/client/web` (через fetch), а не сокетный транспорт.

\- \*\*Satori + WASM карточки\*\*:

&#x20; - Верстка строго на Flexbox (`display: flex`, `flexDirection`). CSS Grid, float и псевдоэлементы не поддерживаются Yoga.

&#x20; - Шрифты грузить как `ArrayBuffer` один раз и кэшировать в памяти изолята.

&#x20; - Не генерировать гигантские Base64 строк `data:image`.

