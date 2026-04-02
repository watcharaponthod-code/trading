import { NextRequest, NextResponse } from "next/server"
import { getAccount, getPortfolioHistory } from "@/lib/alpaca"
import { getPortfolioSnapshots, insertPortfolioSnapshot } from "@/lib/db"

// GET – portfolio history from DB snapshots + live Alpaca portfolio history
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const source = searchParams.get("source") || "alpaca" // "db" | "alpaca"

    if (source === "db") {
      const snapshots = await getPortfolioSnapshots(200)
      return NextResponse.json({ snapshots })
    }

    // Fetch live from Alpaca and save a new snapshot
    const [history, account] = await Promise.all([
      getPortfolioHistory("1D", "5Min"),
      getAccount(),
    ])

    // Save current snapshot to DB
    try {
      await insertPortfolioSnapshot({
        equity: Number(account.equity),
        cash: Number(account.cash),
        buying_power: Number(account.buying_power),
        portfolio_value: Number(account.portfolio_value),
        profit_loss: Number(account.equity) - Number(account.last_equity),
        profit_loss_pct:
          ((Number(account.equity) - Number(account.last_equity)) /
            Number(account.last_equity || 1)) *
          100,
      })
    } catch {
      // Non-fatal
    }

    return NextResponse.json({ history, account })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
