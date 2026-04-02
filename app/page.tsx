"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import {
  RefreshCw,
  Activity,
  TrendingUp,
  BarChart2,
  List,
  Clock,
  Wifi,
  WifiOff,
  AlertCircle,
  Database,
  Bell,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import { format } from "date-fns"

import { StatCard } from "@/components/trading/stat-card"
import { PortfolioChart } from "@/components/trading/portfolio-chart"
import { PriceChart } from "@/components/trading/price-chart"
import { PositionsTable } from "@/components/trading/positions-table"
import { OrdersTable } from "@/components/trading/orders-table"
import { StrategyPanel } from "@/components/trading/strategy-panel"
import { OrderForm } from "@/components/trading/order-form"
import { WatchlistPanel } from "@/components/trading/watchlist-panel"
import { PnLChart } from "@/components/trading/pnl-chart"
import { StatArbPanel } from "@/components/trading/stat-arb-panel"
import { AutoTraderPanel } from "@/components/trading/auto-trader-panel"
import { DEFAULT_STRATEGIES, type StrategyConfig, type TradeSignal } from "@/lib/strategy"
import type { DBTrade, DBTradeSignal, DBStrategyConfig, DBPortfolioSnapshot } from "@/lib/db"

const WATCHLIST_SYMBOLS = ["SPY", "QQQ", "AAPL", "MSFT", "TSLA", "NVDA", "AMD", "GOOGL", "GLD", "SLV"]
const REFRESH_INTERVAL = 5000

export default function TradingDashboard() {
  // Alpaca live data
  const [account, setAccount] = useState<any>(null)
  const [positions, setPositions] = useState<any[]>([])
  const [orders, setOrders] = useState<any[]>([])
  const [portfolioHistory, setPortfolioHistory] = useState<any>(null)
  const [priceData, setPriceData] = useState<any[]>([])
  const [latestBars, setLatestBars] = useState<Record<string, any>>({})

  // DB data
  const [dbStrategies, setDbStrategies] = useState<DBStrategyConfig[]>([])
  const [dbTrades, setDbTrades] = useState<DBTrade[]>([])
  const [dbSignals, setDbSignals] = useState<DBTradeSignal[]>([])
  const [dbSnapshots, setDbSnapshots] = useState<DBPortfolioSnapshot[]>([])

  // UI state
  const [activeSymbol, setActiveSymbol] = useState("SPY")
  const [selectedTimeframe, setSelectedTimeframe] = useState("1Min")
  const [activeStrategy, setActiveStrategy] = useState<StrategyConfig | null>(DEFAULT_STRATEGIES[0])
  const [signals, setSignals] = useState<TradeSignal[]>([])
  const [isStrategyRunning, setIsStrategyRunning] = useState(false)
  const [strategyLoading, setStrategyLoading] = useState(false)
  const [lastRun, setLastRun] = useState<string>("")
  const [orderLoading, setOrderLoading] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)
  const [isLive, setIsLive] = useState(true)
  const [mounted, setMounted] = useState(false)
  const [toast, setToast] = useState<{ type: "success" | "error"; msg: string } | null>(null)
  const strategyIntervalRef = useRef<NodeJS.Timeout | null>(null)

  const showToast = (type: "success" | "error", msg: string) => {
    setToast({ type, msg })
    setTimeout(() => setToast(null), 4000)
  }

  // ── Data Fetchers ──────────────────────────────────────────────────────────

  const fetchAccount = useCallback(async () => {
    try {
      const res = await fetch("/api/account")
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setAccount(data.account)
      setPortfolioHistory(data.history)
      setPositions(data.positions || [])
      setError(null)
    } catch (e: any) {
      setError(e.message)
    }
  }, [])

  const fetchOrders = useCallback(async () => {
    try {
      const res = await fetch("/api/orders")
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setOrders(data.orders || [])
    } catch (e: any) {
      console.error("Orders fetch error:", e.message)
    }
  }, [])

  const fetchLatestBars = useCallback(async () => {
    try {
      const res = await fetch(`/api/market?symbols=${WATCHLIST_SYMBOLS.join(",")}&type=latest`)
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setLatestBars(data.bars || {})
    } catch (e: any) {
      console.error("Market data fetch error:", e.message)
    }
  }, [])

  const fetchDbData = useCallback(async () => {
    try {
      const [strategiesRes, tradesRes, signalsRes, snapshotsRes] = await Promise.all([
        fetch("/api/db-strategies"),
        fetch("/api/db-trades"),
        fetch("/api/db-signals"),
        fetch("/api/db-snapshots"),
      ])

      const strats = await strategiesRes.json()
      const trades = await tradesRes.json()
      const sigs = await signalsRes.json()
      const snaps = await snapshotsRes.json()

      if (strats.strategies) setDbStrategies(strats.strategies)
      if (trades.trades) setDbTrades(trades.trades)
      if (sigs.signals) setDbSignals(sigs.signals)
      if (snaps.snapshots) setDbSnapshots(snaps.snapshots)
    } catch (e: any) {
      console.error("DB fetch error:", e.message)
    }
  }, [])

  const fetchActiveSymbolBars = useCallback(async () => {
    try {
      const res = await fetch(`/api/market?symbol=${activeSymbol}&timeframe=${selectedTimeframe}&type=bars`)
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setPriceData(data.bars || [])
    } catch (e: any) {
      console.error("Historical bars fetch error:", e.message)
    }
  }, [activeSymbol, selectedTimeframe])

  const fetchAll = useCallback(async () => {
    await Promise.all([fetchAccount(), fetchOrders(), fetchLatestBars(), fetchActiveSymbolBars(), fetchDbData()])
    setLastRefresh(new Date())
    setMounted(true)
    setLoading(false)
  }, [fetchAccount, fetchOrders, fetchLatestBars, fetchActiveSymbolBars, fetchDbData])

  // ── Run strategy ────────────────────────────────────────────────────────────

  const runStrategyById = useCallback(async (strategyToRun: StrategyConfig, dryRun = true) => {
    setStrategyLoading(true)
    try {
      const res = await fetch("/api/strategy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          strategyId: strategyToRun.id,
          dryRun,
        }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setSignals(data.signals || [])
      setLastRun(format(new Date(), "HH:mm:ss"))
      if (!dryRun) showToast("success", `⚡ Live strategy executed — ${data.signals?.length || 0} signal(s)`)
      await fetchDbData()
    } catch (e: any) {
      showToast("error", e.message)
    } finally {
      setStrategyLoading(false)
    }
  }, [fetchDbData])

  const runStrategy = useCallback(async (dryRun = true) => {
    if (!activeStrategy) return
    await runStrategyById(activeStrategy, dryRun)
  }, [activeStrategy, runStrategyById])

  const startAutoRun = useCallback((strategy: StrategyConfig) => {
    // Clear any existing interval
    if (strategyIntervalRef.current) {
      clearInterval(strategyIntervalRef.current)
      strategyIntervalRef.current = null
    }
    setActiveStrategy(strategy)
    setIsStrategyRunning(true)
    // Run immediately, then every 60 seconds
    runStrategyById(strategy, true)
    strategyIntervalRef.current = setInterval(() => {
      runStrategyById(strategy, true)
    }, 60000)
    showToast("success", `🟢 Auto-Run started — ${strategy.name} (every 60s)`)
  }, [runStrategyById])

  const stopAutoRun = useCallback(() => {
    if (strategyIntervalRef.current) {
      clearInterval(strategyIntervalRef.current)
      strategyIntervalRef.current = null
    }
    setIsStrategyRunning(false)
    showToast("success", "⏹️ Auto-Run stopped")
  }, [])

  // ── Submit order ────────────────────────────────────────────────────────────

  const submitOrder = useCallback(
    async (order: { symbol?: string; side: "buy" | "sell"; qty: number; type: "market" | "limit"; time_in_force?: string; limit_price?: number }) => {
      setOrderLoading(true)
      try {
        const res = await fetch("/api/trade", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            symbol: order.symbol || activeSymbol,
            side: order.side,
            qty: order.qty,
            type: order.type,
            limit_price: order.limit_price,
            time_in_force: order.time_in_force || "day",
          }),
        })
        const data = await res.json()
        if (data.error) throw new Error(data.error)
        showToast("success", `${order.side.toUpperCase()} order submitted for ${order.symbol || activeSymbol}`)
        await fetchAll()
      } catch (e: any) {
        showToast("error", e.message)
      } finally {
        setOrderLoading(false)
      }
    },
    [activeSymbol, fetchAll]
  )

  const handleClosePosition = useCallback(async (symbol: string) => {
    try {
      const res = await fetch("/api/positions", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      showToast("success", `Position ${symbol} closed`)
      await fetchAll()
    } catch (e: any) {
      showToast("error", e.message)
    }
  }, [fetchAll])

  const handleCancelOrder = useCallback(async (orderId: string) => {
    try {
      const res = await fetch("/api/orders", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      showToast("success", "Order cancelled")
      await fetchOrders()
    } catch (e: any) {
      showToast("error", e.message)
    }
  }, [fetchOrders])

  const handleCancelAllOrders = useCallback(async () => {
    if (!confirm("Cancel ALL open orders?")) return
    try {
      const res = await fetch("/api/orders", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cancelAll: true }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      showToast("success", `Cancelled ${data.cancelled ?? "all"} order(s)`)
      await fetchOrders()
    } catch (e: any) {
      showToast("error", e.message)
    }
  }, [fetchOrders])

  // ── Load data on mount ──────────────────────────────────────────────────────

  useEffect(() => {
    fetchAll()
    const interval = setInterval(fetchAll, REFRESH_INTERVAL)
    return () => clearInterval(interval)
  }, [fetchAll])

  useEffect(() => {
    if (mounted) fetchActiveSymbolBars()
  }, [activeSymbol, selectedTimeframe, fetchActiveSymbolBars])

  useEffect(() => {
    return () => {
      if (strategyIntervalRef.current) clearInterval(strategyIntervalRef.current)
    }
  }, [])

  // ── Derived state ──────────────────────────────────────────────────────────

  // Portfolio chart data from Alpaca history
  const portfolioData = portfolioHistory && Array.isArray(portfolioHistory.timestamp)
    ? portfolioHistory.timestamp
        .map((ts: number, i: number) => ({
          timestamp: ts,  // unix seconds — PortfolioChart will multiply by 1000
          equity: Number(portfolioHistory.equity?.[i]) || 0,
          profitLoss: Number(portfolioHistory.profit_loss?.[i]) || 0,
        }))
        .filter((d: any) => d.equity > 0)
    : []

  // P&L bar chart from DB snapshots
  const pnlData = dbSnapshots
    .filter(s => s.profit_loss !== null)
    .slice(-30) // last 30 snapshots
    .map((s) => {
      const dObj = new Date(s.created_at)
      return {
        label: isNaN(dObj.getTime()) ? "--" : format(dObj, "HH:mm"),
        pnl: parseFloat(s.profit_loss?.toString() || "0"),
      }
    })

  // Derive equity change from account
  const equityChangePct = account && account.equity && account.last_equity
    ? ((Number(account.equity) - Number(account.last_equity)) / Number(account.last_equity)) * 100
    : 0

  // ── Render ──────────────────────────────────────────────────────────────────

  if (!mounted) {
    return (
      <div className="w-full h-screen bg-[--color-bg] text-[--color-fg] flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 rounded-full border-2 border-[--color-accent] border-t-transparent animate-spin mx-auto mb-4" />
          <p className="text-sm text-[--color-muted]">Loading trading dashboard...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 w-screen h-screen bg-slate-950 text-slate-50 flex flex-col overflow-hidden selection:bg-[--color-accent]/30 selection:text-white">
      {/* Background glow effects */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-[--color-accent]/20 blur-[120px] opacity-50" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] rounded-full bg-[--color-blue]/20 blur-[120px] opacity-30" />
      </div>
      {/* Toast notification */}
      {toast && (
        <div className={cn(
          "fixed top-4 right-4 px-4 py-3 rounded-lg text-sm font-medium z-50 animate-in slide-in-from-top-2",
          toast.type === "success" ? "bg-[--color-green] text-white" : "bg-[--color-red] text-white"
        )}>
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <header className="relative h-16 border-b border-white/10 px-6 flex items-center justify-between flex-shrink-0 bg-black/20 backdrop-blur-md z-10">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[--color-accent] to-[--color-blue] flex items-center justify-center shadow-lg shadow-[--color-accent]/20">
            <TrendingUp className="w-5 h-5 text-white" />
          </div>
          <h1 className="text-xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white to-white/70">AlgoTrade</h1>
          <Badge variant="outline" className="ml-3 bg-white/5 border-white/10 backdrop-blur-sm">
            {isLive ? <Wifi className="w-3 h-3 mr-1" /> : <WifiOff className="w-3 h-3 mr-1" />}
            {isLive ? "Live" : "Offline"}
          </Badge>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-[10px] text-[--color-muted] hidden sm:inline">
            {mounted && lastRefresh ? format(lastRefresh, "HH:mm:ss") : "—"}
          </span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              fetchAll()
            }}
            disabled={loading}
          >
            <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
          </Button>
        </div>
      </header>

      {/* Main content — fills remaining height, sidebars fixed, center scrolls */}
      <div className="flex-1 flex gap-0 min-h-0">
        {/* Left Sidebar — Watchlist, fixed height scrollable */}
        <aside className="w-56 border-r border-[--color-panel-border] flex-shrink-0 overflow-y-auto hidden md:flex flex-col bg-[--color-panel]/30 p-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[--color-muted] mb-3 px-2">Watchlist</h2>
          <WatchlistPanel
            items={WATCHLIST_SYMBOLS.map((sym) => {
              const bar = latestBars[sym]
              return {
                symbol: sym,
                price: bar?.c || 0,
                change: bar && bar.o ? bar.c - bar.o : 0,
                changePercent: bar && bar.o ? ((bar.c - bar.o) / bar.o) * 100 : 0,
                volume: bar?.v,
              }
            })}
            activeSymbol={activeSymbol}
            onSelect={setActiveSymbol}
            loading={loading}
          />
        </aside>

        {/* Center — Charts + Tables */}
        <main className="flex-1 overflow-y-auto p-3 flex flex-col gap-3">
          {error && (
            <div className="bg-[--color-red]/20 border border-[--color-red] rounded-lg p-3 text-sm text-[--color-red] flex items-start gap-2">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-medium">API Error</p>
                <p className="text-xs opacity-90">{error}</p>
              </div>
            </div>
          )}

          {/* Stats Row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard
              label="Account Equity"
              value={account?.equity ? `${parseFloat(account.equity).toLocaleString("en-US", { maximumFractionDigits: 2 })}` : "—"}
              prefix="$"
              change={equityChangePct}
              highlight={equityChangePct > 0}
            />
            <StatCard
              label="Buying Power"
              value={account?.buying_power ? `${parseFloat(account.buying_power).toLocaleString("en-US", { maximumFractionDigits: 2 })}` : "—"}
              prefix="$"
              subValue={`${dbTrades.length} DB trades`}
            />
            <StatCard
              label="Open Positions"
              value={positions.length.toString()}
              subValue={positions.length > 0 ? positions.map((p: any) => p.symbol).slice(0,3).join(", ") : "None"}
            />
            <StatCard
              label="Today P&L"
              value={account ? `${(Number(account.equity) - Number(account.last_equity)).toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}` : "—"}
              prefix="$"
              change={equityChangePct}
            />
          </div>

          {/* Charts Row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <div className="h-[220px] bg-[--color-panel] border border-[--color-panel-border] rounded-lg p-3">
              <p className="text-xs text-[--color-muted] mb-1 font-medium uppercase tracking-wider">Portfolio Equity</p>
              <div className="h-[176px]">
                <PortfolioChart data={portfolioData} />
              </div>
            </div>
            <div className="h-[220px] bg-[--color-panel] border border-[--color-panel-border] rounded-lg p-3">
              <p className="text-xs text-[--color-muted] mb-1 font-medium uppercase tracking-wider">P&L History</p>
              <div className="h-[176px]">
                <PnLChart data={pnlData} />
              </div>
            </div>
          </div>

          {/* Price Chart */}
          <div className="bg-[--color-panel] border border-[--color-panel-border] rounded-lg p-3 flex-shrink-0">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold">{activeSymbol} Price</h3>
              <div className="flex gap-1">
                {["1Min", "5Min", "15Min", "1Hour", "1Day"].map((tf) => (
                  <Button
                    key={tf}
                    size="sm"
                    variant={selectedTimeframe === tf ? "default" : "ghost"}
                    className="text-xs h-6 px-2"
                    onClick={() => setSelectedTimeframe(tf)}
                  >
                    {tf}
                  </Button>
                ))}
              </div>
            </div>
            <div className="h-[260px]">
              <PriceChart data={priceData} symbol={activeSymbol} />
            </div>
          </div>


          {/* ── OPEN POSITIONS ── */}
          <div className="bg-[--color-panel] border border-[--color-panel-border] rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-[--color-panel-border]">
              <div className="flex items-center gap-2">
                <BarChart2 className="w-4 h-4 text-[--color-accent]" />
                <h3 className="text-sm font-bold">Open Positions</h3>
                {positions.length > 0 && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[--color-accent]/20 text-[--color-accent]">
                    {positions.length}
                  </span>
                )}
              </div>
              <button
                onClick={fetchAll}
                className="text-[--color-muted] hover:text-[--color-fg] transition-colors"
              >
                <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
              </button>
            </div>
            <PositionsTable
              positions={positions}
              loading={loading}
              onClose={handleClosePosition}
            />
          </div>

          {/* ── ORDERS ── */}
          <div className="bg-[--color-panel] border border-[--color-panel-border] rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-[--color-panel-border]">
              <div className="flex items-center gap-2">
                <List className="w-4 h-4 text-[--color-muted]" />
                <h3 className="text-sm font-bold">Recent Orders</h3>
                {orders.length > 0 && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-white/10 text-white/50">
                    {orders.filter((o: any) => ["new","accepted","pending_new","partially_filled"].includes(o.status)).length} active
                  </span>
                )}
              </div>
              {/* Cancel All button */}
              {orders.some((o: any) => ["new","accepted","pending_new","partially_filled"].includes(o.status)) && (
                <button
                  onClick={handleCancelAllOrders}
                  className="text-[10px] font-bold text-red-400 border border-red-500/30 px-2 py-1 rounded-lg hover:bg-red-500/10 transition-colors"
                >
                  Cancel All
                </button>
              )}
            </div>
            <OrdersTable
              orders={orders}
              loading={loading}
              onCancel={handleCancelOrder}
            />
          </div>

          {/* spacer */}
          <div className="h-6" />
        </main>


        {/* Right Sidebar — Auto-Trade · Stat-Arb · Strategy · Order */}
        <aside className="w-80 flex-shrink-0 border-l border-[--color-panel-border] flex flex-col overflow-y-auto hidden xl:flex">
          <Tabs defaultValue="auto" className="flex flex-col h-full">
            <TabsList className="border-b border-[--color-panel-border] rounded-none bg-transparent px-2 flex-shrink-0 h-9 gap-0.5">
              <TabsTrigger value="auto" className="text-[10px] flex-1 h-7 px-1">
                🤖 Auto
              </TabsTrigger>
              <TabsTrigger value="statarb" className="text-[10px] flex-1 h-7 px-1">
                ⚡ Stat-Arb
              </TabsTrigger>
              <TabsTrigger value="strategy" className="text-[10px] flex-1 h-7 px-1">
                Strategy
              </TabsTrigger>
              <TabsTrigger value="order" className="text-[10px] flex-1 h-7 px-1">
                Order
              </TabsTrigger>
            </TabsList>

            {/* 🤖 Auto-Trader */}
            <TabsContent value="auto" className="flex-1 overflow-y-auto mt-0">
              <div className="p-3">
                <AutoTraderPanel onRefreshPositions={fetchAll} />
              </div>
            </TabsContent>

            <TabsContent value="statarb" className="flex-1 overflow-y-auto mt-0">
              <div className="p-3">
                <StatArbPanel />
              </div>
            </TabsContent>

            <TabsContent value="strategy" className="flex-1 overflow-y-auto mt-0">
              <div className="p-3">
                <StrategyPanel
                  strategies={DEFAULT_STRATEGIES}
                  activeStrategy={activeStrategy}
                  onSelect={(s) => { setActiveStrategy(s); setSignals([]) }}
                  isRunning={isStrategyRunning}
                  isLoading={strategyLoading}
                  lastRun={lastRun}
                  onDeploy={(strategy, dryRun) => {
                    setActiveStrategy(strategy)
                    runStrategyById(strategy, dryRun)
                  }}
                  onAutoRun={startAutoRun}
                  onStop={stopAutoRun}
                  signals={signals}
                />
              </div>
            </TabsContent>

            <TabsContent value="order" className="flex-1 overflow-y-auto mt-0">
              <div className="p-3">
                <OrderForm onSubmit={submitOrder} isLoading={orderLoading} />
              </div>
            </TabsContent>
          </Tabs>
        </aside>
      </div>
    </div>
  )
}
