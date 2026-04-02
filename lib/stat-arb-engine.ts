/**
 * Statistical Arbitrage Engine
 * 
 * Inspired by Renaissance Technologies Medallion Fund approach:
 * - OLS hedge ratio via ordinary least squares regression
 * - Rolling z-score on the cointegrated spread
 * - Automated pair selection by correlation + spread stationarity
 * - Live order execution via Alpaca paper API
 */

// ─── Math Utilities ──────────────────────────────────────────────────────────

export function mean(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0) / arr.length
}

export function std(arr: number[]): number {
  const m = mean(arr)
  return Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / arr.length)
}

/** Ordinary Least Squares: Y = β*X + α. Returns { beta, alpha } */
export function ols(y: number[], x: number[]): { beta: number; alpha: number } {
  const n = Math.min(y.length, x.length)
  const mx = mean(x.slice(-n))
  const my = mean(y.slice(-n))
  let num = 0, den = 0
  for (let i = 0; i < n; i++) {
    num += (x[i] - mx) * (y[i] - my)
    den += (x[i] - mx) ** 2
  }
  const beta = den === 0 ? 1 : num / den
  const alpha = my - beta * mx
  return { beta, alpha }
}

/** Pearson correlation coefficient */
export function correlation(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length)
  const ax = a.slice(-n), bx = b.slice(-n)
  const ma = mean(ax), mb = mean(bx)
  let num = 0, da = 0, db = 0
  for (let i = 0; i < n; i++) {
    num += (ax[i] - ma) * (bx[i] - mb)
    da += (ax[i] - ma) ** 2
    db += (bx[i] - mb) ** 2
  }
  return num / (Math.sqrt(da) * Math.sqrt(db) || 1)
}

/** 
 * Augmented Dickey-Fuller proxy (simplified stationarity check)
 * A stationary spread has |autocorrelation lag-1| < 0.9 and small std vs range
 */
export function isStationary(arr: number[]): boolean {
  if (arr.length < 10) return false
  // Lag-1 autocorrelation
  const shifted = arr.slice(0, -1)
  const original = arr.slice(1)
  const rho = correlation(original, shifted)
  // Variance ratio test: rolling variance should be small relative to total
  const half = Math.floor(arr.length / 2)
  const v1 = std(arr.slice(0, half))
  const v2 = std(arr.slice(half))
  const varianceRatio = Math.abs(v1 - v2) / (mean([v1, v2]) || 1)
  return rho < 0.92 && varianceRatio < 0.5
}

/** Rolling Z-Score of spread */
export function zScore(spread: number[], window: number): number[] {
  const z: number[] = new Array(spread.length).fill(0)
  for (let i = window - 1; i < spread.length; i++) {
    const slice = spread.slice(i - window + 1, i + 1)
    const m = mean(slice)
    const s = std(slice)
    z[i] = s === 0 ? 0 : (spread[i] - m) / s
  }
  return z
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PairStats {
  symbolA: string
  symbolB: string
  correlation: number
  beta: number        // hedge ratio: A = β*B + α
  alpha: number
  spread: number[]
  zScores: number[]
  currentZ: number
  isCointegrated: boolean
  halfLife: number
  signal: "long_A_short_B" | "short_A_long_B" | "close" | "hold"
  entryZ: number
  exitZ: number
  stopZ: number
}

export interface StatArbConfig {
  entryZ: number      // Z-score threshold to enter (default: 2.0)
  exitZ: number       // Z-score threshold to exit/close (default: 0.5)
  stopZ: number       // Stop-loss z-score (default: 3.5)
  lookback: number    // Rolling window for z-score (default: 30)
  minCorrelation: number // Minimum correlation to consider (default: 0.75)
  qtyA: number        // Quantity for symbol A
  qtyB: number        // Quantity for symbol B (adjusted by beta)
}

export const DEFAULT_STAT_ARB_CONFIG: StatArbConfig = {
  entryZ: 1.5,    // Lowered from 2.0 - more entry opportunities
  exitZ: 0.3,     // Lowered from 0.5 - quicker exits
  stopZ: 3.0,     // Lowered from 3.5 - tighter stops
  lookback: 20,   // Shorter period - more responsive
  minCorrelation: 0.6,  // Lowered from 0.75 - more pairs qualify
  qtyA: 2,        // Increased position size
  qtyB: 2,
}

export interface OrderInstruction {
  symbol: string
  side: "buy" | "sell"
  qty: number
  reason: string
}

// ─── Core Analysis ───────────────────────────────────────────────────────────

export function analyzePair(
  symbolA: string,
  pricesA: number[],
  symbolB: string,
  pricesB: number[],
  config: StatArbConfig,
  currentPositions: { symbolA: number; symbolB: number }
): PairStats {
  const n = Math.min(pricesA.length, pricesB.length)
  const pA = pricesA.slice(-n)
  const pB = pricesB.slice(-n)

  // 1. Correlation
  const corr = correlation(pA, pB)

  // 2. OLS hedge ratio
  const { beta, alpha } = ols(pA, pB)

  // 3. Spread = A - β*B
  const spread = pA.map((a, i) => a - beta * pB[i])

  // 4. Z-score (rolling)
  const zs = zScore(spread, config.lookback)
  const currentZ = zs[zs.length - 1] || 0

  // 5. Cointegration proxy
  const cointegrated = isStationary(spread) && Math.abs(corr) >= config.minCorrelation

  // 6. Half-life of mean reversion (speed of reversion)
  // Estimate: regress Δspread on spread[t-1]
  const diffs = spread.slice(1).map((s, i) => s - spread[i])
  const lagged = spread.slice(0, -1)
  const { beta: meanRevBeta } = ols(diffs, lagged)
  const halfLife = meanRevBeta < 0 ? Math.abs(Math.log(2) / meanRevBeta) : 999

  // 7. Signal generation
  let signal: PairStats["signal"] = "hold"
  const hasPositionA = currentPositions.symbolA !== 0
  const hasPositionB = currentPositions.symbolB !== 0
  const hasPositions = hasPositionA || hasPositionB

  if (hasPositions && Math.abs(currentZ) < config.exitZ) {
    signal = "close"
  } else if (hasPositions && Math.abs(currentZ) > config.stopZ) {
    signal = "close" // Stop loss
  } else if (!hasPositions && currentZ > config.entryZ && cointegrated) {
    signal = "short_A_long_B" // A too expensive vs B
  } else if (!hasPositions && currentZ < -config.entryZ && cointegrated) {
    signal = "long_A_short_B" // A too cheap vs B
  }

  return {
    symbolA, symbolB, correlation: corr, beta, alpha,
    spread, zScores: zs, currentZ, isCointegrated: cointegrated,
    halfLife, signal,
    entryZ: config.entryZ, exitZ: config.exitZ, stopZ: config.stopZ,
  }
}

/** 
 * Convert pair analysis into concrete order instructions 
 * Correct position sizing: qty_B = round(beta * qty_A) for dollar-neutral
 */
export function generateOrders(
  stats: PairStats,
  config: StatArbConfig,
  currentPositions: { symbolA: number; symbolB: number }
): OrderInstruction[] {
  const orders: OrderInstruction[] = []
  const qtyA = config.qtyA
  const qtyB = Math.max(1, Math.round(Math.abs(stats.beta) * config.qtyB))

  switch (stats.signal) {
    case "short_A_long_B":
      // Spread high: A overpriced, B underpriced → Short A, Long B
      orders.push({
        symbol: stats.symbolA,
        side: "sell",
        qty: qtyA,
        reason: `Stat-Arb: ${stats.symbolA} overpriced (z=${stats.currentZ.toFixed(2)}, corr=${stats.correlation.toFixed(2)}, β=${stats.beta.toFixed(2)})`,
      })
      orders.push({
        symbol: stats.symbolB,
        side: "buy",
        qty: qtyB,
        reason: `Stat-Arb: ${stats.symbolB} underpriced (hedge ratio buy)`,
      })
      break

    case "long_A_short_B":
      // Spread low: A underpriced, B overpriced → Long A, Short B
      orders.push({
        symbol: stats.symbolA,
        side: "buy",
        qty: qtyA,
        reason: `Stat-Arb: ${stats.symbolA} underpriced (z=${stats.currentZ.toFixed(2)}, corr=${stats.correlation.toFixed(2)}, β=${stats.beta.toFixed(2)})`,
      })
      orders.push({
        symbol: stats.symbolB,
        side: "sell",
        qty: qtyB,
        reason: `Stat-Arb: ${stats.symbolB} overpriced (hedge ratio sell)`,
      })
      break

    case "close":
      // Close all positions in this pair
      if (currentPositions.symbolA > 0) {
        orders.push({ symbol: stats.symbolA, side: "sell", qty: currentPositions.symbolA, reason: `Stat-Arb: Close position (z=${stats.currentZ.toFixed(2)} → convergence)` })
      } else if (currentPositions.symbolA < 0) {
        orders.push({ symbol: stats.symbolA, side: "buy", qty: Math.abs(currentPositions.symbolA), reason: `Stat-Arb: Cover short ${stats.symbolA}` })
      }
      if (currentPositions.symbolB > 0) {
        orders.push({ symbol: stats.symbolB, side: "sell", qty: currentPositions.symbolB, reason: `Stat-Arb: Close position (convergence)` })
      } else if (currentPositions.symbolB < 0) {
        orders.push({ symbol: stats.symbolB, side: "buy", qty: Math.abs(currentPositions.symbolB), reason: `Stat-Arb: Cover short ${stats.symbolB}` })
      }
      break
  }

  return orders
}

// ─── Predefined pairs for monitoring ─────────────────────────────────────────

export const STAT_ARB_PAIRS: [string, string][] = [
  ["SPY", "QQQ"],    // S&P 500 vs Nasdaq — highly correlated
  ["GLD", "SLV"],    // Gold vs Silver — metals pair
  ["AAPL", "MSFT"],  // Big Tech pair
  ["NVDA", "AMD"],   // GPU manufacturers
  ["KO", "PEP"],     // Cola wars
]
