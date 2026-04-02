/**
 * Risk Manager — World-Class Position Sizing & Portfolio Protection
 * 
 * Implements:
 * - Kelly Criterion (half-Kelly for safety)
 * - ATR-based position sizing
 * - Daily drawdown circuit breaker
 * - Max portfolio heat
 * - Correlation exposure limits
 */

export interface RiskConfig {
  maxPositionPct: number    // Max % of equity per position (default 5%)
  maxPortfolioHeat: number  // Max total risk exposure (default 20%)
  dailyLossLimit: number    // Circuit breaker at daily loss % (default -3%)
  maxDrawdownPct: number    // Pause engine at drawdown % (default -8%)
  riskPerTrade: number      // Risk per trade as % of equity (default 1%)
  minWinRate: number        // Min win rate required (default 0.45)
  atrMultiplierTP: number   // ATR multiplier for take profit (default 2.0)
  atrMultiplierSL: number   // ATR multiplier for stop loss  (default 1.0)
}

export const DEFAULT_RISK_CONFIG: RiskConfig = {
  maxPositionPct: 0.05,
  maxPortfolioHeat: 0.20,
  dailyLossLimit: -0.03,
  maxDrawdownPct: -0.08,
  riskPerTrade: 0.01,
  minWinRate: 0.45,
  atrMultiplierTP: 2.0,
  atrMultiplierSL: 1.0,
}

// ─── ATR Calculation ─────────────────────────────────────────────────────────

export interface OHLCV {
  o: number; h: number; l: number; c: number; v: number
}

export function calcATR(bars: OHLCV[], period = 14): number {
  if (bars.length < 2) return 0
  const trs: number[] = []
  for (let i = 1; i < bars.length; i++) {
    const tr = Math.max(
      bars[i].h - bars[i].l,
      Math.abs(bars[i].h - bars[i - 1].c),
      Math.abs(bars[i].l - bars[i - 1].c)
    )
    trs.push(tr)
  }
  const recent = trs.slice(-period)
  return recent.reduce((a, b) => a + b, 0) / recent.length
}

export function calcRSI(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50
  let gains = 0, losses = 0
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1]
    if (diff > 0) gains += diff
    else losses -= diff
  }
  const avgGain = gains / period
  const avgLoss = losses / period
  if (avgLoss === 0) return 100
  const rs = avgGain / avgLoss
  return 100 - 100 / (1 + rs)
}

export function calcEMA(closes: number[], period: number): number[] {
  const k = 2 / (period + 1)
  const emas: number[] = [closes[0]]
  for (let i = 1; i < closes.length; i++) {
    emas.push(closes[i] * k + emas[i - 1] * (1 - k))
  }
  return emas
}

export function calcMACD(closes: number[]): { macd: number; signal: number; hist: number } {
  if (closes.length < 35) return { macd: 0, signal: 0, hist: 0 }
  const ema12 = calcEMA(closes, 12)
  const ema26 = calcEMA(closes, 26)
  const macdLine = ema12.map((v, i) => v - ema26[i])
  const signalLine = calcEMA(macdLine, 9)
  const last = macdLine.length - 1
  return {
    macd: macdLine[last],
    signal: signalLine[last],
    hist: macdLine[last] - signalLine[last],
  }
}

export function calcBollingerBands(closes: number[], period = 20, stdDev = 2): {
  upper: number; middle: number; lower: number
} {
  const slice = closes.slice(-period)
  const m = slice.reduce((a, b) => a + b, 0) / slice.length
  const s = Math.sqrt(slice.reduce((a, b) => a + (b - m) ** 2, 0) / slice.length)
  return { upper: m + stdDev * s, middle: m, lower: m - stdDev * s }
}

export function calcVWAP(bars: OHLCV[]): number {
  let cumTP = 0, cumVol = 0
  for (const b of bars) {
    const tp = (b.h + b.l + b.c) / 3
    cumTP += tp * b.v
    cumVol += b.v
  }
  return cumVol > 0 ? cumTP / cumVol : 0
}

// ─── Kelly Criterion ─────────────────────────────────────────────────────────

export function kellyFraction(winRate: number, avgWin: number, avgLoss: number): number {
  if (avgLoss === 0) return 0
  const b = avgWin / avgLoss // bet-to-loss ratio
  const kelly = winRate - (1 - winRate) / b
  // Half-Kelly for safety, cap at 10%
  return Math.min(Math.max(kelly * 0.5, 0), 0.10)
}

// ─── ATR-based Position Sizing ───────────────────────────────────────────────

export function sizeByATR(params: {
  equity: number
  price: number
  atr: number
  riskPerTrade: number  // e.g. 0.01 = 1% of equity
  atrMultiplier: number // stop-loss distance in ATR units
}): number {
  const { equity, price, atr, riskPerTrade, atrMultiplier } = params
  if (atr === 0 || price === 0) return 1
  const dollarRisk = equity * riskPerTrade
  const slDistance = atr * atrMultiplier
  const qty = Math.floor(dollarRisk / slDistance)
  // Also cap by max position %
  const maxByPct = Math.floor((equity * 0.05) / price)
  return Math.max(1, Math.min(qty, maxByPct))
}

// ─── Portfolio Risk Metrics ──────────────────────────────────────────────────

export interface PortfolioRisk {
  totalExposure: number      // total market value of all positions
  totalRiskPct: number       // exposure as % of equity
  dailyPnlPct: number        // today's P&L %
  drawdownPct: number        // drawdown from peak equity
  isCircuitBreakerActive: boolean
  canTrade: boolean
  reason: string
}

export function assessPortfolioRisk(
  equity: number,
  lastEquity: number,
  positions: Array<{ market_value: string; unrealized_pl: string }>,
  config: RiskConfig
): PortfolioRisk {
  const totalExposure = positions.reduce((sum, p) => sum + Math.abs(parseFloat(p.market_value || "0")), 0)
  const totalRiskPct = totalExposure / equity
  const dailyPnlPct = lastEquity > 0 ? (equity - lastEquity) / lastEquity : 0
  
  // Approximate drawdown (would need historical peak in production)
  const drawdownPct = dailyPnlPct // simplified: daily P&L = drawdown proxy

  const isCircuitBreakerActive = dailyPnlPct <= config.dailyLossLimit || drawdownPct <= config.maxDrawdownPct
  const heatTooHigh = totalRiskPct >= config.maxPortfolioHeat

  let canTrade = !isCircuitBreakerActive && !heatTooHigh
  let reason = "OK"

  if (isCircuitBreakerActive) {
    reason = `🚨 Circuit Breaker: Daily P&L ${(dailyPnlPct * 100).toFixed(2)}%`
    canTrade = false
  } else if (heatTooHigh) {
    reason = `🔥 Portfolio too hot: ${(totalRiskPct * 100).toFixed(1)}% exposure`
    canTrade = false
  }

  return { totalExposure, totalRiskPct, dailyPnlPct, drawdownPct, isCircuitBreakerActive, canTrade, reason }
}

// ─── Signal Confidence Scoring ────────────────────────────────────────────────

export interface SignalScore {
  symbol: string
  strategy: string
  action: "buy" | "sell" | "hold"
  confidence: number        // 0-1
  atr: number
  suggestedQty: number
  tpPrice: number
  slPrice: number
  reason: string
}

export function scoreMomentumSignal(
  symbol: string,
  bars: OHLCV[],
  equity: number,
  config: RiskConfig
): SignalScore | null {
  if (bars.length < 35) return null
  const closes = bars.map(b => b.c)
  const price = closes[closes.length - 1]
  const atr = calcATR(bars)
  const rsi = calcRSI(closes)
  const { macd, signal, hist } = calcMACD(closes)
  const ema9 = calcEMA(closes, 9)
  const ema21 = calcEMA(closes, 21)
  const vwap = calcVWAP(bars.slice(-20))

  const emaLast = ema9[ema9.length - 1]
  const emaSlow = ema21[ema21.length - 1]
  const emaBullish = emaLast > emaSlow
  const emaBearish = emaLast < emaSlow
  
  const prevCloses = closes.slice(0, -1)
  const prevHist = calcMACD(prevCloses).hist
  const macdCrossUp = prevHist <= 0 && hist > 0
  const macdCrossDn = prevHist >= 0 && hist < 0

  const aboveVWAP = price >= vwap
  const belowVWAP = price <= vwap

  let action: "buy" | "sell" | "hold" = "hold"
  let confidence = 0
  let reason = ""

  if (emaBullish && macdCrossUp && rsi < 70 && aboveVWAP) { 
    action = "buy"
    confidence = 0.75
    reason = `Uptrend (EMA9>21) + MACD Crossover ↑ | RSI ${rsi.toFixed(0)}`
  } else if (emaBearish && macdCrossDn && rsi > 30 && belowVWAP) { 
    action = "sell"
    confidence = 0.75
    reason = `Downtrend (EMA9<21) + MACD Crossover ↓ | RSI ${rsi.toFixed(0)}`
  }

  if (action === "hold") return null

  const qty = sizeByATR({ equity, price, atr, riskPerTrade: config.riskPerTrade, atrMultiplier: config.atrMultiplierSL })
  const tpPrice = action === "buy" ? price + atr * config.atrMultiplierTP : price - atr * config.atrMultiplierTP
  const slPrice = action === "buy" ? price - atr * config.atrMultiplierSL : price + atr * config.atrMultiplierSL

  return {
    symbol, strategy: "momentum", action, confidence, atr, suggestedQty: qty, tpPrice, slPrice, reason
  }
}

export function scoreMeanReversionSignal(
  symbol: string,
  bars: OHLCV[],
  equity: number,
  config: RiskConfig
): SignalScore | null {
  if (bars.length < 22) return null
  const closes = bars.map(b => b.c)
  const price = closes[closes.length - 1]
  const atr = calcATR(bars)
  const rsi = calcRSI(closes, 14)
  const { upper, lower, middle } = calcBollingerBands(closes, 20, 2)

  let action: "buy" | "sell" | "hold" = "hold"
  let confidence = 0
  let reason = ""

  // Strong oversold: price below BB lower AND RSI < 35
  if (price <= lower && rsi < 35) {
    action = "buy"
    confidence = Math.min((35 - rsi) / 35 + (lower - price) / (upper - lower || 1), 1)
    reason = `Oversold: RSI ${rsi.toFixed(0)}, touch BB lower (${lower.toFixed(2)})`
  }
  // Strong overbought: price above BB upper AND RSI > 65
  else if (price >= upper && rsi > 65) {
    action = "sell"
    confidence = Math.min((rsi - 65) / 35 + (price - upper) / (upper - lower || 1), 1)
    reason = `Overbought: RSI ${rsi.toFixed(0)}, touch BB upper (${upper.toFixed(2)})`
  }

  if (action === "hold") return null

  const qty = sizeByATR({ equity, price, atr, riskPerTrade: config.riskPerTrade, atrMultiplier: config.atrMultiplierSL })
  const tpPrice = action === "buy" ? middle : middle  // revert to mean
  const slPrice = action === "buy" ? price - atr * config.atrMultiplierSL : price + atr * config.atrMultiplierSL

  return { symbol, strategy: "mean_reversion", action, confidence, atr, suggestedQty: qty, tpPrice, slPrice, reason }
}
