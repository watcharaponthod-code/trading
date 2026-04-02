/**
 * Advanced Technical Indicators & Market Regime Detection
 *
 * Features:
 * - ADX (Average Directional Index) for trend strength
 * - Market regime detection (trending/ranging/volatile)
 * - Volatility-adjusted indicators
 * - Multi-timeframe analysis helpers
 * - Adaptive parameters based on market conditions
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface MarketRegime {
  trendStrength: "strong_trend" | "weak_trend" | "ranging"
  volatility: "low" | "normal" | "high"
  direction: "bullish" | "bearish" | "neutral"
  adx: number
  atrPct: number
  confidence: number
}

export interface MultiTimeframeSignal {
  signal: "buy" | "sell" | "hold"
  strength: number
  timeframe: string
  reason: string
}

export interface AdaptiveConfig {
  // Trend following settings (stronger in trending markets)
  trendThreshold: number
  momentumWeight: number

  // Mean reversion settings (stronger in ranging markets)
  reversionThreshold: number
  reversionWeight: number

  // Volatility adjustments
  positionSizeMult: number
  stopLossMult: number
  takeProfitMult: number
}

// ─── ADX (Average Directional Index) ───────────────────────────────────────────

/**
 * Calculate ADX - measures trend strength (0-100)
 * > 25 = strong trend, < 20 = weak trend/ranging
 */
export function calcADX(bars: { high: number; low: number; close: number }[], period: number = 14): number {
  if (bars.length < period * 2) return 0

  let tr: number[] = []
  let plusDM: number[] = []
  let minusDM: number[] = []

  for (let i = 1; i < bars.length; i++) {
    const high = bars[i].high
    const low = bars[i].low
    const prevHigh = bars[i - 1].high
    const prevLow = bars[i - 1].low
    const prevClose = bars[i - 1].close

    const trVal = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose))
    tr.push(trVal)

    const upMove = high - prevHigh
    const downMove = prevLow - low

    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0)
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0)
  }

  // Smoothed values
  const trSmooth = ema(tr, period)
  const plusDMSmooth = ema(plusDM, period)
  const minusDMSmooth = ema(minusDM, period)

  const plusDI = trSmooth.map((t, i) => (t === 0 ? 0 : (plusDMSmooth[i] / t) * 100))
  const minusDI = trSmooth.map((t, i) => (t === 0 ? 0 : (minusDMSmooth[i] / t) * 100))

  const dx = plusDI.map((pdi, i) => {
    const di = Math.abs(pdi - minusDI[i])
    const sum = pdi + minusDI[i]
    return sum === 0 ? 0 : (di / sum) * 100
  })

  const adx = ema(dx, period)
  return adx[adx.length - 1] || 0
}

// ─── EMA Helper ─────────────────────────────────────────────────────────────

function ema(arr: number[], period: number): number[] {
  const k = 2 / (period + 1)
  const result: number[] = [arr[0]]
  for (let i = 1; i < arr.length; i++) {
    result.push(arr[i] * k + result[i - 1] * (1 - k))
  }
  return result
}

// ─── Market Regime Detection ───────────────────────────────────────────────────

/**
 * Detect current market regime for adaptive strategy selection
 */
export function detectMarketRegime(
  bars: { high: number; low: number; close: number; volume: number }[],
  period: number = 20
): MarketRegime {
  if (bars.length < period * 2) {
    return {
      trendStrength: "ranging",
      volatility: "normal",
      direction: "neutral",
      adx: 0,
      atrPct: 0,
      confidence: 0,
    }
  }

  const closes = bars.map((b) => b.close)
  const highs = bars.map((b) => b.high)
  const lows = bars.map((b) => b.low)

  // Calculate ADX
  const adx = calcADX(bars, 14)

  // Calculate ATR as percentage of price
  const atr = calcATR(bars, 14)
  const atrPct = (atr / closes[closes.length - 1]) * 100

  // Trend strength via ADX
  const trendStrength: MarketRegime["trendStrength"] =
    adx > 30 ? "strong_trend" : adx > 20 ? "weak_trend" : "ranging"

  // Volatility regime
  const recentAtr = atrPct
  const histAtr = []
  for (let i = period; i < bars.length; i++) {
    const slice = bars.slice(i - period, i)
    histAtr.push((calcATR(slice, 14) / slice[slice.length - 1].close) * 100)
  }
  const avgAtr = histAtr.reduce((a, b) => a + b, 0) / histAtr.length

  const volatility: MarketRegime["volatility"] =
    recentAtr > avgAtr * 1.5 ? "high" : recentAtr < avgAtr * 0.7 ? "low" : "normal"

  // Direction via moving average slope
  const ema20 = ema(closes, 20)
  const ema50 = ema(closes, 50)
  const emaSlope = ema20[ema20.length - 1] - ema20[ema20.length - 5]

  const direction: MarketRegime["direction"] =
    ema20[ema20.length - 1] > ema50[ema50.length - 1]
      ? emaSlope > 0
        ? "bullish"
        : "neutral"
      : emaSlope < 0
        ? "bearish"
        : "neutral"

  // Confidence based on alignment of indicators
  const trendAligned = (trendStrength === "strong_trend" && direction !== "neutral") ||
                       (trendStrength === "ranging" && direction === "neutral")
  const confidence = trendAligned ? 0.8 : 0.5

  return {
    trendStrength,
    volatility,
    direction,
    adx,
    atrPct: recentAtr,
    confidence,
  }
}

/**
 * Calculate ATR (Average True Range)
 */
export function calcATR(
  bars: { high: number; low: number; close: number }[],
  period: number = 14
): number {
  if (bars.length < period + 1) return 0

  const tr: number[] = []
  for (let i = 1; i < bars.length; i++) {
    const high = bars[i].high
    const low = bars[i].low
    const prevClose = bars[i - 1].close

    tr.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)))
  }

  return ema(tr, period)[ema(tr, period).length - 1] || 0
}

// ─── Adaptive Configuration ─────────────────────────────────────────────────────

/**
 * Get adaptive trading parameters based on market regime
 */
export function getAdaptiveConfig(regime: MarketRegime): AdaptiveConfig {
  const isTrending = regime.trendStrength === "strong_trend" || regime.trendStrength === "weak_trend"
  const isRanging = regime.trendStrength === "ranging"
  const isHighVol = regime.volatility === "high"
  const isLowVol = regime.volatility === "low"

  return {
    // Trend following - stronger in trending markets
    trendThreshold: isTrending ? 0.5 : 0.7,
    momentumWeight: isTrending ? 1.2 : 0.8,

    // Mean reversion - stronger in ranging markets
    reversionThreshold: isRanging ? 0.3 : 0.5,
    reversionWeight: isRanging ? 1.3 : 0.7,

    // Position sizing - reduce in high volatility
    positionSizeMult: isHighVol ? 0.5 : isLowVol ? 1.5 : 1.0,

    // Risk management - widen stops in high volatility
    stopLossMult: isHighVol ? 2.0 : 1.5,
    takeProfitMult: isHighVol ? 3.0 : 2.0,
  }
}

// ─── Multi-Timeframe Analysis ──────────────────────────────────────────────────

/**
 * Combine signals from multiple timeframes for higher confidence
 */
export function analyzeMultiTimeframe(
  symbol: string,
  dailyBars: any[],
  hourlyBars: any[],
  fifteenMinBars: any[]
): MultiTimeframeSignal[] {
  const signals: MultiTimeframeSignal[] = []

  // Daily trend (primary direction)
  if (dailyBars.length > 50) {
    const dailyCloses = dailyBars.map((b) => b.c)
    const ema20 = ema(dailyCloses, 20)
    const ema50 = ema(dailyCloses, 50)

    if (ema20[ema20.length - 1] > ema50[ema50.length - 1]) {
      signals.push({ signal: "buy", strength: 0.7, timeframe: "daily", reason: "EMA20 > EMA50" })
    } else {
      signals.push({ signal: "sell", strength: 0.7, timeframe: "daily", reason: "EMA20 < EMA50" })
    }
  }

  // Hourly momentum
  if (hourlyBars.length > 30) {
    const hourlyCloses = hourlyBars.map((b) => b.c)
    const ema9 = ema(hourlyCloses, 9)
    const ema21 = ema(hourlyCloses, 21)

    if (ema9[ema9.length - 1] > ema21[ema21.length - 1]) {
      signals.push({ signal: "buy", strength: 0.6, timeframe: "hourly", reason: "EMA9 > EMA21" })
    } else {
      signals.push({ signal: "sell", strength: 0.6, timeframe: "hourly", reason: "EMA9 < EMA21" })
    }
  }

  // 15-min entry timing
  if (fifteenMinBars.length > 20) {
    const fifteenCloses = fifteenMinBars.map((b) => b.c)
    const rsi = calcRSI(fifteenCloses, 14)

    if (rsi < 30) {
      signals.push({ signal: "buy", strength: 0.8, timeframe: "15min", reason: `RSI oversold ${rsi.toFixed(0)}` })
    } else if (rsi > 70) {
      signals.push({ signal: "sell", strength: 0.8, timeframe: "15min", reason: `RSI overbought ${rsi.toFixed(0)}` })
    }
  }

  return signals
}

/**
 * Calculate RSI
 */
export function calcRSI(closes: number[], period: number = 14): number {
  if (closes.length < period + 1) return 50

  let gains = 0
  let losses = 0

  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1]
    if (diff > 0) gains += diff
    else losses -= diff
  }

  let avgGain = gains / period
  let avgLoss = losses / period

  for (let i = period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1]
    avgGain = (avgGain * (period - 1) + Math.max(diff, 0)) / period
    avgLoss = (avgLoss * (period - 1) + Math.max(-diff, 0)) / period
  }

  const rs = avgGain / (avgLoss || 0.0001)
  return 100 - 100 / (1 + rs)
}

/**
 * Combine multi-timeframe signals into a single decision
 */
export function combineMultiTimeframeSignals(signals: MultiTimeframeSignal[]): {
  signal: "buy" | "sell" | "hold"
  confidence: number
  reason: string
} {
  if (signals.length === 0) {
    return { signal: "hold", confidence: 0, reason: "No signals" }
  }

  const buySignals = signals.filter((s) => s.signal === "buy")
  const sellSignals = signals.filter((s) => s.signal === "sell")

  const buyWeight = buySignals.reduce((sum, s) => sum + s.strength, 0)
  const sellWeight = sellSignals.reduce((sum, s) => sum + s.strength, 0)

  if (buyWeight > sellWeight * 1.5) {
    return {
      signal: "buy",
      confidence: Math.min(0.95, buyWeight / signals.length),
      reason: buySignals.map((s) => `${s.timeframe}: ${s.reason}`).join(" | "),
    }
  } else if (sellWeight > buyWeight * 1.5) {
    return {
      signal: "sell",
      confidence: Math.min(0.95, sellWeight / signals.length),
      reason: sellSignals.map((s) => `${s.timeframe}: ${s.reason}`).join(" | "),
    }
  }

  return { signal: "hold", confidence: 0, reason: "Conflicting signals" }
}

// ─── Correlation Matrix ─────────────────────────────────────────────────────────

/**
 * Calculate correlation between two price series
 */
export function calcCorrelation(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length)
  if (n < 2) return 0

  const ax = a.slice(-n)
  const bx = b.slice(-n)
  const meanA = ax.reduce((s, v) => s + v, 0) / n
  const meanB = bx.reduce((s, v) => s + v, 0) / n

  let num = 0
  let dA = 0
  let dB = 0

  for (let i = 0; i < n; i++) {
    const da = ax[i] - meanA
    const db = bx[i] - meanB
    num += da * db
    dA += da * da
    dB += db * db
  }

  return num / (Math.sqrt(dA) * Math.sqrt(dB) || 1)
}

/**
 * Calculate portfolio correlation matrix
 */
export function calcCorrelationMatrix(
  pricesBySymbol: Record<string, number[]>
): Record<string, Record<string, number>> {
  const symbols = Object.keys(pricesBySymbol)
  const matrix: Record<string, Record<string, number>> = {}

  for (const s1 of symbols) {
    matrix[s1] = {}
    for (const s2 of symbols) {
      matrix[s1][s2] = calcCorrelation(pricesBySymbol[s1], pricesBySymbol[s2])
    }
  }

  return matrix
}

/**
 * Check if new trade would increase portfolio concentration risk
 */
export function checkPortfolioDiversification(
  newSymbol: string,
  currentPositions: string[],
  correlationMatrix: Record<string, Record<string, number>>,
  threshold: number = 0.7
): { safe: boolean; reason: string } {
  for (const pos of currentPositions) {
    const corr = correlationMatrix[newSymbol]?.[pos] || 0
    if (Math.abs(corr) > threshold) {
      return {
        safe: false,
        reason: `High correlation (${corr.toFixed(2)}) with existing position ${pos}`,
      }
    }
  }

  return { safe: true, reason: "OK - portfolio diversified" }
}
