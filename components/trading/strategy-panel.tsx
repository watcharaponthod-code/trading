"use client"

import { useState } from "react"
import { Play, Square, ChevronDown, ChevronUp, Settings2, Zap, AlertTriangle, RefreshCw, Activity } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { StrategyConfig, TradeSignal } from "@/lib/strategy"

interface StrategyPanelProps {
  strategies: StrategyConfig[]
  activeStrategy: StrategyConfig | null
  onSelect: (strategy: StrategyConfig) => void
  onDeploy: (strategy: StrategyConfig, dryRun: boolean) => void
  onAutoRun: (strategy: StrategyConfig) => void   // NEW: start auto-run every 1 min
  onStop: () => void
  isRunning: boolean
  signals: TradeSignal[]
  lastRun?: string
  isLoading?: boolean
}

export function StrategyPanel({
  strategies,
  activeStrategy,
  onSelect,
  onDeploy,
  onAutoRun,
  onStop,
  isRunning,
  signals,
  lastRun,
  isLoading,
}: StrategyPanelProps) {
  const [expandedStrategy, setExpandedStrategy] = useState<string | null>(null)
  const [editingParams, setEditingParams] = useState<Record<string, string>>({})

  const handleParamChange = (key: string, value: string) => {
    setEditingParams((prev) => ({ ...prev, [key]: value }))
  }

  const getEffectiveStrategy = (strategy: StrategyConfig): StrategyConfig => {
    if (Object.keys(editingParams).length === 0) return strategy
    const updatedParams: Record<string, number | string> = { ...strategy.params }
    for (const [key, val] of Object.entries(editingParams)) {
      const num = parseFloat(val)
      updatedParams[key] = isNaN(num) ? val : num
    }
    return { ...strategy, params: updatedParams }
  }

  return (
    <div className="flex flex-col gap-2">
      {strategies.map((strategy) => {
        const isActive = activeStrategy?.id === strategy.id
        const isExpanded = expandedStrategy === strategy.id

        return (
          <div
            key={strategy.id}
            className={cn(
              "rounded-xl border transition-all",
              isActive
                ? "border-[--color-accent]/60 bg-[--color-accent]/5"
                : "border-[--color-panel-border] bg-[--color-panel]"
            )}
          >
            <div
              className="flex items-start gap-3 p-3 cursor-pointer"
              onClick={() => onSelect(strategy)}
            >
              <div
                className={cn(
                  "mt-0.5 w-2 h-2 rounded-full flex-shrink-0 transition-all",
                  isActive && isRunning
                    ? "bg-emerald-400 animate-pulse shadow-[0_0_8px_theme(colors.emerald.400)]"
                    : isActive
                    ? "bg-[--color-accent]"
                    : "bg-[--color-panel-border]"
                )}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className={cn("text-sm font-semibold", isActive ? "text-[--color-fg]" : "text-[--color-muted]")}>
                    {strategy.name}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      className="p-1 rounded text-[--color-muted] hover:text-[--color-fg] transition-colors"
                      onClick={(e) => {
                        e.stopPropagation()
                        setExpandedStrategy(isExpanded ? null : strategy.id)
                      }}
                    >
                      {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
                <p className="text-xs text-[--color-muted] mt-0.5 leading-relaxed">{strategy.description}</p>
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {strategy.symbols.map((s) => (
                    <span key={s} className="px-1.5 py-0.5 rounded bg-[--color-panel-border]/60 text-[--color-muted] text-[10px] font-mono">
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {isExpanded && (
              <div className="px-3 pb-3 border-t border-[--color-panel-border]/50 mt-1 pt-3">
                <div className="flex items-center gap-1.5 mb-2 text-[--color-muted]">
                  <Settings2 className="w-3.5 h-3.5" />
                  <span className="text-xs font-medium uppercase tracking-wider">Parameters</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {Object.entries(strategy.params).map(([key, val]) => (
                    <div key={key} className="flex flex-col gap-0.5">
                      <label className="text-[10px] text-[--color-muted] uppercase tracking-wide">{key}</label>
                      <input
                        type="number"
                        defaultValue={Number(val)}
                        onChange={(e) => handleParamChange(key, e.target.value)}
                        className="bg-[--color-bg] border border-[--color-panel-border] rounded px-2 py-1 text-xs font-mono text-[--color-fg] focus:outline-none focus:border-[--color-accent]/60 w-full"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {isActive && (
              <div className="px-3 pb-3 flex flex-col gap-2">
                {/* Row 1: Dry Run + Deploy Live */}
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    className="flex-1 h-8 text-xs bg-[--color-accent]/20 text-[--color-accent] border border-[--color-accent]/40 hover:bg-[--color-accent]/30"
                    variant="outline"
                    onClick={() => onDeploy(getEffectiveStrategy(strategy), true)}
                    disabled={isLoading || isRunning}
                  >
                    <Zap className="w-3.5 h-3.5 mr-1" />
                    Dry Run
                  </Button>
                  <Button
                    size="sm"
                    className="flex-1 h-8 text-xs bg-orange-500/20 text-orange-400 border border-orange-500/40 hover:bg-orange-500/30"
                    variant="outline"
                    onClick={() => onDeploy(getEffectiveStrategy(strategy), false)}
                    disabled={isLoading || isRunning}
                  >
                    <Play className="w-3.5 h-3.5 mr-1" />
                    Deploy Live
                  </Button>
                </div>

                {/* Row 2: Auto-Run every 1 min / Stop */}
                {isRunning ? (
                  <Button
                    size="sm"
                    className="w-full h-9 text-xs bg-red-500/20 text-red-400 border border-red-500/40 hover:bg-red-500/30 font-semibold"
                    variant="outline"
                    onClick={onStop}
                  >
                    <Square className="w-3.5 h-3.5 mr-1.5" />
                    Stop Auto-Run
                    <span className="ml-auto flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      <span className="text-emerald-400 text-[10px]">LIVE</span>
                    </span>
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    className="w-full h-9 text-xs bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 hover:bg-emerald-500/30 font-semibold"
                    variant="outline"
                    onClick={() => onAutoRun(getEffectiveStrategy(strategy))}
                    disabled={isLoading}
                  >
                    <Activity className="w-3.5 h-3.5 mr-1.5" />
                    Start Auto-Run (1 min)
                  </Button>
                )}
              </div>
            )}
          </div>
        )
      })}

      {/* Signals Panel */}
      {signals.length > 0 && (
        <div className="rounded-xl border border-[--color-panel-border] bg-[--color-panel] p-3 mt-1">
          <div className="flex items-center gap-1.5 mb-2">
            <Zap className="w-3.5 h-3.5 text-[--color-accent]" />
            <span className="text-xs font-medium uppercase tracking-wider text-[--color-muted]">Latest Signals</span>
            {lastRun && <span className="text-[10px] text-[--color-muted] ml-auto font-mono">{lastRun}</span>}
          </div>
          <div className="flex flex-col gap-1.5">
            {signals.map((signal, i) => (
              <div
                key={i}
                className={cn(
                  "flex items-start gap-2 p-2 rounded-lg text-xs",
                  signal.action === "buy"
                    ? "bg-emerald-500/10 border border-emerald-500/20"
                    : signal.action === "sell"
                    ? "bg-red-500/10 border border-red-500/20"
                    : "bg-[--color-panel-border]/40"
                )}
              >
                <span
                  className={cn(
                    "font-bold uppercase mt-0.5 flex-shrink-0",
                    signal.action === "buy" ? "text-emerald-400" : signal.action === "sell" ? "text-red-400" : "text-[--color-muted]"
                  )}
                >
                  {signal.action}
                </span>
                <div className="flex-1 min-w-0">
                  <span className="font-mono font-bold text-[--color-fg]">{signal.symbol}</span>
                  <span className="text-[--color-muted] ml-1">x{signal.qty}</span>
                  <p className="text-[--color-muted] text-[10px] mt-0.5 leading-relaxed">{signal.reason}</p>
                </div>
                <span className="text-[--color-muted] text-[10px] flex-shrink-0 bg-[--color-panel-border]/50 px-1.5 py-0.5 rounded font-mono">
                  {(signal.confidence * 100).toFixed(0)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {signals.length === 0 && activeStrategy && !isRunning && (
        <div className="rounded-xl border border-[--color-panel-border]/50 bg-[--color-panel]/50 p-3 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-[--color-muted] flex-shrink-0" />
          <span className="text-xs text-[--color-muted]">No signals yet. Dry Run or Start Auto-Run to analyze.</span>
        </div>
      )}

      {isRunning && signals.length === 0 && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 flex items-center gap-2">
          <RefreshCw className="w-4 h-4 text-emerald-400 animate-spin flex-shrink-0" />
          <span className="text-xs text-emerald-400">Running analysis every 60 seconds...</span>
        </div>
      )}
    </div>
  )
}
