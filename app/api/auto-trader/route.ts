import { NextResponse } from "next/server"
import {
  getAccount, getPositions, getOpenOrders, getHistoricalBars,
  cancelOrder, cancelAllOrders, submitBracketOrder, getMarketClock, closePosition
} from "@/lib/alpaca"
import {
  scoreMomentumSignal, scoreMeanReversionSignal,
  assessPortfolioRisk, DEFAULT_RISK_CONFIG, type RiskConfig, type OHLCV
} from "@/lib/risk-manager"
import {
  analyzePair, generateOrders, DEFAULT_STAT_ARB_CONFIG, STAT_ARB_PAIRS
} from "@/lib/stat-arb-engine"
import { insertTrade, insertTradeSignal, insertPortfolioSnapshot, runMigrations } from "@/lib/db"
import { submitOrder } from "@/lib/alpaca"

// ─── Symbols to scan for all non-stat-arb strategies ──────────────────────────
const SCAN_SYMBOLS = ["SPY", "QQQ", "AAPL", "MSFT", "TSLA", "NVDA", "AMD", "GOOGL", "META", "AMZN"]

// ─── Engine state (module-level, persists per server process) ─────────────────
let engineRunning = false
let lastRunAt: string | null = null
let lastRunResult: any = null
let totalCycles = 0
let totalTradesExecuted = 0

// ─── GET — engine status ──────────────────────────────────────────────────────
export async function GET() {
  try {
    const clock = await getMarketClock().catch(() => ({ is_open: false, next_open: "", next_close: "" }))
    return NextResponse.json({
      engineRunning,
      lastRunAt,
      lastRunResult,
      totalCycles,
      totalTradesExecuted,
      marketOpen: clock.is_open,
      nextOpen: clock.next_open,
      nextClose: clock.next_close,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// ─── POST — run one full engine cycle ─────────────────────────────────────────
export async function POST(req: Request) {
  try {
    runMigrations()
    const body = await req.json().catch(() => ({}))
    const dryRun: boolean = body.dryRun !== false
    const config: RiskConfig = { ...DEFAULT_RISK_CONFIG, ...(body.riskConfig || {}) }

    const log: string[] = []
    const executedOrders: any[] = []
    const signals: any[] = []
    const errors: string[] = []

    // 1. Check market hours
    const clock = await getMarketClock()
    log.push(`Market: ${clock.is_open ? "OPEN ✅" : "CLOSED ⛔"}`)
    if (!clock.is_open && !body.forceRun) {
      return NextResponse.json({
        status: "market_closed",
        message: `Market closed. Next open: ${clock.next_open}`,
        dryRun,
      })
    }

    // 2. Load account + positions + open orders
    const [account, positions, openOrders] = await Promise.all([
      getAccount(),
      getPositions(),
      getOpenOrders(),
    ])
    const equity = Number(account.equity)
    const lastEquity = Number(account.last_equity)
    const buyingPower = Number(account.buying_power)
    log.push(`Equity: $${equity.toFixed(2)}, BP: $${buyingPower.toFixed(2)}, Positions: ${positions.length}, Open Orders: ${openOrders.length}`)

    // 3. Portfolio risk check
    const risk = assessPortfolioRisk(equity, lastEquity, positions, config)
    log.push(`Risk: ${risk.reason} | Heat: ${(risk.totalRiskPct * 100).toFixed(1)}% | Daily P&L: ${(risk.dailyPnlPct * 100).toFixed(2)}%`)

    if (!risk.canTrade && !dryRun) {
      return NextResponse.json({
        status: "risk_blocked",
        reason: risk.reason,
        risk,
        log,
        dryRun,
      })
    }

    // 4. Stale order cleanup — cancel any open orders older than 10 minutes
    const staleOrders = openOrders.filter((o: any) => {
      const age = Date.now() - new Date(o.created_at).getTime()
      return age > 10 * 60 * 1000 // 10 min
    })
    if (staleOrders.length > 0) {
      log.push(`Cleaning ${staleOrders.length} stale order(s)...`)
      for (const o of staleOrders) {
        try {
          if (!dryRun) await cancelOrder(o.id)
          log.push(`  Cancelled stale order: ${o.symbol} ${o.side} x${o.qty} (age: ${Math.round((Date.now() - new Date(o.created_at).getTime()) / 60000)}min)`)
        } catch (e: any) {
          errors.push(`Stale cancel ${o.id}: ${e.message}`)
        }
      }
    }

    // Build position lookup
    const posMap: Record<string, any> = {}
    for (const p of positions) posMap[p.symbol] = p

    // 5. Check existing positions for TP/SL
    for (const pos of positions) {
      const pl = parseFloat(pos.unrealized_pl || "0")
      const plPct = parseFloat(pos.unrealized_plpc || "0")
      const mv = parseFloat(pos.market_value || "0")
      const qty = parseFloat(pos.qty || "1")

      // Take profit: if position up > 2.5% → close
      if (plPct > 0.025) {
        signals.push({ symbol: pos.symbol, action: "close_tp", plPct: (plPct * 100).toFixed(2), reason: "Take profit triggered (>2.5%)" })
        if (!dryRun) {
          try {
            await closePosition(pos.symbol)
            executedOrders.push({ symbol: pos.symbol, action: "close", reason: `TP: +${(plPct * 100).toFixed(2)}%` })
            log.push(`TP: Closed ${pos.symbol} at +${(plPct * 100).toFixed(2)}%`)
          } catch (e: any) { errors.push(`TP close ${pos.symbol}: ${e.message}`) }
        }
      }
      // Stop loss: if position down > 1.5% → close
      else if (plPct < -0.015) {
        signals.push({ symbol: pos.symbol, action: "close_sl", plPct: (plPct * 100).toFixed(2), reason: "Stop loss triggered (<-1.5%)" })
        if (!dryRun) {
          try {
            await closePosition(pos.symbol)
            executedOrders.push({ symbol: pos.symbol, action: "close", reason: `SL: ${(plPct * 100).toFixed(2)}%` })
            log.push(`SL: Closed ${pos.symbol} at ${(plPct * 100).toFixed(2)}%`)
          } catch (e: any) { errors.push(`SL close ${pos.symbol}: ${e.message}`) }
        }
      }
    }

    // 6. Run Stat-Arb on pairs
    for (const [symA, symB] of STAT_ARB_PAIRS) {
      try {
        if (posMap[symA] || posMap[symB]) continue // already have a position, let SL/TP handle it

        const [dailyA, dailyB, intA, intB] = await Promise.all([
          getHistoricalBars(symA, "1Day", 90),
          getHistoricalBars(symB, "1Day", 90),
          getHistoricalBars(symA, "5Min", 48).catch(() => ({ bars: [] })),
          getHistoricalBars(symB, "5Min", 48).catch(() => ({ bars: [] })),
        ])
        const pA = (dailyA.bars || []).map((b: any) => Number(b.c)).filter(Number.isFinite)
        const pB = (dailyB.bars || []).map((b: any) => Number(b.c)).filter(Number.isFinite)
        if (pA.length < 30 || pB.length < 30) continue

        const stats = analyzePair(symA, pA, symB, pB, DEFAULT_STAT_ARB_CONFIG, { symbolA: 0, symbolB: 0 })

        // Intraday Z override
        let z = stats.currentZ
        const iA = (intA.bars || []).map((b: any) => Number(b.c)).filter(Number.isFinite)
        const iB = (intB.bars || []).map((b: any) => Number(b.c)).filter(Number.isFinite)
        if (iA.length >= 10 && iB.length >= 10) {
          const len = Math.min(iA.length, iB.length)
          const spread = iA.slice(-len).map((a: number, i: number) => a - stats.beta * iB.slice(-len)[i])
          const m = spread.reduce((a: number, b: number) => a + b, 0) / spread.length
          const s = Math.sqrt(spread.reduce((a: number, b: number) => a + (b - m) ** 2, 0) / spread.length)
          if (s > 0) z = (spread[spread.length - 1] - m) / s
        }

        if (Math.abs(z) > DEFAULT_STAT_ARB_CONFIG.entryZ && stats.isCointegrated) {
          const effectiveSignal = z > 0 ? "short_A_long_B" : "long_A_short_B"
          signals.push({ pair: `${symA}/${symB}`, z: z.toFixed(2), signal: effectiveSignal, corr: stats.correlation.toFixed(2) })

          if (!dryRun && risk.canTrade) {
            const orders = generateOrders({ ...stats, currentZ: z, signal: effectiveSignal as any }, DEFAULT_STAT_ARB_CONFIG, { symbolA: 0, symbolB: 0 })
            for (const o of orders) {
              try {
                const result = await submitOrder({ symbol: o.symbol, qty: o.qty, side: o.side, type: "market", time_in_force: "day" })
                insertTrade({ symbol: o.symbol, side: o.side, qty: o.qty, order_id: result.id, status: result.status, strategy_id: "stat_arb", signal_reason: o.reason })
                executedOrders.push({ ...o, orderId: result.id, pair: `${symA}/${symB}` })
                totalTradesExecuted++
              } catch (e: any) { errors.push(`${o.symbol}: ${e.message}`) }
            }
          }
        }
      } catch (e: any) {
        errors.push(`StatArb ${symA}/${symB}: ${e.message}`)
      }
    }

    // 7. Run Momentum + Mean Reversion on individual symbols
    if (risk.canTrade) {
      for (const sym of SCAN_SYMBOLS) {
        if (posMap[sym]) continue // skip if already holding

        try {
          const data = await getHistoricalBars(sym, "15Min", 80)
          const bars: OHLCV[] = (data.bars || []).map((b: any) => ({ o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }))
          if (bars.length < 35) continue

          const momSig = scoreMomentumSignal(sym, bars, equity, config)
          const mrSig = scoreMeanReversionSignal(sym, bars, equity, config)

          // Pick best signal
          const best = [momSig, mrSig]
            .filter(Boolean)
            .sort((a, b) => b!.confidence - a!.confidence)[0]

          if (best && best.confidence >= 0.55 && best.action !== "hold") {
            const tradeAction = best.action as "buy" | "sell"
            signals.push({ symbol: sym, strategy: best.strategy, action: tradeAction, confidence: best.confidence.toFixed(2), reason: best.reason })

            insertTradeSignal({
              strategy_id: best.strategy,
              symbol: sym,
              action: tradeAction,
              qty: best.suggestedQty,
              reason: best.reason,
              confidence: best.confidence,
              price_at_signal: bars[bars.length - 1].c,
              was_executed: !dryRun,
            })

            if (!dryRun) {
              try {
                const result = await submitBracketOrder({
                  symbol: sym,
                  qty: best.suggestedQty,
                  side: tradeAction,
                  take_profit_price: best.tpPrice,
                  stop_loss_price: best.slPrice,
                })
                insertTrade({ symbol: sym, side: tradeAction, qty: best.suggestedQty, order_id: result.id, status: result.status, strategy_id: best.strategy, signal_reason: best.reason, confidence: best.confidence })
                executedOrders.push({ symbol: sym, side: tradeAction, qty: best.suggestedQty, strategy: best.strategy, tp: best.tpPrice.toFixed(2), sl: best.slPrice.toFixed(2), orderId: result.id })
                totalTradesExecuted++
                log.push(`📈 Bracket ${tradeAction.toUpperCase()} ${sym} x${best.suggestedQty} | TP: $${best.tpPrice.toFixed(2)} SL: $${best.slPrice.toFixed(2)}`)
              } catch (e: any) {
                errors.push(`${sym}: ${e.message}`)
              }
            }
          }
        } catch (e: any) {
          errors.push(`Scan ${sym}: ${e.message}`)
        }
      }
    }

    // 8. Save portfolio snapshot
    try {
      insertPortfolioSnapshot({
        equity, cash: Number(account.cash), buying_power: buyingPower,
        portfolio_value: Number(account.portfolio_value),
        profit_loss: equity - lastEquity,
        profit_loss_pct: lastEquity > 0 ? ((equity - lastEquity) / lastEquity) * 100 : 0,
      })
    } catch {}

    totalCycles++
    lastRunAt = new Date().toISOString()
    lastRunResult = {
      signals: signals.length,
      executed: executedOrders.length,
      staleCleared: staleOrders.length,
      errors: errors.length,
      canTrade: risk.canTrade,
    }

    return NextResponse.json({
      status: dryRun ? "dry_run" : "executed",
      timestamp: lastRunAt,
      cycle: totalCycles,
      marketOpen: clock.is_open,
      risk,
      signals,
      executedOrders,
      staleOrdersCleared: staleOrders.length,
      errors,
      log,
      summary: `${signals.length} signal(s), ${executedOrders.length} order(s), ${staleOrders.length} stale cleared`,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
