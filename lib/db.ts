import Database from "better-sqlite3"
import { Pool } from "pg"
import path from "path"
import fs from "fs"

// ─── DB CONFIG ───────────────────────────────────────────────────────────────

const DB_PATH = path.join(process.cwd(), "trading.db")
const POSTGRES_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL

let sqliteDb: Database.Database | null = null
let pgPool: Pool | null = null

// Determine which DB to use (Postgres for Production/Cloud, SQLite for Local)
const isPostgres = Boolean(POSTGRES_URL && POSTGRES_URL.startsWith("postgres"))

export function getDb() {
  if (isPostgres) {
    if (!pgPool) pgPool = new Pool({ connectionString: POSTGRES_URL, ssl: { rejectUnauthorized: false } })
    return pgPool
  } else {
    if (!sqliteDb) {
      sqliteDb = new Database(DB_PATH)
      sqliteDb.pragma("journal_mode = WAL")
      sqliteDb.pragma("foreign_keys = ON")
    }
    return sqliteDb
  }
}

// ─── DB Migration ─────────────────────────────────────────────────────────────

let migrated = false

export async function runMigrations() {
  if (migrated) return
  migrated = true

  if (isPostgres) {
    const client = await (getDb() as Pool).connect()
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS trades (
          id SERIAL PRIMARY KEY,
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
          created_at TIMESTAMPTZ DEFAULT NOW(),
          executed_at TIMESTAMPTZ,
          filled_avg_price REAL,
          filled_qty REAL
        );

        CREATE TABLE IF NOT EXISTS strategy_configs (
          id SERIAL PRIMARY KEY,
          strategy_id TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          description TEXT,
          symbols TEXT NOT NULL DEFAULT '[]',
          params TEXT NOT NULL DEFAULT '{}',
          is_active INTEGER DEFAULT 0,
          auto_execute INTEGER DEFAULT 0,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS portfolio_snapshots (
          id SERIAL PRIMARY KEY,
          equity REAL NOT NULL,
          cash REAL NOT NULL,
          buying_power REAL,
          portfolio_value REAL,
          profit_loss REAL,
          profit_loss_pct REAL,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS trade_signals (
          id SERIAL PRIMARY KEY,
          strategy_id TEXT NOT NULL,
          symbol TEXT NOT NULL,
          action TEXT NOT NULL CHECK (action IN ('buy', 'sell', 'hold')),
          qty REAL NOT NULL,
          reason TEXT,
          confidence REAL,
          price_at_signal REAL,
          was_executed INTEGER DEFAULT 0,
          trade_id INTEGER REFERENCES trades(id),
          created_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_trades_created_at ON trades(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_portfolio_created_at ON portfolio_snapshots(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_signals_created_at ON trade_signals(created_at DESC);
      `)

      // Seed default strategies
      const strategies = [
        ["stat_arb", "Statistical Arbitrage", "Z-score spread trading", '["SPY", "QQQ"]', '{"period": 20, "zThreshold": 2.0, "qty": 1}'],
        ["mean_reversion", "Mean Reversion", "Bollinger Bands + RSI", '["AAPL", "MSFT"]', '{"period": 20, "bbMultiplier": 2.0, "rsiOversold": 35, "rsiOverbought": 65, "qty": 1}'],
        ["momentum", "EMA Momentum", "EMA crossover/trend", '["TSLA", "NVDA"]', '{"fastPeriod": 9, "slowPeriod": 21, "qty": 1}']
      ]
      for (const s of strategies) {
        await client.query("INSERT INTO strategy_configs (strategy_id, name, description, symbols, params) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (strategy_id) DO NOTHING", s)
      }
      console.log("[postgres] Migration complete (Neon)")
    } finally {
      client.release()
    }
  } else {
    const db = getDb() as Database.Database
    db.exec(`
      CREATE TABLE IF NOT EXISTS trades (id INTEGER PRIMARY KEY AUTOINCREMENT, symbol TEXT NOT NULL, side TEXT NOT NULL, qty REAL NOT NULL, price REAL, order_id TEXT, status TEXT DEFAULT 'pending', strategy_id TEXT, signal_reason TEXT, confidence REAL, pnl REAL, created_at TEXT DEFAULT (datetime('now')), executed_at TEXT, filled_avg_price REAL, filled_qty REAL);
      CREATE TABLE IF NOT EXISTS strategy_configs (id INTEGER PRIMARY KEY AUTOINCREMENT, strategy_id TEXT NOT NULL UNIQUE, name TEXT NOT NULL, description TEXT, symbols TEXT NOT NULL DEFAULT '[]', params TEXT NOT NULL DEFAULT '{}', is_active INTEGER DEFAULT 0, auto_execute INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
      CREATE TABLE IF NOT EXISTS portfolio_snapshots (id INTEGER PRIMARY KEY AUTOINCREMENT, equity REAL NOT NULL, cash REAL NOT NULL, buying_power REAL, portfolio_value REAL, profit_loss REAL, profit_loss_pct REAL, created_at TEXT DEFAULT (datetime('now')));
      CREATE TABLE IF NOT EXISTS trade_signals (id INTEGER PRIMARY KEY AUTOINCREMENT, strategy_id TEXT NOT NULL, symbol TEXT NOT NULL, action TEXT NOT NULL, qty REAL NOT NULL, reason TEXT, confidence REAL, price_at_signal REAL, was_executed INTEGER DEFAULT 0, trade_id INTEGER REFERENCES trades(id), created_at TEXT DEFAULT (datetime('now')));
    `)
    const seed = db.prepare("INSERT OR IGNORE INTO strategy_configs (strategy_id, name, description, symbols, params) VALUES (?, ?, ?, ?, ?)")
    seed.run("stat_arb", "Statistical Arbitrage", "Z-score spread trading", '["SPY", "QQQ"]', '{"period": 20, "zThreshold": 2.0, "qty": 1}')
    seed.run("mean_reversion", "Mean Reversion", "Bollinger Bands + RSI", '["AAPL", "MSFT"]', '{"period": 20, "bbMultiplier": 2.0, "rsiOversold": 35, "rsiOverbought": 65, "qty": 1}')
    seed.run("momentum", "EMA Momentum", "EMA crossover/trend", '["TSLA", "NVDA"]', '{"fastPeriod": 9, "slowPeriod": 21, "qty": 1}')
    console.log("[sqlite] Migration complete (Local) ->", DB_PATH)
  }
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DBTrade {
  id: number; symbol: string; side: "buy" | "sell"; qty: number; price: number | null;
  order_id: string | null; status: string; strategy_id: string | null; signal_reason: string | null;
  confidence: number | null; pnl: number | null; created_at: string;
}

export interface DBStrategyConfig {
  id: number; strategy_id: string; name: string; symbols: string[]; params: any;
  is_active: boolean; auto_execute: boolean;
}

export interface DBPortfolioSnapshot {
  id: number; equity: number; cash: number; profit_loss: number | null; created_at: string;
}

export interface DBTradeSignal {
  id: number; strategy_id: string; symbol: string; action: string; qty: number; created_at: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export async function insertTrade(trade: any): Promise<DBTrade> {
  const db = getDb()
  if (isPostgres) {
    const res = await (db as Pool).query(`
      INSERT INTO trades (symbol, side, qty, price, order_id, status, strategy_id, signal_reason, confidence, executed_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW()) RETURNING *
    `, [trade.symbol, trade.side, trade.qty, trade.price || null, trade.order_id || null, trade.status || "filled", trade.strategy_id || null, trade.signal_reason || null, trade.confidence || null])
    return res.rows[0]
  } else {
    const stmt = (db as Database.Database).prepare(`
      INSERT INTO trades (symbol, side, qty, price, order_id, status, strategy_id, signal_reason, confidence, executed_at)
      VALUES (@symbol, @side, @qty, @price, @order_id, @status, @strategy_id, @signal_reason, @confidence, datetime('now'))
    `)
    const info = stmt.run(trade)
    return (db as Database.Database).prepare("SELECT * FROM trades WHERE id = ?").get(info.lastInsertRowid) as DBTrade
  }
}

export async function getTrades(limit = 50): Promise<DBTrade[]> {
  const db = getDb()
  if (isPostgres) {
    const res = await (db as Pool).query("SELECT * FROM trades ORDER BY created_at DESC LIMIT $1", [limit])
    return res.rows
  } else {
    return (db as Database.Database).prepare("SELECT * FROM trades ORDER BY created_at DESC LIMIT ?").all(limit) as DBTrade[]
  }
}

export async function getStrategyConfigs(): Promise<DBStrategyConfig[]> {
  const db = getDb()
  let rows: any[] = []
  if (isPostgres) {
    const res = await (db as Pool).query("SELECT * FROM strategy_configs ORDER BY id ASC")
    rows = res.rows
  } else {
    rows = (db as Database.Database).prepare("SELECT * FROM strategy_configs ORDER BY id ASC").all()
  }
  return rows.map(r => ({
    ...r,
    symbols: typeof r.symbols === "string" ? JSON.parse(r.symbols) : r.symbols,
    params: typeof r.params === "string" ? JSON.parse(r.params) : r.params,
    is_active: Boolean(r.is_active),
    auto_execute: Boolean(r.auto_execute)
  }))
}

export async function updateStrategyConfig(strategyId: string, updates: any): Promise<any> {
  const db = getDb()
  if (isPostgres) {
    const current = (await (db as Pool).query("SELECT * FROM strategy_configs WHERE strategy_id = $1", [strategyId])).rows[0]
    if (!current) throw new Error("Strategy not found")
    const params = updates.params ? JSON.stringify(updates.params) : current.params
    const symbols = updates.symbols ? JSON.stringify(updates.symbols) : current.symbols
    const active = updates.is_active !== undefined ? (updates.is_active ? 1 : 0) : current.is_active
    await (db as Pool).query(`
      UPDATE strategy_configs SET params = $1, symbols = $2, is_active = $3, updated_at = NOW() WHERE strategy_id = $4
    `, [params, symbols, active, strategyId])
  } else {
    const current = (db as Database.Database).prepare("SELECT * FROM strategy_configs WHERE strategy_id = ?").get(strategyId) as any
    const params = updates.params ? JSON.stringify(updates.params) : current.params
    const symbols = updates.symbols ? JSON.stringify(updates.symbols) : current.symbols
    const active = updates.is_active !== undefined ? (updates.is_active ? 1 : 0) : current.is_active
    ;(db as Database.Database).prepare(`
      UPDATE strategy_configs SET params = ?, symbols = ?, is_active = ?, updated_at = datetime('now') WHERE strategy_id = ?
    `).run(params, symbols, active, strategyId)
  }
}

export async function insertPortfolioSnapshot(snapshot: any): Promise<any> {
  const db = getDb()
  if (isPostgres) {
    await (db as Pool).query(`
      INSERT INTO portfolio_snapshots (equity, cash, buying_power, portfolio_value, profit_loss, profit_loss_pct)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [snapshot.equity, snapshot.cash, snapshot.buying_power || null, snapshot.portfolio_value || null, snapshot.profit_loss || null, snapshot.profit_loss_pct || null])
  } else {
    ;(db as Database.Database).prepare(`
      INSERT INTO portfolio_snapshots (equity, cash, buying_power, portfolio_value, profit_loss, profit_loss_pct)
      VALUES (@equity, @cash, @buying_power, @portfolio_value, @profit_loss, @profit_loss_pct)
    `).run(snapshot)
  }
}

export async function getPortfolioSnapshots(limit = 200): Promise<any[]> {
  const db = getDb()
  if (isPostgres) {
    return (await (db as Pool).query("SELECT * FROM portfolio_snapshots ORDER BY created_at ASC LIMIT $1", [limit])).rows
  } else {
    return (db as Database.Database).prepare("SELECT * FROM portfolio_snapshots ORDER BY created_at ASC LIMIT ?").all(limit)
  }
}

export async function insertTradeSignal(signal: any): Promise<any> {
  const db = getDb()
  if (isPostgres) {
    await (db as Pool).query(`
      INSERT INTO trade_signals (strategy_id, symbol, action, qty, reason, confidence, price_at_signal, was_executed)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [signal.strategy_id, signal.symbol, signal.action, signal.qty, signal.reason || null, signal.confidence || null, signal.price_at_signal || null, signal.was_executed ? 1 : 0])
  } else {
    ;(db as Database.Database).prepare(`
      INSERT INTO trade_signals (strategy_id, symbol, action, qty, reason, confidence, price_at_signal, was_executed)
      VALUES (@strategy_id, @symbol, @action, @qty, @reason, @confidence, @price_at_signal, @was_executed)
    `).run({ ...signal, was_executed: signal.was_executed ? 1 : 0 })
  }
}

export async function getTradeSignals(limit = 100): Promise<any[]> {
  const db = getDb()
  if (isPostgres) {
    return (await (db as Pool).query("SELECT * FROM trade_signals ORDER BY created_at DESC LIMIT $1", [limit])).rows
  } else {
    return (db as Database.Database).prepare("SELECT * FROM trade_signals ORDER BY created_at DESC LIMIT ?").all(limit)
  }
}
