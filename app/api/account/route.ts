import { NextResponse } from "next/server"
import { getAccount, getPositions, getPortfolioHistory } from "@/lib/alpaca"
import { insertPortfolioSnapshot, runMigrations } from "@/lib/db"

export async function GET() {
  try {
    // Ensure DB tables exist (idempotent)
    runMigrations()

    const [account, positions, history] = await Promise.all([
      getAccount(),
      getPositions(),
      getPortfolioHistory("1D", "5Min"),
    ])

    // Auto-save a portfolio snapshot every refresh for chart history
    try {
      const equity = Number(account.equity)
      const lastEquity = Number(account.last_equity)
      if (equity > 0 && Number.isFinite(equity)) {
        insertPortfolioSnapshot({
          equity,
          cash: Number(account.cash) || 0,
          buying_power: Number(account.buying_power) || 0,
          portfolio_value: Number(account.portfolio_value) || 0,
          profit_loss: equity - lastEquity,
          profit_loss_pct: lastEquity > 0 ? ((equity - lastEquity) / lastEquity) * 100 : 0,
        })
      }
    } catch {
      // Non-fatal — DB snapshot issues don't block the dashboard
    }

    return NextResponse.json({ account, positions, history })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
