import { NextResponse } from "next/server"
import {
  getAccount, getPositions, getHistoricalBars,
  cancelAllOrders, submitBracketOrder, closePosition,
} from "@/lib/alpaca"
import { insertTrade, insertTradeSignal, runMigrations } from "@/lib/db"

export const runtime = "nodejs"
export const maxDuration = 60

const THAI_LLM_URL = "http://thaillm.or.th/api/v1/chat/completions"
const THAI_LLM_MODEL = "pathumma-thaillm-qwen3-8b-think-3.0.0"
const SYMBOLS = ["SPY", "QQQ"]

// ─── Indicators ────────────────────────────────────────────────────────────────
function calcRSI(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50
  let gains = 0, losses = 0
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1]
    if (diff > 0) gains += diff
    else losses += Math.abs(diff)
  }
  const rs = (gains / period) / ((losses / period) || 1)
  return 100 - 100 / (1 + rs)
}

function calcEMA(closes: number[], period: number): number {
  if (!closes.length) return 0
  const k = 2 / (period + 1)
  let ema = closes[0]
  for (let i = 1; i < closes.length; i++) ema = closes[i] * k + ema * (1 - k)
  return ema
}

// ─── ThaiLLM call ──────────────────────────────────────────────────────────────
async function askThaiLLM(prompt: string): Promise<any> {
  const apiKey = process.env.THAI_LLM_API_KEY
  if (!apiKey) throw new Error("THAI_LLM_API_KEY not configured")

  const res = await fetch(THAI_LLM_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: THAI_LLM_MODEL,
      messages: [
        {
          role: "system",
          content: "You are an expert quantitative trader. Respond ONLY with valid JSON, no markdown, no extra text.",
        },
        { role: "user", content: prompt },
      ],
      max_tokens: 256,
      temperature: 0.1,
    }),
  })

  if (!res.ok) throw new Error(`ThaiLLM ${res.status}: ${res.statusText}`)
  const data = await res.json()
  const text = data.choices?.[0]?.message?.content || ""

  // Extract JSON from response (strip any <think> tags or markdown)
  const match = text.replace(/<think>[\s\S]*?<\/think>/gi, "").match(/\{[\s\S]*?\}/)
  if (!match) throw new Error(`Cannot parse AI response: ${text.slice(0, 200)}`)
  return JSON.parse(match[0])
}

// ─── Main handler ──────────────────────────────────────────────────────────────
export async function GET(req: Request) {
  const auth = req.headers.get("authorization")
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    await runMigrations()
    const results: any[] = []

    // Step 1: Cancel ALL open orders (clear stale orders)
    let cancelledCount = 0
    try {
      const cancelled = await cancelAllOrders()
      cancelledCount = cancelled.cancelled
    } catch { /* ignore if no orders */ }

    // Step 2: Account + positions
    const [account, positions] = await Promise.all([getAccount(), getPositions()])
    const equity = Number(account.equity)
    const buyingPower = Number(account.buying_power)

    // Step 3: Analyze each symbol
    for (const symbol of SYMBOLS) {
      try {
        // Get 1-hour bars (last 30 candles)
        const barsData = await getHistoricalBars(symbol, "1Hour", 100)
        const bars: any[] = barsData.bars || []
        if (bars.length < 5) {
          results.push({ symbol, skipped: "insufficient data" })
          continue
        }

        const closes = bars.map((b: any) => Number(b.c))
        const currentPrice = closes[closes.length - 1]
        const rsi = calcRSI(closes)
        const ema9 = calcEMA(closes, 9)
        const ema21 = calcEMA(closes, 21)
        const trend = ema9 > ema21 ? "BULLISH" : "BEARISH"

        // VWAP from last 5 bars
        const last5 = bars.slice(-5)
        const vwapNum = last5.reduce((s: number, b: any) => s + Number(b.c) * Number(b.v), 0)
        const vwapDen = last5.reduce((s: number, b: any) => s + Number(b.v), 0)
        const vwap = vwapNum / (vwapDen || 1)

        // Current position
        const pos = positions.find((p: any) => p.symbol === symbol)
        const posQty = pos ? Math.abs(Number(pos.qty)) : 0
        const posSide = pos ? (Number(pos.qty) > 0 ? "LONG" : "SHORT") : "NONE"
        const posPnl = pos ? Number(pos.unrealized_pl).toFixed(2) : "0"

        // Recent 5 candles
        const candleStr = bars.slice(-5).map((b: any) =>
          `O:${Number(b.o).toFixed(1)} H:${Number(b.h).toFixed(1)} L:${Number(b.l).toFixed(1)} C:${Number(b.c).toFixed(1)}`
        ).join(" | ")

        // Step 4: Ask ThaiLLM
        const prompt = `Analyze and decide BUY or SELL for this hourly swing trade. You MUST pick one.

Symbol: ${symbol} | Price: $${currentPrice.toFixed(2)}
RSI(14): ${rsi.toFixed(1)} | EMA9: ${ema9.toFixed(2)} | EMA21: ${ema21.toFixed(2)} | Trend: ${trend}
VWAP(5h): ${vwap.toFixed(2)} | Equity: $${equity.toFixed(0)} | BuyingPower: $${buyingPower.toFixed(0)}
Last 5 hourly candles: ${candleStr}
Current position: ${posSide} qty:${posQty} P&L:$${posPnl}

Rules:
- BUY: enter long with bracket order (take_profit + stop_loss auto set)
- SELL: close existing long position
- qty: 1 share
- take_profit_pct: 1.5 to 4.0 (realistic for 1-hour swing)
- stop_loss_pct: 0.8 to 2.0

Respond ONLY JSON:
{"action":"BUY","symbol":"${symbol}","qty":1,"take_profit_pct":2.5,"stop_loss_pct":1.2,"reason":"one line reason"}`

        const ai = await askThaiLLM(prompt)

        if (!ai.action || !["BUY", "SELL"].includes(ai.action.toUpperCase())) {
          results.push({ symbol, error: "AI returned invalid action", raw: ai })
          continue
        }

        const action = ai.action.toUpperCase() as "BUY" | "SELL"
        const qty: number = ai.qty || 1
        const tpPct: number = (ai.take_profit_pct || 2.5) / 100
        const slPct: number = (ai.stop_loss_pct || 1.5) / 100

        let order: any = null

        // Step 5: Execute
        if (action === "BUY") {
          // Close short first if exists
          if (posSide === "SHORT") {
            try { await closePosition(symbol) } catch { /* ignore */ }
          }
          const tp = currentPrice * (1 + tpPct)
          const sl = currentPrice * (1 - slPct)
          order = await submitBracketOrder({
            symbol,
            qty,
            side: "buy",
            take_profit_price: tp,
            stop_loss_price: sl,
          })
        } else {
          // SELL: close long position
          if (posSide === "LONG" && posQty > 0) {
            try { await closePosition(symbol) } catch { /* ignore */ }
            order = { id: "close-position", status: "sent" }
          } else {
            results.push({ symbol, action: "SELL", skipped: "no long position", reason: ai.reason })
            continue
          }
        }

        // Step 6: Log to DB
        await insertTradeSignal({
          strategy_id: "ai_hourly",
          symbol,
          action: action.toLowerCase(),
          qty,
          reason: `[ThaiLLM] ${ai.reason}`,
          confidence: 0.85,
          price_at_signal: currentPrice,
          was_executed: true,
        })

        if (order?.id) {
          await insertTrade({
            symbol,
            side: action.toLowerCase(),
            qty,
            price: currentPrice,
            order_id: order.id,
            status: order.status || "submitted",
            strategy_id: "ai_hourly",
            signal_reason: ai.reason,
            confidence: 0.85,
          })
        }

        results.push({
          symbol,
          action,
          price: currentPrice,
          qty,
          takeProfit: action === "BUY" ? (currentPrice * (1 + tpPct)).toFixed(2) : null,
          stopLoss: action === "BUY" ? (currentPrice * (1 - slPct)).toFixed(2) : null,
          reason: ai.reason,
          orderId: order?.id,
        })
      } catch (err: any) {
        results.push({ symbol, error: err.message })
      }
    }

    return NextResponse.json({
      ok: true,
      timestamp: new Date().toISOString(),
      ordersCleared: cancelledCount,
      results,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
