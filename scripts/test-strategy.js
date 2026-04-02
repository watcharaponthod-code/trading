/**
 * AlgoTrade Strategy Tester
 * 
 * ดึงข้อมูลย้อนหลังมาทดสอบกลยุทธ์แบบเดียวกับ Streaming Worker
 * เพื่อดูว่ากลยุทธ์ที่เขียนไว้ หาจังหวะเข้าซื้อ (signals) ได้จริงไหม
 * 
 * รัน: node scripts/test-strategy.js
 */

const https = require("https")
const fs    = require("fs")
const path  = require("path")

const envPath = path.join(__dirname, "..", ".env.local")
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, "utf-8").split("\n").forEach(line => {
    const m = line.match(/^([^#=]+)=(.*)$/)
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "")
  })
}

const API_KEY    = process.env.ALPACA_API_KEY
const API_SECRET = process.env.ALPACA_API_SECRET

// ─── Technical Analysis (เหมือน Worker) ──────────────────────────────────────────

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

function analyzeSymbol(symbol, bars) {
  if (bars.length < 35) return null

  const closes = bars.map(b => b.c)
  const price  = closes[closes.length - 1]
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

  // ─── Momentum Signals ───
  // อิงแค่เทรนด์เป็นหลัก + โมเมนตัมกำลังไปในทิศทางนั้น
  const emaBullish = ema9[ema9.length - 1] > ema21[ema21.length - 1]
  const emaBearish = ema9[ema9.length - 1] < ema21[ema21.length - 1]
  const macdBullish = hist > 0
  const macdBearish = hist < 0

  if (emaBullish && macdBullish && rsi > 40 && rsi < 70) {
    action = "buy"
    confidence = 0.70
    reason = `Uptrend (EMA9>21) + MACD Bullish + RSI ${rsi.toFixed(0)}`
  } else if (emaBearish && macdBearish && rsi < 60 && rsi > 30) {
    action = "sell"
    confidence = 0.70
    reason = `Downtrend (EMA9<21) + MACD Bearish + RSI ${rsi.toFixed(0)}`
  }

  // ─── Mean Reversion ───
  // ถ้าราคาออกนอกกรอบ Bollinger Bands มากๆ ให้สวนทาง
  if (!action && price <= lower * 1.001 && rsi < 40) {
    action = "buy"
    confidence = 0.80
    reason = `Oversold: RSI ${rsi.toFixed(0)}, Touch BB Lower (${lower.toFixed(2)})`
  } else if (!action && price >= upper * 0.999 && rsi > 60) {
    action = "sell"
    confidence = 0.80
    reason = `Overbought: RSI ${rsi.toFixed(0)}, Touch BB Upper (${upper.toFixed(2)})`
  }

  return { symbol, action, confidence, reason, price, rsi, macdHist: hist, lower, upper }
}

async function fetchHistorical(symbol) {
  return new Promise((resolve) => {
    // 15Min timeframes yield more clear trends in testing
    const url = new URL(`https://data.alpaca.markets/v2/stocks/bars?symbols=${symbol}&timeframe=15Min&limit=500`)
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: "GET",
      headers: {
        "APCA-API-KEY-ID": API_KEY,
        "APCA-API-SECRET-KEY": API_SECRET,
      },
    }
    const req = https.request(options, (res) => {
      let buf = ""
      res.on("data", d => buf += d)
      res.on("end", () => {
        try { resolve(JSON.parse(buf)) } catch { resolve(null) }
      })
    })
    req.on("error", () => resolve(null))
    req.end()
  })
}

async function run() {
  console.log("=========================================")
  console.log("   AlgoTrade — Strategy Backtest")
  console.log("=========================================")

  const symbols = ["AAPL", "MSFT", "NVDA", "SPY", "TSLA"]
  console.log(`Fetching 15Min bars for: ${symbols.join(", ")}...\n`)

  let totalSignals = 0

  for (const sym of symbols) {
    const data = await fetchHistorical(sym)
    if (!data || !data.bars || !data.bars[sym]) {
      console.log(`⚠️ ${sym}: ไม่สามารถดึงข้อมูลได้`)
      continue
    }

    const rawBars = data.bars[sym]
    // Simulate streaming by analyzing step by step
    // start from bar 40 to end
    let signalsForSym = 0
    
    for (let i = 40; i < rawBars.length; i++) {
        const history = rawBars.slice(Math.max(0, i - 100), i + 1).map(b => ({
            o: b.o, h: b.h, l: b.l, c: b.c, v: b.v, t: b.t
        }))
        
        const result = analyzeSymbol(sym, history)
        if (result && result.action) {
            const time = new Date(rawBars[i].t).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })
            console.log(`[${time}] สัญญาณมาแล้ว!`)
            console.log(`  👉 ${result.action === 'buy' ? '🟢 BUY' : '🔴 SELL'} ${sym} ที่ราคา $${result.price.toFixed(2)}`)
            console.log(`  📝 เหตุผล: ${result.reason}`)
            console.log(`  📊 RSI: ${result.rsi.toFixed(2)} | MACD Hist: ${result.macdHist.toFixed(4)}`)
            console.log(`-----------------------------------------`)
            signalsForSym++
            totalSignals++
        }
    }
    if (signalsForSym === 0) {
        console.log(`[${sym}] ไม่พบสัญญาณจากข้อมูลชุดนี้ (ตลาดอาจซึมหรือผันผวนเกินไป)`)
    }
  }

  console.log(`\n✅ ทดสอบเสร็จสิ้น! พบขุมทรัพย์ (signals) ปรากฏขึ้นทั้งหมด ${totalSignals} ครั้ง`)
}

run()
