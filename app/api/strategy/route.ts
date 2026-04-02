import { NextRequest, NextResponse } from "next/server"
import { getHistoricalBars, getPositions, submitOrder, getAccount as fetchAccount } from "@/lib/alpaca"
import { runStrategy, type StrategyConfig, type Bar } from "@/lib/strategy"
import {
  getStrategyConfigs,
  updateStrategyConfig,
  setStrategyActive,
  insertTradeSignal,
  insertTrade,
  insertPortfolioSnapshot,
  runMigrations,
} from "@/lib/db"

// GET – return all strategies from DB
export async function GET() {
  try {
    runMigrations()
    const configs = getStrategyConfigs()
    return NextResponse.json({ strategies: configs })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// PATCH – update strategy params / active state
export async function PATCH(req: NextRequest) {
  try {
    runMigrations()
    const body = await req.json()
    const { strategyId, params, is_active, auto_execute, symbols } = body

    if (!strategyId) {
      return NextResponse.json({ error: "strategyId required" }, { status: 400 })
    }

    if (is_active !== undefined) {
      setStrategyActive(strategyId, is_active)
    }

    const updated = updateStrategyConfig(strategyId, { params, auto_execute, symbols })
    return NextResponse.json({ strategy: updated })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// POST – run a strategy and optionally execute trades, persist to SQLite
export async function POST(req: NextRequest) {
  try {
    runMigrations()
    const body = await req.json()
    const { strategyId, customConfig, dryRun = true } = body

    // Load strategy from DB if not provided inline
    let strategy: StrategyConfig | undefined = customConfig
    if (!strategy) {
      const configs = getStrategyConfigs()
      const found = configs.find((c) => c.strategy_id === strategyId)
      if (!found) {
        return NextResponse.json({ error: "Strategy not found" }, { status: 400 })
      }
      strategy = {
        id: found.strategy_id as StrategyConfig["id"],
        name: found.name,
        description: found.description,
        symbols: found.symbols,
        params: found.params,
      }
    }

    // Fetch historical data for all symbols
    const barsBySymbol: Record<string, Bar[]> = {}
    await Promise.all(
      strategy.symbols.map(async (symbol) => {
        try {
          const data = await getHistoricalBars(symbol, "1Min", 100)
          barsBySymbol[symbol] = data.bars || []
        } catch {
          barsBySymbol[symbol] = []
        }
      })
    )

    // Fetch current positions
    const positions = await getPositions()
    const positionsBySymbol: Record<string, number> = {}
    for (const pos of positions) {
      positionsBySymbol[pos.symbol] = Math.abs(Number(pos.qty))
    }

    // Run strategy to get signals
    const signals = runStrategy(strategy, barsBySymbol, positionsBySymbol)

    const executedOrders: unknown[] = []
    const errors: string[] = []
    const dbTradeIds: number[] = []

    // Persist all signals to DB
    for (const signal of signals) {
      const lastBar = (barsBySymbol[signal.symbol] || []).slice(-1)[0]
      insertTradeSignal({
        strategy_id: strategy.id,
        symbol: signal.symbol,
        action: signal.action,
        qty: signal.qty,
        reason: signal.reason,
        confidence: signal.confidence,
        price_at_signal: lastBar?.c,
        was_executed: !dryRun && signal.action !== "hold",
      })
    }

    // Execute live orders and persist trades
    if (!dryRun && signals.length > 0) {
      for (const signal of signals) {
        if (signal.action === "hold") continue
        try {
          const order = await submitOrder({
            symbol: signal.symbol,
            qty: signal.qty,
            side: signal.action,
            type: "market",
            time_in_force: "day",
          })
          executedOrders.push(order)

          const dbTrade = insertTrade({
            symbol: signal.symbol,
            side: signal.action,
            qty: signal.qty,
            price: order.limit_price ? Number(order.limit_price) : undefined,
            order_id: order.id,
            status: order.status || "pending",
            strategy_id: strategy.id,
            signal_reason: signal.reason,
            confidence: signal.confidence,
            filled_avg_price: order.filled_avg_price ? Number(order.filled_avg_price) : undefined,
            filled_qty: order.filled_qty ? Number(order.filled_qty) : undefined,
          })
          dbTradeIds.push(dbTrade.id)
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : "Unknown error"
          errors.push(`${signal.symbol}: ${message}`)
        }
      }

      // Save portfolio snapshot after live execution
      try {
        const account = await fetchAccount()
        insertPortfolioSnapshot({
          equity: Number(account.equity),
          cash: Number(account.cash),
          buying_power: Number(account.buying_power),
          portfolio_value: Number(account.portfolio_value),
          profit_loss: Number(account.equity) - Number(account.last_equity),
          profit_loss_pct: ((Number(account.equity) - Number(account.last_equity)) / Number(account.last_equity)) * 100,
        })
      } catch {
        // Non-fatal
      }
    }

    return NextResponse.json({
      strategy: strategy.name,
      signals,
      executedOrders,
      errors,
      dryRun,
      dbTradeIds,
      timestamp: new Date().toISOString(),
      analysisData: {
        symbolCount: strategy.symbols.length,
        barsLoaded: Object.fromEntries(Object.entries(barsBySymbol).map(([k, v]) => [k, v.length])),
        positionsHeld: positionsBySymbol,
      },
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
