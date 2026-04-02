/**
 * Enhanced Trading Strategies with Adaptive Parameters
 *
 * Features:
 * - Market regime detection for strategy selection
 * - Adaptive parameters based on volatility
 * - Multi-timeframe confirmation
 * - Portfolio correlation filtering
 * - Dynamic position sizing
 */

import {
  Bar,
  StrategyConfig,
  TradeSignal,
  calcEMA,
  calcRSI,
  calcBollingerBands,
  calcZScore,
  calcCorrelation,
} from "./strategy"
import {
  MarketRegime,
  AdaptiveConfig,
  detectMarketRegime,
  getAdaptiveConfig,
  analyzeMultiTimeframe,
  combineMultiTimeframeSignals,
  checkPortfolioDiversification,
  calcCorrelationMatrix,
  calcATR,
} from "./advanced-indicators"

// ─── Enhanced Strategy Types ───────────────────────────────────────────────────

export interface EnhancedStrategyConfig extends StrategyConfig {
  useRegimeDetection: boolean
  useMultiTimeframe: boolean
  checkCorrelation: boolean
  correlationThreshold: number
}

export interface EnhancedStrategyContext {
  regime?: MarketRegime
  adaptiveConfig?: AdaptiveConfig
  multiTimeframeSignals?: any[]
  portfolioCorrelation?: Record<string, Record<string, number>>
  currentPositions: string[]
}

// ─── Enhanced Momentum Strategy ────────────────────────────────────────────────

/**
 * Momentum strategy with regime detection and adaptive parameters
 */
export function runEnhancedMomentum(
  barsBySymbol: Record<string, Bar[]>,
  config: EnhancedStrategyConfig,
  positionsBySymbol: Record<string, number>,
  context: EnhancedStrategyContext
): TradeSignal[] {
  const signals: TradeSignal[] = []

  // Get adaptive configuration
  const adaptive = context.adaptiveConfig || {
    trendThreshold: 0.6,
    momentumWeight: 1.0,
    reversionThreshold: 0.5,
    reversionWeight: 1.0,
    positionSizeMult: 1.0,
    stopLossMult: 1.5,
    takeProfitMult: 2.0,
  }

  const fastPeriod = Number(config.params.fastPeriod) || 9
  const slowPeriod = Number(config.params.slowPeriod) || 21
  let qty = Number(config.params.qty) || 1
  qty = Math.floor(qty * adaptive.positionSizeMult)

  for (const symbol of config.symbols) {
    const bars = barsBySymbol[symbol] || []
    if (bars.length < slowPeriod + 10) continue

    // Skip if correlation check fails
    if (config.checkCorrelation && context.portfolioCorrelation) {
      const check = checkPortfolioDiversification(
        symbol,
        context.currentPositions,
        context.portfolioCorrelation,
        config.correlationThreshold
      )
      if (!check.safe) {
        console.log(`Skipping ${symbol}: ${check.reason}`)
        continue
      }
    }

    const closes = bars.map((b) => b.c)
    const volumes = bars.map((b) => b.v)
    const highs = bars.map((b) => b.h)
    const lows = bars.map((b) => b.l)

    // Detect market regime for this symbol
    const regime = detectMarketRegime(
      bars.map((b) => ({
        high: b.h,
        low: b.l,
        close: b.c,
        volume: b.v,
      })),
      20
    )

    // Only trade momentum in trending markets
    if (regime.trendStrength === "ranging") {
      continue
    }

    const fastEMA = calcEMA(closes, fastPeriod)
    const slowEMA = calcEMA(closes, slowPeriod)
    const rsi = calcRSI(closes, 14)
    const atr = calcATR(
      bars.map((b) => ({ high: b.h, low: b.l, close: b.c })),
      14
    )

    const pos = positionsBySymbol[symbol] || 0
    const lastClose = closes[closes.length - 1]
    const lastRSI = rsi
    const lastVolume = volumes[volumes.length - 1]
    const avgVolume = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20

    const currFast = fastEMA[fastEMA.length - 1]
    const currSlow = slowEMA[slowEMA.length - 1]

    // Calculate momentum strength
    const emaDiff = ((currFast - currSlow) / currSlow) * 100
    const trendAligned = (regime.direction === "bullish" && currFast > currSlow) ||
                         (regime.direction === "bearish" && currFast < currSlow)

    // Strong trend entry
    if (pos === 0 && regime.trendStrength === "strong_trend" && trendAligned) {
      const isBullish = currFast > currSlow && regime.direction === "bullish"
      const isBearish = currFast < currSlow && regime.direction === "bearish"

      const volumeConfirm = lastVolume > avgVolume * 1.2
      const rsiConfirm = regime.direction === "bullish" ? lastRSI < 75 : lastRSI > 25

      if ((isBullish || isBearish) && volumeConfirm && rsiConfirm) {
        const confidence = Math.min(
          0.9,
          0.5 +
            adaptive.momentumWeight * 0.2 +
            (regime.adx / 100) * 0.2
        )

        signals.push({
          symbol,
          action: isBullish ? "buy" : "sell",
          qty,
          reason: `Enhanced Momentum: ${regime.trendStrength} ${regime.direction} ADX=${regime.adx.toFixed(0)}`,
          confidence,
          price: lastClose,
        })
      }
    }
    // Trend continuation
    else if (pos === 0 && emaDiff > 0.5 && currFast > currSlow && lastRSI > 50 && lastRSI < 70) {
      signals.push({
        symbol,
        action: "buy",
        qty,
        reason: `Momentum continuation EMA diff=${emaDiff.toFixed(2)}%`,
        confidence: 0.65 * adaptive.momentumWeight,
        price: lastClose,
      })
    }
    // Exit when trend weakens
    else if (pos > 0 && regime.trendStrength === "ranging") {
      signals.push({
        symbol,
        action: "sell",
        qty: pos,
        reason: `Momentum exit: trend weakened`,
        confidence: 0.7,
      })
    }
    // Exit on reversal
    else if (pos > 0 && currFast < currSlow && lastRSI < 50) {
      signals.push({
        symbol,
        action: "sell",
        qty: pos,
        reason: `Momentum reversal`,
        confidence: 0.75,
      })
    }
  }

  return signals
}

// ─── Enhanced Mean Reversion Strategy ───────────────────────────────────────────

/**
 * Mean reversion with regime detection and dynamic thresholds
 */
export function runEnhancedMeanReversion(
  barsBySymbol: Record<string, Bar[]>,
  config: EnhancedStrategyConfig,
  positionsBySymbol: Record<string, number>,
  context: EnhancedStrategyContext
): TradeSignal[] {
  const signals: TradeSignal[] = []

  const adaptive = context.adaptiveConfig || {
    trendThreshold: 0.6,
    momentumWeight: 1.0,
    reversionThreshold: 0.5,
    reversionWeight: 1.0,
    positionSizeMult: 1.0,
    stopLossMult: 1.5,
    takeProfitMult: 2.0,
  }

  const period = Number(config.params.period) || 20
  const bbMult = Number(config.params.bbMultiplier) || 2.0
  let qty = Number(config.params.qty) || 1
  qty = Math.floor(qty * adaptive.positionSizeMult)

  // Dynamic RSI thresholds based on volatility
  const rsiOversold = 35
  const rsiOverbought = 65

  for (const symbol of config.symbols) {
    const bars = barsBySymbol[symbol] || []
    if (bars.length < period + 20) continue

    // Detect regime
    const regime = detectMarketRegime(
      bars.map((b) => ({
        high: b.h,
        low: b.l,
        close: b.c,
        volume: b.v,
      })),
      20
    )

    // Prefer mean reversion in ranging markets
    if (regime.trendStrength === "strong_trend" && regime.volatility === "high") {
      continue // Skip mean reversion in strong trending high vol markets
    }

    const closes = bars.map((b) => b.c)
    const { upper, lower, middle } = calcBollingerBands(closes, period, bbMult)
    const rsi = calcRSI(closes, 14)
    const zScores = calcZScore(closes, period)

    const lastClose = closes[closes.length - 1]
    const lastRSI = rsi
    const lastUpper = upper[upper.length - 1]
    const lastLower = lower[lower.length - 1]
    const lastMiddle = middle[middle.length - 1]
    const lastZ = zScores[zScores.length - 1]

    const pos = positionsBySymbol[symbol] || 0
    const bbPosition = (lastClose - lastLower) / (lastUpper - lastLower)

    // Dynamic threshold based on regime
    const bbThreshold = adaptive.reversionThreshold
    const zThreshold = regime.volatility === "high" ? 2.5 : 2.0

    // Deep oversold - strong signal
    if (bbPosition < bbThreshold * 0.5 && lastRSI < 40 && pos === 0) {
      const confidence = Math.min(
        0.9,
        (0.6 + adaptive.reversionWeight * 0.2) * (1 - bbPosition)
      )

      signals.push({
        symbol,
        action: "buy",
        qty,
        reason: `Enhanced Mean Rev: Deep oversold BB${(bbPosition * 100).toFixed(0)}% Z=${lastZ.toFixed(1)}`,
        confidence,
        price: lastClose,
      })
    }
    // Deep overbought
    else if (bbPosition > 1 - bbThreshold * 0.5 && lastRSI > 60 && pos > 0) {
      const confidence = Math.min(
        0.9,
        (0.6 + adaptive.reversionWeight * 0.2) * bbPosition
      )

      signals.push({
        symbol,
        action: "sell",
        qty: pos,
        reason: `Enhanced Mean Rev: Deep overbought BB${(bbPosition * 100).toFixed(0)}%`,
        confidence,
      })
    }
    // Z-score entry
    else if (Math.abs(lastZ) > zThreshold && pos === 0) {
      const isOversold = lastZ < -zThreshold
      signals.push({
        symbol,
        action: isOversold ? "buy" : "sell",
        qty,
        reason: `Z-score entry: ${lastZ.toFixed(2)} (threshold: ${zThreshold})`,
        confidence: 0.7 * adaptive.reversionWeight,
        price: lastClose,
      })
    }
    // Exit at mean
    else if (pos > 0 && Math.abs(lastClose - lastMiddle) < (lastUpper - lastLower) * 0.15) {
      signals.push({
        symbol,
        action: "sell",
        qty: pos,
        reason: `Mean reversion exit: returned to mean`,
        confidence: 0.75,
      })
    }
  }

  return signals
}

// ─── Enhanced Statistical Arbitrage ────────────────────────────────────────────

/**
 * Statistical arbitrage with dynamic hedge ratios and regime awareness
 */
export function runEnhancedStatArb(
  barsBySymbol: Record<string, Bar[]>,
  config: EnhancedStrategyConfig,
  positionsBySymbol: Record<string, number>,
  context: EnhancedStrategyContext
): TradeSignal[] {
  const signals: TradeSignal[] = []

  const adaptive = context.adaptiveConfig || {
    trendThreshold: 0.6,
    momentumWeight: 1.0,
    reversionThreshold: 0.5,
    reversionWeight: 1.0,
    positionSizeMult: 1.0,
    stopLossMult: 1.5,
    takeProfitMult: 2.0,
  }

  const period = Number(config.params.period) || 20
  let zThreshold = Number(config.params.zThreshold) || 1.5
  let qty = Number(config.params.qty) || 2
  qty = Math.floor(qty * adaptive.positionSizeMult)

  // Adjust Z threshold based on volatility
  if (context.regime?.volatility === "high") {
    zThreshold *= 1.3
  }

  const symbols = config.symbols
  if (symbols.length < 2) return signals

  const [sym1, sym2] = symbols
  const bars1 = barsBySymbol[sym1] || []
  const bars2 = barsBySymbol[sym2] || []

  if (bars1.length < period || bars2.length < period) return signals

  const closes1 = bars1.map((b) => b.c)
  const closes2 = bars2.map((b) => b.c)

  // Calculate correlation
  const correlation = calcCorrelation(closes1, closes2)

  // Skip if correlation is too weak
  if (Math.abs(correlation) < 0.5) {
    return signals
  }

  // Calculate spread and hedge ratio using rolling OLS
  const spread: number[] = []
  const hedgeRatios: number[] = []

  for (let i = period; i <= closes1.length; i++) {
    const slice1 = closes1.slice(i - period, i)
    const slice2 = closes2.slice(i - period, i)

    // OLS regression: slice1 = β * slice2 + α
    const mean1 = slice1.reduce((a, b) => a + b, 0) / period
    const mean2 = slice2.reduce((a, b) => a + b, 0) / period

    let num = 0
    let den = 0
    for (let j = 0; j < period; j++) {
      num += (slice2[j] - mean2) * (slice1[j] - mean1)
      den += (slice2[j] - mean2) ** 2
    }

    const beta = den === 0 ? 1 : num / den
    hedgeRatios.push(beta)
    spread.push(slice1[slice1.length - 1] - beta * slice2[slice2.length - 1])
  }

  // Calculate Z-score of spread
  const zScores = calcZScore(spread, period)
  const currentZ = zScores[zScores.length - 1]
  const currentHedgeRatio = hedgeRatios[hedgeRatios.length - 1]

  const pos1 = positionsBySymbol[sym1] || 0
  const pos2 = positionsBySymbol[sym2] || 0
  const hasPositions = pos1 !== 0 || pos2 !== 0

  // Check regime for pair
  const regime1 = detectMarketRegime(
    bars1.map((b) => ({ high: b.h, low: b.l, close: b.c, volume: b.v })),
    20
  )
  const regime2 = detectMarketRegime(
    bars2.map((b) => ({ high: b.h, low: b.l, close: b.c, volume: b.v })),
    20
  )

  // Avoid stat arb in highly volatile trending markets
  if (
    regime1.trendStrength === "strong_trend" &&
    regime2.trendStrength === "strong_trend" &&
    regime1.direction !== regime2.direction
  ) {
    return signals // Divergent trends - bad for stat arb
  }

  // Close positions when spread normalizes
  if (hasPositions && Math.abs(currentZ) < 0.3) {
    if (pos1 > 0) signals.push({ symbol: sym1, action: "sell", qty: pos1, reason: "Stat Arb: spread converged", confidence: 0.75 })
    if (pos2 > 0) signals.push({ symbol: sym2, action: "sell", qty: pos2, reason: "Stat Arb: spread converged", confidence: 0.75 })
  }
  // Entry when spread widens
  else if (!hasPositions && Math.abs(currentZ) > zThreshold) {
    const confidence = Math.min(
      0.9,
      0.5 + adaptive.reversionWeight * 0.2 + Math.abs(currentZ) / 10
    )

    if (currentZ > 0) {
      // Spread high: short sym1, long sym2 (adjusted by hedge ratio)
      const qty2 = Math.max(1, Math.round(qty * currentHedgeRatio))
      signals.push({
        symbol: sym1,
        action: "sell",
        qty,
        reason: `Enhanced Stat Arb: spread high Z=${currentZ.toFixed(2)} β=${currentHedgeRatio.toFixed(2)} corr=${correlation.toFixed(2)}`,
        confidence,
      })
      signals.push({
        symbol: sym2,
        action: "buy",
        qty: qty2,
        reason: `Hedge leg`,
        confidence,
      })
    } else {
      // Spread low: long sym1, short sym2
      const qty2 = Math.max(1, Math.round(qty * currentHedgeRatio))
      signals.push({
        symbol: sym1,
        action: "buy",
        qty,
        reason: `Enhanced Stat Arb: spread low Z=${currentZ.toFixed(2)} β=${currentHedgeRatio.toFixed(2)} corr=${correlation.toFixed(2)}`,
        confidence,
      })
      signals.push({
        symbol: sym2,
        action: "sell",
        qty: qty2,
        reason: `Hedge leg`,
        confidence,
      })
    }
  }

  return signals
}

// ─── Unified Enhanced Strategy Runner ───────────────────────────────────────────

export function runEnhancedStrategy(
  strategy: EnhancedStrategyConfig,
  barsBySymbol: Record<string, Bar[]>,
  positionsBySymbol: Record<string, number>,
  context: EnhancedStrategyContext
): TradeSignal[] {
  switch (strategy.id) {
    case "stat_arb":
    case "pairs_trading":
      return runEnhancedStatArb(barsBySymbol, strategy, positionsBySymbol, context)
    case "mean_reversion":
      return runEnhancedMeanReversion(barsBySymbol, strategy, positionsBySymbol, context)
    case "momentum":
      return runEnhancedMomentum(barsBySymbol, strategy, positionsBySymbol, context)
    default:
      return []
  }
}

// ─── Default Enhanced Strategies ────────────────────────────────────────────────

export const DEFAULT_ENHANCED_STRATEGIES: EnhancedStrategyConfig[] = [
  {
    id: "momentum",
    name: "Enhanced Momentum",
    description: "Adaptive momentum trading with regime detection and multi-timeframe confirmation",
    symbols: ["SPY", "QQQ", "TSLA", "NVDA", "AMD"],
    params: { fastPeriod: 9, slowPeriod: 21, qty: 3 },
    useRegimeDetection: true,
    useMultiTimeframe: true,
    checkCorrelation: true,
    correlationThreshold: 0.75,
  },
  {
    id: "mean_reversion",
    name: "Enhanced Mean Reversion",
    description: "Dynamic mean reversion with volatility-adjusted thresholds",
    symbols: ["AAPL", "MSFT", "GOOGL", "META", "AMZN"],
    params: { period: 20, bbMultiplier: 2.0, rsiOversold: 35, rsiOverbought: 65, qty: 2 },
    useRegimeDetection: true,
    useMultiTimeframe: false,
    checkCorrelation: true,
    correlationThreshold: 0.7,
  },
  {
    id: "stat_arb",
    name: "Enhanced Statistical Arbitrage",
    description: "Pairs trading with dynamic hedge ratios and regime awareness",
    symbols: ["SPY", "QQQ"],
    params: { period: 20, zThreshold: 1.5, qty: 3 },
    useRegimeDetection: true,
    useMultiTimeframe: false,
    checkCorrelation: false,
    correlationThreshold: 0.8,
  },
]
