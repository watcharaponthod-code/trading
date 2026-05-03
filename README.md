# AlgoTrade — Full-Stack Algorithmic Trading Dashboard

<div align="center">

![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)
![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue?logo=typescript)
![Tailwind CSS](https://img.shields.io/badge/Tailwind-4.x-38bdf8?logo=tailwindcss)
![Alpaca](https://img.shields.io/badge/Alpaca-Markets-FFCA28)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Neon-4169E1?logo=postgresql)
![Telegram](https://img.shields.io/badge/Telegram-Bot-2CA5E0?logo=telegram)
![Vercel](https://img.shields.io/badge/Vercel-Deploy-000000?logo=vercel)
[![Live Demo](https://img.shields.io/badge/Live-Demo-green?logo=vercel)](https://trading-jet-iota.vercel.app)

</div>

---

## Dashboard Preview

![AlgoTrade Dashboard](docs/dashboard.png)

> AlgoTrade Dashboard — แสดง Portfolio Equity, Open Positions, P&L History และ Auto-Trade Engine แบบ Real-time

---

## ภาพรวมระบบ (System Overview)

AlgoTrade เป็น Full-Stack Algorithmic Trading Dashboard สำหรับ Paper/Live Trading บน Alpaca Markets API

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Vercel (Free)                         │
│                                                             │
│  ┌──────────────┐    ┌─────────────────────────────────┐   │
│  │  Next.js UI  │    │        API Routes (Serverless)   │   │
│  │  Dashboard   │    │  /api/auto-trader  (stocks)      │   │
│  │  Charts      │    │  /api/crypto-trader (crypto)     │   │
│  │  Watchlist   │    │  /api/account, /api/positions    │   │
│  └──────────────┘    └─────────────────────────────────┘   │
│                                          ↑                  │
│  ┌───────────────────────────────────────┤                  │
│  │      Vercel Cron Jobs (every 1 min)   │                  │
│  │  GET /api/cron/trade   ──────────────►│                  │
│  │  GET /api/cron/crypto  ──────────────►│                  │
│  └───────────────────────────────────────┘                  │
└─────────────────────────────────────────────────────────────┘
              │                        │
              ▼                        ▼
   ┌─────────────────┐      ┌──────────────────┐
   │  Alpaca Markets │      │   Neon PostgreSQL │
   │  Paper/Live API │      │   (Trade History) │
   │  Stocks + Crypto│      │   Signals, Orders │
   └─────────────────┘      └──────────────────┘
              │
              ▼
   ┌─────────────────┐
   │  Telegram Bot   │
   │  Trade Alerts   │
   └─────────────────┘
```

---

## Features

- **Auto-Trader** — รัน strategy engine ทุก 1 นาทีผ่าน Vercel Cron Jobs (ไม่ต้องมี server แยก)
- **4 Strategies** — Momentum, Mean Reversion, Stat-Arb, Pairs Trading
- **Crypto 24/7** — BTC, ETH, SOL, AVAX, DOGE trade ได้ตลอดเวลา
- **Risk Management** — Portfolio heat limit, daily P&L cutoff, stale order cleanup
- **Real-time Dashboard** — Portfolio equity chart, P&L history, open positions
- **Telegram Alerts** — แจ้งเตือนทุก signal และ trade execution

---


## AI Trading Engine (Hourly)

```
Every Hour (Cron-job.org — free)
         │
         ▼
  ┌─────────────┐     ┌──────────────────┐
  │ Alpaca API  │────►│ Technical Analysis│
  │ 1h Candles  │     │ RSI · EMA · VWAP  │
  └─────────────┘     └────────┬─────────┘
                               │
                      ┌────────▼──────────┐
                      │   ThaiLLM AI      │
                      │ Pathumma-8B-Think │
                      │ (thaillm.or.th)   │
                      └────────┬──────────┘
                               │
               ┌───────────────┴───────────────┐
               ▼                               ▼
             BUY                             SELL
               │                               │
  ┌────────────▼───────────┐      ┌────────────▼──────────┐
  │  Bracket Order         │      │  Close Position        │
  │  ├─ Take Profit (+2.5%)│      │  (Market Order)        │
  │  └─ Stop Loss  (-1.5%) │      └───────────────────────┘
  └────────────────────────┘
```

> **Note:** Vercel Hobby = daily cron max. For hourly trading, use [Cron-job.org](https://cron-job.org) (free) to call `GET /api/cron/ai-trade` every hour with header `Authorization: Bearer {CRON_SECRET}`

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16, TypeScript, Tailwind CSS v4, Recharts |
| Backend | Next.js API Routes (Serverless) |
| Scheduling | Vercel Cron Jobs (every 1 min) |
| Broker | Alpaca Markets API (Paper + Live) |
| Database | Neon PostgreSQL (production) / SQLite (local) |
| Hosting | Vercel (Free tier) |
| Notifications | Telegram Bot API |

---

## การ Deploy

### 1. Clone & Install
```bash
git clone https://github.com/watcharaponthod-code/trading.git
cd trading
npm install
```

### 2. ตั้งค่า Environment Variables
```env
# Alpaca
ALPACA_API_KEY=your_key
ALPACA_API_SECRET=your_secret
ALPACA_BASE_URL=https://paper-api.alpaca.markets

# Database (Neon)
DATABASE_URL=postgresql://...

# Cron Security
CRON_SECRET=your_random_secret

# Telegram (optional)
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_ADMIN_CHAT_IDS=123456789
```

### 3. Deploy to Vercel
```bash
vercel deploy --prod
```

Vercel Cron Jobs จะรันอัตโนมัติทุก 1 นาทีหลัง deploy

---

## Live Demo

🌐 [https://trading-jet-iota.vercel.app](https://trading-jet-iota.vercel.app)
