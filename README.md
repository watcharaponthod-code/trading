# AlgoTrade — Full-Stack Algorithmic Trading Dashboard

<div align="center">

![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)
![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue?logo=typescript)
![Tailwind CSS](https://img.shields.io/badge/Tailwind-4.x-38bdf8?logo=tailwindcss)
![Alpaca](https://img.shields.io/badge/Alpaca-Markets-FFCA28)
![SQLite](https://img.shields.io/badge/SQLite-Local-003B57?logo=sqlite)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Production-4169E1?logo=postgresql)
![Telegram](https://img.shields.io/badge/Telegram-Bot-2CA5E0?logo=telegram)
![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker)
![Vercel](https://img.shields.io/badge/Vercel-Deploy-000000?logo=vercel)



</div>

---

## ภาพรวมระบบ (System Overview)

AlgoTrade เป็น Full-Stack Trading Dashboard สำหรับ Paper/Live Trading บน Alpaca Markets API ประกอบด้วย:
- **Dashboard UI** — แสดง Portfolio, P&L, ราคาหุ้น, สถานะ Positions และ Orders แบบเรียลไทม์
- **Strategy Engine** — กลยุทธ์ 4 แบบ (Stat-Arb, Mean Reversion, Momentum, Pairs Trading)
- **Auto-Trader** — เครื่องยนต์เทรดอัตโนมัติพร้อม Risk Management
- **Telegram Bot** — แจ้งเตือนผ่าน Telegram ทุก signal และ trade
- **Dual DB** — รองรับ SQLite (local) และ PostgreSQL (production/Vercel)

---

## Architecture Diagram

![Architecture](public/architecture.svg)

---

## Strategy Engine & Risk Management Flow

![Strategy Flow](public/strategy-flow.svg)

---

## Database Schema

![Database Schema](public/database-schema.svg)

---

## Directory Structure

```
trading/
├── app/
│   ├── api/
│   │   ├── account/route.ts       # Alpaca account + positions
│   │   ├── auto-trader/route.ts   # Full auto-trading engine
│   │   ├── crypto-trader/route.ts # Crypto trading endpoint
│   │   ├── db-signals/route.ts    # Trade signals from DB
│   │   ├── db-snapshots/route.ts  # Portfolio snapshots from DB
│   │   ├── db-strategies/route.ts # Strategy configs from DB
│   │   ├── db-trades/route.ts     # Trade history from DB
│   │   ├── market/route.ts        # Market data (bars, quotes)
│   │   ├── orders/route.ts        # Order management
│   │   ├── positions/route.ts     # Position management
│   │   ├── stat-arb/route.ts      # Stat-Arb endpoint
│   │   ├── strategy/route.ts      # Strategy CRUD + execution
│   │   ├── telegram/webhook/      # Telegram bot webhook
│   │   └── trade/route.ts         # Single trade execution
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx                   # Main Trading Dashboard
│
├── components/
│   ├── trading/
│   │   ├── auto-trader-panel.tsx  # Auto-Trader tab
│   │   ├── order-form.tsx         # Order submission form
│   │   ├── orders-table.tsx       # Recent orders
│   │   ├── pnl-chart.tsx          # P&L bar chart
│   │   ├── portfolio-chart.tsx    # Equity line chart
│   │   ├── positions-table.tsx    # Open positions
│   │   ├── price-chart.tsx        # Price/OHLC chart
│   │   ├── stat-arb-panel.tsx     # Stat-Arb panel
│   │   ├── stat-card.tsx          # Summary stat cards
│   │   ├── strategy-panel.tsx     # Strategy selector + runner
│   │   └── watchlist-panel.tsx    # Symbol watchlist
│   └── ui/                        # shadcn/ui components
│
├── lib/
│   ├── advanced-indicators.ts     # Advanced TA indicators
│   ├── alpaca.ts                  # Alpaca API wrapper
│   ├── db.ts                      # DB layer (SQLite + PostgreSQL)
│   ├── enhanced-strategy.ts       # Enhanced strategy logic
│   ├── migrate.ts                 # DB migrations
│   ├── risk-manager.ts            # Risk management engine
│   ├── stat-arb-engine.ts         # Statistical arbitrage engine
│   ├── strategy.ts                # Core strategy implementations
│   ├── telegram-bot.ts            # Telegram bot client
│   ├── telegram.ts                # Telegram utilities
│   └── utils.ts                   # Utility functions
│
├── scripts/
│   ├── 001-create-tables.sql      # DB schema
│   ├── auto-trader-worker.js      # PM2 polling worker
│   ├── notify-deploy.ts           # Deploy notification
│   ├── setup-telegram.ts          # Telegram webhook setup
│   ├── streaming-worker.js        # WebSocket streaming worker
│   └── test-strategy.js           # Strategy testing script
│
├── .env.example                   # Environment variables template
├── Dockerfile                     # Docker image definition
├── ecosystem.config.js            # PM2 process config (Docker/VPS)
├── next.config.mjs                # Next.js config
└── package.json
```

---

## Tech Stack

| Category | Technology | Purpose |
|---|---|---|
| **Framework** | Next.js 16 | Full-stack React framework |
| **Language** | TypeScript 5.7 | Type-safe development |
| **UI** | shadcn/ui + Radix UI | Component library |
| **Styling** | Tailwind CSS 4 | Utility-first CSS |
| **Charts** | Recharts | Portfolio & price charts |
| **Broker API** | Alpaca Markets | Paper & live trading |
| **DB (Local)** | SQLite (better-sqlite3) | Local development |
| **DB (Prod)** | PostgreSQL (pg/Neon) | Production deployment |
| **Notifications** | Telegram Bot API | Trade & signal alerts |
| **Process Mgmt** | PM2 | Docker/VPS worker management |
| **Deployment** | Vercel | Cloud hosting |
| **CI/CD** | GitHub Actions | Auto-deploy to Vercel |

---

## Features

### Trading Dashboard
- **Real-time Watchlist** — 10 symbols (SPY, QQQ, AAPL, MSFT, TSLA, NVDA, AMD, GOOGL, GLD, SLV) with live price & % change
- **Portfolio Equity Chart** — Alpaca portfolio history (1D, 5Min bars)
- **P&L Bar Chart** — Last 30 snapshots from DB
- **Price Chart** — OHLC bars for any symbol (1Min to 1Day timeframes)
- **Open Positions** — Close positions directly from UI
- **Orders Table** — Cancel individual or all open orders

### Strategy Engine
- **Statistical Arbitrage** — Z-score on spread between 2 correlated assets (SPY/QQQ)
- **Mean Reversion** — Bollinger Bands + RSI oversold/overbought (AAPL, MSFT, GOOGL, META, TSLA)
- **EMA Momentum** — EMA(9) vs EMA(21) crossover + MACD + VWAP confirmation (NVDA, AMD, TSLA)
- **Pairs Trading** — Dollar-neutral long/short on correlated pairs (GLD/SLV)
- **Auto-Run** — Run strategy every 60s automatically from browser

### Auto-Trader Engine
- Scans 16 symbols for momentum + mean reversion signals
- Monitors 5 pre-defined stat-arb pairs
- Auto Take-Profit at +2.5%, Stop-Loss at -1.5%
- Cancels stale orders older than 10 minutes
- Saves portfolio snapshot after each cycle

### Risk Management
- **Kelly Criterion** (Half-Kelly) — Optimal position sizing
- **ATR Position Sizing** — Risk 1% of equity per trade
- **Max Position Size** — 5% of equity per symbol
- **Portfolio Heat Limit** — Max 20% total exposure
- **Daily Loss Circuit Breaker** — Halts trading at -3% daily loss
- **Drawdown Protection** — Pauses at -8% drawdown

### Telegram Bot
- Commands: `/status`, `/positions`, `/signals`, `/trades`, `/performance`, `/settings`
- Real-time notifications for signal generation and trade execution
- Inline keyboards for quick actions
- Deployment notifications on app start

---

## Environment Variables

```bash
# ─── Alpaca API (required) ────────────────────────────────────────────────────
ALPACA_API_KEY=your_api_key_here
ALPACA_API_SECRET=your_api_secret_here
ALPACA_BASE_URL=https://paper-api.alpaca.markets/v2  # paper trading (default)

# ─── Database ─────────────────────────────────────────────────────────────────
# PostgreSQL for Vercel/production (leave blank to use local SQLite)
DATABASE_URL=postgresql://user:password@host/database

# ─── Telegram Bot (optional) ──────────────────────────────────────────────────
TELEGRAM_BOT_TOKEN=your_bot_token_here
TELEGRAM_WEBHOOK_URL=https://your-app.vercel.app/api/telegram/webhook
TELEGRAM_ADMIN_CHAT_IDS=123456789,987654321

# ─── App Config ───────────────────────────────────────────────────────────────
NEXT_PUBLIC_APP_URL=http://localhost:3000
NODE_ENV=development

# ─── Worker Config (Docker/VPS only) ─────────────────────────────────────────
WORKER_BASE_URL=http://localhost:3000
WORKER_DRY_RUN=true
```

---

## Quick Start

### Local Development

```bash
# 1. Clone
git clone https://github.com/watcharaponthod-code/trading.git
cd trading

# 2. Install dependencies
npm install

# 3. Setup environment
cp .env.example .env.local
# Edit .env.local — add your ALPACA_API_KEY and ALPACA_API_SECRET

# 4. Run dev server
npm run dev
# Open http://localhost:3000
```

### Docker (Self-Hosted with PM2 Workers)

```bash
# Build & run
docker build -t algotrade .
docker run -p 3000:3000 \
  -e ALPACA_API_KEY=xxx \
  -e ALPACA_API_SECRET=xxx \
  algotrade

# Includes:
#   - Next.js web server (port 3000)
#   - WebSocket streaming worker (real-time signals)
#   - Polling worker (backup, every 60s)
```

### Vercel Deployment

1. Push to GitHub
2. Connect repo in Vercel dashboard
3. Set environment variables: `ALPACA_API_KEY`, `ALPACA_API_SECRET`, `DATABASE_URL`
4. Deploy — CI/CD via `.github/workflows/vercel-deploy.yml`

> **Important:** Vercel requires `DATABASE_URL` (PostgreSQL) since SQLite does not run in serverless.
> Use [Neon](https://neon.tech) or [Supabase](https://supabase.com) for a free PostgreSQL database.

---

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/account` | Account info, positions, portfolio history |
| GET | `/api/market` | Market data (latest bars / historical bars) |
| GET | `/api/orders` | List orders |
| DELETE | `/api/orders` | Cancel order or all orders |
| GET | `/api/positions` | Open positions |
| DELETE | `/api/positions` | Close position |
| POST | `/api/trade` | Submit a trade order |
| GET | `/api/strategy` | List strategy configs |
| POST | `/api/strategy` | Run strategy (dry or live) |
| PATCH | `/api/strategy` | Update strategy config |
| GET | `/api/auto-trader` | Auto-trader engine status |
| POST | `/api/auto-trader` | Run one auto-trader cycle |
| GET | `/api/db-trades` | Trade history from DB |
| GET | `/api/db-signals` | Signal log from DB |
| GET | `/api/db-strategies` | Strategy configs from DB |
| GET | `/api/db-snapshots` | Portfolio snapshots from DB |
| POST | `/api/telegram/webhook` | Telegram bot webhook handler |

---

## Notes & Limitations

- **Paper Trading by default** — Set `ALPACA_BASE_URL=https://api.alpaca.markets/v2` for live trading (use with caution)
- **SQLite on local only** — Vercel requires PostgreSQL (`DATABASE_URL`)
- **Background workers** — `streaming-worker.js` and `auto-trader-worker.js` require Docker/PM2 on a VPS; they do NOT run on Vercel serverless
- **Market hours** — Auto-trader returns `market_closed` outside NYSE hours unless `forceRun: true` is passed
