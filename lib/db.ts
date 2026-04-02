import Database from "better-sqlite3"
import path from "path"
import fs from "fs"

// Store SQLite DB in the project root (persists between restarts)
const DB_PATH = path.join(process.cwd(), "trading.db")

let _db: Database.Database | null = null

export function getDb(): Database.Database {
  if (_db) return _db
  _db = new Database(DB_PATH)
  _db.pragma("journal_mode = WAL") // Better performance for concurrent reads
  _db.pragma("foreign_keys = ON")
  return _db
}

// ─── DB Migration (run once) ─────────────────────────────────────────────────

let migrated = false

export function runMigrations() {
  if (migrated) return
  migrated = true
  const db = getDb()

  db.exec(`
    CREATE TABLE IF NOT EXISTS trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL,
      side TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
      qty REAL NOT NULL,
      price REAL,
      order_id TEXT,
      status TEXT DEFAULT 'pending',
      strategy_id TEXT,
      signal_reason TEXT,
      confidence REAL,
      pnl REAL,
      created_at TEXT DEFAULT (datetime('now')),
      executed_at TEXT,
      filled_avg_price REAL,
      filled_qty REAL
    );

    CREATE TABLE IF NOT EXISTS strategy_configs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      strategy_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT,
      symbols TEXT NOT NULL DEFAULT '[]',
      params TEXT NOT NULL DEFAULT '{}',
      is_active INTEGER DEFAULT 0,
      auto_execute INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS portfolio_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      equity REAL NOT NULL,
      cash REAL NOT NULL,
      buying_power REAL,
      portfolio_value REAL,
      profit_loss REAL,
      profit_loss_pct REAL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS trade_signals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      strategy_id TEXT NOT NULL,
      symbol TEXT NOT NULL,
      action TEXT NOT NULL CHECK (action IN ('buy', 'sell', 'hold')),
      qty REAL NOT NULL,
      reason TEXT,
      confidence REAL,
      price_at_signal REAL,
      was_executed INTEGER DEFAULT 0,
      trade_id INTEGER REFERENCES trades(id),
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_trades_created_at ON trades(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_trades_symbol ON trades(symbol);
    CREATE INDEX IF NOT EXISTS idx_portfolio_created_at ON portfolio_snapshots(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_signals_created_at ON trade_signals(created_at DESC);
  `)

  // Seed default strategies
  const seedStmt = db.prepare(`
    INSERT OR IGNORE INTO strategy_configs (strategy_id, name, description, symbols, params, is_active)
    VALUES (?, ?, ?, ?, ?, 0)
  `)
  const seedMany = db.transaction(() => {
    seedStmt.run("stat_arb", "Statistical Arbitrage", "Z-score spread trading between SPY/QQQ", JSON.stringify(["SPY", "QQQ"]), JSON.stringify({ period: 20, zThreshold: 2.0, qty: 1 }))
    seedStmt.run("mean_reversion", "Mean Reversion", "Bollinger Bands + RSI on AAPL/MSFT/GOOGL", JSON.stringify(["AAPL", "MSFT", "GOOGL"]), JSON.stringify({ period: 20, bbMultiplier: 2.0, rsiOversold: 30, rsiOverbought: 70, qty: 1 }))
    seedStmt.run("momentum", "EMA Momentum", "EMA crossover on TSLA/NVDA/AMD", JSON.stringify(["TSLA", "NVDA", "AMD"]), JSON.stringify({ fastPeriod: 10, slowPeriod: 30, qty: 1 }))
    seedStmt.run("pairs_trading", "Pairs Trading", "Long/short pairs on GLD/SLV", JSON.stringify(["GLD", "SLV"]), JSON.stringify({ period: 30, zThreshold: 1.8, qty: 2 }))
  })
  seedMany()
  console.log("[sqlite] Migration complete →", DB_PATH)
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DBTrade {
  id: number
  symbol: string
  side: "buy" | "sell"
  qty: number
  price: number | null
  order_id: string | null
  status: string
  strategy_id: string | null
  signal_reason: string | null
  confidence: number | null
  pnl: number | null
  created_at: string
  executed_at: string | null
  filled_avg_price: number | null
  filled_qty: number | null
}

export interface DBStrategyConfig {
  id: number
  strategy_id: string
  name: string
  description: string
  symbols: string[]
  params: Record<string, number | string>
  is_active: boolean
  auto_execute: boolean
  created_at: string
  updated_at: string
}

export interface DBPortfolioSnapshot {
  id: number
  equity: number
  cash: number
  buying_power: number | null
  portfolio_value: number | null
  profit_loss: number | null
  profit_loss_pct: number | null
  created_at: string
}

export interface DBTradeSignal {
  id: number
  strategy_id: string
  symbol: string
  action: "buy" | "sell" | "hold"
  qty: number
  reason: string | null
  confidence: number | null
  price_at_signal: number | null
  was_executed: boolean
  trade_id: number | null
  created_at: string
}

// ─── Trade helpers ───────────────────────────────────────────────────────────

export function insertTrade(trade: {
  symbol: string
  side: "buy" | "sell"
  qty: number
  price?: number
  order_id?: string
  status?: string
  strategy_id?: string
  signal_reason?: string
  confidence?: number
  filled_avg_price?: number
  filled_qty?: number
}): DBTrade {
  const db = getDb()
  const stmt = db.prepare(`
    INSERT INTO trades (symbol, side, qty, price, order_id, status, strategy_id, signal_reason, confidence, filled_avg_price, filled_qty, executed_at)
    VALUES (@symbol, @side, @qty, @price, @order_id, @status, @strategy_id, @signal_reason, @confidence, @filled_avg_price, @filled_qty, datetime('now'))
  `)
  const info = stmt.run({
    symbol: trade.symbol,
    side: trade.side,
    qty: trade.qty,
    price: trade.price ?? null,
    order_id: trade.order_id ?? null,
    status: trade.status ?? "filled",
    strategy_id: trade.strategy_id ?? null,
    signal_reason: trade.signal_reason ?? null,
    confidence: trade.confidence ?? null,
    filled_avg_price: trade.filled_avg_price ?? null,
    filled_qty: trade.filled_qty ?? null,
  })
  return db.prepare("SELECT * FROM trades WHERE id = ?").get(info.lastInsertRowid) as DBTrade
}

export function getTrades(limit = 50): DBTrade[] {
  const db = getDb()
  return db.prepare("SELECT * FROM trades ORDER BY created_at DESC LIMIT ?").all(limit) as DBTrade[]
}

export function getTradesByStrategy(strategyId: string, limit = 50): DBTrade[] {
  const db = getDb()
  return db.prepare("SELECT * FROM trades WHERE strategy_id = ? ORDER BY created_at DESC LIMIT ?").all(strategyId, limit) as DBTrade[]
}

// ─── Strategy Config helpers ─────────────────────────────────────────────────

function parseStrategy(row: any): DBStrategyConfig {
  return {
    ...row,
    symbols: typeof row.symbols === "string" ? JSON.parse(row.symbols) : row.symbols,
    params: typeof row.params === "string" ? JSON.parse(row.params) : row.params,
    is_active: Boolean(row.is_active),
    auto_execute: Boolean(row.auto_execute),
  }
}

export function getStrategyConfigs(): DBStrategyConfig[] {
  const db = getDb()
  const rows = db.prepare("SELECT * FROM strategy_configs ORDER BY id ASC").all()
  return rows.map(parseStrategy)
}

export function updateStrategyConfig(
  strategyId: string,
  updates: { params?: Record<string, number | string>; is_active?: boolean; auto_execute?: boolean; symbols?: string[] }
): DBStrategyConfig {
  const db = getDb()
  const current = db.prepare("SELECT * FROM strategy_configs WHERE strategy_id = ?").get(strategyId) as any
  if (!current) throw new Error(`Strategy ${strategyId} not found`)

  const newParams = updates.params ? JSON.stringify(updates.params) : current.params
  const newSymbols = updates.symbols ? JSON.stringify(updates.symbols) : current.symbols
  const newActive = updates.is_active !== undefined ? (updates.is_active ? 1 : 0) : current.is_active
  const newAuto = updates.auto_execute !== undefined ? (updates.auto_execute ? 1 : 0) : current.auto_execute

  db.prepare(`
    UPDATE strategy_configs
    SET params = ?, symbols = ?, is_active = ?, auto_execute = ?, updated_at = datetime('now')
    WHERE strategy_id = ?
  `).run(newParams, newSymbols, newActive, newAuto, strategyId)

  return parseStrategy(db.prepare("SELECT * FROM strategy_configs WHERE strategy_id = ?").get(strategyId))
}

export function setStrategyActive(strategyId: string, isActive: boolean): void {
  const db = getDb()
  db.prepare("UPDATE strategy_configs SET is_active = 0, updated_at = datetime('now')").run()
  if (isActive) {
    db.prepare("UPDATE strategy_configs SET is_active = 1, updated_at = datetime('now') WHERE strategy_id = ?").run(strategyId)
  }
}

// ─── Portfolio snapshot helpers ───────────────────────────────────────────────

export function insertPortfolioSnapshot(snapshot: {
  equity: number
  cash: number
  buying_power?: number
  portfolio_value?: number
  profit_loss?: number
  profit_loss_pct?: number
}): DBPortfolioSnapshot {
  const db = getDb()
  const stmt = db.prepare(`
    INSERT INTO portfolio_snapshots (equity, cash, buying_power, portfolio_value, profit_loss, profit_loss_pct)
    VALUES (@equity, @cash, @buying_power, @portfolio_value, @profit_loss, @profit_loss_pct)
  `)
  const info = stmt.run({
    equity: snapshot.equity,
    cash: snapshot.cash,
    buying_power: snapshot.buying_power ?? null,
    portfolio_value: snapshot.portfolio_value ?? null,
    profit_loss: snapshot.profit_loss ?? null,
    profit_loss_pct: snapshot.profit_loss_pct ?? null,
  })
  return db.prepare("SELECT * FROM portfolio_snapshots WHERE id = ?").get(info.lastInsertRowid) as DBPortfolioSnapshot
}

export function getPortfolioSnapshots(limit = 200): DBPortfolioSnapshot[] {
  const db = getDb()
  return db.prepare("SELECT * FROM portfolio_snapshots ORDER BY created_at ASC LIMIT ?").all(limit) as DBPortfolioSnapshot[]
}

// ─── Trade signal helpers ─────────────────────────────────────────────────────

export function insertTradeSignal(signal: {
  strategy_id: string
  symbol: string
  action: "buy" | "sell" | "hold"
  qty: number
  reason?: string
  confidence?: number
  price_at_signal?: number
  was_executed?: boolean
  trade_id?: number
}): DBTradeSignal {
  const db = getDb()
  const stmt = db.prepare(`
    INSERT INTO trade_signals (strategy_id, symbol, action, qty, reason, confidence, price_at_signal, was_executed, trade_id)
    VALUES (@strategy_id, @symbol, @action, @qty, @reason, @confidence, @price_at_signal, @was_executed, @trade_id)
  `)
  const info = stmt.run({
    strategy_id: signal.strategy_id,
    symbol: signal.symbol,
    action: signal.action,
    qty: signal.qty,
    reason: signal.reason ?? null,
    confidence: signal.confidence ?? null,
    price_at_signal: signal.price_at_signal ?? null,
    was_executed: signal.was_executed ? 1 : 0,
    trade_id: signal.trade_id ?? null,
  })
  return db.prepare("SELECT * FROM trade_signals WHERE id = ?").get(info.lastInsertRowid) as DBTradeSignal
}

export function getTradeSignals(limit = 100): DBTradeSignal[] {
  const db = getDb()
  return db.prepare("SELECT * FROM trade_signals ORDER BY created_at DESC LIMIT ?").all(limit) as DBTradeSignal[]
}
