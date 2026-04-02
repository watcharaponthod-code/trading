/**
 * Telegram Bot Setup Script
 *
 * Sets up webhook and sends deploy notification
 */

import { initTelegramBot, getTelegramBot, templates } from "../lib/telegram-bot"

// ─── Config ───────────────────────────────────────────────────────────────────

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || ""
const WEBHOOK_URL = process.env.TELEGRAM_WEBHOOK_URL || ""
const ADMIN_CHAT_IDS = process.env.TELEGRAM_ADMIN_CHAT_IDS?.split(",") || []

async function setupTelegramBot() {
  if (!BOT_TOKEN) {
    console.warn("⚠️  TELEGRAM_BOT_TOKEN not set - skipping telegram setup")
    return
  }

  // Initialize bot
  const bot = initTelegramBot({
    botToken: BOT_TOKEN,
    adminChatIds: ADMIN_CHAT_IDS,
  })

  console.log("🤖 Telegram Bot Setup")
  console.log("=" .repeat(40))

  // Get bot info
  try {
    const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getMe`)
    const data = await response.json()

    if (data.ok) {
      const botInfo = data.result
      console.log(`✅ Bot: @${botInfo.username}`)
      console.log(`   Name: ${botInfo.first_name}`)
      console.log(`   ID: ${botInfo.id}`)
    } else {
      console.error("❌ Failed to get bot info:", data.description)
      return
    }
  } catch (error) {
    console.error("❌ Error fetching bot info:", error)
    return
  }

  // Set webhook if URL provided
  if (WEBHOOK_URL) {
    try {
      const webhookResponse = await fetch(
        `https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url: WEBHOOK_URL,
            allowed_updates: ["message", "callback_query"],
          }),
        }
      )

      const webhookData = await webhookResponse.json()

      if (webhookData.ok) {
        console.log(`✅ Webhook set to: ${WEBHOOK_URL}`)
      } else {
        console.error("❌ Failed to set webhook:", webhookData.description)
      }
    } catch (error) {
      console.error("❌ Error setting webhook:", error)
    }
  } else {
    console.log("⚠️  TELEGRAM_WEBHOOK_URL not set - skipping webhook setup")
    console.log("   To enable webhook, set:")
    console.log("   TELEGRAM_WEBHOOK_URL=https://your-domain.com/api/telegram/webhook")
  }

  // Get current webhook info
  try {
    const webhookInfo = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo`)
    const info = await webhookInfo.json()

    if (info.ok) {
      console.log(`\n📡 Webhook Info:`)
      console.log(`   URL: ${info.result.url || "Not set"}`)
      console.log(`   Has custom certificate: ${info.result.has_custom_certificate || false}`)
      console.log(`   Pending updates: ${info.result.pending_update_count || 0}`)
    }
  } catch (error) {
    console.error("❌ Error fetching webhook info:", error)
  }

  // Send deploy notification to admin chat IDs
  if (ADMIN_CHAT_IDS.length > 0) {
    console.log(`\n📢 Sending deploy notification to ${ADMIN_CHAT_IDS.length} chat(s)...`)

    for (const chatId of ADMIN_CHAT_IDS) {
      try {
        await bot.sendMessage({
          chat_id: chatId.trim(),
          text: templates.deployNotification(process.env.NODE_ENV || "development"),
          reply_markup: {
            inline_keyboard: [
              [
                { text: "📊 Status", callback_data: "/status" },
                { text: "💰 Positions", callback_data: "/positions" },
              ],
            ],
          },
        })
        console.log(`   ✅ Sent to chat ID: ${chatId}`)
      } catch (error) {
        console.error(`   ❌ Failed to send to ${chatId}:`, error)
      }
    }
  } else {
    console.log("\n⚠️  No admin chat IDs configured")
    console.log("   To receive notifications, add chat IDs to:")
    console.log("   TELEGRAM_ADMIN_CHAT_IDS=123456789,987654321")
  }

  console.log("\n" + "=".repeat(40))
  console.log("✅ Telegram bot setup complete!")
  console.log("\n📝 Next steps:")
  console.log("   1. Start a chat with your bot on Telegram")
  console.log("   2. Send /start to initialize")
  console.log("   3. Use /status to check bot status")
  console.log("   4. Use inline buttons for quick access")
}

// Run setup
setupTelegramBot().catch(console.error)
