import { NextResponse } from "next/server"
import { getOpenOrders, cancelOrder, cancelAllOrders } from "@/lib/alpaca"

// GET — return all open orders
export async function GET() {
  try {
    const orders = await getOpenOrders()
    return NextResponse.json({ orders })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// DELETE — cancel a specific order or all open orders
export async function DELETE(req: Request) {
  try {
    const body = await req.json().catch(() => ({}))
    
    if (body.cancelAll) {
      // Cancel ALL open orders
      const result = await cancelAllOrders()
      return NextResponse.json({ success: true, cancelled: result.cancelled })
    }
    
    if (!body.orderId) {
      return NextResponse.json({ error: "orderId or cancelAll required" }, { status: 400 })
    }
    
    const result = await cancelOrder(body.orderId)
    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
