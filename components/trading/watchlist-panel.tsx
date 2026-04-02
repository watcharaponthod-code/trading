"use client"

import { BarChart2, TrendingUp, TrendingDown } from "lucide-react"
import { cn } from "@/lib/utils"

interface WatchlistItem {
  symbol: string
  price: number
  change: number
  changePercent: number
  volume?: number
}

interface WatchlistPanelProps {
  items: WatchlistItem[]
  activeSymbol?: string
  onSelect: (symbol: string) => void
  loading?: boolean
}

export function WatchlistPanel({ items, activeSymbol, onSelect, loading }: WatchlistPanelProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center h-24 text-[--color-muted] text-sm">
        Loading market data...
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-0.5">
      {items.map((item) => {
        const isPositive = item.change >= 0
        return (
          <button
            key={item.symbol}
            onClick={() => onSelect(item.symbol)}
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all",
              activeSymbol === item.symbol
                ? "bg-[--color-accent]/10 border border-[--color-accent]/30"
                : "hover:bg-[--color-panel-border]/40 border border-transparent"
            )}
          >
            <div className={cn(
              "w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0",
              "bg-[--color-panel-border]/60"
            )}>
              <BarChart2 className="w-3.5 h-3.5 text-[--color-muted]" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold font-mono text-[--color-fg]">{item.symbol}</span>
                <span className="text-sm font-mono font-semibold text-[--color-fg]">
                  ${item.price.toFixed(2)}
                </span>
              </div>
              <div className="flex items-center justify-between mt-0.5">
                <span className="text-[10px] text-[--color-muted]">
                  Vol: {item.volume ? (item.volume / 1000).toFixed(0) + "K" : "—"}
                </span>
                <span className={cn(
                  "flex items-center gap-0.5 text-[10px] font-semibold",
                  isPositive ? "text-[--color-green]" : "text-[--color-red]"
                )}>
                  {isPositive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                  {isPositive ? "+" : ""}{item.changePercent.toFixed(2)}%
                </span>
              </div>
            </div>
          </button>
        )
      })}
    </div>
  )
}
