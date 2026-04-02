import { getTradeSignals, runMigrations } from "@/lib/db"

export async function GET() {
  try {
    await runMigrations()
    const signals = await getTradeSignals(100)
    return Response.json({ signals }, { status: 200 })
  } catch (error: any) {
    return Response.json({ error: error.message }, { status: 500 })
  }
}
