import { NextRequest, NextResponse } from "next/server"
import { getHistoricalBars, submitOrder, getPositions, getAccount } from "@/lib/alpaca"
import {
  analyzePair,
  generateOrders,
  DEFAULT_STAT_ARB_CONFIG,
  STAT_ARB_PAIRS,
  type StatArbConfig,
  type PairStats,
} from "@/lib/stat-arb-engine"
import { insertTrade, insertTradeSignal, insertPortfolioSnapshot, runMigrations } from "@/lib/db"

// GET — fetch current stat-arb analysis for all pairs (no orders)
export async function GET() {
  try {
    runMigrations()
    const config = DEFAULT_STAT_ARB_CONFIG

    // Fetch positions for context
    const positions: any[] = await getPositions().catch(() => [])
    const posMap: Record<string, number> = {}
    for (const p of positions) {
      posMap[p.symbol] = Number(p.qty) * (p.side === "short" ? -1 : 1)
    }

    // Analyze all pairs in parallel
    // Use 1Day bars for correlation/beta/cointegration (90 days = reliable statistics)
    // Use 5Min bars for latest Z-score (today's intraday deviation)
    const pairResults = await Promise.all(
      STAT_ARB_PAIRS.map(async ([symA, symB]) => {
        try {
          // Daily bars for long-horizon statistics (90 days)
          const [dailyA, dailyB, intradayA, intradayB] = await Promise.all([
            getHistoricalBars(symA, "1Day", 90),
            getHistoricalBars(symB, "1Day", 90),
            getHistoricalBars(symA, "5Min", 50).catch(() => ({ bars: [] })),
            getHistoricalBars(symB, "5Min", 50).catch(() => ({ bars: [] })),
          ])

          const dailyPricesA = (dailyA.bars || []).map((b: any) => Number(b.c)).filter(Number.isFinite)
          const dailyPricesB = (dailyB.bars || []).map((b: any) => Number(b.c)).filter(Number.isFinite)

          if (dailyPricesA.length < 20 || dailyPricesB.length < 20) return null

          // Calculate beta/correlation from daily data (stable)
          const stats = analyzePair(symA, dailyPricesA, symB, dailyPricesB, config, {
            symbolA: posMap[symA] || 0,
            symbolB: posMap[symB] || 0,
          })

          // Override Z-score with intraday data if available (more responsive)
          let currentZ = stats.currentZ
          const intA = (intradayA.bars || []).map((b: any) => Number(b.c)).filter(Number.isFinite)
          const intB = (intradayB.bars || []).map((b: any) => Number(b.c)).filter(Number.isFinite)
          if (intA.length >= 10 && intB.length >= 10) {
            const len = Math.min(intA.length, intB.length)
            const intSpread = intA.slice(-len).map((a: number, i: number) => a - stats.beta * intB.slice(-len)[i])
            if (intSpread.length >= 5) {
              const m = intSpread.reduce((a: number, b: number) => a + b, 0) / intSpread.length
              const s = Math.sqrt(intSpread.reduce((a: number, b: number) => a + (b - m) ** 2, 0) / intSpread.length)
              currentZ = s > 0 ? (intSpread[intSpread.length - 1] - m) / s : 0
            }
          }

          return {
            pair: `${symA}/${symB}`,
            symbolA: symA,
            symbolB: symB,
            correlation: stats.correlation,
            beta: stats.beta,
            currentZ,
            halfLife: stats.halfLife,
            signal: stats.signal,
            isCointegrated: stats.isCointegrated,
            dailyBars: dailyPricesA.length,
            intradayBars: intA.length,
            spreadStd: Math.sqrt(stats.spread.reduce((a, s) => a + (s - stats.spread.reduce((x, y) => x + y, 0) / stats.spread.length) ** 2, 0) / stats.spread.length),
            zHistory: stats.zScores.slice(-20),
          }
        } catch {
          return null
        }
      })
    )

    const pairs = pairResults.filter(Boolean)
    return NextResponse.json({ pairs, config, timestamp: new Date().toISOString() })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// POST — run stat-arb engine and optionally execute trades
export async function POST(req: NextRequest) {
  try {
    runMigrations()
    const body = await req.json()
    const config: StatArbConfig = { ...DEFAULT_STAT_ARB_CONFIG, ...body.config }
    const dryRun: boolean = body.dryRun !== false // default to dry run for safety
    const selectedPairs: [string, string][] = body.pairs || STAT_ARB_PAIRS

    // Get current positions
    const positions: any[] = await getPositions().catch(() => [])
    const posMap: Record<string, number> = {}
    for (const p of positions) {
      posMap[p.symbol] = Number(p.qty) * (p.side === "short" ? -1 : 1)
    }

    const allSignals: any[] = []
    const allOrders: any[] = []
    const errors: string[] = []

    // Analyze all selected pairs using Daily bars for stability
    for (const [symA, symB] of selectedPairs) {
      try {
        const [dailyA, dailyB, intA, intB] = await Promise.all([
          getHistoricalBars(symA, "1Day", 90),
          getHistoricalBars(symB, "1Day", 90),
          getHistoricalBars(symA, "5Min", 50).catch(() => ({ bars: [] })),
          getHistoricalBars(symB, "5Min", 50).catch(() => ({ bars: [] })),
        ])

        const pricesA = (dailyA.bars || []).map((b: any) => Number(b.c)).filter(Number.isFinite)
        const pricesB = (dailyB.bars || []).map((b: any) => Number(b.c)).filter(Number.isFinite)

        if (pricesA.length < 20 || pricesB.length < 20) {
          errors.push(`${symA}/${symB}: insufficient daily data (${pricesA.length} days)`)
          continue
        }

        const stats = analyzePair(symA, pricesA, symB, pricesB, config, {
          symbolA: posMap[symA] || 0,
          symbolB: posMap[symB] || 0,
        })

        // Compute intraday Z-score override
        let currentZ = stats.currentZ
        const intPricesA = (intA.bars || []).map((b: any) => Number(b.c)).filter(Number.isFinite)
        const intPricesB = (intB.bars || []).map((b: any) => Number(b.c)).filter(Number.isFinite)
        if (intPricesA.length >= 10 && intPricesB.length >= 10) {
          const len = Math.min(intPricesA.length, intPricesB.length)
          const intSpread = intPricesA.slice(-len).map((a: number, i: number) => a - stats.beta * intPricesB.slice(-len)[i])
          if (intSpread.length >= 5) {
            const m = intSpread.reduce((a: number, b: number) => a + b, 0) / intSpread.length
            const s = Math.sqrt(intSpread.reduce((a: number, b: number) => a + (b - m) ** 2, 0) / intSpread.length)
            if (s > 0) currentZ = (intSpread[intSpread.length - 1] - m) / s
          }
        }

        // Override stats with intraday Z
        const effectiveSignal = (() => {
          const hasPos = (posMap[symA] || 0) !== 0 || (posMap[symB] || 0) !== 0
          if (hasPos && Math.abs(currentZ) < config.exitZ) return "close"
          if (hasPos && Math.abs(currentZ) > config.stopZ) return "close"
          if (!hasPos && currentZ > config.entryZ && stats.isCointegrated) return "short_A_long_B"
          if (!hasPos && currentZ < -config.entryZ && stats.isCointegrated) return "long_A_short_B"
          return "hold"
        })()

        const effectiveStats = { ...stats, currentZ, signal: effectiveSignal as any }

        // Record signal
        allSignals.push({
          pair: `${symA}/${symB}`,
          signal: effectiveSignal,
          currentZ,
          correlation: stats.correlation,
          beta: stats.beta,
          halfLife: stats.halfLife,
          isCointegrated: stats.isCointegrated,
        })

        // Log to DB if actionable
        if (effectiveSignal !== "hold") {
          insertTradeSignal({
            strategy_id: "stat_arb",
            symbol: `${symA}/${symB}`,
            action: effectiveSignal === "long_A_short_B" ? "buy"
                   : effectiveSignal === "short_A_long_B" ? "sell"
                   : "hold",
            qty: config.qtyA,
            reason: `z=${currentZ.toFixed(3)}, β=${stats.beta.toFixed(3)}, corr=${stats.correlation.toFixed(3)}, hl=${stats.halfLife.toFixed(1)}d`,
            confidence: Math.min(Math.abs(currentZ) / config.stopZ, 1),
            price_at_signal: pricesA[pricesA.length - 1],
            was_executed: !dryRun,
          })
        }

        // Execute orders
        if (effectiveSignal !== "hold") {
          const orders = generateOrders(effectiveStats, config, {
            symbolA: posMap[symA] || 0,
            symbolB: posMap[symB] || 0,
          })

          for (const o of orders) {
            if (dryRun) {
              allOrders.push({ ...o, status: "dry_run", pair: `${symA}/${symB}`, z: currentZ.toFixed(2) })
              continue
            }

            try {
              const alpacaOrder = await submitOrder({
                symbol: o.symbol,
                qty: o.qty,
                side: o.side,
                type: "market",
                time_in_force: "day",
              })

              const dbTrade = insertTrade({
                symbol: o.symbol,
                side: o.side,
                qty: o.qty,
                order_id: alpacaOrder.id,
                status: alpacaOrder.status,
                strategy_id: "stat_arb",
                signal_reason: o.reason,
                confidence: Math.min(Math.abs(currentZ) / config.stopZ, 1),
                filled_avg_price: alpacaOrder.filled_avg_price ? Number(alpacaOrder.filled_avg_price) : undefined,
                filled_qty: alpacaOrder.filled_qty ? Number(alpacaOrder.filled_qty) : undefined,
              })

              allOrders.push({
                ...o,
                status: "submitted",
                orderId: alpacaOrder.id,
                dbTradeId: dbTrade.id,
                pair: `${symA}/${symB}`,
              })
            } catch (err: any) {
              errors.push(`${o.symbol}: ${err.message}`)
            }
          }
        }
      } catch (err: any) {
        errors.push(`${symA}/${symB}: ${err.message}`)
      }
    }


    // Save portfolio snapshot after execution
    if (!dryRun && allOrders.length > 0) {
      try {
        const account = await getAccount()
        insertPortfolioSnapshot({
          equity: Number(account.equity),
          cash: Number(account.cash),
          buying_power: Number(account.buying_power),
          portfolio_value: Number(account.portfolio_value),
          profit_loss: Number(account.equity) - Number(account.last_equity),
          profit_loss_pct: ((Number(account.equity) - Number(account.last_equity)) / Number(account.last_equity)) * 100,
        })
      } catch {}
    }

    const actionablePairs = allSignals.filter(s => s.signal !== "hold")
    return NextResponse.json({
      timestamp: new Date().toISOString(),
      dryRun,
      pairsAnalyzed: allSignals.length,
      actionableSignals: actionablePairs.length,
      signals: allSignals,
      orders: allOrders,
      errors,
      summary: actionablePairs.length > 0
        ? `${actionablePairs.length} signal(s): ${actionablePairs.map(s => `${s.pair} (z=${s.currentZ.toFixed(2)}, ${s.signal})`).join(" | ")}`
        : "All pairs within normal range — no trade opportunity",
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
