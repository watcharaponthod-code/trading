"use client"

import { useState } from "react"
import { X, Loader2, Clock, CheckCircle, AlertCircle, XCircle } from "lucide-react"
import { cn } from "@/lib/utils"
import { format } from "date-fns"

interface Order {
  id: string
  symbol: string
  side: "buy" | "sell"
  type: string
  qty: string
  filled_qty: string
  limit_price: string | null
  filled_avg_price: string | null
  status: string
  created_at: string
  time_in_force: string
}

interface OrdersTableProps {
  orders: Order[]
  onCancel?: (orderId: string) => Promise<void> | void
  loading?: boolean
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: any; cancellable: boolean }> = {
  new:              { label: "New",         color: "text-blue-400 bg-blue-400/10 border-blue-400/25",     icon: Clock,       cancellable: true },
  accepted:         { label: "Accepted",    color: "text-blue-400 bg-blue-400/10 border-blue-400/25",     icon: Clock,       cancellable: true },
  pending_new:      { label: "Pending",     color: "text-yellow-400 bg-yellow-400/10 border-yellow-400/25", icon: Clock,     cancellable: true },
  partially_filled: { label: "Partial",     color: "text-yellow-400 bg-yellow-400/10 border-yellow-400/25", icon: Clock,     cancellable: true },
  filled:           { label: "Filled",      color: "text-emerald-400 bg-emerald-400/10 border-emerald-400/25", icon: CheckCircle, cancellable: false },
  canceled:         { label: "Cancelled",   color: "text-white/30 bg-white/5 border-white/10",            icon: XCircle,     cancellable: false },
  expired:          { label: "Expired",     color: "text-white/30 bg-white/5 border-white/10",            icon: XCircle,     cancellable: false },
  rejected:         { label: "Rejected",    color: "text-red-400 bg-red-400/10 border-red-400/25",        icon: AlertCircle, cancellable: false },
}

export function OrdersTable({ orders, onCancel, loading }: OrdersTableProps) {
  const [cancelling, setCancelling] = useState<string | null>(null)

  if (loading) {
    return (
      <div className="flex items-center justify-center h-28 text-[--color-muted] text-sm gap-2">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading orders...
      </div>
    )
  }

  if (!orders || orders.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-28 gap-1">
        <span className="text-2xl">📋</span>
        <span className="text-[--color-muted] text-sm">No recent orders</span>
      </div>
    )
  }

  const handleCancel = async (orderId: string) => {
    if (!onCancel || cancelling) return
    setCancelling(orderId)
    try {
      await onCancel(orderId)
    } finally {
      setCancelling(null)
    }
  }

  const activeCount = orders.filter(o => STATUS_CONFIG[o.status]?.cancellable).length

  return (
    <div className="flex flex-col">
      {/* Summary */}
      <div className="flex items-center justify-between px-4 py-2 bg-[--color-panel-border]/20 text-xs">
        <span className="text-[--color-muted]">{orders.length} order{orders.length !== 1 ? "s" : ""}</span>
        {activeCount > 0 && (
          <span className="text-yellow-400 font-bold">{activeCount} active</span>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[--color-panel-border]">
              {["Symbol", "Side", "Type", "Qty", "Fill Qty", "Limit", "Fill Price", "Status", "Time", ""].map((h) => (
                <th key={h} className="text-left py-2 px-3 text-[--color-muted] font-medium uppercase tracking-wider whitespace-nowrap text-[10px]">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => {
              const cfg = STATUS_CONFIG[order.status] || {
                label: order.status,
                color: "text-white/40 bg-white/5 border-white/10",
                icon: Clock,
                cancellable: false,
              }
              const StatusIcon = cfg.icon
              const isCancelling = cancelling === order.id

              let createdAt = ""
              try {
                createdAt = format(new Date(order.created_at), "HH:mm:ss")
              } catch {}

              return (
                <tr
                  key={order.id}
                  className={cn(
                    "border-b border-[--color-panel-border]/40 transition-colors",
                    isCancelling ? "opacity-50 bg-red-500/5" : "hover:bg-[--color-panel-border]/20"
                  )}
                >
                  <td className="py-2.5 px-3 font-bold text-[--color-fg] font-mono">{order.symbol}</td>
                  <td className="py-2.5 px-3">
                    <span className={cn(
                      "px-1.5 py-0.5 rounded text-[10px] font-bold uppercase",
                      order.side === "buy"
                        ? "bg-emerald-500/15 text-emerald-400"
                        : "bg-red-500/15 text-red-400"
                    )}>
                      {order.side}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-[--color-muted] uppercase text-[10px]">{order.type}</td>
                  <td className="py-2.5 px-3 font-mono text-[--color-fg]">
                    {parseFloat(order.qty || "0").toFixed(2)}
                  </td>
                  <td className="py-2.5 px-3 font-mono text-[--color-muted]">
                    {order.filled_qty ? parseFloat(order.filled_qty).toFixed(2) : "—"}
                  </td>
                  <td className="py-2.5 px-3 font-mono text-[--color-muted]">
                    {order.limit_price ? `$${parseFloat(order.limit_price).toFixed(2)}` : "MKT"}
                  </td>
                  <td className="py-2.5 px-3 font-mono text-[--color-fg]">
                    {order.filled_avg_price ? `$${parseFloat(order.filled_avg_price).toFixed(2)}` : "—"}
                  </td>
                  <td className="py-2.5 px-3">
                    <span className={cn("flex items-center gap-1 px-1.5 py-0.5 rounded-full border text-[10px] font-semibold", cfg.color)}>
                      <StatusIcon className="w-2.5 h-2.5" />
                      {cfg.label}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 font-mono text-[--color-muted] text-[10px] whitespace-nowrap">
                    {createdAt}
                  </td>
                  <td className="py-2.5 px-3">
                    {cfg.cancellable && onCancel && (
                      <button
                        disabled={!!cancelling}
                        onClick={() => handleCancel(order.id)}
                        className={cn(
                          "flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold uppercase transition-all border",
                          isCancelling
                            ? "border-red-500/30 text-red-400 bg-red-500/10"
                            : "border-red-500/30 text-red-400 bg-red-500/5 hover:bg-red-500/20 hover:border-red-500/50",
                          cancelling && cancelling !== order.id && "opacity-30 cursor-not-allowed"
                        )}
                      >
                        {isCancelling
                          ? <Loader2 className="w-3 h-3 animate-spin" />
                          : <X className="w-3 h-3" />
                        }
                        {isCancelling ? "..." : "Cancel"}
                      </button>
                    )}
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
