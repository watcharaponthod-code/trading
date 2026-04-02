"use client"

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
} from "recharts"

interface PnLPoint {
  label: string
  pnl: number
}

interface PnLChartProps {
  data: PnLPoint[]
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    const val = payload[0]?.value
    return (
      <div className="bg-slate-900/80 backdrop-blur-md border border-white/10 rounded-xl px-4 py-3 text-xs shadow-2xl">
        <p className="text-white/60 mb-2 font-mono tracking-wider uppercase">{label}</p>
        <p className={`font-mono font-semibold ${val >= 0 ? "text-[--color-green]" : "text-[--color-red]"}`}>
          {val >= 0 ? "+" : ""}${val?.toFixed(2)}
        </p>
      </div>
    )
  }
  return null
}

export function PnLChart({ data }: PnLChartProps) {
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-[--color-muted] text-sm">
        No P&L data available
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-panel-border)" vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 10 }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          domain={['auto', 'auto']}
          tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          width={60}
          tickFormatter={(v) => `$${v.toFixed(0)}`}
        />
        <Tooltip content={<CustomTooltip />} />
        <ReferenceLine y={0} stroke="var(--color-muted)" strokeOpacity={0.5} />
        <Bar dataKey="pnl" radius={[3, 3, 0, 0]}>
          {data.map((entry, index) => (
            <Cell
              key={`cell-${index}`}
              fill={entry.pnl >= 0 ? "var(--color-green)" : "var(--color-red)"}
              fillOpacity={0.8}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
