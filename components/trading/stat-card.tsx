"use client"

import { TrendingUp, TrendingDown, Minus } from "lucide-react"
import { cn } from "@/lib/utils"

interface StatCardProps {
  label: string
  value: string
  subValue?: string
  change?: number
  prefix?: string
  className?: string
  highlight?: boolean
}

export function StatCard({ label, value, subValue, change, prefix, className, highlight }: StatCardProps) {
  const isPositive = change !== undefined && change > 0
  const isNegative = change !== undefined && change < 0
  const isNeutral = change !== undefined && change === 0

  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur-xl transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl hover:shadow-[--color-accent]/20",
        highlight && "border-[--color-accent]/50 bg-gradient-to-br from-[--color-accent]/20 to-transparent",
        className
      )}
    >
      {/* Subtle background glow effect */}
      <div className="absolute -right-8 -top-8 h-24 w-24 rounded-full bg-white/5 blur-2xl transition-all duration-500 group-hover:bg-[--color-accent]/20" />
      
      <span className="text-[11px] font-bold text-white/50 uppercase tracking-[0.2em]">{label}</span>
      <div className="flex items-end gap-2 mt-1 -mb-1">
        <span className="text-3xl font-bold font-mono text-white tracking-tight leading-none drop-shadow-md">
          {prefix && <span className="text-xl mr-1 text-white/40">{prefix}</span>}
          {value}
        </span>
        {change !== undefined && (
          <span
            className={cn(
              "flex items-center gap-0.5 text-[11px] font-bold py-0.5 px-1.5 rounded-full mb-1 border",
              isPositive && "text-[--color-green] bg-[--color-green]/10 border-[--color-green]/20",
              isNegative && "text-[--color-red] bg-[--color-red]/10 border-[--color-red]/20",
              isNeutral && "text-white/50 bg-white/5 border-white/10"
            )}
          >
            {isPositive && <TrendingUp className="w-3 h-3" />}
            {isNegative && <TrendingDown className="w-3 h-3" />}
            {isNeutral && <Minus className="w-3 h-3" />}
            {change > 0 ? "+" : ""}{change.toFixed(2)}%
          </span>
        )}
      </div>
      {subValue && <span className="text-xs text-white/40 mt-1 block">{subValue}</span>}
    </div>
  )
}
