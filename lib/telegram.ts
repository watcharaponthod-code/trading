const TELEGRAM_TOKEN = "8529025762:AAFbTWjJbCUEFhiQjZquuSCPzr-hiuDzhhY"
// Replace this with your Chat ID once you get it (type /getid to a bot or check api)
// Or I can dynamically fetch recent chats from /getUpdates
const DEFAULT_CHAT_IDS = ["1144073385"] // Example: User can replace this

/**
 * Sends a notification to Telegram.
 * It will try to send to all predefined chat IDs.
 */
export async function sendTelegramAlert(message: string, chatIds: string[] = DEFAULT_CHAT_IDS) {
  if (!TELEGRAM_TOKEN) return
  
  for (const chatId of chatIds) {
    try {
      const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
          parse_mode: "Markdown"
        })
      })
    } catch (err) {
      console.error(`[Telegram] Failed to send to ${chatId}:`, err)
    }
  }
}

/**
 * Format a trade into a nice alert message.
 */
export function formatTradeAlert(trade: {
  symbol: string,
  side: string,
  qty: number,
  price: number,
  strategy: string,
  reason?: string,
  tp?: number,
  sl?: number
}) {
  const icon = trade.side.toLowerCase() === "buy" ? "🟢 BUY" : "🔴 SELL"
  const total = (trade.qty * trade.price).toFixed(2)
  
  return `
*${icon} ${trade.symbol}*
━━━━━━━━━━━━━━━━━━
💰 *Price:* $${trade.price.toFixed(2)}
📦 *Qty:* ${trade.qty} (Total: $${total})
🧠 *Strategy:* ${trade.strategy}
📝 *Reason:* ${trade.reason || "N/A"}
🎯 *TP:* ${trade.tp ? `$${trade.tp.toFixed(2)}` : "None"}
🛑 *SL:* ${trade.sl ? `$${trade.sl.toFixed(2)}` : "None"}
━━━━━━━━━━━━━━━━━━
📅 ${new Date().toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })}
`.trim()
}
