/**
 * Telegram Webhook API Route
 *
 * Handles incoming updates from Telegram:
 * - Commands (/start, /status, etc.)
 * - Callback queries (button presses)
 * - Message routing
 */

import { NextRequest, NextResponse } from "next/server"
import {
  getTelegramBot,
  initTelegramBot,
  type TelegramUpdate,
} from "@/lib/telegram-bot"
import {
  getAccount,
  getPositions,
  getOpenOrders,
} from "@/lib/alpaca"
import {
  getTrades,
  getTradeSignals,
  getStrategyConfigs,
  runMigrations,
} from "@/lib/db"

// ─── Config ───────────────────────────────────────────────────────────────────

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || ""
const TELEGRAM_ADMIN_CHAT_IDS = process.env.TELEGRAM_ADMIN_CHAT_IDS?.split(",") || []

// Initialize bot
if (TELEGRAM_BOT_TOKEN) {
  initTelegramBot({
    botToken: TELEGRAM_BOT_TOKEN,
    adminChatIds: TELEGRAM_ADMIN_CHAT_IDS,
  })
}

// ─── Webhook Handler ───────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const bot = getTelegramBot()
    if (!bot?.isEnabled()) {
      return NextResponse.json({ error: "Bot not configured" }, { status: 500 })
    }

    const update: TelegramUpdate = await req.json()

    // Handle callback queries (button presses)
    if (update.callback_query) {
      await handleCallbackQuery(update.callback_query)
      return NextResponse.json({ ok: true })
    }

    // Handle messages
    if (update.message) {
      await handleMessage(update.message)
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ ok: true, message: "No handler for this update" })
  } catch (error: any) {
    console.error("Telegram webhook error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// ─── Message Handler ───────────────────────────────────────────────────────────

async function handleMessage(message: any) {
  const bot = getTelegramBot()
  if (!bot) return

  const { chat, text, from } = message
  const chatId = chat.id
  const username = from?.username || chat.first_name

  if (!text) return

  // Parse command
  const command = text.toLowerCase().trim()

  // Route command
  switch (command) {
    case "/start":
      await bot.handleStart(chatId, username)
      break

    case "/status":
    case "/menu":
      await handleStatusCommand(chatId)
      break

    case "/positions":
      await handlePositionsCommand(chatId)
      break

    case "/signals":
      await handleSignalsCommand(chatId)
      break

    case "/trades":
      await handleTradesCommand(chatId)
      break

    case "/performance":
      await handlePerformanceCommand(chatId)
      break

    case "/settings":
      await handleSettingsCommand(chatId)
      break

    case "/help":
      await bot.handleHelp(chatId)
      break

    default:
      // Unknown command - show menu
      await bot.sendMessage({
        chat_id: chatId,
        text: `❓ Unknown command: \`${command}\`\n\nUse /help to see available commands.`,
        reply_markup: {
          inline_keyboard: [
            [{ text: "📋 Show Help", callback_data: "/help" }],
            [{ text: "🏠 Main Menu", callback_data: "/menu" }],
          ],
        },
      })
  }
}

// ─── Callback Query Handler ───────────────────────────────────────────────────

async function handleCallbackQuery(callbackQuery: any) {
  const bot = getTelegramBot()
  if (!bot) return

  const { id, from, message, data } = callbackQuery
  const chatId = message.chat.id
  const messageId = message.message_id

  // Handle special actions that need processing
  if (data.startsWith("toggle_")) {
    await bot.handleCallback({
      id,
      userId: from.id,
      chatId,
      messageId,
      data,
    })
    return
  }

  if (data.startsWith("bot_")) {
    await bot.handleCallback({
      id,
      userId: from.id,
      chatId,
      messageId,
      data,
    })
    return
  }

  // Route to command handler
  switch (data) {
    case "/status":
      await handleStatusCommand(chatId)
      await editOrSendMessage(bot, chatId, messageId, "/status")
      break

    case "/positions":
      await handlePositionsCommand(chatId)
      await editOrSendMessage(bot, chatId, messageId, "/positions")
      break

    case "/signals":
      await handleSignalsCommand(chatId)
      await editOrSendMessage(bot, chatId, messageId, "/signals")
      break

    case "/trades":
      await handleTradesCommand(chatId)
      await editOrSendMessage(bot, chatId, messageId, "/trades")
      break

    case "/performance":
      await handlePerformanceCommand(chatId)
      await editOrSendMessage(bot, chatId, messageId, "/performance")
      break

    case "/settings":
      await handleSettingsCommand(chatId)
      await editOrSendMessage(bot, chatId, messageId, "/settings")
      break

    case "/menu":
      await bot.handleMenu(chatId)
      break

    case "/help":
      await bot.handleHelp(chatId)
      break

    default:
      await bot.answerCallbackQuery(id, "Unknown action")
  }
}

async function editOrSendMessage(
  bot: any,
  chatId: number,
  messageId: number,
  command: string
) {
  // Try to edit the existing message
  // If that fails, send a new message
  // This is handled by the individual command handlers
}

// ─── Command Handlers ───────────────────────────────────────────────────────────

async function handleStatusCommand(chatId: number) {
  const bot = getTelegramBot()
  if (!bot) return

  try {
    await runMigrations()

    // Fetch current data
    const [account, positions, strategies] = await Promise.all([
      getAccount().catch(() => ({ equity: 0, last_equity: 0 })),
      getPositions().catch(() => []),
      getStrategyConfigs().catch(() => []),
    ])

    const equity = Number(account.equity) || 0
    const lastEquity = Number(account.last_equity) || 0
    const dailyPnl = lastEquity > 0 ? ((equity - lastEquity) / lastEquity) * 100 : 0

    // Check market hours
    const clock = await fetch("https://paper-api.alpaca.markets/v2/clock", {
      headers: {
        "APCA-API-KEY-ID": process.env.ALPACA_API_KEY || "",
        "APCA-API-SECRET-KEY": process.env.ALPACA_API_SECRET || "",
      },
    })
      .then((r) => r.json())
      .catch(() => ({ is_open: false }))

    const activeStrategies = strategies
      .filter((s: any) => s.is_active)
      .map((s: any) => s.name || s.strategy_id)

    await bot.handleStatus(chatId, {
      isRunning: true,
      marketOpen: clock.is_open || false,
      cycleCount: 0,
      totalTrades: positions.length,
      equity,
      dailyPnl,
      activeStrategies,
    })
  } catch (error: any) {
    await bot.sendMessage({
      chat_id: chatId,
      text: `⚠️ *Error fetching status*\n\n\`${error.message}\``,
    })
  }
}

async function handlePositionsCommand(chatId: number) {
  const bot = getTelegramBot()
  if (!bot) return

  try {
    const positions = await getPositions().catch(() => [])

    await bot.handlePositions(
      chatId,
      positions.map((p: any) => ({
        symbol: p.symbol,
        qty: Number(p.qty),
        side: Number(p.qty) > 0 ? "long" : "short",
        entryPrice: Number(p.avg_entry_price) || 0,
        currentPrice: Number(p.current_price) || 0,
        unrealizedPl: Number(p.unrealized_pl) || 0,
        unrealizedPlpc: Number(p.unrealized_plpc) || 0,
      }))
    )
  } catch (error: any) {
    await bot.sendMessage({
      chat_id: chatId,
      text: `⚠️ *Error fetching positions*\n\n\`${error.message}\``,
    })
  }
}

async function handleSignalsCommand(chatId: number) {
  const bot = getTelegramBot()
  if (!bot) return

  try {
    const signals = await getTradeSignals(20).catch(() => [])

    await bot.handleSignals(
      chatId,
      signals.map((s: any) => ({
        id: s.id,
        strategy: s.strategy_id,
        symbol: s.symbol,
        action: s.action,
        confidence: s.confidence || 0.5,
        reason: s.reason || "",
        createdAt: new Date(s.created_at),
      }))
    )
  } catch (error: any) {
    await bot.sendMessage({
      chat_id: chatId,
      text: `⚠️ *Error fetching signals*\n\n\`${error.message}\``,
    })
  }
}

async function handleTradesCommand(chatId: number) {
  const bot = getTelegramBot()
  if (!bot) return

  try {
    const trades = await getTrades(20).catch(() => [])

    await bot.handleTrades(
      chatId,
      trades.map((t: any) => ({
        id: t.id,
        symbol: t.symbol,
        side: t.side,
        qty: Number(t.qty),
        price: Number(t.price) || Number(t.filled_avg_price) || 0,
        pnl: t.pnl ? Number(t.pnl) : undefined,
        status: t.status,
        createdAt: new Date(t.created_at),
      }))
    )
  } catch (error: any) {
    await bot.sendMessage({
      chat_id: chatId,
      text: `⚠️ *Error fetching trades*\n\n\`${error.message}\``,
    })
  }
}

async function handlePerformanceCommand(chatId: number) {
  const bot = getTelegramBot()
  if (!bot) return

  try {
    const [account, trades] = await Promise.all([
      getAccount().catch(() => ({ equity: 100000, last_equity: 100000 })),
      getTrades(100).catch(() => []),
    ])

    const equity = Number(account.equity) || 0
    const lastEquity = Number(account.last_equity) || 0
    const startingEquity = 100000 // Default starting equity

    const totalPnl = equity - startingEquity
    const totalPnlPct = (totalPnl / startingEquity) * 100
    const dailyPnl = lastEquity > 0 ? ((equity - lastEquity) / lastEquity) * 100 : 0

    // Calculate win rate
    const closedTrades = trades.filter((t: any) => t.pnl !== null && t.pnl !== undefined)
    const winningTrades = closedTrades.filter((t: any) => Number(t.pnl) > 0).length
    const losingTrades = closedTrades.filter((t: any) => Number(t.pnl) < 0).length
    const winRate = closedTrades.length > 0 ? (winningTrades / closedTrades.length) * 100 : 0

    await bot.handlePerformance(chatId, {
      equity,
      startingEquity,
      totalPnl,
      totalPnlPct,
      dailyPnl,
      winRate,
      totalTrades: trades.length,
      winningTrades,
      losingTrades,
    })
  } catch (error: any) {
    await bot.sendMessage({
      chat_id: chatId,
      text: `⚠️ *Error fetching performance*\n\n\`${error.message}\``,
    })
  }
}

async function handleSettingsCommand(chatId: number) {
  const bot = getTelegramBot()
  if (!bot) return

  try {
    // Default settings - in production, fetch from database
    const settings = {
      notifications: true,
      tradeAlerts: true,
      signalAlerts: true,
    }

    await bot.handleSettings(chatId, settings)
  } catch (error: any) {
    await bot.sendMessage({
      chat_id: chatId,
      text: `⚠️ *Error fetching settings*\n\n\`${error.message}\``,
    })
  }
}

// ─── Webhook Setup ────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const bot = getTelegramBot()

  // Verify webhook (Telegram sends a hub.challenge)
  const url = new URL(req.url)
  const challenge = url.searchParams.get("hub.challenge")

  if (challenge) {
    return new Response(challenge, {
      headers: { "Content-Type": "text/plain" },
    })
  }

  // Show webhook info
  return NextResponse.json({
    enabled: bot?.isEnabled() || false,
    webhookUrl: bot?.isEnabled()
      ? `${process.env.NEXT_PUBLIC_APP_URL || "https://your-domain.com"}/api/telegram/webhook`
      : null,
    info: "To set up webhook, call this URL with ?action=set",
  })
}
