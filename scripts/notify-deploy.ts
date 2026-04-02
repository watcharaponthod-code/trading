/**
 * Deploy Notification Script
 *
 * Sends a notification to Telegram when the bot is deployed
 * Run this script after deploying to notify users
 */

const https = require("https")

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || ""
const ADMIN_CHAT_IDS = process.env.TELEGRAM_ADMIN_CHAT_IDS?.split(",") || []
const ENV = process.env.NODE_ENV || "development"
const VERSION = process.env.npm_package_version || "unknown"

async function sendDeployNotification() {
  if (!BOT_TOKEN) {
    console.error("❌ TELEGRAM_BOT_TOKEN not set")
    process.exit(1)
  }

  if (ADMIN_CHAT_IDS.length === 0) {
    console.error("❌ TELEGRAM_ADMIN_CHAT_IDS not set")
    process.exit(1)
  }

  const emoji = {
    rocket: "🚀",
    robot: "🤖",
    check: "✅",
    info: "ℹ️",
  }

  const message = `
${emoji.rocket} *Bot Deployed*

${emoji.robot} *Environment:* \`${ENV}\`
${emoji.check} *Version:* \`${VERSION}\`

Bot is now online and ready to trade!

${emoji.info} Use /status to see current state.
`

  console.log("📢 Sending deploy notification...")

  for (const chatId of ADMIN_CHAT_IDS) {
    try {
      const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`
      const data = JSON.stringify({
        chat_id: chatId.trim(),
        text: message,
        parse_mode: "Markdown",
        disable_web_page_preview: true,
        reply_markup: {
          inline_keyboard: [
            [
              { text: "📊 Status", callback_data: "/status" },
              { text: "💰 Positions", callback_data: "/positions" },
            ],
            [
              { text: "🚀 Signals", callback_data: "/signals" },
              { text: "📈 Trades", callback_data: "/trades" },
            ],
          ],
        },
      })

      await new Promise((resolve, reject) => {
        const req = https.request(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(data),
          },
        }, (res) => {
          let body = ""
          res.on("data", (chunk) => body += chunk)
          res.on("end", () => {
            const response = JSON.parse(body)
            if (response.ok) {
              console.log(`✅ Sent to chat ID: ${chatId}`)
              resolve(response)
            } else {
              console.error(`❌ Failed to send to ${chatId}:`, response.description)
              reject(response)
            }
          })
        })

        req.on("error", reject)
        req.write(data)
        req.end()
      })
    } catch (error) {
      console.error(`❌ Error sending to ${chatId}:`, error.message)
    }
  }

  console.log("\n✅ Deploy notification sent!")
}

sendDeployNotification().catch(console.error)
