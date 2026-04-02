# Telegram Bot Integration

Complete Telegram bot integration for monitoring and controlling your trading agent.

## Features ✨

- 📊 **Status Monitoring**: Check bot status, positions, and performance
- 🚀 **Trade Notifications**: Real-time alerts when trades are executed
- 📈 **Signal Alerts**: Get notified of new trading signals
- 🎛️ **Inline Buttons**: Quick actions with beautiful button menus
- 💬 **Markdown Formatting**: Rich text formatting for clear information display
- 🔄 **Auto-Deploy Notifications**: Get notified when bot is deployed

## Setup Guide 🚀

### 1. Create Telegram Bot

1. Open Telegram and search for **@BotFather**
2. Send `/newbot` command
3. Follow instructions to create your bot
4. Copy the **bot token** (looks like `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`)

### 2. Get Your Chat ID

1. Send a message to your bot (any message)
2. Visit this URL in your browser:
   ```
   https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates
   ```
3. Find your `chat.id` in the response (a number like `123456789`)

### 3. Configure Environment Variables

Add to your `.env.local` file:

```bash
# Telegram Bot Configuration
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz
TELEGRAM_WEBHOOK_URL=https://your-app.vercel.app/api/telegram/webhook
TELEGRAM_ADMIN_CHAT_IDS=123456789,987654321
```

### 4. Setup Webhook (Optional)

For automatic updates via webhook:

```bash
npm run telegram:setup
```

This will:
- Verify your bot token
- Set up the webhook
- Send a test notification

## Available Commands 📝

| Command | Description |
|---------|-------------|
| `/start` | Initialize the bot and show welcome message |
| `/status` | Show current bot status, market hours, equity |
| `/positions` | Display all open positions with P&L |
| `/signals` | Show recent trading signals |
| `/trades` | Display recent trade history |
| `/performance` | Show P&L summary and win rate |
| `/settings` | Configure notification preferences |
| `/help` | Display help message |
| `/menu` | Show main menu |

## Inline Buttons 🎛️

The bot provides inline keyboards for quick access:

### Main Menu
- 📊 Status - Current bot status
- 💰 Positions - Open positions
- 🚀 Signals - Recent signals
- 📈 Trades - Trade history
- 🔥 Performance - P&L summary
- ⚙️ Settings - Configure notifications

### Quick Actions
- Refresh buttons on each page
- Toggle settings
- Pause/Resume bot
- Close all positions
- Cancel all orders

## Message Formatting ✨

All messages use beautiful Markdown formatting:

```
🤖 Trading Bot Status

Engine: ✅ Running
Market: ✅ Open
Cycles: `156`  |  Trades: `23`

━━━━━━━━━━━━━━━━━━━━

💰 Account
Equity: $103,456.78
Daily P&L: +2.34% 📈
```

## Notifications 🔔

### Trade Executed
```
🚀 Trade Executed

AAPL - BUY 📈

├ Quantity: `10`
├ Price: $178.50
├ Strategy: `momentum`
├ Confidence: 75%
└ Reason: Strong trend momentum ADX=35

🕐 10:30 AM EST
```

### New Signal
```
🚀 New Signal

TSLA - SELL 📉

├ Confidence: 80%
├ Strategy: `mean_reversion`
└ Reason: Deep overbought BB95% RSI72
```

### Deploy Notification
```
🚀 Bot Deployed

Environment: `production`
Version: `1.0.0`

✅ Bot is now online and ready to trade!

ℹ️ Type /status to see current state.
```

## API Integration 🔌

The bot integrates with your existing API:

```typescript
import { getTelegramBot } from "@/lib/telegram-bot"

// Get bot instance
const bot = getTelegramBot()

// Send trade notification
await bot.notifyTrade({
  symbol: "AAPL",
  side: "buy",
  action: "buy",
  qty: 10,
  price: 178.50,
  strategy: "momentum",
  reason: "Strong trend",
  confidence: 0.75
})

// Send signal notification
await bot.notifySignal({
  symbol: "TSLA",
  action: "sell",
  confidence: 0.80,
  reason: "Overbought",
  strategy: "mean_reversion"
})
```

## Troubleshooting 🔧

### Bot not responding?

1. Check your bot token is correct
2. Verify webhook is set: `npm run telegram:setup`
3. Check your chat ID is in `TELEGRAM_ADMIN_CHAT_IDS`

### Not receiving notifications?

1. Verify you've started the bot with `/start`
2. Check your chat ID is in the admin list
3. Ensure webhook URL is correct for your domain

### Webhook not working?

1. Make sure your app is deployed and accessible
2. Verify the webhook URL includes the full path: `/api/telegram/webhook`
3. Check SSL certificate is valid (required by Telegram)

## Security 🔒

- Bot only responds to configured chat IDs
- Webhook validates all incoming requests
- No sensitive data exposed in messages
- All commands are read-only (except through API integration)

## Development 🛠️

For local testing without webhook:

1. Run your bot locally
2. Use polling mode (webhook not required)
3. Test commands by sending messages to your bot

```bash
# Local development
npm run dev

# In another terminal, run streaming worker
npm run stream:dry
```

## Production Deployment 🚀

### Vercel Deployment

Add environment variables in Vercel dashboard:

1. Go to Project Settings > Environment Variables
2. Add `TELEGRAM_BOT_TOKEN`
3. Add `TELEGRAM_WEBHOOK_URL` (your Vercel URL)
4. Add `TELEGRAM_ADMIN_CHAT_IDS`

### Auto-Deploy Notification

Add to your `package.json`:

```json
{
  "scripts": {
    "postbuild": "npm run telegram:notify"
  }
}
```

Or add to your CI/CD pipeline:

```bash
npm run telegram:notify
```

## Support 💬

For issues or questions:

1. Check this README first
2. Review Telegram Bot API documentation
3. Check the bot code in `lib/telegram-bot.ts`
4. Check the webhook handler in `app/api/telegram/webhook/route.ts`

---

**Happy Trading! 🚀📈**
