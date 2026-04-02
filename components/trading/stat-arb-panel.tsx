"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { Activity, Play, Square, RefreshCw, TrendingUp, TrendingDown, Minus, AlertTriangle, Zap, BarChart2, Info } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface PairSignal {
  pair: string
  symbolA: string
  symbolB: string
  signal: "long_A_short_B" | "short_A_long_B" | "close" | "hold"
  currentZ: number
  correlation: number
  beta: number
  halfLife: number
  isCointegrated: boolean
}

interface StatArbPanelProps {
  className?: string
}

const SIGNAL_LABELS = {
  long_A_short_B: "Long A / Short B",
  short_A_long_B: "Short A / Long B",
  close: "CLOSE ← convergence",
  hold: "Hold",
}

export function StatArbPanel({ className }: StatArbPanelProps) {
  const [pairs, setPairs] = useState<PairSignal[]>([])
  const [loading, setLoading] = useState(false)
  const [running, setRunning] = useState(false)
  const [lastRun, setLastRun] = useState<string>("")
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)
  const [entryZ, setEntryZ] = useState(2.0)
  const [exitZ, setExitZ] = useState(0.5)
  const [stopZ, setStopZ] = useState(3.5)
  const [qtyA, setQtyA] = useState(1)
  const intervalRef = useRef<NodeJS.Timeout | null>(null)

  const fetchAnalysis = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const res = await fetch("/api/stat-arb")
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setPairs(data.pairs || [])
      setLastRun(new Date().toLocaleTimeString("th-TH"))
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchAnalysis()
  }, [fetchAnalysis])

  const runEngine = useCallback(async (dryRun: boolean) => {
    try {
      setLoading(true)
      setError(null)
      const res = await fetch("/api/stat-arb", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dryRun,
          config: { entryZ, exitZ, stopZ, qtyA, qtyB: 1 },
        }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setResult(data)
      setLastRun(new Date().toLocaleTimeString("th-TH"))
      await fetchAnalysis()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [entryZ, exitZ, stopZ, qtyA, fetchAnalysis])

  const startAutoRun = useCallback(() => {
    if (intervalRef.current) return
    setRunning(true)
    runEngine(false) // execute live immediately
    intervalRef.current = setInterval(() => {
      runEngine(false)
    }, 60000) // every 60 seconds
  }, [runEngine])

  const stopAutoRun = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
    setRunning(false)
  }, [])

  useEffect(() => () => { if (intervalRef.current) clearInterval(intervalRef.current) }, [])

  const getSignalStyle = (signal: PairSignal["signal"]) => {
    switch (signal) {
      case "long_A_short_B": return "text-emerald-400 bg-emerald-400/10 border-emerald-400/25"
      case "short_A_long_B": return "text-red-400 bg-red-400/10 border-red-400/25"
      case "close": return "text-yellow-400 bg-yellow-400/10 border-yellow-400/25"
      default: return "text-white/30 bg-white/5 border-white/10"
    }
  }

  const getZColor = (z: number) => {
    const abs = Math.abs(z)
    if (abs > stopZ) return "text-red-400 font-bold"
    if (abs > entryZ) return "text-yellow-400 font-bold"
    if (abs > 1) return "text-blue-400"
    return "text-white/50"
  }

  const actionable = pairs.filter(p => p.signal !== "hold")

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {/* Header with status */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={cn("w-2 h-2 rounded-full", running ? "bg-emerald-400 animate-pulse" : "bg-white/20")} />
          <span className="text-xs font-semibold uppercase tracking-wider text-white/60">Stat-Arb Engine</span>
          {running && <span className="text-[10px] text-emerald-400 font-mono">LIVE · 60s</span>}
        </div>
        {lastRun && <span className="text-[10px] text-white/30 font-mono">{lastRun}</span>}
      </div>

      {/* Summary card */}
      {actionable.length > 0 && (
        <div className="bg-yellow-400/10 border border-yellow-400/30 rounded-xl p-3 flex items-start gap-2">
          <Zap className="w-4 h-4 text-yellow-400 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-xs font-bold text-yellow-400">{actionable.length} Active Signal{actionable.length > 1 ? "s" : ""}</p>
            <p className="text-[11px] text-yellow-400/70 mt-0.5">
              {actionable.map(p => p.pair).join(", ")}
            </p>
          </div>
        </div>
      )}

      {/* Pair table */}
      <div className="flex flex-col gap-1.5">
        {pairs.length === 0 && !loading && (
          <div className="text-center py-6 text-white/30 text-xs">
            {error ? <span className="text-red-400">{error}</span> : "Click Refresh to analyze pairs"}
          </div>
        )}
        {pairs.map((p) => (
          <div
            key={p.pair}
            className={cn(
              "rounded-xl border p-3 transition-all",
              p.signal !== "hold"
                ? "border-yellow-400/30 bg-yellow-400/5"
                : "border-white/8 bg-white/3"
            )}
          >
            {/* Pair header */}
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="font-mono font-bold text-sm text-white">{p.pair}</span>
                <span className={cn(
                  "text-[10px] px-1.5 py-0.5 rounded-full border font-semibold",
                  p.isCointegrated
                    ? "text-emerald-400 bg-emerald-400/10 border-emerald-400/25"
                    : "text-white/30 bg-white/5 border-white/10"
                )}>
                  {p.isCointegrated ? "COINT ✓" : "WEAK"}
                </span>
              </div>
              <span className={cn("text-[10px] px-2 py-0.5 rounded-full border font-bold uppercase", getSignalStyle(p.signal))}>
                {p.signal === "hold" ? "HOLD" : p.signal === "close" ? "CLOSE" : p.signal === "long_A_short_B" ? "L/S" : "S/L"}
              </span>
            </div>

            {/* Stats grid */}
            <div className="grid grid-cols-4 gap-2 text-[10px]">
              <div className="flex flex-col">
                <span className="text-white/40 uppercase">Z-Score</span>
                <span className={cn("font-mono font-bold", getZColor(p.currentZ))}>
                  {p.currentZ.toFixed(2)}
                </span>
              </div>
              <div className="flex flex-col">
                <span className="text-white/40 uppercase">Corr</span>
                <span className={cn("font-mono", Math.abs(p.correlation) > 0.8 ? "text-emerald-400" : "text-white/50")}>
                  {p.correlation.toFixed(2)}
                </span>
              </div>
              <div className="flex flex-col">
                <span className="text-white/40 uppercase">β (hedge)</span>
                <span className="font-mono text-white/70">{p.beta.toFixed(3)}</span>
              </div>
              <div className="flex flex-col">
                <span className="text-white/40 uppercase">½-Life</span>
                <span className={cn("font-mono", p.halfLife < 10 ? "text-emerald-400" : p.halfLife < 30 ? "text-yellow-400" : "text-white/30")}>
                  {p.halfLife < 200 ? `${p.halfLife.toFixed(1)}d` : "—"}
                </span>
              </div>
            </div>

            {/* Z-score bar */}
            <div className="mt-2 relative">
              <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                <div
                  className={cn(
                    "h-full rounded-full transition-all duration-500",
                    Math.abs(p.currentZ) > stopZ ? "bg-red-500"
                    : Math.abs(p.currentZ) > entryZ ? "bg-yellow-400"
                    : "bg-emerald-400/50"
                  )}
                  style={{ width: `${Math.min(Math.abs(p.currentZ) / stopZ * 100, 100)}%`, marginLeft: p.currentZ < 0 ? 0 : "50%" }}
                />
              </div>
              <div className="flex justify-between text-[9px] text-white/20 mt-0.5 font-mono">
                <span>-{stopZ}</span>
                <span className="text-white/40">0</span>
                <span>+{stopZ}</span>
              </div>
            </div>

            {/* Signal explanation */}
            {p.signal !== "hold" && (
              <div className="mt-1.5 text-[10px] text-white/50 flex items-center gap-1">
                <Info className="w-3 h-3 flex-shrink-0" />
                <span>{SIGNAL_LABELS[p.signal]}</span>
                {p.signal === "short_A_long_B" && (
                  <span className="text-white/30">(Sell {p.symbolA}, Buy {p.symbolB})</span>
                )}
                {p.signal === "long_A_short_B" && (
                  <span className="text-white/30">(Buy {p.symbolA}, Sell {p.symbolB})</span>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Parameters */}
      <div className="border border-white/8 rounded-xl p-3 bg-white/3">
        <p className="text-[10px] uppercase tracking-wider text-white/40 mb-2 font-semibold">Parameters</p>
        <div className="grid grid-cols-2 gap-2">
          {[
            { label: "Entry Z", value: entryZ, set: setEntryZ, min: 0.5, step: 0.1 },
            { label: "Exit Z", value: exitZ, set: setExitZ, min: 0.1, step: 0.1 },
            { label: "Stop Z", value: stopZ, set: setStopZ, min: 2, step: 0.1 },
            { label: "Qty / pair", value: qtyA, set: setQtyA, min: 1, step: 1 },
          ].map(({ label, value, set, min, step }) => (
            <div key={label} className="flex flex-col gap-0.5">
              <label className="text-[10px] text-white/40 uppercase">{label}</label>
              <input
                type="number"
                value={value}
                min={min}
                step={step}
                onChange={(e) => set(Number(e.target.value))}
                className="bg-black/30 border border-white/10 rounded px-2 py-1 text-xs font-mono text-white focus:outline-none focus:border-white/30 w-full"
              />
            </div>
          ))}
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex flex-col gap-2">
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            className="flex-1 h-8 text-xs border-white/20 text-white/60 hover:text-white hover:border-white/40"
            onClick={fetchAnalysis}
            disabled={loading}
          >
            <RefreshCw className={cn("w-3.5 h-3.5 mr-1", loading && "animate-spin")} />
            Refresh
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="flex-1 h-8 text-xs border-blue-400/40 text-blue-400 hover:bg-blue-400/10"
            onClick={() => runEngine(true)}
            disabled={loading || running}
          >
            <Zap className="w-3.5 h-3.5 mr-1" />
            Dry Run
          </Button>
        </div>
        {running ? (
          <Button
            size="sm"
            className="w-full h-10 text-sm bg-red-500/20 text-red-400 border border-red-500/40 hover:bg-red-500/30 font-bold"
            variant="outline"
            onClick={stopAutoRun}
          >
            <Square className="w-4 h-4 mr-2" />
            Stop Auto-Trading
            <span className="ml-auto flex items-center gap-1.5 text-[10px]">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              LIVE
            </span>
          </Button>
        ) : (
          <Button
            size="sm"
            className="w-full h-10 text-sm bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 hover:bg-emerald-500/30 font-bold"
            variant="outline"
            onClick={startAutoRun}
            disabled={loading}
          >
            <Play className="w-4 h-4 mr-2" />
            Start Stat-Arb Auto-Trade
          </Button>
        )}
      </div>

      {/* Last result */}
      {result && (
        <div className="border border-white/8 rounded-xl p-3 bg-white/3 text-[10px]">
          <div className="flex items-center gap-1.5 mb-2">
            <Activity className="w-3 h-3 text-white/40" />
            <span className="text-white/50 uppercase tracking-wider font-semibold">Last Run</span>
            <span className="text-white/30 ml-auto">{result.dryRun ? "[DRY RUN]" : "[LIVE]"}</span>
          </div>
          <p className="text-white/60 leading-relaxed">{result.summary}</p>
          {result.errors?.length > 0 && (
            <p className="text-red-400/70 mt-1">{result.errors.join(" · ")}</p>
          )}
          {result.orders?.length > 0 && (
            <div className="mt-2 flex flex-col gap-1">
              {result.orders.map((o: any, i: number) => (
                <div key={i} className={cn("flex items-center gap-2 px-2 py-1 rounded-lg",
                  o.side === "buy" ? "bg-emerald-400/10" : "bg-red-400/10"
                )}>
                  <span className={cn("font-bold uppercase w-8", o.side === "buy" ? "text-emerald-400" : "text-red-400")}>
                    {o.side}
                  </span>
                  <span className="font-mono text-white">{o.symbol} ×{o.qty}</span>
                  <span className={cn("ml-auto text-[9px] px-1.5 rounded",
                    o.status === "submitted" ? "text-emerald-400 bg-emerald-400/10" : "text-white/30"
                  )}>
                    {o.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
