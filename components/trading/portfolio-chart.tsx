"use client"

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts"
import { format } from "date-fns"

interface PortfolioPoint {
  timestamp: number
  equity: number
  profitLoss: number
}

interface PortfolioChartProps {
  data: PortfolioPoint[]
  baseValue?: number
}

const CustomTooltip = ({ active, payload }: any) => {
  if (active && payload && payload.length) {
    const d = payload[0]?.payload
    if (!d) return null
    const isUp = d.pl >= 0
    return (
      <div className="bg-slate-900/90 backdrop-blur-md border border-white/10 rounded-xl px-4 py-3 text-xs shadow-2xl">
        <p className="text-white/50 mb-2 font-mono tracking-wider uppercase">{d.displayTime}</p>
        <p className="text-white font-mono font-bold text-sm">
          ${d.equity?.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </p>
        {d.pl !== 0 && (
          <p className={`font-mono text-xs mt-1 ${isUp ? "text-emerald-400" : "text-red-400"}`}>
            P&L: {isUp ? "+" : ""}${d.pl?.toFixed(2)}
          </p>
        )}
      </div>
    )
  }
  return null
}

export function PortfolioChart({ data, baseValue }: PortfolioChartProps) {
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-white/30 text-sm flex-col gap-2">
        <span className="text-2xl">📈</span>
        <span>No portfolio history yet</span>
        <span className="text-xs text-white/20">Run a strategy to generate snapshots</span>
      </div>
    )
  }

  // Parse and validate data
  const formatted = data.map((d) => {
    let ts = 0
    try {
      if (typeof d.timestamp === "number" && d.timestamp > 0) {
        ts = d.timestamp < 20_000_000_000 ? d.timestamp * 1000 : d.timestamp
      }
    } catch {}
    return {
      ts,
      displayTime: ts ? format(new Date(ts), "MM/dd HH:mm") : "--",
      equity: Number(d.equity) || 0,
      pl: Number(d.profitLoss) || 0,
    }
  }).filter(d => d.ts > 0 && d.equity > 0)

  if (formatted.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-white/30 text-sm">
        Loading portfolio data...
      </div>
    )
  }

  const equities = formatted.map(d => d.equity).filter(Number.isFinite)
  const minEq = Math.min(...equities)
  const maxEq = Math.max(...equities)
  const spread = maxEq - minEq || maxEq * 0.02 || 100
  const domainMin = Math.max(0, minEq - spread * 0.15)
  const domainMax = maxEq + spread * 0.15

  const isPositive = formatted[formatted.length - 1].equity >= formatted[0].equity
  const strokeColor = isPositive ? "#10b981" : "#ef4444"
  const gradId = isPositive ? "eqGreen" : "eqRed"

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={formatted} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="eqGreen" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="eqRed" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
        <XAxis
          dataKey="ts"
          type="number"
          scale="time"
          domain={["dataMin", "dataMax"]}
          tickFormatter={(ts) => {
            try { return format(new Date(ts), "HH:mm") } catch { return "" }
          }}
          tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 9 }}
          axisLine={false}
          tickLine={false}
          minTickGap={40}
        />
        <YAxis
          domain={[domainMin, domainMax]}
          tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 9 }}
          axisLine={false}
          tickLine={false}
          width={80}
          tickFormatter={(v) => `$${Number(v).toLocaleString()}`}
        />
        <Tooltip content={<CustomTooltip />} />
        {baseValue && Number.isFinite(baseValue) && (
          <ReferenceLine y={baseValue} stroke="rgba(255,255,255,0.2)" strokeDasharray="4 4" />
        )}
        <Area
          type="monotone"
          dataKey="equity"
          stroke={strokeColor}
          strokeWidth={2}
          fill={`url(#${gradId})`}
          dot={false}
          activeDot={{ r: 4, fill: strokeColor, strokeWidth: 0 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
