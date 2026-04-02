/**
 * Telegram Bot Integration for Trading Agent
 *
 * Features:
 * - /commands for status, positions, signals, trades
 * - Inline keyboards for quick actions
 * - Beautiful markdown formatting
 * - Real-time notifications
 * - Auto-deploy notifications
 */

import { upsertTelegramChat, getAllTelegramChats } from "./db"

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TelegramConfig {
  botToken: string
  allowedChatIds?: string[]
  adminChatIds?: string[]
}

export interface TelegramMessage {
  chat_id: string | number
  text: string
  parse_mode?: "Markdown" | "MarkdownV2" | "HTML"
  disable_web_page_preview?: boolean
  reply_markup?: {
    inline_keyboard?: Array<Array<{ text: string; callback_data?: string; url?: string }>>
  }
}

export interface TelegramUpdate {
  update_id: number
  message?: {
    message_id: number
    chat: { id: number; type: string; username?: string; first_name?: string }
    text?: string
    date: number
  }
  callback_query?: {
    id: string
    from: { id: number; username?: string }
    message: { message_id: number; chat: { id: number } }
    data: string
  }
}

// ─── Bot State ───────────────────────────────────────────────────────────────

const botState = {
  enabled: false,
  chatIds: new Set<string>(),
  lastNotified: 0,
  notifyCooldown: 60_000, // 1 minute between notifications
}

// ─── Markdown Formatting Helpers ───────────────────────────────────────────────

const md = {
  bold: (t: string) => `*${t}*`,
  italic: (t: string) => `_${t}_`,
  code: (t: string) => `\`${t}\``,
  pre: (t: string) => `\`\`\`\n${t}\n\`\`\``,
  link: (text: string, url: string) => `[${text}](${url})`,
  emoji: {
    rocket: "🚀",
    chart: "📊",
    money: "💰",
    alert: "⚠️",
    check: "✅",
    cross: "❌",
    info: "ℹ️",
    fire: "🔥",
    trend_up: "📈",
    trend_down: "📉",
    clock: "🕐",
    robot: "🤖",
    gear: "⚙️",
  },
  // Color indicators using emoji
  color: (value: number, thresholds = { good: 0, warn: 0 }) => {
    if (thresholds.good !== undefined) {
      if (value >= thresholds.good) return md.emoji.check
      if (thresholds.warn !== undefined && value >= thresholds.warn) return md.emoji.alert
    }
    return md.emoji.cross
  },
  pct: (val: number) => (val > 0 ? `+${val.toFixed(2)}%` : `${val.toFixed(2)}%`),
  money: (val: number) => `$${val.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
}

// ─── Message Templates ─────────────────────────────────────────────────────────

const templates = {
  // Welcome message
  welcome: (name?: string) => `
${md.emoji.robot} *AlgoTrade Bot* - Welcome${name ? ` ${name}` : ""}!

${md.emoji.info} I'm your personal trading assistant. Here's what I can do:

${md.bold("Quick Commands:")}
/status - Show current trading status
/positions - View open positions
/signals - Recent trading signals
/trades - Trade history
/performance - P&L summary
/settings - Configure notifications

${md.bold("Market Hours:")}
🕐 Mon-Fri: 9:30 AM - 4:00 PM EST

${md.emoji.chart} Use the buttons below or type a command to get started!
`,

  // Status message
  status: (data: {
    isRunning: boolean
    marketOpen: boolean
    cycleCount: number
    totalTrades: number
    equity: number
    dailyPnl: number
    activeStrategies: string[]
  }) => `
${md.emoji.robot} *Trading Bot Status*

${md.bold("Engine:")} ${data.isRunning ? md.emoji.check + " Running" : md.emoji.cross + " Stopped"}
${md.bold("Market:")} ${data.marketOpen ? md.emoji.check + " Open" : md.emoji.cross + " Closed"}
${md.bold("Cycles:")} \`${data.cycleCount}\`  |  ${md.bold("Trades:")} \`${data.totalTrades}\`

━━━━━━━━━━━━━━━━━━━━

${md.emoji.money} *Account*
${md.bold("Equity:")} ${md.money(data.equity)}
${md.bold("Daily P&L:")} ${md.pct(data.dailyPnl)} ${data.dailyPnl >= 0 ? md.emoji.trend_up : md.emoji.trend_down}

${md.emoji.gear} *Active Strategies*
${data.activeStrategies.map((s, i) => `${i + 1}. \`${s}\``).join("\n") || "No active strategies"}

${md.emoji.clock} _Updated: ${new Date().toLocaleString("en-US", { timeZone: "America/New_York" })}_
`,

  // Positions message
  positions: (positions: Array<{
    symbol: string
    qty: number
    side: string
    entryPrice: number
    currentPrice: number
    unrealizedPl: number
    unrealizedPlpc: number
  }>) => {
    if (positions.length === 0) {
      return `
${md.emoji.chart} *Open Positions*

_No open positions_

${md.emoji.info} Bot will open positions when signals are generated.
`
    }

    const totalPl = positions.reduce((sum, p) => sum + p.unrealizedPl, 0)
    const totalPlPct = positions.reduce((sum, p) => sum + p.unrealizedPlpc * Math.abs(p.qty) * p.currentPrice, 0) /
                      positions.reduce((sum, p) => sum + Math.abs(p.qty) * p.currentPrice, 0)

    return `
${md.emoji.chart} *Open Positions* (${positions.length})

${positions.map((p) => `
${md.bold(p.symbol)} ${p.side === "long" ? md.emoji.trend_up : md.emoji.trend_down}
├ Qty: \`${p.qty}\` @ ${md.money(p.entryPrice)}
├ Now: ${md.money(p.currentPrice)}
└ P&L: ${md.money(p.unrealizedPl)} (${md.pct(p.unrealizedPlpc * 100)})
`).join("\n")}

━━━━━━━━━━━━━━━━━━━━
${md.bold("Total P&L:")} ${md.money(totalPl)} (${md.pct(totalPlPct * 100)})
`
  },

  // Signals message
  signals: (signals: Array<{
    id: number
    strategy: string
    symbol: string
    action: string
    confidence: number
    reason: string
    createdAt: Date
  }>) => {
    if (signals.length === 0) {
      return `
${md.emoji.rocket} *Recent Signals*

_No recent signals_

${md.emoji.info} Waiting for market conditions...
`
    }

    return `
${md.emoji.rocket} *Recent Signals* (Last ${signals.length})

${signals.map((s) => `
${md.bold(s.symbol)} - ${s.action.toUpperCase()}
├ Strategy: \`${s.strategy}\`
├ Confidence: ${(s.confidence * 100).toFixed(0)}%
├ Reason: ${s.reason}
└ ${new Date(s.createdAt).toLocaleTimeString("en-US", { timeZone: "America/New_York" })}
`).join("\n")}
`
  },

  // Trades message
  trades: (trades: Array<{
    id: number
    symbol: string
    side: string
    qty: number
    price: number
    pnl?: number
    status: string
    createdAt: Date
  }>) => {
    const totalPnl = trades.reduce((sum, t) => sum + (t.pnl || 0), 0)
    const winRate = trades.filter((t) => t.pnl && t.pnl > 0).length / trades.length * 100

    return `
${md.emoji.money} *Recent Trades* (${trades.length})

${trades.map((t) => `
${md.bold(t.symbol)} - ${t.side.toUpperCase()}
├ Qty: \`${t.qty}\` @ ${md.money(t.price)}
├ P&L: ${t.pnl ? md.money(t.pnl) : "N/A"}
└ Status: \`${t.status}\`
`).join("\n")}

━━━━━━━━━━━━━━━━━━━━
${md.bold("Total P&L:")} ${md.money(totalPnl)}
${md.bold("Win Rate:")} ${winRate.toFixed(1)}%
`
  },

  // Performance message
  performance: (data: {
    equity: number
    startingEquity: number
    totalPnl: number
    totalPnlPct: number
    dailyPnl: number
    winRate: number
    totalTrades: number
    winningTrades: number
    losingTrades: number
  }) => `
${md.emoji.chart} *Performance Summary*

${md.emoji.money} *Returns*
${md.bold("Total P&L:")} ${md.money(data.totalPnl)} (${md.pct(data.totalPnlPct)})
${md.bold("Daily P&L:")} ${md.pct(data.dailyPnl)}
${md.bold("Equity:")} ${md.money(data.equity)}

${md.emoji.trend_up} *Statistics*
${md.bold("Win Rate:")} ${data.winRate.toFixed(1)}%
${md.bold("Total Trades:")} \`${data.totalTrades}\`
${md.bold("Winning:")} \`${data.winningTrades}\`  |  ${md.bold("Losing:")} \`${data.losingTrades}\`

${md.emoji.fire} *Performance ${data.totalPnl >= 0 ? "🔥" : "❄️"}*
${data.totalPnl >= 0 ?
  `Great job! You're up ${md.pct(data.totalPnlPct)}. Keep it up!` :
  `Down ${md.pct(data.totalPnlPct)}. Stay disciplined!`}
`,

  // Trade execution notification
  tradeExecuted: (trade: {
    symbol: string
    side: string
    action: string
    qty: number
    price: number
    strategy: string
    reason: string
    confidence: number
  }) => `
${md.emoji.rocket} *Trade Executed*

${md.bold(trade.symbol)} - ${trade.side.toUpperCase()} ${trade.action === "buy" ? md.emoji.trend_up : md.emoji.trend_down}

├ ${md.bold("Quantity:")} \`${trade.qty}\`
├ ${md.bold("Price:")} ${md.money(trade.price)}
├ ${md.bold("Strategy:")} \`${trade.strategy}\`
├ ${md.bold("Confidence:")} ${(trade.confidence * 100).toFixed(0)}%
└ ${md.bold("Reason:")} ${trade.reason}

${md.emoji.clock} ${new Date().toLocaleTimeString("en-US", { timeZone: "America/New_York" })}
`,

  // Signal notification
  signalGenerated: (signal: {
    symbol: string
    action: string
    confidence: number
    reason: string
    strategy: string
  }) => `
${md.emoji.rocket} *New Signal*

${md.bold(signal.symbol)} - ${signal.action.toUpperCase()} ${signal.action === "buy" ? md.emoji.trend_up : md.emoji.trend_down}

├ ${md.bold("Confidence:")} ${(signal.confidence * 100).toFixed(0)}%
├ ${md.bold("Strategy:")} \`${signal.strategy}\`
└ ${md.bold("Reason:")} ${signal.reason}
`,

  // Deploy notification
  deployNotification: (env: string, version?: string) => `
${md.emoji.rocket} *Bot Deployed*

${md.bold("Environment:")} \`${env}\`${version ? `\n${md.bold("Version:")} \`${version}\`` : ""}

${md.emoji.check} Bot is now online and ready to trade!

${md.emoji.info} Type /status to see current state.
`,

  // Error notification
  error: (error: string, context?: string) => `
${md.emoji.alert} *Error*

${context ? `${md.bold("Context:")} \`${context}\`\n` : ""}${md.bold("Message:")}
\`${error}\`

${md.emoji.info} Check logs for more details.
`,

  // Warning
  warning: (message: string) => `
${md.emoji.alert} *Warning*

${message}
`,

  // Settings message
  settings: (config: { notifications: boolean; tradeAlerts: boolean; signalAlerts: boolean }) => `
${md.emoji.gear} *Bot Settings*

${md.bold("Notifications:")} ${config.notifications ? md.emoji.check : md.emoji.cross}
${md.bold("Trade Alerts:")} ${config.tradeAlerts ? md.emoji.check : md.emoji.cross}
${md.bold("Signal Alerts:")} ${config.signalAlerts ? md.emoji.check : md.emoji.cross}

Use the buttons below to toggle settings.
`,
}

// ─── Inline Keyboards ───────────────────────────────────────────────────────────

const keyboards = {
  mainMenu: () => ({
    inline_keyboard: [
      [
        { text: `${md.emoji.chart} Status`, callback_data: "/status" },
        { text: `${md.emoji.money} Positions`, callback_data: "/positions" },
      ],
      [
        { text: `${md.emoji.rocket} Signals`, callback_data: "/signals" },
        { text: `${md.emoji.trend_up} Trades`, callback_data: "/trades" },
      ],
      [
        { text: `${md.emoji.fire} Performance`, callback_data: "/performance" },
        { text: `${md.emoji.gear} Settings`, callback_data: "/settings" },
      ],
      [
        { text: `${md.emoji.info} Help`, callback_data: "/help" },
      ],
    ],
  }),

  refreshOnly: (command: string) => ({
    inline_keyboard: [
      [{ text: `${md.emoji.clock} Refresh`, callback_data: command }],
      [{ text: `${md.emoji.info} Main Menu`, callback_data: "/menu" }],
    ],
  }),

  settings: () => ({
    inline_keyboard: [
      [
        { text: "Toggle Notifications", callback_data: "toggle_notifications" },
        { text: "Toggle Trade Alerts", callback_data: "toggle_trades" },
      ],
      [
        { text: "Toggle Signal Alerts", callback_data: "toggle_signals" },
      ],
      [
        { text: `${md.emoji.info} Main Menu`, callback_data: "/menu" },
      ],
    ],
  }),

  quickActions: () => ({
    inline_keyboard: [
      [
        { text: "Pause Bot", callback_data: "bot_pause" },
        { text: "Resume Bot", callback_data: "bot_resume" },
      ],
      [
        { text: "Close All Positions", callback_data: "close_all" },
        { text: "Cancel All Orders", callback_data: "cancel_all" },
      ],
    ],
  }),
}

// ─── Bot Client Class ───────────────────────────────────────────────────────────

export class TradingBot {
  private config: TelegramConfig
  private baseUrl: string

  constructor(config: TelegramConfig) {
    this.config = config
    this.baseUrl = `https://api.telegram.org/bot${config.botToken}`
    botState.enabled = !!config.botToken
  }

  // ─── Core API Methods ───────────────────────────────────────────────────────

  async sendMessage(msg: TelegramMessage): Promise<any> {
    if (!botState.enabled) return null

    try {
      const response = await fetch(`${this.baseUrl}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: msg.chat_id,
          text: msg.text,
          parse_mode: msg.parse_mode || "Markdown",
          disable_web_page_preview: msg.disable_web_page_preview ?? true,
          reply_markup: msg.reply_markup,
        }),
      })

      const data = await response.json()
      if (!data.ok) {
        console.error("Telegram API error:", data)
        return null
      }

      // Store chat ID for notifications
      if (msg.chat_id && !botState.chatIds.has(String(msg.chat_id))) {
        botState.chatIds.add(String(msg.chat_id))
      }

      return data.result
    } catch (error) {
      console.error("Telegram send error:", error)
      return null
    }
  }

  async editMessage(
    chatId: string | number,
    messageId: number,
    text: string,
    replyMarkup?: any
  ): Promise<any> {
    if (!botState.enabled) return null

    try {
      const response = await fetch(`${this.baseUrl}/editMessageText`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: messageId,
          text,
          parse_mode: "Markdown",
          reply_markup: replyMarkup,
        }),
      })

      const data = await response.json()
      return data.ok ? data.result : null
    } catch (error) {
      console.error("Telegram edit error:", error)
      return null
    }
  }

  async answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
    if (!botState.enabled) return

    try {
      await fetch(`${this.baseUrl}/answerCallbackQuery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callback_query_id: callbackQueryId,
          text,
          show_alert: false,
        }),
      })
    } catch (error) {
      console.error("Telegram callback answer error:", error)
    }
  }

  // ─── Notification Methods ────────────────────────────────────────────────────

  async notifyAll(message: string, replyMarkup?: any): Promise<void> {
    // Get all chats from DB
    const dbChatIds = await getAllTelegramChats().catch(() => [])
    const allChatIds = new Set([...Array.from(botState.chatIds), ...dbChatIds])

    if (!botState.enabled || allChatIds.size === 0) return

    // Cooldown check
    const now = Date.now()
    if (now - botState.lastNotified < botState.notifyCooldown) return
    botState.lastNotified = now

    const promises = Array.from(allChatIds).map((chatId) =>
      this.sendMessage({ chat_id: chatId, text: message, reply_markup: replyMarkup })
    )

    await Promise.allSettled(promises)
  }

  async notifyTrade(trade: {
    symbol: string
    side: string
    action: string
    qty: number
    price: number
    strategy: string
    reason: string
    confidence: number
  }): Promise<void> {
    await this.notifyAll(templates.tradeExecuted(trade))
  }

  async notifySignal(signal: {
    symbol: string
    action: string
    confidence: number
    reason: string
    strategy: string
  }): Promise<void> {
    await this.notifyAll(templates.signalGenerated(signal))
  }

  async notifyError(error: string, context?: string): Promise<void> {
    await this.notifyAll(templates.error(error, context))
  }

  async notifyDeploy(env: string, version?: string): Promise<void> {
    await this.notifyAll(templates.deployNotification(env, version), keyboards.mainMenu())
  }

  // ─── Command Handlers ───────────────────────────────────────────────────────

  async handleStart(chatId: string | number, name?: string): Promise<void> {
    // Save to memory
    botState.chatIds.add(String(chatId))
    
    // Save to DB for persistence
    await upsertTelegramChat(String(chatId), name).catch(err => {
      console.error("Failed to save chat to DB:", err)
    })

    await this.sendMessage({
      chat_id: chatId,
      text: templates.welcome(name),
      reply_markup: keyboards.mainMenu(),
    })
  }

  async handleStatus(chatId: string | number, data: any): Promise<void> {
    await this.sendMessage({
      chat_id: chatId,
      text: templates.status(data),
      reply_markup: keyboards.refreshOnly("/status"),
    })
  }

  async handlePositions(chatId: string | number, positions: any[]): Promise<void> {
    await this.sendMessage({
      chat_id: chatId,
      text: templates.positions(positions),
      reply_markup: keyboards.refreshOnly("/positions"),
    })
  }

  async handleSignals(chatId: string | number, signals: any[]): Promise<void> {
    await this.sendMessage({
      chat_id: chatId,
      text: templates.signals(signals),
      reply_markup: keyboards.refreshOnly("/signals"),
    })
  }

  async handleTrades(chatId: string | number, trades: any[]): Promise<void> {
    await this.sendMessage({
      chat_id: chatId,
      text: templates.trades(trades),
      reply_markup: keyboards.refreshOnly("/trades"),
    })
  }

  async handlePerformance(chatId: string | number, data: any): Promise<void> {
    await this.sendMessage({
      chat_id: chatId,
      text: templates.performance(data),
      reply_markup: keyboards.refreshOnly("/performance"),
    })
  }

  async handleSettings(chatId: string | number, config: any): Promise<void> {
    await this.sendMessage({
      chat_id: chatId,
      text: templates.settings(config),
      reply_markup: keyboards.settings(),
    })
  }

  async handleMenu(chatId: string | number): Promise<void> {
    await this.sendMessage({
      chat_id: chatId,
      text: `${md.emoji.robot} *Main Menu*

Select an option below:`,
      reply_markup: keyboards.mainMenu(),
    })
  }

  async handleHelp(chatId: string | number): Promise<void> {
    await this.sendMessage({
      chat_id: chatId,
      text: `
${md.emoji.info} *Help & Commands*

${md.bold("Available Commands:")}
/start - Initialize the bot
/status - Current bot status
/positions - Open positions
/signals - Recent signals
/trades - Trade history
/performance - P&L summary
/settings - Configure notifications
/help - Show this message

${md.bold("Quick Actions:")}
Use inline buttons for instant access to all features.

${md.bold("Notifications:")}
• Trade executions
• New signals
• Errors & warnings
• Deploy updates

${md.emoji.gear} _Need help? Check your admin settings._
`,
      reply_markup: keyboards.mainMenu(),
    })
  }

  // ─── Callback Query Handlers ─────────────────────────────────────────────────

  async handleCallback(callback: {
    id: string
    userId: number
    chatId: number
    messageId: number
    data: string
  }): Promise<void> {
    const { id, chatId, messageId, data } = callback

    // Acknowledge the callback
    await this.answerCallbackQuery(id)

    // Route the callback
    switch (data) {
      case "/status":
      case "/positions":
      case "/signals":
      case "/trades":
      case "/performance":
      case "/settings":
      case "/menu":
      case "/help":
        // These will be handled by the main command handler
        // Return the command for the caller to process
        break

      default:
        // Handle special actions
        if (data.startsWith("toggle_")) {
          const setting = data.replace("toggle_", "")
          await this.handleToggleSetting(chatId, messageId, setting)
        } else if (data.startsWith("bot_")) {
          await this.handleBotAction(chatId, messageId, data)
        }
        break
    }
  }

  private async handleToggleSetting(
    chatId: number,
    messageId: number,
    setting: string
  ): Promise<void> {
    // This would integrate with your settings storage
    await this.editMessage(chatId, messageId, `${md.emoji.gear} *Setting Updated*

\`${setting}\` toggled.

${md.emoji.info} Settings will be saved.
`, keyboards.refreshOnly("/settings"))
  }

  private async handleBotAction(
    chatId: number,
    messageId: number,
    action: string
  ): Promise<void> {
    const actionText = action.replace("bot_", "").replace(/_/g, " ")
    await this.editMessage(chatId, messageId, `${md.emoji.robot} *Action*

${actionText}

${md.emoji.info} Processing...
`, keyboards.refreshOnly("/status"))
  }

  // ─── Utilities ───────────────────────────────────────────────────────────────

  isEnabled(): boolean {
    return botState.enabled
  }

  getChatIds(): string[] {
    return Array.from(botState.chatIds)
  }

  addChatId(chatId: string): void {
    botState.chatIds.add(chatId)
  }

  removeChatId(chatId: string): void {
    botState.chatIds.delete(chatId)
  }
}

// ─── Singleton Instance ───────────────────────────────────────────────────────

let botInstance: TradingBot | null = null

export function initTelegramBot(config: TelegramConfig): TradingBot {
  if (!botInstance && config.botToken) {
    botInstance = new TradingBot(config)
  }
  return botInstance!
}

export function getTelegramBot(): TradingBot | null {
  return botInstance
}

// ─── Export for API route usage ────────────────────────────────────────────────

export { templates, keyboards, md, botState }
