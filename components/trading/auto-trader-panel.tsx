"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import {
  Activity, Play, Square, RefreshCw, Zap,
  TrendingUp, TrendingDown, BarChart2, List,
  ShieldAlert, CheckCircle, Clock, AlertTriangle,
  ChevronDown, ChevronUp, Settings2
} from "lucide-react"
import { cn } from "@/lib/utils"
import { format } from "date-fns"

interface EngineStatus {
  engineRunning: boolean
  lastRunAt: string | null
  totalCycles: number
  totalTradesExecuted: number
  marketOpen: boolean
  nextOpen: string
  nextClose: string
  lastRunResult?: {
    signals: number
    executed: number
    staleCleared: number
    errors: number
    canTrade: boolean
  }
}

interface RunResult {
  status: string
  signals: any[]
  executedOrders: any[]
  staleOrdersCleared: number
  errors: string[]
  risk?: {
    canTrade: boolean
    reason: string
    totalRiskPct: number
    dailyPnlPct: number
  }
  log: string[]
  summary: string
  marketOpen: boolean
}

interface AutoTraderPanelProps {
  onRefreshPositions?: () => void
}

export function AutoTraderPanel({ onRefreshPositions }: AutoTraderPanelProps) {
  const [status, setStatus] = useState<EngineStatus | null>(null)
  const [result, setResult] = useState<RunResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [running, setRunning] = useState(false)
  const [lastRun, setLastRun] = useState("")
  const [showLog, setShowLog] = useState(false)
  const [dryRun, setDryRun] = useState(true)
  const intervalRef = useRef<NodeJS.Timeout | null>(null)

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/auto-trader")
      const data = await res.json()
      setStatus(data)
    } catch {}
  }, [])

  useEffect(() => {
    fetchStatus()
    const si = setInterval(fetchStatus, 30000) // refresh status every 30s
    return () => clearInterval(si)
  }, [fetchStatus])

  const runEngine = useCallback(async (dr: boolean) => {
    setLoading(true)
    try {
      const res = await fetch("/api/auto-trader", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun: dr, forceRun: true }),
      })
      const data = await res.json()
      setResult(data)
      setLastRun(format(new Date(), "HH:mm:ss"))
      await fetchStatus()
      onRefreshPositions?.()
    } catch (e: any) {
      setResult({ status: "error", signals: [], executedOrders: [], staleOrdersCleared: 0, errors: [e.message], log: [], summary: e.message, marketOpen: false })
    } finally {
      setLoading(false)
    }
  }, [fetchStatus, onRefreshPositions])

  const startAutoRun = useCallback(() => {
    if (intervalRef.current) return
    setRunning(true)
    runEngine(dryRun)
    intervalRef.current = setInterval(() => runEngine(dryRun), 60000)
  }, [runEngine, dryRun])

  const stopAutoRun = useCallback(() => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null }
    setRunning(false)
  }, [])

  useEffect(() => () => { if (intervalRef.current) clearInterval(intervalRef.current) }, [])

  const marketOpen = status?.marketOpen ?? false

  return (
    <div className="flex flex-col gap-3">

      {/* Market status banner */}
      <div className={cn(
        "flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold",
        marketOpen
          ? "bg-emerald-400/10 border border-emerald-400/30 text-emerald-400"
          : "bg-white/5 border border-white/10 text-white/40"
      )}>
        <div className="flex items-center gap-2">
          <span className={cn("w-2 h-2 rounded-full", marketOpen ? "bg-emerald-400 animate-pulse" : "bg-white/20")} />
          {marketOpen ? "Market OPEN" : "Market CLOSED"}
        </div>
        {status?.nextClose && marketOpen && (
          <span className="text-[10px] text-emerald-400/70">Closes {format(new Date(status.nextClose), "HH:mm")}</span>
        )}
        {status?.nextOpen && !marketOpen && (
          <span className="text-[10px] text-white/30">Opens {new Date(status.nextOpen).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}</span>
        )}
      </div>

      {/* Engine stats */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: "Cycles", value: status?.totalCycles ?? 0, color: "text-blue-400" },
          { label: "Trades", value: status?.totalTradesExecuted ?? 0, color: "text-emerald-400" },
          { label: "Live", value: running ? "ON" : "OFF", color: running ? "text-emerald-400" : "text-white/30" },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-white/5 border border-white/8 rounded-xl p-2.5 text-center">
            <div className={cn("text-lg font-bold font-mono", color)}>{value}</div>
            <div className="text-[10px] text-white/40 uppercase tracking-wide">{label}</div>
          </div>
        ))}
      </div>

      {/* Risk status from last result */}
      {result?.risk && (
        <div className={cn(
          "flex items-start gap-2 p-3 rounded-xl border text-xs",
          result.risk.canTrade
            ? "bg-emerald-400/5 border-emerald-400/20 text-emerald-400"
            : "bg-red-400/10 border-red-400/30 text-red-400"
        )}>
          {result.risk.canTrade
            ? <CheckCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            : <ShieldAlert className="w-4 h-4 flex-shrink-0 mt-0.5" />
          }
          <div className="flex-1">
            <p className="font-bold">{result.risk.canTrade ? "Risk OK — Trading Enabled" : "Risk Block"}</p>
            <p className="text-[10px] opacity-70 mt-0.5">{result.risk.reason}</p>
            <div className="flex gap-3 mt-1">
              <span>Heat: {(result.risk.totalRiskPct * 100).toFixed(1)}%</span>
              <span>P&L: {(result.risk.dailyPnlPct * 100).toFixed(2)}%</span>
            </div>
          </div>
        </div>
      )}

      {/* Last run result */}
      {result && result.status !== "market_closed" && (
        <div className="bg-white/3 border border-white/8 rounded-xl p-3 text-[11px]">
          <div className="flex items-center gap-2 mb-2">
            <Activity className="w-3.5 h-3.5 text-white/40" />
            <span className="text-white/50 font-semibold uppercase tracking-wide">Last Engine Run</span>
            <span className={cn("ml-auto px-2 py-0.5 rounded text-[10px] font-bold",
              result.status === "executed" ? "bg-emerald-400/15 text-emerald-400"
              : result.status === "dry_run" ? "bg-blue-400/15 text-blue-400"
              : "bg-white/10 text-white/40"
            )}>
              {result.status.toUpperCase().replace("_", " ")}
            </span>
          </div>

          <p className="text-white/60 mb-2">{result.summary}</p>

          {/* Compact signal/order list */}
          {result.signals.length > 0 && (
            <div className="flex flex-col gap-1 mb-2">
              {result.signals.slice(0, 5).map((s: any, i: number) => (
                <div key={i} className={cn(
                  "flex items-center gap-2 px-2 py-1 rounded-lg text-[10px]",
                  s.action === "buy" || s.signal === "long_A_short_B" ? "bg-emerald-400/10" : "bg-red-400/10"
                )}>
                  <span className={cn("font-bold uppercase w-12 flex-shrink-0",
                    s.action === "buy" || s.signal === "long_A_short_B" ? "text-emerald-400" : "text-red-400"
                  )}>
                    {s.pair || s.symbol}
                  </span>
                  <span className="text-white/40 flex-1 truncate">{s.reason || s.signal}</span>
                  {s.confidence && <span className="text-white/30 font-mono">{(parseFloat(s.confidence) * 100).toFixed(0)}%</span>}
                </div>
              ))}
              {result.signals.length > 5 && (
                <p className="text-white/30 text-[10px] text-center">+{result.signals.length - 5} more</p>
              )}
            </div>
          )}

          {/* Errors */}
          {result.errors.length > 0 && (
            <div className="text-red-400/60 text-[10px] mt-1">
              ⚠️ {result.errors.slice(0, 2).join(" · ")}
            </div>
          )}

          {/* Log toggle */}
          {result.log.length > 0 && (
            <button
              className="flex items-center gap-1 text-white/30 text-[10px] mt-2 hover:text-white/50 transition-colors"
              onClick={() => setShowLog(!showLog)}
            >
              {showLog ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              {showLog ? "Hide" : "Show"} engine log ({result.log.length} lines)
            </button>
          )}
          {showLog && (
            <div className="mt-2 bg-black/30 rounded-lg p-2 font-mono text-[10px] text-white/50 max-h-32 overflow-y-auto">
              {result.log.map((l, i) => <p key={i}>{l}</p>)}
            </div>
          )}
        </div>
      )}

      {/* Market closed message */}
      {result?.status === "market_closed" && (
        <div className="bg-white/5 border border-white/10 rounded-xl p-3 text-center text-sm text-white/40">
          <Clock className="w-5 h-5 mx-auto mb-1" />
          {result.summary}
        </div>
      )}

      {/* Controls */}
      <div className="flex flex-col gap-2">
        {/* Mode toggle */}
        <div className="flex gap-1 bg-white/5 p-1 rounded-xl">
          <button
            onClick={() => setDryRun(true)}
            className={cn("flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all",
              dryRun ? "bg-blue-500/20 text-blue-400 border border-blue-500/30" : "text-white/30"
            )}
          >
            Dry Run
          </button>
          <button
            onClick={() => { setDryRun(false) }}
            className={cn("flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all",
              !dryRun ? "bg-orange-500/20 text-orange-400 border border-orange-500/30" : "text-white/30"
            )}
          >
            🔴 Live
          </button>
        </div>

        {/* Run once */}
        <button
          onClick={() => runEngine(dryRun)}
          disabled={loading || running}
          className={cn(
            "flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold border transition-all",
            loading
              ? "border-white/10 text-white/30 cursor-not-allowed"
              : "border-white/20 text-white/70 hover:text-white hover:border-white/40"
          )}
        >
          <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
          {loading ? "Running..." : "Run Once"}
        </button>

        {/* Auto-Run start/stop */}
        {running ? (
          <button
            onClick={stopAutoRun}
            className="flex items-center justify-center gap-2 py-3 rounded-xl text-base font-bold border bg-red-500/15 text-red-400 border-red-500/40 hover:bg-red-500/25 transition-all"
          >
            <Square className="w-4 h-4" />
            Stop Auto-Trade
            <span className="ml-auto flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-emerald-400 text-xs">LIVE</span>
            </span>
          </button>
        ) : (
          <button
            onClick={startAutoRun}
            disabled={loading}
            className={cn(
              "flex items-center justify-center gap-2 py-3 rounded-xl text-base font-bold border transition-all",
              dryRun
                ? "bg-blue-500/15 text-blue-400 border-blue-500/40 hover:bg-blue-500/25"
                : "bg-emerald-500/15 text-emerald-400 border-emerald-500/40 hover:bg-emerald-500/25"
            )}
          >
            <Play className="w-4 h-4" />
            {dryRun ? "Start Simulation (60s)" : "Start Auto-Trade (60s)"}
          </button>
        )}
      </div>

      {/* Last run timestamp */}
      {lastRun && (
        <p className="text-center text-[10px] text-white/20 font-mono">Last run: {lastRun}</p>
      )}
    </div>
  )
}
