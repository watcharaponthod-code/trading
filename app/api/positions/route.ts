import { NextRequest, NextResponse } from "next/server"
import { getPositions, closePosition } from "@/lib/alpaca"

export async function GET() {
  try {
    const positions = await getPositions()
    return NextResponse.json({ positions })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { symbol } = await req.json()
    if (!symbol) {
      return NextResponse.json({ error: "symbol required" }, { status: 400 })
    }
    const result = await closePosition(symbol)
    return NextResponse.json({ success: true, result })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
