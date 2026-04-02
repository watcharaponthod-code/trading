import { getTrades, runMigrations } from "@/lib/db"

export async function GET() {
  try {
    await runMigrations()
    const trades = await getTrades(50)
    return Response.json({ trades }, { status: 200 })
  } catch (error: any) {
    return Response.json({ error: error.message }, { status: 500 })
  }
}
