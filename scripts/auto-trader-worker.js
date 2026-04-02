/**
 * AlgoTrade Background Worker
 * 
 * รัน: node scripts/auto-trader-worker.js
 * 
 * ทำงานเป็น Node.js process แยกจาก Next.js server
 * ไม่ขึ้นกับ browser — สามารถรันได้ตลอด 24/7
 * 
 * Workflow:
 * - ทุก 60 วินาที: เรียก /api/auto-trader (stocks ถ้าตลาดเปิด)
 * - ทุก 30 วินาที: เรียก /api/crypto-trader (crypto ทำงาน 24/7)
 * - ทุก 5 นาที: cleanup stale orders + health check
 */

const https = require("https")
const http  = require("http")
const fs    = require("fs")
const path  = require("path")

// Load .env.local manually — no dotenv needed
const envPath = path.join(__dirname, "..", ".env.local")
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, "utf-8").split("\n").forEach(line => {
    const m = line.match(/^([^#=]+)=(.*)$/)
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "")
  })
}


const BASE = process.env.WORKER_BASE_URL || "http://localhost:3000"
const DRY_RUN = process.env.WORKER_DRY_RUN !== "false" // default: dry run
const STOCK_INTERVAL_MS  = 60_000   // 60s — stock scan
const CRYPTO_INTERVAL_MS = 30_000   // 30s — crypto scan (faster, more liquid)
const CLEANUP_INTERVAL_MS = 5 * 60_000 // 5 min — stale order cleanup

let cycles = 0
let errors = 0

function colorize(color, text) {
  const codes = { green: "\x1b[32m", yellow: "\x1b[33m", red: "\x1b[31m", cyan: "\x1b[36m", reset: "\x1b[0m", bold: "\x1b[1m" }
  return `${codes[color] || ""}${text}${codes.reset}`
}

function log(level, msg) {
  const ts  = new Date().toLocaleTimeString("th-TH", { hour12: false, timeZone: "Asia/Bangkok" })
  const icons = { INFO: colorize("cyan", "ℹ"), OK: colorize("green", "✓"), WARN: colorize("yellow", "⚠"), ERR: colorize("red", "✗") }
  console.log(`[${ts}] ${icons[level] || "·"} ${msg}`)
}

async function post(path, body, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await postOnce(path, body)
    } catch (err) {
      if (attempt === retries) throw err
      await new Promise(r => setTimeout(r, 3000 * (attempt + 1)))
    }
  }
}

async function postOnce(path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + path)
    const data = JSON.stringify(body)
    const lib = url.protocol === "https:" ? https : http
    const req = lib.request({
      hostname: url.hostname,
      port: url.port || (url.protocol === "https:" ? 443 : 80),
      path: url.pathname,
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) },
    }, (res) => {
      let buf = ""
      res.on("data", d => buf += d)
      res.on("end", () => {
        try { resolve(JSON.parse(buf)) } catch { resolve({ raw: buf }) }
      })
    })
    req.on("error", reject)
    req.setTimeout(55_000, () => { req.destroy(); reject(new Error("Request timeout")) })
    req.write(data)
    req.end()
  })
}

// Wait for Next.js server to be ready
async function waitForServer(maxWaitMs = 60_000) {
  const start = Date.now()
  while (Date.now() - start < maxWaitMs) {
    try {
      await new Promise((resolve, reject) => {
        const url = new URL(BASE + "/api/auto-trader")
        const lib = url.protocol === "https:" ? https : http
        const req = lib.get(`${BASE}/api/auto-trader`, { timeout: 3000 }, (res) => {
          log("OK", `Server ready (HTTP ${res.statusCode})`)
          resolve(true)
        })
        req.on("error", reject)
      })
      return true
    } catch {
      log("INFO", "Waiting for Next.js server to be ready...")
      await new Promise(r => setTimeout(r, 3000))
    }
  }
  log("WARN", "Server not responding — will keep trying anyway")
  return false
}

async function runStockEngine() {
  try {
    const result = await post("/api/auto-trader", { dryRun: DRY_RUN, forceRun: false })
    cycles++

    if (result.status === "market_closed") {
      log("INFO", `Stocks: CLOSED — next open ${result.message?.replace("Market closed. Next open: ", "") || ""}`)
      return
    }
    if (result.status === "risk_blocked") {
      log("WARN", `Stocks: RISK BLOCK — ${result.reason}`)
      return
    }
    if (result.error) {
      log("ERR", `Stocks Engine: ${result.error}`)
      errors++
      return
    }

    const { signals = [], executedOrders = [], staleOrdersCleared = 0, risk } = result
    const mode = DRY_RUN ? colorize("yellow", "[DRY]") : colorize("green", "[LIVE]")
    log("OK", `Stocks ${mode} | Signals: ${signals.length} | Orders: ${executedOrders.length} | Stale cleared: ${staleOrdersCleared} | Heat: ${risk ? (risk.totalRiskPct * 100).toFixed(1) : "?"}%`)

    if (signals.length > 0) {
      for (const s of signals) {
        const sym = s.pair || s.symbol
        const act = s.action || s.signal
        log("INFO", `  → ${sym}: ${act} (conf: ${s.confidence || s.z || "?"})`)
      }
    }
  } catch (err) {
    log("ERR", `Stocks engine failed: ${err.message}`)
    errors++
  }
}

async function runCryptoEngine() {
  try {
    const result = await post("/api/crypto-trader", { dryRun: DRY_RUN })
    if (result.error) { log("ERR", `Crypto: ${result.error}`); errors++; return }

    const { signals = [], executedOrders = [] } = result
    const mode = DRY_RUN ? colorize("yellow", "[DRY]") : colorize("green", "[LIVE]")
    if (signals.length > 0 || executedOrders.length > 0) {
      log("OK", `Crypto ${mode} | Signals: ${signals.length} | Orders: ${executedOrders.length}`)
      for (const s of signals) {
        log("INFO", `  → ${s.symbol}: ${s.action} @ ${s.reason}`)
      }
    }
  } catch (err) {
    log("ERR", `Crypto failed: ${err.message}`)
    errors++
  }
}

// ─── Crash protection — never die silently ────────────────────────────────────
process.on("uncaughtException", (err) => {
  log("ERR", `UNCAUGHT: ${err.message}`)
  errors++
  // Don't exit — let PM2 handle if needed
})
process.on("unhandledRejection", (reason) => {
  log("ERR", `UNHANDLED REJECTION: ${reason}`)
  errors++
})

// ─── Main startup ─────────────────────────────────────────────────────────────

console.log(colorize("bold", "\n╔═══════════════════════════════════════════╗"))
console.log(colorize("bold", "║   AlgoTrade 24/7 Background Worker        ║"))
console.log(colorize("bold", "╚═══════════════════════════════════════════╝"))
log("INFO", `Target:  ${BASE}`)
log("INFO", `Mode:    ${DRY_RUN ? colorize("yellow", "DRY RUN (simulation only)") : colorize("red", "🔴 LIVE — REAL TRADES")}`)
log("INFO", `Stocks:  every ${STOCK_INTERVAL_MS / 1000}s (NYSE hours only)`)
log("INFO", `Crypto:  every ${CRYPTO_INTERVAL_MS / 1000}s (24/7)`)
log("INFO", `Hours:   NYSE = Mon-Fri 09:30-16:00 ET (22:30-03:00 TH)`)
console.log("")

;(async () => {
  // Wait for Next.js to be ready (important when PM2 starts both together)
  await waitForServer(90_000)
  console.log("")

  // First run immediately
  await Promise.all([runStockEngine(), runCryptoEngine()])

  // Recurring schedule
  const stockInterval  = setInterval(runStockEngine,  STOCK_INTERVAL_MS)
  const cryptoInterval = setInterval(runCryptoEngine, CRYPTO_INTERVAL_MS)

  // Health check every 5 min
  setInterval(() => {
    const uptime = Math.floor(process.uptime() / 60)
    log("INFO", `♥ Health: ${cycles} cycles | ${errors} errors | uptime ${uptime}m`)
  }, CLEANUP_INTERVAL_MS)

  // Graceful shutdown
  const shutdown = (sig) => {
    log("INFO", `\nReceived ${sig} — shutting down gracefully...`)
    clearInterval(stockInterval)
    clearInterval(cryptoInterval)
    console.log(colorize("yellow", "Worker stopped."))
    process.exit(0)
  }
  process.on("SIGINT",  () => shutdown("SIGINT"))
  process.on("SIGTERM", () => shutdown("SIGTERM"))
})()

