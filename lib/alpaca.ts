const API_KEY = process.env.ALPACA_API_KEY!
const API_SECRET = process.env.ALPACA_API_SECRET!
const BASE_URL = process.env.ALPACA_BASE_URL || "https://paper-api.alpaca.markets/v2"
const DATA_URL = "https://data.alpaca.markets/v2"

const headers = {
  "APCA-API-KEY-ID": API_KEY,
  "APCA-API-SECRET-KEY": API_SECRET,
  "Content-Type": "application/json",
}

export async function getAccount() {
  const res = await fetch(`${BASE_URL}/account`, { headers, cache: "no-store" })
  if (!res.ok) throw new Error(`Account fetch failed: ${res.statusText}`)
  return res.json()
}

export async function getPositions() {
  const res = await fetch(`${BASE_URL}/positions`, { headers, cache: "no-store" })
  if (!res.ok) throw new Error(`Positions fetch failed: ${res.statusText}`)
  return res.json()
}

export async function getOrders(status = "all", limit = 50) {
  const res = await fetch(`${BASE_URL}/orders?status=${status}&limit=${limit}&direction=desc`, {
    headers,
    cache: "no-store",
  })
  if (!res.ok) throw new Error(`Orders fetch failed: ${res.statusText}`)
  return res.json()
}

export async function submitOrder(params: {
  symbol: string
  qty?: number
  notional?: number
  side: "buy" | "sell"
  type: "market" | "limit" | "stop" | "stop_limit"
  time_in_force: "day" | "gtc" | "ioc" | "fok"
  limit_price?: number
  stop_price?: number
}) {
  const res = await fetch(`${BASE_URL}/orders`, {
    method: "POST",
    headers,
    body: JSON.stringify(params),
  })
  if (!res.ok) {
    const err = await res.json()
    throw new Error(err.message || `Order failed: ${res.statusText}`)
  }
  return res.json()
}

export async function cancelOrder(orderId: string) {
  const res = await fetch(`${BASE_URL}/orders/${orderId}`, {
    method: "DELETE",
    headers,
  })
  if (!res.ok) throw new Error(`Cancel order failed: ${res.statusText}`)
  return { success: true }
}

export async function closePosition(symbol: string) {
  const res = await fetch(`${BASE_URL}/positions/${symbol}`, {
    method: "DELETE",
    headers,
  })
  if (!res.ok) {
    const err = await res.json()
    throw new Error(err.message || `Close position failed: ${res.statusText}`)
  }
  return res.json()
}

export async function getLatestBars(symbols: string[]) {
  const symbolsParam = symbols.join(",")
  const res = await fetch(`${DATA_URL}/stocks/bars/latest?symbols=${symbolsParam}&feed=iex`, {
    headers,
    cache: "no-store",
  })
  if (!res.ok) throw new Error(`Bars fetch failed: ${res.statusText}`)
  return res.json()
}

export async function getHistoricalBars(
  symbol: string,
  timeframe = "1Min",
  limit = 100
) {
  const end = new Date().toISOString()
  const res = await fetch(
    `${DATA_URL}/stocks/${symbol}/bars?timeframe=${timeframe}&limit=${limit}&feed=iex&end=${end}`,
    { headers, cache: "no-store" }
  )
  if (!res.ok) throw new Error(`Historical bars fetch failed: ${res.statusText}`)
  return res.json()
}

export async function getLatestQuotes(symbols: string[]) {
  const symbolsParam = symbols.join(",")
  const res = await fetch(`${DATA_URL}/stocks/quotes/latest?symbols=${symbolsParam}&feed=iex`, {
    headers,
    cache: "no-store",
  })
  if (!res.ok) throw new Error(`Quotes fetch failed: ${res.statusText}`)
  return res.json()
}

export async function getPortfolioHistory(period = "1D", timeframe = "5Min") {
  const res = await fetch(
    `${BASE_URL}/account/portfolio/history?period=${period}&timeframe=${timeframe}&extended_hours=true`,
    { headers, cache: "no-store" }
  )
  if (!res.ok) throw new Error(`Portfolio history fetch failed: ${res.statusText}`)
  return res.json()
}

export async function getWatchlist() {
  const res = await fetch(`${BASE_URL}/watchlists`, { headers, cache: "no-store" })
  if (!res.ok) throw new Error(`Watchlist fetch failed: ${res.statusText}`)
  return res.json()
}

export async function cancelAllOrders(): Promise<{ cancelled: number }> {
  const res = await fetch(`${BASE_URL}/orders`, { method: "DELETE", headers })
  if (!res.ok && res.status !== 207) throw new Error(`Cancel all failed: ${res.statusText}`)
  const body = await res.json().catch(() => [])
  const list = Array.isArray(body) ? body : []
  return { cancelled: list.filter((o: any) => o.status === 200).length }
}

export async function getMarketClock(): Promise<{ is_open: boolean; next_open: string; next_close: string }> {
  const res = await fetch(`${BASE_URL}/clock`, { headers, cache: "no-store" })
  if (!res.ok) throw new Error(`Clock fetch failed: ${res.statusText}`)
  return res.json()
}

export async function submitBracketOrder(params: {
  symbol: string
  qty: number
  side: "buy" | "sell"
  take_profit_price: number
  stop_loss_price: number
  limit_price?: number // if omitted → market entry
}): Promise<any> {
  const order: Record<string, any> = {
    symbol: params.symbol,
    qty: params.qty,
    side: params.side,
    type: params.limit_price ? "limit" : "market",
    time_in_force: "day",
    order_class: "bracket",
    take_profit: { limit_price: params.take_profit_price.toFixed(2) },
    stop_loss: { stop_price: params.stop_loss_price.toFixed(2) },
  }
  if (params.limit_price) order.limit_price = params.limit_price.toFixed(2)

  const res = await fetch(`${BASE_URL}/orders`, {
    method: "POST",
    headers,
    body: JSON.stringify(order),
  })
  if (!res.ok) {
    const err = await res.json()
    throw new Error(err.message || `Bracket order failed: ${res.statusText}`)
  }
  return res.json()
}

export async function submitTrailingStop(params: {
  symbol: string
  qty: number
  side: "buy" | "sell"
  trail_percent?: number
  trail_price?: number
}): Promise<any> {
  const order: Record<string, any> = {
    symbol: params.symbol,
    qty: params.qty,
    side: params.side,
    type: "trailing_stop",
    time_in_force: "day",
  }
  if (params.trail_percent) order.trail_percent = params.trail_percent
  if (params.trail_price) order.trail_price = params.trail_price

  const res = await fetch(`${BASE_URL}/orders`, {
    method: "POST",
    headers,
    body: JSON.stringify(order),
  })
  if (!res.ok) {
    const err = await res.json()
    throw new Error(err.message || `Trailing stop failed: ${res.statusText}`)
  }
  return res.json()
}

export async function getOpenOrders(): Promise<any[]> {
  const res = await fetch(`${BASE_URL}/orders?status=open&limit=100`, { headers, cache: "no-store" })
  if (!res.ok) throw new Error(`Open orders fetch failed: ${res.statusText}`)
  return res.json()
}

export async function getAssetInfo(symbol: string): Promise<any> {
  const res = await fetch(`${BASE_URL}/assets/${symbol}`, { headers, cache: "no-store" })
  if (!res.ok) throw new Error(`Asset ${symbol} not found`)
  return res.json()
}

