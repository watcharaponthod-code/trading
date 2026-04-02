"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface OrderFormProps {
  onSubmit: (order: {
    symbol?: string
    qty: number
    side: "buy" | "sell"
    type: "market" | "limit"
    time_in_force?: string
    limit_price?: number
  }) => void
  isLoading?: boolean
}

export function OrderForm({ onSubmit, isLoading }: OrderFormProps) {
  const [symbol, setSymbol] = useState("")
  const [qty, setQty] = useState("")
  const [side, setSide] = useState<"buy" | "sell">("buy")
  const [type, setType] = useState<"market" | "limit">("market")
  const [tif, setTif] = useState<"day" | "gtc" | "ioc">("day")
  const [limitPrice, setLimitPrice] = useState("")

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!symbol || !qty) return
    onSubmit({
      symbol: symbol.toUpperCase().trim(),
      qty: parseFloat(qty),
      side,
      type,
      time_in_force: tif,
      limit_price: type === "limit" && limitPrice ? parseFloat(limitPrice) : undefined,
    })
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setSide("buy")}
          className={cn(
            "py-2 rounded-lg text-sm font-semibold border transition-all",
            side === "buy"
              ? "bg-[--color-green]/20 border-[--color-green]/50 text-[--color-green]"
              : "bg-transparent border-[--color-panel-border] text-[--color-muted] hover:border-[--color-green]/30"
          )}
        >
          Buy
        </button>
        <button
          type="button"
          onClick={() => setSide("sell")}
          className={cn(
            "py-2 rounded-lg text-sm font-semibold border transition-all",
            side === "sell"
              ? "bg-[--color-red]/20 border-[--color-red]/50 text-[--color-red]"
              : "bg-transparent border-[--color-panel-border] text-[--color-muted] hover:border-[--color-red]/30"
          )}
        >
          Sell
        </button>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-[10px] uppercase tracking-wider text-[--color-muted]">Symbol</label>
        <input
          type="text"
          value={symbol}
          onChange={(e) => setSymbol(e.target.value.toUpperCase())}
          placeholder="AAPL"
          className="bg-[--color-bg] border border-[--color-panel-border] rounded-lg px-3 py-2 text-sm font-mono text-[--color-fg] focus:outline-none focus:border-[--color-accent]/60 uppercase"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-[10px] uppercase tracking-wider text-[--color-muted]">Quantity</label>
        <input
          type="number"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          placeholder="1"
          min="0.001"
          step="0.001"
          className="bg-[--color-bg] border border-[--color-panel-border] rounded-lg px-3 py-2 text-sm font-mono text-[--color-fg] focus:outline-none focus:border-[--color-accent]/60"
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] uppercase tracking-wider text-[--color-muted]">Order Type</label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as "market" | "limit")}
            className="bg-[--color-bg] border border-[--color-panel-border] rounded-lg px-3 py-2 text-sm text-[--color-fg] focus:outline-none focus:border-[--color-accent]/60"
          >
            <option value="market">Market</option>
            <option value="limit">Limit</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] uppercase tracking-wider text-[--color-muted]">Time in Force</label>
          <select
            value={tif}
            onChange={(e) => setTif(e.target.value as "day" | "gtc" | "ioc")}
            className="bg-[--color-bg] border border-[--color-panel-border] rounded-lg px-3 py-2 text-sm text-[--color-fg] focus:outline-none focus:border-[--color-accent]/60"
          >
            <option value="day">DAY</option>
            <option value="gtc">GTC</option>
            <option value="ioc">IOC</option>
          </select>
        </div>
      </div>

      {type === "limit" && (
        <div className="flex flex-col gap-1">
          <label className="text-[10px] uppercase tracking-wider text-[--color-muted]">Limit Price</label>
          <input
            type="number"
            value={limitPrice}
            onChange={(e) => setLimitPrice(e.target.value)}
            placeholder="0.00"
            step="0.01"
            className="bg-[--color-bg] border border-[--color-panel-border] rounded-lg px-3 py-2 text-sm font-mono text-[--color-fg] focus:outline-none focus:border-[--color-accent]/60"
          />
        </div>
      )}

      <Button
        type="submit"
        disabled={isLoading || !symbol || !qty}
        className={cn(
          "w-full h-10 text-sm font-semibold",
          side === "buy"
            ? "bg-[--color-green] hover:bg-[--color-green]/90 text-[--color-bg]"
            : "bg-[--color-red] hover:bg-[--color-red]/90 text-[--color-fg]"
        )}
      >
        {isLoading ? "Submitting..." : `${side === "buy" ? "Buy" : "Sell"} ${symbol || "—"}`}
      </Button>
    </form>
  )
}
