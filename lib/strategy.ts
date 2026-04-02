export type StrategyId = "stat_arb" | "mean_reversion" | "momentum" | "pairs_trading"

export interface StrategyConfig {
  id: StrategyId
  name: string
  description: string
  symbols: string[]
  params: Record<string, number | string>
}

export interface TradeSignal {
  symbol: string
  action: "buy" | "sell" | "hold"
  qty: number
  reason: string
  confidence: number
  price?: number
}

export interface Bar {
  t: string
  o: number
  h: number
  l: number
  c: number
  v: number
}

// ─── Technical Indicators ────────────────────────────────────────────────────

export function calcSMA(prices: number[], period: number): number[] {
  const sma: number[] = []
  for (let i = 0; i < prices.length; i++) {
    if (i < period - 1) {
      sma.push(NaN)
    } else {
      const slice = prices.slice(i - period + 1, i + 1)
      sma.push(slice.reduce((a, b) => a + b, 0) / period)
    }
  }
  return sma
}

export function calcEMA(prices: number[], period: number): number[] {
  const k = 2 / (period + 1)
  const ema: number[] = []
  for (let i = 0; i < prices.length; i++) {
    if (i === 0) {
      ema.push(prices[0])
    } else {
      ema.push(prices[i] * k + ema[i - 1] * (1 - k))
    }
  }
  return ema
}

export function calcStdDev(prices: number[], period: number): number[] {
  const stddev: number[] = []
  for (let i = 0; i < prices.length; i++) {
    if (i < period - 1) {
      stddev.push(NaN)
    } else {
      const slice = prices.slice(i - period + 1, i + 1)
      const mean = slice.reduce((a, b) => a + b, 0) / period
      const variance = slice.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / period
      stddev.push(Math.sqrt(variance))
    }
  }
  return stddev
}

export function calcRSI(prices: number[], period = 14): number[] {
  const rsi: number[] = new Array(prices.length).fill(NaN)
  if (prices.length < period + 1) return rsi

  let gains = 0
  let losses = 0
  for (let i = 1; i <= period; i++) {
    const diff = prices[i] - prices[i - 1]
    if (diff > 0) gains += diff
    else losses -= diff
  }

  let avgGain = gains / period
  let avgLoss = losses / period

  for (let i = period; i < prices.length; i++) {
    if (i === period) {
      rsi[i] = 100 - 100 / (1 + avgGain / (avgLoss || 0.0001))
      continue
    }
    const diff = prices[i] - prices[i - 1]
    avgGain = (avgGain * (period - 1) + Math.max(diff, 0)) / period
    avgLoss = (avgLoss * (period - 1) + Math.max(-diff, 0)) / period
    rsi[i] = 100 - 100 / (1 + avgGain / (avgLoss || 0.0001))
  }
  return rsi
}

export function calcBollingerBands(
  prices: number[],
  period = 20,
  multiplier = 2
): { upper: number[]; middle: number[]; lower: number[] } {
  const middle = calcSMA(prices, period)
  const stddev = calcStdDev(prices, period)
  const upper = middle.map((m, i) => m + multiplier * stddev[i])
  const lower = middle.map((m, i) => m - multiplier * stddev[i])
  return { upper, middle, lower }
}

export function calcZScore(prices: number[], period = 20): number[] {
  const sma = calcSMA(prices, period)
  const stddev = calcStdDev(prices, period)
  return prices.map((p, i) => (p - sma[i]) / (stddev[i] || 1))
}

export function calcCorrelation(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length)
  if (n < 2) return 0
  const ax = a.slice(-n)
  const bx = b.slice(-n)
  const meanA = ax.reduce((s, v) => s + v, 0) / n
  const meanB = bx.reduce((s, v) => s + v, 0) / n
  let num = 0, dA = 0, dB = 0
  for (let i = 0; i < n; i++) {
    const da = ax[i] - meanA
    const db = bx[i] - meanB
    num += da * db
    dA += da * da
    dB += db * db
  }
  return num / (Math.sqrt(dA) * Math.sqrt(dB) || 1)
}

// ─── Strategy Implementations ─────────────────────────────────────────────────

export function runStatArb(
  barsBySymbol: Record<string, Bar[]>,
  config: StrategyConfig,
  positionsBySymbol: Record<string, number>
): TradeSignal[] {
  const signals: TradeSignal[] = []
  const symbols = config.symbols
  if (symbols.length < 2) return signals

  const period = Number(config.params.period) || 20
  const zThreshold = Number(config.params.zThreshold) || 1.5  // Lowered from 2.0
  const qty = Number(config.params.qty) || 1

  const [sym1, sym2] = symbols
  const bars1 = barsBySymbol[sym1] || []
  const bars2 = barsBySymbol[sym2] || []
  if (bars1.length < period || bars2.length < period) return signals

  const closes1 = bars1.map((b) => b.c)
  const closes2 = bars2.map((b) => b.c)
  const spread = closes1.map((c, i) => c - closes2[i])
  const zScores = calcZScore(spread, period)
  const latestZ = zScores[zScores.length - 1]
  const correlation = calcCorrelation(closes1, closes2)

  const pos1 = positionsBySymbol[sym1] || 0
  const pos2 = positionsBySymbol[sym2] || 0
  const hasPositions = pos1 !== 0 || pos2 !== 0

  // Close positions when spread normalizes (lower threshold for exit)
  if (hasPositions && Math.abs(latestZ) < 0.3) {
    if (pos1 > 0) signals.push({ symbol: sym1, action: "sell", qty: pos1, reason: "Stat Arb: spread normalized", confidence: 0.75 })
    if (pos2 > 0) signals.push({ symbol: sym2, action: "sell", qty: pos2, reason: "Stat Arb: spread normalized", confidence: 0.75 })
  }
  // Entry when spread widens (lower threshold for entry)
  else if (!hasPositions && Math.abs(latestZ) > zThreshold) {
    const confidence = Math.min(0.9, 0.5 + Math.abs(latestZ) / 6)
    if (latestZ > 0) {
      // Spread high: short sym1, long sym2
      signals.push({ symbol: sym1, action: "sell", qty, reason: `Stat Arb: spread high z=${latestZ.toFixed(2)} corr=${correlation.toFixed(2)}`, confidence })
      signals.push({ symbol: sym2, action: "buy", qty, reason: `Stat Arb: hedge long`, confidence })
    } else {
      // Spread low: long sym1, short sym2
      signals.push({ symbol: sym1, action: "buy", qty, reason: `Stat Arb: spread low z=${latestZ.toFixed(2)} corr=${correlation.toFixed(2)}`, confidence })
      signals.push({ symbol: sym2, action: "sell", qty, reason: `Stat Arb: hedge short`, confidence })
    }
  }

  return signals
}

export function runMeanReversion(
  barsBySymbol: Record<string, Bar[]>,
  config: StrategyConfig,
  positionsBySymbol: Record<string, number>
): TradeSignal[] {
  const signals: TradeSignal[] = []
  const period = Number(config.params.period) || 20
  const bbMult = Number(config.params.bbMultiplier) || 2.0
  const qty = Number(config.params.qty) || 1
  const rsiOversold = Number(config.params.rsiOversold) || 35  // Relaxed from 30
  const rsiOverbought = Number(config.params.rsiOverbought) || 65  // Relaxed from 70

  for (const symbol of config.symbols) {
    const bars = barsBySymbol[symbol] || []
    if (bars.length < period + 14) continue

    const closes = bars.map((b) => b.c)
    const { upper, lower, middle } = calcBollingerBands(closes, period, bbMult)
    const rsi = calcRSI(closes, 14)
    const lastClose = closes[closes.length - 1]
    const lastRSI = rsi[rsi.length - 1]
    const lastUpper = upper[upper.length - 1]
    const lastLower = lower[lower.length - 1]
    const lastMiddle = middle[middle.length - 1]
    const pos = positionsBySymbol[symbol] || 0

    // Calculate BB position (0-1 range)
    const bbPosition = (lastClose - lastLower) / (lastUpper - lastLower)

    // Deep oversold (bottom 10% of BB)
    if (bbPosition < 0.1 && lastRSI < 45 && pos === 0) {
      signals.push({
        symbol,
        action: "buy",
        qty,
        reason: `Mean Rev: Deep oversold BB${(bbPosition*100).toFixed(0)}% RSI=${lastRSI.toFixed(0)}`,
        confidence: Math.min(0.9, 0.6 + (0.3 * (1 - bbPosition)))
      })
    }
    // Deep overbought (top 10% of BB)
    else if (bbPosition > 0.9 && lastRSI > 55 && pos > 0) {
      signals.push({
        symbol,
        action: "sell",
        qty: pos,
        reason: `Mean Rev: Deep overbought BB${(bbPosition*100).toFixed(0)}% RSI=${lastRSI.toFixed(0)}`,
        confidence: Math.min(0.9, 0.6 + (0.3 * bbPosition))
      })
    }
    // Entry at lower BB with RSI confirmation
    else if (lastClose <= lastLower && lastRSI < rsiOversold && pos === 0) {
      signals.push({
        symbol,
        action: "buy",
        qty,
        reason: `Mean Rev: Lower BB RSI=${lastRSI.toFixed(0)}`,
        confidence: Math.min(0.85, (rsiOversold - lastRSI) / 20 + 0.5)
      })
    }
    // Entry at upper BB with RSI confirmation
    else if (lastClose >= lastUpper && lastRSI > rsiOverbought && pos > 0) {
      signals.push({
        symbol,
        action: "sell",
        qty: pos,
        reason: `Mean Rev: Upper BB RSI=${lastRSI.toFixed(0)}`,
        confidence: Math.min(0.85, (lastRSI - rsiOverbought) / 20 + 0.5)
      })
    }
    // Exit when returning to mean
    else if (pos > 0 && Math.abs(lastClose - lastMiddle) < (lastUpper - lastLower) * 0.1) {
      signals.push({
        symbol,
        action: "sell",
        qty: pos,
        reason: `Mean Rev: Return to mean`,
        confidence: 0.7
      })
    }
  }
  return signals
}

export function runMomentum(
  barsBySymbol: Record<string, Bar[]>,
  config: StrategyConfig,
  positionsBySymbol: Record<string, number>
): TradeSignal[] {
  const signals: TradeSignal[] = []
  const fastPeriod = Number(config.params.fastPeriod) || 9
  const slowPeriod = Number(config.params.slowPeriod) || 21
  const qty = Number(config.params.qty) || 1

  for (const symbol of config.symbols) {
    const bars = barsBySymbol[symbol] || []
    if (bars.length < slowPeriod + 5) continue

    const closes = bars.map((b) => b.c)
    const volumes = bars.map((b) => b.v)
    const fastEMA = calcEMA(closes, fastPeriod)
    const slowEMA = calcEMA(closes, slowPeriod)
    const rsi = calcRSI(closes, 14)
    const pos = positionsBySymbol[symbol] || 0

    const prevFast = fastEMA[fastEMA.length - 2]
    const prevSlow = slowEMA[slowEMA.length - 2]
    const currFast = fastEMA[fastEMA.length - 1]
    const currSlow = slowEMA[slowEMA.length - 1]
    const lastRSI = rsi[rsi.length - 1]
    const lastVolume = volumes[volumes.length - 1]
    const avgVolume = volumes.slice(-20).reduce((a,b) => a+b, 0) / 20

    const crossedAbove = prevFast <= prevSlow && currFast > currSlow
    const crossedBelow = prevFast >= prevSlow && currFast < currSlow
    const volumeSpike = lastVolume > avgVolume * 1.3

    // Strong bullish momentum
    if (crossedAbove && pos === 0 && lastRSI < 75) {
      const confidence = volumeSpike ? 0.85 : 0.75
      signals.push({
        symbol,
        action: "buy",
        qty,
        reason: `Momentum: EMA${fastPeriod}>EMA${slowPeriod} ${volumeSpike ? '+Vol' : ''} RSI=${lastRSI.toFixed(0)}`,
        confidence
      })
    }
    // Strong bearish momentum
    else if (crossedBelow && pos > 0 && lastRSI > 25) {
      signals.push({
        symbol,
        action: "sell",
        qty: pos,
        reason: `Momentum: EMA${fastPeriod}<EMA${slowPeriod} RSI=${lastRSI.toFixed(0)}`,
        confidence: 0.75
      })
    }
    // Trend continuation (already in bullish trend)
    else if (currFast > currSlow && pos === 0 && lastRSI > 50 && lastRSI < 70) {
      signals.push({
        symbol,
        action: "buy",
        qty,
        reason: `Momentum: Trend continuation RSI=${lastRSI.toFixed(0)}`,
        confidence: 0.6
      })
    }
    // Exit when momentum fades
    else if (pos > 0 && currFast < currSlow && lastRSI < 50) {
      signals.push({
        symbol,
        action: "sell",
        qty: pos,
        reason: `Momentum: Trend faded`,
        confidence: 0.7
      })
    }
  }
  return signals
}

export function runStrategy(
  strategy: StrategyConfig,
  barsBySymbol: Record<string, Bar[]>,
  positionsBySymbol: Record<string, number>
): TradeSignal[] {
  switch (strategy.id) {
    case "stat_arb":
      return runStatArb(barsBySymbol, strategy, positionsBySymbol)
    case "mean_reversion":
      return runMeanReversion(barsBySymbol, strategy, positionsBySymbol)
    case "momentum":
      return runMomentum(barsBySymbol, strategy, positionsBySymbol)
    case "pairs_trading":
      return runStatArb(barsBySymbol, { ...strategy, id: "stat_arb" }, positionsBySymbol)
    default:
      return []
  }
}

export const DEFAULT_STRATEGIES: StrategyConfig[] = [
  {
    id: "stat_arb",
    name: "Statistical Arbitrage",
    description: "Exploits mean-reverting spread between two correlated assets using z-score analysis.",
    symbols: ["SPY", "QQQ"],
    params: { period: 20, zThreshold: 1.5, qty: 2 },  // More aggressive
  },
  {
    id: "mean_reversion",
    name: "Mean Reversion",
    description: "Buys oversold and sells overbought conditions using Bollinger Bands + RSI confirmation.",
    symbols: ["AAPL", "MSFT", "GOOGL", "META", "TSLA"],  // More symbols
    params: { period: 20, bbMultiplier: 2.0, rsiOversold: 35, rsiOverbought: 65, qty: 1 },  // Relaxed thresholds
  },
  {
    id: "momentum",
    name: "EMA Momentum",
    description: "Trades EMA crossovers to capture short-term momentum in trending assets.",
    symbols: ["NVDA", "AMD", "TSLA", "SOXL", "QQQ"],  // High volatility symbols
    params: { fastPeriod: 9, slowPeriod: 21, qty: 2 },  // Faster EMAs, more qty
  },
  {
    id: "pairs_trading",
    name: "Pairs Trading",
    description: "Long/short pairs strategy on highly correlated stocks to capture convergence.",
    symbols: ["GLD", "SLV"],
    params: { period: 20, zThreshold: 1.2, qty: 3 },  // Very aggressive
  },
]
