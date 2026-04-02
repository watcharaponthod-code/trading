import { NextResponse } from "next/server"
import { getTradeSignals } from "@/lib/db"

// GET – return all trade signals from DB
export async function GET() {
  try {
    const signals = await getTradeSignals(100)
    return NextResponse.json({ signals })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
