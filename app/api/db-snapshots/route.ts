import { getPortfolioSnapshots, runMigrations } from "@/lib/db"

export async function GET() {
  try {
    await runMigrations()
    const snapshots = await getPortfolioSnapshots(200)
    return Response.json({ snapshots }, { status: 200 })
  } catch (error: any) {
    return Response.json({ error: error.message }, { status: 500 })
  }
}
