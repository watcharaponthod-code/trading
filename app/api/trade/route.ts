import { NextResponse } from "next/server"
import { submitOrder } from "@/lib/alpaca"
import { insertTrade, getTrades, runMigrations } from "@/lib/db"

// GET – return all trades from DB
export async function GET() {
  try {
    runMigrations()
    const trades = getTrades(100)
    return NextResponse.json({ trades })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// POST – submit a manual order and persist to DB
export async function POST(req: Request) {
  try {
    runMigrations()
    const body = await req.json()
    const { symbol, qty, side, type, time_in_force, limit_price, stop_price, strategy_id } = body

    if (!symbol || !side || !type || !time_in_force) {
      return NextResponse.json({ error: "Missing required order fields" }, { status: 400 })
    }

    const order = await submitOrder({
      symbol,
      qty: qty ? Number(qty) : undefined,
      side,
      type,
      time_in_force,
      limit_price: limit_price ? Number(limit_price) : undefined,
      stop_price: stop_price ? Number(stop_price) : undefined,
    })

    // Persist to DB (sync)
    const dbTrade = insertTrade({
      symbol,
      side,
      qty: Number(qty),
      price: limit_price ? Number(limit_price) : undefined,
      order_id: order.id,
      status: order.status || "pending",
      strategy_id: strategy_id || undefined,
      filled_avg_price: order.filled_avg_price ? Number(order.filled_avg_price) : undefined,
      filled_qty: order.filled_qty ? Number(order.filled_qty) : undefined,
    })

    return NextResponse.json({ order, dbTrade })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
