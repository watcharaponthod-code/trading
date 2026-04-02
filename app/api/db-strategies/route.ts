import { getStrategyConfigs, runMigrations } from "@/lib/db"

export async function GET() {
  try {
    await runMigrations()
    const strategies = await getStrategyConfigs()
    return Response.json({ strategies }, { status: 200 })
  } catch (error: any) {
    return Response.json({ error: error.message }, { status: 500 })
  }
}
