import { NextResponse } from "next/server"
import { getPortfolioSnapshots } from "@/lib/db"

export async function GET() {
  try {
    const snapshots = await getPortfolioSnapshots(200)
    return NextResponse.json({ snapshots })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
