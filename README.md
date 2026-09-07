# LevelEdge — Discord Level Bot

Edge-first, free-tier Discord level tracking bot with serverless architecture.

## Project Structure

```
level-edge/
├── shared/           # @shared/types — common types and utilities
├── collector/        # Collector daemon (Node.js/Bun + discord.js)
├── worker/          # Cloudflare Worker (TypeScript)
└── CLAUDE.md        # Project specification
```

## Setup

```bash
# Install dependencies (uses npm workspaces)
npm install

# Build all packages
npm run build -w shared && npm run build -w collector && npm run build -w worker

# Dev mode
npm run dev -w collector    # Collector daemon with live reload
npm run dev -w worker       # Worker with wrangler dev
```

## Environment Variables

### Collector (`.env`)
```
DISCORD_TOKEN=your_bot_token
DATABASE_URL=libsql://...
DATABASE_AUTH_TOKEN=your_auth_token
```

### Worker
Secrets via `wrangler secret put DISCORD_BOT_TOKEN`
