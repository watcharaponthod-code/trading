/**
 * AlgoTrade Streaming Worker
 * 
 * WebSocket real-time feed จาก Alpaca:
 *   Stock:  wss://stream.data.alpaca.markets/v2/iex
 *   Crypto: wss://stream.data.alpaca.markets/v1beta3/crypto/us
 * 
 * ทำงาน:
 * - สะสม bars ใน memory (ring buffer 200 bars/symbol)
 * - ทุกครั้งที่ bar ปิด (ได้ bar ใหม่) → วิเคราะห์ทันที
 * - ถ้า signal ผ่าน → ยิง bracket order (entry + TP + SL)
 * - Monitor positions ทุก 30 วินาที → TP/SL server-side
 * - Auto-reconnect ถ้า WebSocket หลุด
 * 
 * รัน: node scripts/streaming-worker.js
 */

const WebSocket = require("ws")
const https     = require("https")
const http      = require("http")
const fs        = require("fs")
const path      = require("path")

// ─── Load .env.local ──────────────────────────────────────────────────────────
const envPath = path.join(__dirname, "..", ".env.local")
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, "utf-8").split("\n").forEach(line => {
    const m = line.match(/^([^#=]+)=(.*)$/)
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "")
  })
}

const API_KEY    = process.env.ALPACA_API_KEY
const API_SECRET = process.env.ALPACA_API_SECRET
const BASE_URL   = process.env.WORKER_BASE_URL || "http://localhost:3000"
const DRY_RUN    = process.env.WORKER_DRY_RUN !== "false"

// Paper = iex, Live = sip
const STOCK_WS   = "wss://stream.data.alpaca.markets/v2/iex"
const CRYPTO_WS  = "wss://stream.data.alpaca.markets/v1beta3/crypto/us"
const TG_TOKEN   = "8529025762:AAFbTWjJbCUEFhiQjZquuSCPzr-hiuDzhhY"
let   tgChatIds  = [] // Dynamically found

// Symbols to stream - More symbols = more opportunities
const STOCK_SYMBOLS  = ["SPY","QQQ","AAPL","MSFT","TSLA","NVDA","AMD","GOOGL","META","AMZN","GLD","SLV","KO","PEP","NFLX","PYPL","DIS","BA","CAT","JPM"]
const CRYPTO_SYMBOLS = ["BTC/USD","ETH/USD","SOL/USD","ADA/USD","DOT/USD"]

const BUFFER_SIZE    = 200   // Keep 200 bars per symbol in memory
const MIN_BARS       = 20   // Minimum bars needed for analysis (lowered from 35)
const POSITION_CHECK_MS = 30_000 // Check positions every 30s

// ─── Trading Parameters ────────────────────────────────────────────────────────────
const MAX_POSITIONS  = 5     // Max concurrent positions
const MAX_PER_SYMBOL = 1     // Max positions per symbol
const COOLDOWN_MS    = 300_000 // 5 min cooldown between trades on same symbol

// ─── State ────────────────────────────────────────────────────────────────────
const barBuffers = {}  // { "AAPL": [{o,h,l,c,v,t}, ...] }
const lastTradeTime = {} // { "AAPL": timestamp }
let equity  = 100000
let posMap  = {}
let totalSignals = 0
let totalTrades  = 0
let totalErrors  = 0

// ─── Logging ──────────────────────────────────────────────────────────────────
const C = {
  green: "\x1b[32m", yellow: "\x1b[33m", red: "\x1b[31m",
  cyan: "\x1b[36m", magenta: "\x1b[35m", reset: "\x1b[0m",
  bold: "\x1b[1m", dim: "\x1b[2m"
}

function log(level, msg) {
  const ts = new Date().toLocaleTimeString("th-TH", { hour12: false, timeZone: "Asia/Bangkok" })
  const icons = {
    INFO: `${C.cyan}ℹ${C.reset}`, OK: `${C.green}✓${C.reset}`,
    WARN: `${C.yellow}⚠${C.reset}`, ERR: `${C.red}✗${C.reset}`,
    TRADE: `${C.magenta}⚡${C.reset}`, BAR: `${C.dim}█${C.reset}`,
  }
  console.log(`[${ts}] ${icons[level] || "·"} ${msg}`)
}

// ─── HTTP Helpers ─────────────────────────────────────────────────────────────

function alpacaFetch(endpoint, method = "GET", body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(`https://paper-api.alpaca.markets/v2${endpoint}`)
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method,
      headers: {
        "APCA-API-KEY-ID": API_KEY,
        "APCA-API-SECRET-KEY": API_SECRET,
        "Content-Type": "application/json",
      },
    }
    const req = https.request(options, (res) => {
      let buf = ""
      res.on("data", d => buf += d)
      res.on("end", () => {
        try { resolve(JSON.parse(buf)) } catch { resolve(buf) }
      })
    })
    req.on("error", reject)
    req.setTimeout(15000, () => { req.destroy(); reject(new Error("timeout")) })
    if (body) req.write(JSON.stringify(body))
    req.end()
  })
}

function apiPost(apiPath, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE_URL + apiPath)
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
    req.setTimeout(30000, () => { req.destroy(); reject(new Error("timeout")) })
    req.write(data)
    req.end()
  })
}

async function broadcastTelegram(message) {
  if (!TG_TOKEN) return
  
  // 1. Refresh chat IDs if empty
  if (tgChatIds.length === 0) {
    try {
      const res = await new Promise((resolve) => {
        https.get(`https://api.telegram.org/bot${TG_TOKEN}/getUpdates`, (r) => {
          let b = ""; r.on("data", d => b += d); r.on("end", () => resolve(JSON.parse(b)))
        })
      })
      if (res.ok && res.result) {
        tgChatIds = [...new Set(res.result.map(u => u.message?.chat?.id || u.my_chat_member?.chat?.id).filter(id => id))]
      }
    } catch {}
  }

  // 2. Broadcast to all found IDs
  for (const chatId of tgChatIds) {
    try {
      const data = JSON.stringify({ chat_id: chatId, text: message, parse_mode: "Markdown" })
      const req = https.request({
        hostname: "api.telegram.org",
        path: `/bot${TG_TOKEN}/sendMessage`,
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) }
      })
      req.write(data); req.end()
    } catch {}
  }
}

// ─── Technical Analysis (embedded — no dependency on Next.js server) ──────────

function calcATR(bars, period = 14) {
  if (bars.length < 2) return 0
  const trs = []
  for (let i = 1; i < bars.length; i++) {
    trs.push(Math.max(
      bars[i].h - bars[i].l,
      Math.abs(bars[i].h - bars[i - 1].c),
      Math.abs(bars[i].l - bars[i - 1].c)
    ))
  }
  const s = trs.slice(-period)
  return s.reduce((a, b) => a + b, 0) / s.length
}

function calcEMA(closes, period) {
  const k = 2 / (period + 1)
  const emas = [closes[0]]
  for (let i = 1; i < closes.length; i++) {
    emas.push(closes[i] * k + emas[i - 1] * (1 - k))
  }
  return emas
}

function calcRSI(closes, period = 14) {
  if (closes.length < period + 1) return 50
  let gains = 0, losses = 0
  for (let i = closes.length - period; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1]
    if (d > 0) gains += d; else losses -= d
  }
  const rs = (gains / period) / ((losses / period) || 0.0001)
  return 100 - 100 / (1 + rs)
}

function calcMACD(closes) {
  if (closes.length < 35) return { macd: 0, signal: 0, hist: 0 }
  const ema12 = calcEMA(closes, 12)
  const ema26 = calcEMA(closes, 26)
  const macdLine = ema12.map((v, i) => v - ema26[i])
  const signalLine = calcEMA(macdLine, 9)
  const last = macdLine.length - 1
  return { macd: macdLine[last], signal: signalLine[last], hist: macdLine[last] - signalLine[last] }
}

function calcBB(closes, period = 20) {
  const s = closes.slice(-period)
  const m = s.reduce((a, b) => a + b, 0) / s.length
  const std = Math.sqrt(s.reduce((a, b) => a + (b - m) ** 2, 0) / s.length)
  return { upper: m + 2 * std, middle: m, lower: m - 2 * std }
}

function calcVWAP(bars) {
  let cumTP = 0, cumVol = 0
  for (const b of bars.slice(-20)) {
    cumTP += ((b.h + b.l + b.c) / 3) * b.v
    cumVol += b.v
  }
  return cumVol > 0 ? cumTP / cumVol : 0
}

// ─── ADX (Average Directional Index) ─────────────────────────────────────────────

function calcADX(bars, period = 14) {
  if (bars.length < period * 2) return 0

  let tr = [], plusDM = [], minusDM = []

  for (let i = 1; i < bars.length; i++) {
    const high = bars[i].h
    const low = bars[i].l
    const prevHigh = bars[i - 1].h
    const prevLow = bars[i - 1].l
    const prevClose = bars[i - 1].c

    const trVal = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose))
    tr.push(trVal)

    const upMove = high - prevHigh
    const downMove = prevLow - low

    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0)
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0)
  }

  // Smoothed values
  const trSmooth = calcEMA(tr, period)
  const plusDMSmooth = calcEMA(plusDM, period)
  const minusDMSmooth = calcEMA(minusDM, period)

  const plusDI = trSmooth.map((t, i) => t === 0 ? 0 : (plusDMSmooth[i] / t) * 100)
  const minusDI = trSmooth.map((t, i) => t === 0 ? 0 : (minusDMSmooth[i] / t) * 100)

  const dx = plusDI.map((pdi, i) => {
    const di = Math.abs(pdi - minusDI[i])
    const sum = pdi + minusDI[i]
    return sum === 0 ? 0 : (di / sum) * 100
  })

  const adx = calcEMA(dx, period)
  return adx[adx.length - 1] || 0
}

// ─── Market Regime Detection ────────────────────────────────────────────────────

function detectMarketRegime(bars, period = 20) {
  if (bars.length < period * 2) {
    return { trendStrength: "ranging", volatility: "normal", direction: "neutral", adx: 0, atrPct: 0 }
  }

  const closes = bars.map(b => b.c)

  // Calculate ADX
  const adx = calcADX(bars, 14)

  // Calculate ATR as percentage
  const atr = calcATR(bars, 14)
  const atrPct = (atr / closes[closes.length - 1]) * 100

  // Trend strength
  const trendStrength = adx > 30 ? "strong_trend" : adx > 20 ? "weak_trend" : "ranging"

  // Historical ATR for volatility comparison
  const histAtr = []
  for (let i = period; i < bars.length; i++) {
    const slice = bars.slice(i - period, i)
    histAtr.push((calcATR(slice, 14) / slice[slice.length - 1].c) * 100)
  }
  const avgAtr = histAtr.reduce((a, b) => a + b, 0) / histAtr.length

  const volatility = atrPct > avgAtr * 1.5 ? "high" : atrPct < avgAtr * 0.7 ? "low" : "normal"

  // Direction via EMA
  const ema20 = calcEMA(closes, 20)
  const ema50 = calcEMA(closes, 50)
  const emaSlope = ema20[ema20.length - 1] - ema20[Math.max(0, ema20.length - 5)]

  let direction = "neutral"
  if (ema20[ema20.length - 1] > ema50[ema50.length - 1]) {
    direction = emaSlope > 0 ? "bullish" : "neutral"
  } else {
    direction = emaSlope < 0 ? "bearish" : "neutral"
  }

  return { trendStrength, volatility, direction, adx, atrPct }
}

// ─── Signal Analysis ──────────────────────────────────────────────────────────

function analyzeSymbol(symbol, bars) {
  if (bars.length < MIN_BARS) return null

  // Check cooldown
  const now = Date.now()
  if (lastTradeTime[symbol] && now - lastTradeTime[symbol] < COOLDOWN_MS) {
    return null
  }

  // Check max positions
  const openPositions = Object.keys(posMap).length
  if (openPositions >= MAX_POSITIONS) {
    return null
  }

  // ─── MARKET REGIME DETECTION ────────────────────────────────────────────────────
  const regime = detectMarketRegime(bars, 20)

  const closes = bars.map(b => b.c)
  const volumes = bars.map(b => b.v)
  const price  = closes[closes.length - 1]
  const volume = volumes[volumes.length - 1]
  const avgVolume = volumes.slice(-20).reduce((a,b) => a+b, 0) / 20
  const atr    = calcATR(bars)
  const rsi    = calcRSI(closes)
  const { macd, signal: macdSig, hist } = calcMACD(closes)
  const ema9   = calcEMA(closes, 9)
  const ema21  = calcEMA(closes, 21)
  const { upper, lower, middle } = calcBB(closes)
  const vwap   = calcVWAP(bars)

  let action = null
  let confidence = 0
  let reason = ""

  // ─── ADAPTIVE PARAMETERS BASED ON REGIME ───────────────────────────────────────
  const isTrending = regime.trendStrength === "strong_trend" || regime.trendStrength === "weak_trend"
  const isRanging = regime.trendStrength === "ranging"
  const isHighVol = regime.volatility === "high"
  const isBullish = regime.direction === "bullish"
  const isBearish = regime.direction === "bearish"

  // Adjust thresholds based on regime
  const momentumThreshold = isTrending ? 0.5 : 0.7  // Easier momentum in trending
  const reversionThreshold = isRanging ? 0.3 : 0.5  // Easier reversion in ranging
  const volumeMult = isHighVol ? 1.3 : 1.5          // Lower volume requirement in high vol

  // ─── VOLUME SPIKE DETECTION ────────────────────────────────────────────────────
  const volumeSpike = volume > avgVolume * volumeMult
  const volumeVeryHigh = volume > avgVolume * (volumeMult * 1.3)

  // ─── REGIME-AWARE MOMENTUM SIGNALS ──────────────────────────────────────────────
  if (isTrending && regime.confidence > 0.6) {
    const emaBullish = ema9[ema9.length - 1] > ema21[ema21.length - 1]
    const emaBearish = ema9[ema9.length - 1] < ema21[ema21.length - 1]

    const prevCloses = closes.slice(0, -1)
    const prevHist = calcMACD(prevCloses).hist
    const macdCrossUp = prevHist <= 0 && hist > 0
    const macdCrossDn = prevHist >= 0 && hist < 0

    // Strong trend aligned momentum (best signal)
    if (emaBullish && isBullish && macdCrossUp && rsi < 75 && volumeSpike) {
      action = "buy"
      confidence = Math.min(0.9, 0.6 + (regime.adx / 100) * 0.3)
      reason = `Strong Trend Momentum ADX=${regime.adx.toFixed(0)} ${regime.direction} | RSI ${rsi.toFixed(0)}`
    }
    else if (emaBearish && isBearish && macdCrossDn && rsi > 25 && volumeSpike) {
      action = "sell"
      confidence = Math.min(0.9, 0.6 + (regime.adx / 100) * 0.3)
      reason = `Strong Trend Momentum ADX=${regime.adx.toFixed(0)} ${regime.direction} | RSI ${rsi.toFixed(0)}`
    }
    // Trend continuation
    else if (isBullish && emaBullish && rsi > 50 && rsi < 70 && price > middle) {
      action = "buy"
      confidence = 0.65
      reason = `Bullish Trend Cont. ADX=${regime.adx.toFixed(0)} | RSI ${rsi.toFixed(0)}`
    }
    else if (isBearish && emaBearish && rsi < 50 && rsi > 30 && price < middle) {
      action = "sell"
      confidence = 0.65
      reason = `Bearish Trend Cont. ADX=${regime.adx.toFixed(0)} | RSI ${rsi.toFixed(0)}`
    }
  }

  // ─── REGIME-AWARE MEAN REVERSION SIGNALS ────────────────────────────────────────
  if (!action && isRanging) {
    const bbPosition = (price - lower) / (upper - lower)

    // Deep oversold in ranging market (great signal)
    if (bbPosition < reversionThreshold && rsi < 40) {
      action = "buy"
      confidence = Math.min(0.9, 0.65 + (1 - bbPosition) * 0.25)
      reason = `Ranging: Deep Oversold BB${(bbPosition*100).toFixed(0)}% | RSI ${rsi.toFixed(0)}`
    }
    // Deep overbought in ranging market
    else if (bbPosition > (1 - reversionThreshold) && rsi > 60) {
      action = "sell"
      confidence = Math.min(0.9, 0.65 + bbPosition * 0.25)
      reason = `Ranging: Deep Overbought BB${(bbPosition*100).toFixed(0)}% | RSI ${rsi.toFixed(0)}`
    }
    // Z-score entry
    else {
      const mean = closes.slice(-20).reduce((a,b) => a+b, 0) / 20
      const std = Math.sqrt(closes.slice(-20).reduce((a,b) => a + (b-mean)**2, 0) / 20)
      const z = (price - mean) / (std || 1)

      if (z < -2 && rsi < 45) {
        action = "buy"
        confidence = 0.7
        reason = `Z-score ${z.toFixed(2)} oversold | RSI ${rsi.toFixed(0)}`
      }
      else if (z > 2 && rsi > 55) {
        action = "sell"
        confidence = 0.7
        reason = `Z-score ${z.toFixed(2)} overbought | RSI ${rsi.toFixed(0)}`
      }
    }
  }

  // ─── VOLATILITY-ADAPTED BREAKOUTS ───────────────────────────────────────────────
  if (!action && isHighVol) {
    const prevHigh = bars[bars.length - 2].h
    const prevLow = bars[bars.length - 2].l
    const currHigh = bars[bars.length - 1].h
    const currLow = bars[bars.length - 1].l

    // Breakout with volume
    if (currHigh > prevHigh * 1.002 && volumeVeryHigh && rsi < 75) {
      action = "buy"
      confidence = 0.7
      reason = `Volatility Breakout UP + High Vol | RSI ${rsi.toFixed(0)}`
    }
    else if (currLow < prevLow * 0.998 && volumeVeryHigh && rsi > 25) {
      action = "sell"
      confidence = 0.7
      reason = `Volatility Breakout DOWN + High Vol | RSI ${rsi.toFixed(0)}`
    }
  }

  // ─── PRICE ACTION PATTERNS (work in all regimes) ───────────────────────────────
  if (!action) {
    const prevBar = bars[bars.length - 2]
    const bar = bars[bars.length - 1]
    const bodySize = Math.abs(bar.c - bar.o)
    const prevBodySize = Math.abs(prevBar.c - prevBar.o)

    // Strong bullish candle
    if (bar.c > bar.o && bodySize > prevBodySize * 1.2 &&
        bar.c > prevBar.h && volumeSpike && rsi < 75) {
      action = "buy"
      confidence = 0.7
      reason = `Strong Bullish Candle + Volume`
    }
    // Strong bearish candle
    else if (bar.c < bar.o && bodySize > prevBodySize * 1.2 &&
             bar.c < prevBar.l && volumeSpike && rsi > 25) {
      action = "sell"
      confidence = 0.7
      reason = `Strong Bearish Candle + Volume`
    }
  }

  // ─── VWAP BOUNCE (works well in all regimes) ───────────────────────────────────
  if (!action) {
    const prevPrice = closes[closes.length - 2]
    const bouncedOffVWAP = (prevPrice < vwap && price > vwap) ||
                           (prevPrice > vwap && price < vwap)

    if (bouncedOffVWAP && volumeSpike) {
      action = price > vwap ? "buy" : "sell"
      confidence = 0.6
      reason = `VWAP Bounce + Volume | RSI ${rsi.toFixed(0)}`
    }
  }

  // ─── MULTI-BAR MOMENTUM (check last 3 bars) ────────────────────────────────────
  if (!action && bars.length >= 4) {
    const last3Closes = closes.slice(-3)
    const consecutiveUp = last3Closes.every((c, i) => i === 0 || c > last3Closes[i-1])
    const consecutiveDown = last3Closes.every((c, i) => i === 0 || c < last3Closes[i-1])

    if (consecutiveUp && volumeVeryHigh && rsi < 70) {
      action = "buy"
      confidence = 0.65
      reason = `3-Bar Up Trend + High Volume | RSI ${rsi.toFixed(0)}`
    }
    else if (consecutiveDown && volumeVeryHigh && rsi > 30) {
      action = "sell"
      confidence = 0.65
      reason = `3-Bar Down Trend + High Volume | RSI ${rsi.toFixed(0)}`
    }
  }

  if (!action || confidence < 0.5) return null

  // ─── VOLATILITY-ADAPTED POSITION SIZING ─────────────────────────────────────────
  const baseRisk = equity * 0.01
  const volAdjustedRisk = isHighVol ? baseRisk * 0.7 : baseRisk
  const slDistance = atr * (isHighVol ? 2.0 : 1.5)
  const tpDistance = atr * (isHighVol ? 3.0 : 2.5)

  const qty = Math.max(1, Math.floor(volAdjustedRisk / slDistance))
  const maxByPct = Math.floor((equity * 0.05) / price)
  const finalQty = Math.min(qty, maxByPct)

  const tpPrice = action === "buy" ? price + tpDistance : price - tpDistance
  const slPrice = action === "buy" ? price - slDistance : price + slDistance

  return {
    symbol, action, confidence, reason, price, atr,
    qty: Math.max(1, finalQty), tpPrice, slPrice,
    regime: `${regime.trendStrength}_${regime.direction}`  // Add regime info
  }
}

// ─── Execute Trade ────────────────────────────────────────────────────────────

async function executeTrade(signal) {
  // Record trade time for cooldown
  lastTradeTime[signal.symbol] = Date.now()

  if (DRY_RUN) {
    const regimeInfo = signal.regime ? `\nRegime: \`${signal.regime}\`` : ""
    const msg = `🔍 *[DRY]* ${signal.action === "buy" ? "🟢 BUY" : "🔴 SELL"} *${signal.symbol}* x${signal.qty}\nPrice: $${signal.price.toFixed(2)}\nConfidence: ${(signal.confidence * 100).toFixed(0)}%\nReason: ${signal.reason}${regimeInfo}`
    log("TRADE", `${C.yellow}[DRY]${C.reset} ${signal.action.toUpperCase()} ${signal.symbol} x${signal.qty} | TP: $${signal.tpPrice.toFixed(2)} SL: $${signal.slPrice.toFixed(2)} | ${signal.reason}`)
    broadcastTelegram(msg)
    totalTrades++
    return
  }

  try {
    const order = {
      symbol: signal.symbol,
      qty: signal.qty,
      side: signal.action,
      type: "market",
      time_in_force: "day",
      order_class: "bracket",
      take_profit: { limit_price: signal.tpPrice.toFixed(2) },
      stop_loss: { stop_price: signal.slPrice.toFixed(2) },
    }
    const result = await alpacaFetch("/orders", "POST", order)

    if (result.id) {
      const regimeInfo = signal.regime ? `\nRegime: \`${signal.regime}\`` : ""
      const msg = `🚀 *[LIVE]* ${signal.action === "buy" ? "🟢 BUY" : "🔴 SELL"} *${signal.symbol}* x${signal.qty}\nPrice: $${signal.price.toFixed(2)}\nTP: $${signal.tpPrice.toFixed(2)} | SL: $${signal.slPrice.toFixed(2)}\nOrder: ${result.id.slice(0,8)}${regimeInfo}`
      log("TRADE", `${C.green}[LIVE]${C.reset} ${signal.action.toUpperCase()} ${signal.symbol} x${signal.qty} | Order ${result.id.slice(0,8)} | TP: $${signal.tpPrice.toFixed(2)} SL: $${signal.slPrice.toFixed(2)}`)
      broadcastTelegram(msg)
      totalTrades++

      // Record in DB via API
      apiPost("/api/auto-trader", {
        dryRun: true, // just to log, already executed above
        forceRun: true,
      }).catch(() => {})
    } else {
      log("ERR", `Order failed: ${JSON.stringify(result).slice(0, 200)}`)
      totalErrors++
    }
  } catch (err) {
    log("ERR", `Trade ${signal.symbol}: ${err.message}`)
    totalErrors++
  }
}

// ─── Process incoming bar ─────────────────────────────────────────────────────

async function onBarReceived(bar) {
  const sym = bar.S
  if (!barBuffers[sym]) barBuffers[sym] = []

  const b = {
    o: Number(bar.o), h: Number(bar.h), l: Number(bar.l),
    c: Number(bar.c), v: Number(bar.v), t: bar.t
  }

  // Ring buffer: keep last BUFFER_SIZE bars
  barBuffers[sym].push(b)
  if (barBuffers[sym].length > BUFFER_SIZE) {
    barBuffers[sym] = barBuffers[sym].slice(-BUFFER_SIZE)
  }

  const bars = barBuffers[sym]
  const count = bars.length

  // Don't log every single bar — just show accumulation progress
  if (count % 10 === 0 || count === MIN_BARS) {
    log("BAR", `${sym}: ${count} bars buffered (price: $${b.c.toFixed(2)})`)
  }

  // Not enough data yet
  if (count < MIN_BARS) return

  // Skip if we already have a position in this symbol
  if (posMap[sym]) return

  // ── ANALYZE ──
  const signal = analyzeSymbol(sym, bars)
  if (!signal) return

  totalSignals++
  log("OK", `${C.bold}SIGNAL${C.reset} ${sym}: ${signal.action.toUpperCase()} (conf: ${signal.confidence.toFixed(2)}) — ${signal.reason}`)

  // Execute
  await executeTrade(signal)
}

// ─── Position Monitor (TP/SL fallback) ────────────────────────────────────────

async function monitorPositions() {
  try {
    const positions = await alpacaFetch("/positions")
    if (!Array.isArray(positions)) return

    posMap = {}
    for (const p of positions) {
      posMap[p.symbol] = p
      const plPct = parseFloat(p.unrealized_plpc || "0")

      // Take profit > 2.5%
      if (plPct > 0.025) {
        log("TRADE", `TP triggered: ${p.symbol} at +${(plPct * 100).toFixed(2)}%`)
        if (!DRY_RUN) {
          await alpacaFetch(`/positions/${encodeURIComponent(p.symbol)}`, "DELETE").catch(() => {})
        }
      }
      // Stop loss < -1.5%
      else if (plPct < -0.015) {
        log("TRADE", `SL triggered: ${p.symbol} at ${(plPct * 100).toFixed(2)}%`)
        if (!DRY_RUN) {
          await alpacaFetch(`/positions/${encodeURIComponent(p.symbol)}`, "DELETE").catch(() => {})
        }
      }
    }

    // Update equity
    const account = await alpacaFetch("/account")
    if (account.equity) equity = Number(account.equity)

    // Cancel stale orders (> 10 min)
    const orders = await alpacaFetch("/orders?status=open&limit=50")
    if (Array.isArray(orders)) {
      for (const o of orders) {
        const age = Date.now() - new Date(o.created_at).getTime()
        if (age > 10 * 60_000) {
          log("WARN", `Cancelling stale order ${o.symbol} (${Math.round(age / 60_000)}min old)`)
          if (!DRY_RUN) await alpacaFetch(`/orders/${o.id}`, "DELETE").catch(() => {})
        }
      }
    }
  } catch (err) {
    log("ERR", `Position monitor: ${err.message}`)
  }
}

// ─── WebSocket Connection ─────────────────────────────────────────────────────

function connectStream(wsUrl, symbols, label) {
  let ws
  let reconnectDelay = 1000
  let heartbeat = null

  function connect() {
    log("INFO", `${label}: Connecting to ${wsUrl}...`)
    ws = new WebSocket(wsUrl)

    ws.on("open", () => {
      log("OK", `${label}: WebSocket connected`)
      reconnectDelay = 1000 // reset
    })

    ws.on("message", (raw) => {
      try {
        const msgs = JSON.parse(raw.toString())
        for (const msg of msgs) {
          // Authentication flow
          if (msg.T === "success" && msg.msg === "connected") {
            // Authenticate
            ws.send(JSON.stringify({
              action: "auth",
              key: API_KEY,
              secret: API_SECRET,
            }))
            continue
          }

          if (msg.T === "success" && msg.msg === "authenticated") {
            log("OK", `${label}: Authenticated ✓`)
            // Subscribe to bars
            ws.send(JSON.stringify({
              action: "subscribe",
              bars: symbols,
            }))
            log("INFO", `${label}: Subscribed to ${symbols.length} symbols`)
            continue
          }

          if (msg.T === "error") {
            log("ERR", `${label}: ${msg.msg} (code: ${msg.code})`)
            continue
          }

          if (msg.T === "subscription") {
            log("OK", `${label}: Subscription confirmed: bars=[${(msg.bars || []).join(",")}]`)
            continue
          }

          // Bar data
          if (msg.T === "b") {
            onBarReceived(msg).catch(err => {
              log("ERR", `Bar processing: ${err.message}`)
              totalErrors++
            })
          }
        }
      } catch (err) {
        log("ERR", `${label} parse error: ${err.message}`)
      }
    })

    ws.on("close", (code, reason) => {
      log("WARN", `${label}: WebSocket closed (${code}) — reconnecting in ${reconnectDelay / 1000}s...`)
      clearInterval(heartbeat)
      setTimeout(() => {
        reconnectDelay = Math.min(reconnectDelay * 2, 30000) // exponential backoff max 30s
        connect()
      }, reconnectDelay)
    })

    ws.on("error", (err) => {
      log("ERR", `${label}: ${err.message}`)
    })

    // Heartbeat: keep connection alive
    heartbeat = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping()
      }
    }, 30000)
  }

  connect()
  return { getWs: () => ws }
}

// ─── Crash protection ─────────────────────────────────────────────────────────
process.on("uncaughtException", (err) => {
  log("ERR", `UNCAUGHT: ${err.message}`)
  totalErrors++
})
process.on("unhandledRejection", (reason) => {
  log("ERR", `UNHANDLED: ${reason}`)
  totalErrors++
})

// ─── Main ─────────────────────────────────────────────────────────────────────

console.log(`${C.bold}`)
console.log(`╔═══════════════════════════════════════════════╗`)
console.log(`║   AlgoTrade Streaming Worker (WebSocket)      ║`)
console.log(`╚═══════════════════════════════════════════════╝${C.reset}`)
console.log()
log("INFO", `Mode:    ${DRY_RUN ? `${C.yellow}DRY RUN${C.reset}` : `${C.red}🔴 LIVE TRADING${C.reset}`}`)
log("INFO", `Stocks:  ${STOCK_SYMBOLS.length} symbols via ${STOCK_WS}`)
log("INFO", `Crypto:  ${CRYPTO_SYMBOLS.length} symbols via ${CRYPTO_WS}`)
log("INFO", `Buffer:  ${BUFFER_SIZE} bars/symbol | Min: ${MIN_BARS} bars for analysis`)
log("INFO", `TP/SL:   Monitor every ${POSITION_CHECK_MS / 1000}s`)
console.log()

if (!API_KEY || !API_SECRET) {
  log("ERR", "ALPACA_API_KEY / ALPACA_API_SECRET missing from .env.local!")
  process.exit(1)
}

// Connect to both feeds
connectStream(STOCK_WS,  STOCK_SYMBOLS,  "STOCKS")
connectStream(CRYPTO_WS, CRYPTO_SYMBOLS, "CRYPTO")

// Position monitor + TP/SL + stale order cleanup
setInterval(monitorPositions, POSITION_CHECK_MS)
// First position check after 5s
setTimeout(monitorPositions, 5000)

// Health check log
setInterval(() => {
  const uptime = Math.floor(process.uptime() / 60)
  const buffered = Object.entries(barBuffers).map(([s, b]) => `${s}:${b.length}`).join(" ")
  log("INFO", `♥ uptime ${uptime}m | signals: ${totalSignals} | trades: ${totalTrades} | errors: ${totalErrors}`)
  if (Object.keys(barBuffers).length > 0) {
    log("INFO", `  buffers: ${buffered}`)
  }
}, 5 * 60_000)

// Graceful shutdown
process.on("SIGINT",  () => { log("INFO", "Shutting down..."); process.exit(0) })
process.on("SIGTERM", () => { process.exit(0) })
