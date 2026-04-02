import { NextResponse } from "next/server"
import {
  getAccount, getPositions, getOpenOrders, getHistoricalBars,
  cancelOrder, closePosition, submitBracketOrder
} from "@/lib/alpaca"
import {
  scoreMomentumSignal, scoreMeanReversionSignal,
  assessPortfolioRisk, DEFAULT_RISK_CONFIG, type RiskConfig, type OHLCV
} from "@/lib/risk-manager"
import { insertTrade, insertTradeSignal, insertPortfolioSnapshot, runMigrations } from "@/lib/db"

// Alpaca supports these crypto pairs 24/7
const CRYPTO_SYMBOLS = [
  "BTC/USD",
  "ETH/USD",
  "SOL/USD",
  "AVAX/USD",
  "DOGE/USD",
]

// Tiny fractional quantities safe for paper trading (Alpaca supports fractional crypto)
const CRYPTO_NOTIONAL: Record<string, number> = {
  "BTC/USD":  10,   // $10 worth
  "ETH/USD":  10,
  "SOL/USD":  10,
  "AVAX/USD": 10,
  "DOGE/USD": 10,
}

export async function GET() {
  return NextResponse.json({
    symbols: CRYPTO_SYMBOLS,
    note: "Crypto trades 24/7 — no market hours restriction",
  })
}

export async function POST(req: Request) {
  try {
    await runMigrations()
    const body = await req.json().catch(() => ({}))
    const dryRun: boolean = body.dryRun !== false
    const config: RiskConfig = { ...DEFAULT_RISK_CONFIG, maxPositionPct: 0.02, riskPerTrade: 0.005 }

    const log: string[] = []
    const signals: any[] = []
    const executedOrders: any[] = []
    const errors: string[] = []

    // Load account state
    const [account, positions, openOrders] = await Promise.all([
      getAccount(),
      getPositions(),
      getOpenOrders(),
    ])
    const equity = Number(account.equity)
    const lastEquity = Number(account.last_equity)
    const buyingPower = Number(account.buying_power)
    log.push(`Equity: $${equity.toFixed(2)}, BP: $${buyingPower.toFixed(2)}`)

    // Risk check
    const risk = assessPortfolioRisk(equity, lastEquity, positions, config)
    if (!risk.canTrade && !dryRun) {
      return NextResponse.json({ status: "risk_blocked", reason: risk.reason, dryRun })
    }

    // Build position map for crypto
    const posMap: Record<string, any> = {}
    for (const p of positions) posMap[p.symbol] = p

    // Stale order cleanup (> 15 min for crypto)
    const stale = openOrders.filter((o: any) => {
      const sym = o.symbol as string
      if (!CRYPTO_SYMBOLS.includes(sym)) return false
      return Date.now() - new Date(o.created_at).getTime() > 15 * 60_000
    })
    for (const o of stale) {
      try {
        if (!dryRun) await cancelOrder(o.id)
        log.push(`Cancelled stale crypto order: ${o.symbol}`)
      } catch {}
    }

    // TP/SL on existing crypto positions
    for (const pos of positions) {
      if (!CRYPTO_SYMBOLS.includes(pos.symbol)) continue
      const plPct = parseFloat(pos.unrealized_plpc || "0")
      if (plPct > 0.03) { // Crypto TP: +3%
        if (!dryRun) {
          try { await closePosition(pos.symbol); log.push(`TP: Closed ${pos.symbol} +${(plPct * 100).toFixed(2)}%`) } catch {}
        }
        signals.push({ symbol: pos.symbol, action: "close_tp", plPct: (plPct * 100).toFixed(2) })
      } else if (plPct < -0.02) { // Crypto SL: -2%
        if (!dryRun) {
          try { await closePosition(pos.symbol); log.push(`SL: Closed ${pos.symbol} ${(plPct * 100).toFixed(2)}%`) } catch {}
        }
        signals.push({ symbol: pos.symbol, action: "close_sl", plPct: (plPct * 100).toFixed(2) })
      }
    }

    // Scan each crypto symbol
    for (const sym of CRYPTO_SYMBOLS) {
      if (posMap[sym]) continue // already holding

      try {
        // Use 15Min bars for crypto (more volatile, need more recent data)
        const data = await getHistoricalBars(sym, "15Min", 100)
        const bars: OHLCV[] = (data.bars || []).map((b: any) => ({
          o: Number(b.o), h: Number(b.h), l: Number(b.l), c: Number(b.c), v: Number(b.v)
        })).filter((b: OHLCV) => Number.isFinite(b.c) && b.c > 0)

        if (bars.length < 35) {
          log.push(`${sym}: insufficient bars (${bars.length})`)
          continue
        }

        const momSig  = scoreMomentumSignal(sym, bars, equity, config)
        const mrSig   = scoreMeanReversionSignal(sym, bars, equity, config)
        const best = [momSig, mrSig]
          .filter(Boolean)
          .sort((a, b) => b!.confidence - a!.confidence)[0]

        if (!best || best.confidence < 0.55 || best.action === "hold") continue

        const tradeAction = best.action as "buy" | "sell"
        const notional = CRYPTO_NOTIONAL[sym] || 10
        const price = bars[bars.length - 1].c

        signals.push({
          symbol: sym,
          strategy: best.strategy,
          action: tradeAction,
          confidence: best.confidence.toFixed(2),
          price: price.toFixed(2),
          reason: best.reason,
        })

        await insertTradeSignal({
          strategy_id: `crypto_${best.strategy}`,
          symbol: sym,
          action: tradeAction,
          qty: notional / price,
          reason: best.reason,
          confidence: best.confidence,
          price_at_signal: price,
          was_executed: !dryRun,
        })

        if (!dryRun && risk.canTrade) {
          try {
            // Crypto: use notional (dollar amount), not qty
            const result = await submitBracketOrder({
              symbol: sym,
              qty: Math.max(1, best.suggestedQty),
              side: tradeAction,
              take_profit_price: parseFloat(best.tpPrice.toFixed(8)),
              stop_loss_price: parseFloat(best.slPrice.toFixed(8)),
            })
            await insertTrade({
              symbol: sym,
              side: tradeAction,
              qty: notional,
              order_id: result.id,
              status: result.status,
              strategy_id: `crypto_${best.strategy}`,
              signal_reason: best.reason,
              confidence: best.confidence,
            })
            executedOrders.push({ symbol: sym, side: tradeAction, orderId: result.id, strategy: best.strategy })
            log.push(`📈 Crypto ${tradeAction.toUpperCase()} ${sym} | TP: ${best.tpPrice.toFixed(2)} SL: ${best.slPrice.toFixed(2)}`)
          } catch (e: any) {
            errors.push(`${sym}: ${e.message}`)
          }
        }
      } catch (e: any) {
        errors.push(`${sym}: ${e.message}`)
      }
    }

    // Save portfolio snapshot
    try {
      await insertPortfolioSnapshot({
        equity, cash: Number(account.cash), buying_power: buyingPower,
        portfolio_value: Number(account.portfolio_value),
        profit_loss: equity - lastEquity,
        profit_loss_pct: lastEquity > 0 ? ((equity - lastEquity) / lastEquity) * 100 : 0,
      })
    } catch {}
 Drum:

    return NextResponse.json({
      status: dryRun ? "dry_run" : "executed",
      timestamp: new Date().toISOString(),
      marketAvailability: "24/7",
      signals,
      executedOrders,
      staleCleared: stale.length,
      errors,
      log,
      summary: `${signals.length} signal(s), ${executedOrders.length} executed`,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
