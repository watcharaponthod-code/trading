"use client"

import { useState } from "react"
import { TrendingUp, TrendingDown, X, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"

interface Position {
  symbol: string
  qty: string
  avg_entry_price: string
  current_price: string
  market_value: string
  unrealized_pl: string
  unrealized_plpc: string
  side: string
}

interface PositionsTableProps {
  positions: Position[]
  onClose?: (symbol: string) => Promise<void> | void
  loading?: boolean
}

export function PositionsTable({ positions, onClose, loading }: PositionsTableProps) {
  const [closing, setClosing] = useState<string | null>(null)

  if (loading) {
    return (
      <div className="flex items-center justify-center h-28 text-[--color-muted] text-sm gap-2">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading positions...
      </div>
    )
  }

  if (!positions || positions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-28 gap-1">
        <span className="text-2xl">📭</span>
        <span className="text-[--color-muted] text-sm">No open positions</span>
      </div>
    )
  }

  const handleClose = async (symbol: string) => {
    if (!onClose || closing) return
    setClosing(symbol)
    try {
      await onClose(symbol)
    } finally {
      setClosing(null)
    }
  }

  const totalPL = positions.reduce((sum, p) => sum + parseFloat(p.unrealized_pl || "0"), 0)

  return (
    <div className="flex flex-col">
      {/* Summary bar */}
      <div className="flex items-center justify-between px-4 py-2 bg-[--color-panel-border]/20 text-xs">
        <span className="text-[--color-muted]">{positions.length} position{positions.length !== 1 ? "s" : ""}</span>
        <span className={cn("font-bold font-mono", totalPL >= 0 ? "text-emerald-400" : "text-red-400")}>
          Total P&L: {totalPL >= 0 ? "+" : ""}${totalPL.toFixed(2)}
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[--color-panel-border]">
              {["Symbol", "Side", "Qty", "Entry", "Current", "Mkt Value", "P&L", "%", "Close"].map((h) => (
                <th key={h} className="text-left py-2 px-3 text-[--color-muted] font-medium uppercase tracking-wider whitespace-nowrap text-[10px]">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {positions.map((pos) => {
              const pl = parseFloat(pos.unrealized_pl)
              const plpc = parseFloat(pos.unrealized_plpc) * 100
              const isPositive = pl >= 0
              const isClosing = closing === pos.symbol

              return (
                <tr
                  key={pos.symbol}
                  className={cn(
                    "border-b border-[--color-panel-border]/40 transition-colors",
                    isClosing ? "opacity-50 bg-red-500/5" : "hover:bg-[--color-panel-border]/20"
                  )}
                >
                  <td className="py-3 px-3 font-bold text-[--color-fg] font-mono">{pos.symbol}</td>
                  <td className="py-3 px-3">
                    <span className={cn(
                      "px-1.5 py-0.5 rounded text-[10px] font-bold uppercase",
                      pos.side === "long"
                        ? "bg-emerald-500/15 text-emerald-400"
                        : "bg-red-500/15 text-red-400"
                    )}>
                      {pos.side}
                    </span>
                  </td>
                  <td className="py-3 px-3 font-mono text-[--color-fg]">
                    {parseFloat(pos.qty).toFixed(2)}
                  </td>
                  <td className="py-3 px-3 font-mono text-[--color-muted]">
                    ${parseFloat(pos.avg_entry_price).toFixed(2)}
                  </td>
                  <td className="py-3 px-3 font-mono text-[--color-fg] font-semibold">
                    ${parseFloat(pos.current_price).toFixed(2)}
                  </td>
                  <td className="py-3 px-3 font-mono text-[--color-muted]">
                    ${parseFloat(pos.market_value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td className={cn("py-3 px-3 font-mono font-bold", isPositive ? "text-emerald-400" : "text-red-400")}>
                    {isPositive ? "+" : ""}${pl.toFixed(2)}
                  </td>
                  <td className={cn("py-3 px-3 font-mono font-bold text-[10px]", isPositive ? "text-emerald-400" : "text-red-400")}>
                    <span className="flex items-center gap-0.5">
                      {isPositive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                      {isPositive ? "+" : ""}{plpc.toFixed(2)}%
                    </span>
                  </td>
                  <td className="py-3 px-3">
                    <button
                      disabled={!!closing}
                      onClick={() => handleClose(pos.symbol)}
                      className={cn(
                        "flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase transition-all border",
                        isClosing
                          ? "border-red-500/30 text-red-400 bg-red-500/10"
                          : "border-red-500/30 text-red-400 bg-red-500/5 hover:bg-red-500/20 hover:border-red-500/50",
                        closing && closing !== pos.symbol && "opacity-30 cursor-not-allowed"
                      )}
                    >
                      {isClosing ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <X className="w-3 h-3" />
                      )}
                      {isClosing ? "Closing..." : "Close"}
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
