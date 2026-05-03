import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const maxDuration = 60

export async function GET(req: Request) {
  // Vercel sends Authorization: Bearer {CRON_SECRET} automatically
  const auth = req.headers.get("authorization")
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const baseUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000"

    const res = await fetch(`${baseUrl}/api/auto-trader`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dryRun: false }),
    })

    const data = await res.json()
    console.log("[CRON/trade]", JSON.stringify(data))
    return NextResponse.json({ ok: true, ...data })
  } catch (err: any) {
    console.error("[CRON/trade] error:", err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
