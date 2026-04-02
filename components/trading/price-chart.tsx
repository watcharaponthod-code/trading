"use client"

import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts"
import { format } from "date-fns"

interface CandleBar {
  t: string
  o: number
  h: number
  l: number
  c: number
  v: number
}

interface PriceChartProps {
  data: CandleBar[]
  symbol: string
}

const CustomTooltip = ({ active, payload }: any) => {
  if (active && payload && payload.length) {
    const bar = payload[0]?.payload
    if (!bar) return null
    const isGreen = bar.c >= bar.o
    return (
      <div className="bg-slate-900/90 backdrop-blur-md border border-white/10 rounded-xl px-4 py-3 text-xs shadow-2xl min-w-[160px]">
        <p className="text-white/50 mb-2 font-mono tracking-widest uppercase">{bar.displayTime}</p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
          <span className="text-white/40">Open</span>
          <span className="text-white font-mono">${bar.o?.toFixed(2)}</span>
          <span className="text-white/40">High</span>
          <span className="text-emerald-400 font-mono">${bar.h?.toFixed(2)}</span>
          <span className="text-white/40">Low</span>
          <span className="text-red-400 font-mono">${bar.l?.toFixed(2)}</span>
          <span className="text-white/40">Close</span>
          <span className={`font-mono font-bold ${isGreen ? "text-emerald-400" : "text-red-400"}`}>${bar.c?.toFixed(2)}</span>
          <span className="text-white/40">Volume</span>
          <span className="text-white font-mono">{bar.v?.toLocaleString()}</span>
        </div>
      </div>
    )
  }
  return null
}

export function PriceChart({ data, symbol }: PriceChartProps) {
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-white/30 text-sm flex-col gap-2">
        <span className="text-2xl">📊</span>
        <span>No price data for {symbol}</span>
      </div>
    )
  }

  // Parse timestamps safely
  const formatted = data.map((d) => {
    let ts = 0
    try {
      if (d.t) {
        const dateObj = new Date(d.t)
        if (!isNaN(dateObj.getTime())) {
          ts = dateObj.getTime()
        }
      }
    } catch {}
    return {
      ts,
      displayTime: ts ? format(new Date(ts), "HH:mm") : "--:--",
      o: Number(d.o) || 0,
      h: Number(d.h) || 0,
      l: Number(d.l) || 0,
      c: Number(d.c) || 0,
      v: Number(d.v) || 0,
    }
  }).filter(d => d.ts > 0 && d.c > 0)

  if (formatted.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-white/30 text-sm">
        Processing data...
      </div>
    )
  }

  const closes = formatted.map(d => d.c).filter(Number.isFinite)
  const highs = formatted.map(d => d.h).filter(Number.isFinite)
  const lows = formatted.map(d => d.l).filter(Number.isFinite)
  const minPrice = Math.min(...lows)
  const maxPrice = Math.max(...highs)
  const spread = maxPrice - minPrice || maxPrice * 0.01 || 1
  const domainMin = Math.max(0, minPrice - spread * 0.1)
  const domainMax = maxPrice + spread * 0.1

  const lastClose = closes[closes.length - 1]
  const firstClose = closes[0]
  const strokeColor = lastClose >= firstClose ? "#10b981" : "#ef4444"

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={formatted} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="priceGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={strokeColor} stopOpacity={0.15} />
            <stop offset="95%" stopColor={strokeColor} stopOpacity={0} />
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
          width={72}
          tickFormatter={(v) => `$${Number(v).toFixed(2)}`}
        />
        <Tooltip content={<CustomTooltip />} />
        <ReferenceLine y={firstClose} stroke="rgba(255,255,255,0.15)" strokeDasharray="4 4" />
        <Line
          type="monotone"
          dataKey="c"
          stroke={strokeColor}
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, fill: strokeColor, strokeWidth: 0 }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  )
}
