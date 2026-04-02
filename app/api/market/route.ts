import { NextRequest, NextResponse } from "next/server"
import { getHistoricalBars, getLatestBars, getLatestQuotes } from "@/lib/alpaca"

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const symbols = searchParams.get("symbols")?.split(",").filter(Boolean) || []
    const symbol = searchParams.get("symbol") || ""
    const timeframe = searchParams.get("timeframe") || "1Min"
    const limit = parseInt(searchParams.get("limit") || "100")
    const type = searchParams.get("type") || "bars"

    // Latest bars for watchlist — Alpaca returns { bars: { SYMBOL: [..] } }
    if (type === "latest" && symbols.length > 0) {
      const data = await getLatestBars(symbols)
      // Normalize: flatten each symbol's latest bar into { SYMBOL: bar }
      const flatBars: Record<string, any> = {}
      const rawBars = data.bars || {}
      for (const sym of Object.keys(rawBars)) {
        // Alpaca latest bars endpoint returns array or single object depending on feed
        const entry = rawBars[sym]
        flatBars[sym] = Array.isArray(entry) ? entry[entry.length - 1] : entry
      }
      return NextResponse.json({ bars: flatBars })
    }

    if (type === "quotes" && symbols.length > 0) {
      const data = await getLatestQuotes(symbols)
      return NextResponse.json(data)
    }

    // Historical bars for a single symbol — Alpaca returns { bars: [...] }
    if (symbol) {
      const data = await getHistoricalBars(symbol, timeframe, limit)
      const bars = Array.isArray(data.bars) ? data.bars : data.bars?.[symbol] || []
      return NextResponse.json({ bars })
    }

    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
