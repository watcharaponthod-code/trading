/**
 * Database Abstraction Layer
 *
 * Priority:
 *   1. Firebase Firestore  — when FIREBASE_SERVICE_ACCOUNT or FIREBASE_PROJECT_ID+KEY is set
 *   2. PostgreSQL          — when DATABASE_URL starts with "postgres"
 *   3. SQLite              — fallback for local dev (better-sqlite3, lazy-loaded)
 */

import { Pool } from "pg"
import path from "path"

// ─── Config Detection ────────────────────────────────────────────────────────

const POSTGRES_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL
const FIREBASE_ENABLED = Boolean(
  process.env.FIREBASE_SERVICE_ACCOUNT ||
  process.env.FIREBASE_PROJECT_ID ||
  process.env.FIREBASE_CLIENT_EMAIL
)
const isPostgres = !FIREBASE_ENABLED && Boolean(POSTGRES_URL && POSTGRES_URL.startsWith("postgres"))
const isFirestore = FIREBASE_ENABLED

// ─── SQLite (lazy, local dev only) ───────────────────────────────────────────

const DB_PATH = path.join(process.cwd(), "trading.db")
let sqliteDb: any | null = null
let pgPool: Pool | null = null

export function getDb() {
  if (isFirestore) throw new Error("Use Firestore helpers directly")
  if (isPostgres) {
    if (!pgPool) pgPool = new Pool({ connectionString: POSTGRES_URL, ssl: { rejectUnauthorized: false } })
    return pgPool
  }
  if (!sqliteDb) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const BetterSQLite = require("better-sqlite3")
    sqliteDb = new BetterSQLite(DB_PATH)
    sqliteDb.pragma("journal_mode = WAL")
    sqliteDb.pragma("foreign_keys = ON")
  }
  return sqliteDb
}

// ─── Migrations ───────────────────────────────────────────────────────────────

let migrated = false

export async function runMigrations() {
  if (migrated) return
  migrated = true

  if (isFirestore) {
    // Firestore is schemaless — seed default strategy_configs if missing
    const { getFirestore } = await import("./firebase")
    const db = getFirestore()
    const strategies = [
      {
        strategy_id: "stat_arb", name: "Statistical Arbitrage",
        description: "Z-score spread trading", symbols: ["SPY", "QQQ"],
        params: { period: 20, zThreshold: 2.0, qty: 1 }, is_active: false, auto_execute: false,
      },
      {
        strategy_id: "mean_reversion", name: "Mean Reversion",
        description: "Bollinger Bands + RSI", symbols: ["AAPL", "MSFT"],
        params: { period: 20, bbMultiplier: 2.0, rsiOversold: 35, rsiOverbought: 65, qty: 1 },
        is_active: false, auto_execute: false,
      },
      {
        strategy_id: "momentum", name: "EMA Momentum",
        description: "EMA crossover/trend", symbols: ["TSLA", "NVDA"],
        params: { fastPeriod: 9, slowPeriod: 21, qty: 1 }, is_active: false, auto_execute: false,
      },
      {
        strategy_id: "pairs_trading", name: "Pairs Trading",
        description: "Dollar-neutral long/short pairs", symbols: ["GLD", "SLV"],
        params: { period: 20, zThreshold: 1.2, qty: 3 }, is_active: false, auto_execute: false,
      },
    ]
    for (const s of strategies) {
      const ref = db.collection("strategy_configs").doc(s.strategy_id)
      const snap = await ref.get()
      if (!snap.exists) await ref.set({ ...s, created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    }
    console.log("[firestore] Migration / seed complete")
    return
  }

  if (isPostgres) {
    const client = await (getDb() as Pool).connect()
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS trades (
          id SERIAL PRIMARY KEY, symbol TEXT NOT NULL, side TEXT NOT NULL,
          qty REAL NOT NULL, price REAL, order_id TEXT, status TEXT DEFAULT 'pending',
          strategy_id TEXT, signal_reason TEXT, confidence REAL, pnl REAL,
          created_at TIMESTAMPTZ DEFAULT NOW(), executed_at TIMESTAMPTZ,
          filled_avg_price REAL, filled_qty REAL
        );
        CREATE TABLE IF NOT EXISTS strategy_configs (
          id SERIAL PRIMARY KEY, strategy_id TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
          description TEXT, symbols TEXT NOT NULL DEFAULT '[]', params TEXT NOT NULL DEFAULT '{}',
          is_active INTEGER DEFAULT 0, auto_execute INTEGER DEFAULT 0,
          created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS portfolio_snapshots (
          id SERIAL PRIMARY KEY, equity REAL NOT NULL, cash REAL NOT NULL,
          buying_power REAL, portfolio_value REAL, profit_loss REAL, profit_loss_pct REAL,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS trade_signals (
          id SERIAL PRIMARY KEY, strategy_id TEXT NOT NULL, symbol TEXT NOT NULL,
          action TEXT NOT NULL, qty REAL NOT NULL, reason TEXT, confidence REAL,
          price_at_signal REAL, was_executed INTEGER DEFAULT 0,
          trade_id INTEGER REFERENCES trades(id), created_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS telegram_chats (
          chat_id TEXT PRIMARY KEY, username TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_trades_created_at ON trades(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_portfolio_created_at ON portfolio_snapshots(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_signals_created_at ON trade_signals(created_at DESC);
      `)
      // Normalize symbols/params columns to TEXT in case they were previously created as TEXT[] or JSONB
      await client.query(`
        DO $$
        DECLARE col_type TEXT;
        BEGIN
          SELECT data_type INTO col_type FROM information_schema.columns
            WHERE table_name='strategy_configs' AND column_name='symbols';
          IF col_type = 'ARRAY' THEN
            EXECUTE 'ALTER TABLE strategy_configs ALTER COLUMN symbols TYPE TEXT USING to_json(symbols)::text';
          END IF;
          SELECT data_type INTO col_type FROM information_schema.columns
            WHERE table_name='strategy_configs' AND column_name='params';
          IF col_type = 'ARRAY' THEN
            EXECUTE 'ALTER TABLE strategy_configs ALTER COLUMN params TYPE TEXT USING to_json(params)::text';
          END IF;
        EXCEPTION WHEN OTHERS THEN NULL;
        END $$;
      `)
      for (const [sid, name, desc, params, syms] of [
        ["stat_arb", "Statistical Arbitrage", "Z-score spread trading", '{"period":20,"zThreshold":2.0,"qty":1}', '["SPY","QQQ"]'],
        ["mean_reversion", "Mean Reversion", "Bollinger Bands + RSI", '{"period":20,"bbMultiplier":2.0,"rsiOversold":35,"rsiOverbought":65,"qty":1}', '["AAPL","MSFT"]'],
        ["momentum", "EMA Momentum", "EMA crossover/trend", '{"fastPeriod":9,"slowPeriod":21,"qty":1}', '["TSLA","NVDA"]'],
      ]) {
        await client.query(
          "INSERT INTO strategy_configs (strategy_id,name,description,symbols,params) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (strategy_id) DO NOTHING",
          [sid, name, desc, syms, params]
        )
      }
      console.log("[postgres] Migration complete")
    } finally { client.release() }
    return
  }

  // SQLite
  const db = getDb()
  db.exec(`
    CREATE TABLE IF NOT EXISTS trades (id INTEGER PRIMARY KEY AUTOINCREMENT, symbol TEXT NOT NULL, side TEXT NOT NULL, qty REAL NOT NULL, price REAL, order_id TEXT, status TEXT DEFAULT 'pending', strategy_id TEXT, signal_reason TEXT, confidence REAL, pnl REAL, created_at TEXT DEFAULT (datetime('now')), executed_at TEXT, filled_avg_price REAL, filled_qty REAL);
    CREATE TABLE IF NOT EXISTS strategy_configs (id INTEGER PRIMARY KEY AUTOINCREMENT, strategy_id TEXT NOT NULL UNIQUE, name TEXT NOT NULL, description TEXT, symbols TEXT NOT NULL DEFAULT '[]', params TEXT NOT NULL DEFAULT '{}', is_active INTEGER DEFAULT 0, auto_execute INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS portfolio_snapshots (id INTEGER PRIMARY KEY AUTOINCREMENT, equity REAL NOT NULL, cash REAL NOT NULL, buying_power REAL, portfolio_value REAL, profit_loss REAL, profit_loss_pct REAL, created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS trade_signals (id INTEGER PRIMARY KEY AUTOINCREMENT, strategy_id TEXT NOT NULL, symbol TEXT NOT NULL, action TEXT NOT NULL, qty REAL NOT NULL, reason TEXT, confidence REAL, price_at_signal REAL, was_executed INTEGER DEFAULT 0, trade_id INTEGER REFERENCES trades(id), created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS telegram_chats (chat_id TEXT PRIMARY KEY, username TEXT, created_at TEXT DEFAULT (datetime('now')));
  `)
  const seed = db.prepare("INSERT OR IGNORE INTO strategy_configs (strategy_id, name, description, symbols, params) VALUES (?, ?, ?, ?, ?)")
  seed.run("stat_arb", "Statistical Arbitrage", "Z-score spread trading", '["SPY","QQQ"]', '{"period":20,"zThreshold":2.0,"qty":1}')
  seed.run("mean_reversion", "Mean Reversion", "Bollinger Bands + RSI", '["AAPL","MSFT"]', '{"period":20,"bbMultiplier":2.0,"rsiOversold":35,"rsiOverbought":65,"qty":1}')
  seed.run("momentum", "EMA Momentum", "EMA crossover/trend", '["TSLA","NVDA"]', '{"fastPeriod":9,"slowPeriod":21,"qty":1}')
  console.log("[sqlite] Migration complete")
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DBTrade {
  id: number; symbol: string; side: "buy" | "sell"; qty: number; price: number | null;
  order_id: string | null; status: string; strategy_id: string | null;
  signal_reason: string | null; confidence: number | null; pnl: number | null; created_at: string;
}
export interface DBStrategyConfig {
  id: number; strategy_id: string; name: string; description: string;
  symbols: string[]; params: any; is_active: boolean; auto_execute: boolean;
}
export interface DBPortfolioSnapshot {
  id: number; equity: number; cash: number; buying_power: number | null;
  portfolio_value: number | null; profit_loss: number | null;
  profit_loss_pct: number | null; created_at: string;
}
export interface DBTradeSignal {
  id: number; strategy_id: string; symbol: string; action: "buy" | "sell" | "hold";
  qty: number; reason: string | null; confidence: number | null;
  price_at_signal: number | null; was_executed: boolean; trade_id: number | null; created_at: string;
}

// ─── Helpers — route to Firestore / PG / SQLite ───────────────────────────────

async function fsDb() {
  const { getFirestore } = await import("./firebase")
  return getFirestore()
}

// ─── insertTrade ──────────────────────────────────────────────────────────────

export async function insertTrade(trade: any): Promise<any> {
  if (isFirestore) {
    const db = await fsDb()
    const ref = await db.collection("trades").add({
      ...trade,
      created_at: new Date().toISOString(),
      executed_at: new Date().toISOString(),
    })
    const snap = await ref.get()
    return { id: ref.id, ...snap.data() }
  }
  const db = getDb()
  if (isPostgres) {
    const res = await (db as Pool).query(
      `INSERT INTO trades (symbol,side,qty,price,order_id,status,strategy_id,signal_reason,confidence,executed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW()) RETURNING *`,
      [trade.symbol, trade.side, trade.qty, trade.price || null, trade.order_id || null,
       trade.status || "filled", trade.strategy_id || null, trade.signal_reason || null, trade.confidence || null]
    )
    return res.rows[0]
  }
  const info = (db as any).prepare(
    `INSERT INTO trades (symbol,side,qty,price,order_id,status,strategy_id,signal_reason,confidence,executed_at)
     VALUES (@symbol,@side,@qty,@price,@order_id,@status,@strategy_id,@signal_reason,@confidence,datetime('now'))`
  ).run(trade)
  return (db as any).prepare("SELECT * FROM trades WHERE id = ?").get(info.lastInsertRowid)
}

// ─── getTrades ────────────────────────────────────────────────────────────────

export async function getTrades(limit = 50): Promise<any[]> {
  if (isFirestore) {
    const db = await fsDb()
    const snap = await db.collection("trades").orderBy("created_at", "desc").limit(limit).get()
    return snap.docs.map(d => ({ id: d.id, ...d.data() }))
  }
  const db = getDb()
  if (isPostgres) return (await (db as Pool).query("SELECT * FROM trades ORDER BY created_at DESC LIMIT $1", [limit])).rows
  return (db as any).prepare("SELECT * FROM trades ORDER BY created_at DESC LIMIT ?").all(limit)
}

export async function getTradesByStrategy(strategyId: string, limit = 50): Promise<any[]> {
  if (isFirestore) {
    const db = await fsDb()
    const snap = await db.collection("trades").where("strategy_id", "==", strategyId)
      .orderBy("created_at", "desc").limit(limit).get()
    return snap.docs.map(d => ({ id: d.id, ...d.data() }))
  }
  const db = getDb()
  if (isPostgres) return (await (db as Pool).query("SELECT * FROM trades WHERE strategy_id=$1 ORDER BY created_at DESC LIMIT $2", [strategyId, limit])).rows
  return (db as any).prepare("SELECT * FROM trades WHERE strategy_id=? ORDER BY created_at DESC LIMIT ?").all(strategyId, limit)
}

// ─── strategy_configs ─────────────────────────────────────────────────────────

export async function getStrategyConfigs(): Promise<any[]> {
  if (isFirestore) {
    const db = await fsDb()
    const snap = await db.collection("strategy_configs").get()
    return snap.docs.map(d => {
      const data = d.data()
      return { ...data, id: d.id, symbols: data.symbols || [], params: data.params || {}, is_active: Boolean(data.is_active), auto_execute: Boolean(data.auto_execute) }
    })
  }
  const db = getDb()
  const rows = isPostgres
    ? (await (db as Pool).query("SELECT * FROM strategy_configs ORDER BY id ASC")).rows
    : (db as any).prepare("SELECT * FROM strategy_configs ORDER BY id ASC").all()
  return rows.map((r: any) => ({
    ...r,
    symbols: typeof r.symbols === "string" ? JSON.parse(r.symbols) : r.symbols,
    params: typeof r.params === "string" ? JSON.parse(r.params) : r.params,
    is_active: Boolean(r.is_active), auto_execute: Boolean(r.auto_execute),
  }))
}

export async function updateStrategyConfig(strategyId: string, updates: any): Promise<void> {
  if (isFirestore) {
    const db = await fsDb()
    const ref = db.collection("strategy_configs").doc(strategyId)
    const snap = await ref.get()
    if (!snap.exists) return
    const current = snap.data()!
    await ref.update({
      params: updates.params ?? current.params,
      symbols: updates.symbols ?? current.symbols,
      is_active: updates.is_active !== undefined ? updates.is_active : current.is_active,
      updated_at: new Date().toISOString(),
    })
    return
  }
  const db = getDb()
  const current = isPostgres
    ? (await (db as Pool).query("SELECT * FROM strategy_configs WHERE strategy_id=$1", [strategyId])).rows[0]
    : (db as any).prepare("SELECT * FROM strategy_configs WHERE strategy_id=?").get(strategyId) as any
  if (!current) return
  const params = updates.params ? JSON.stringify(updates.params) : current.params
  const symbols = updates.symbols ? JSON.stringify(updates.symbols) : current.symbols
  const active = updates.is_active !== undefined ? (updates.is_active ? 1 : 0) : current.is_active
  if (isPostgres) {
    await (db as Pool).query("UPDATE strategy_configs SET params=$1,symbols=$2,is_active=$3,updated_at=NOW() WHERE strategy_id=$4", [params, symbols, active, strategyId])
  } else {
    (db as any).prepare("UPDATE strategy_configs SET params=?,symbols=?,is_active=?,updated_at=datetime('now') WHERE strategy_id=?").run(params, symbols, active, strategyId)
  }
}

export async function setStrategyActive(strategyId: string, isActive: boolean): Promise<void> {
  if (isFirestore) {
    const db = await fsDb()
    const all = await db.collection("strategy_configs").get()
    const batch = db.batch()
    all.docs.forEach(d => batch.update(d.ref, { is_active: false, updated_at: new Date().toISOString() }))
    if (isActive) batch.update(db.collection("strategy_configs").doc(strategyId), { is_active: true, updated_at: new Date().toISOString() })
    await batch.commit()
    return
  }
  const db = getDb()
  if (isPostgres) {
    await (db as Pool).query("UPDATE strategy_configs SET is_active=0")
    if (isActive) await (db as Pool).query("UPDATE strategy_configs SET is_active=1,updated_at=NOW() WHERE strategy_id=$1", [strategyId])
  } else {
    (db as any).prepare("UPDATE strategy_configs SET is_active=0,updated_at=datetime('now')").run()
    if (isActive) (db as any).prepare("UPDATE strategy_configs SET is_active=1,updated_at=datetime('now') WHERE strategy_id=?").run(strategyId)
  }
}

// ─── portfolio_snapshots ──────────────────────────────────────────────────────

export async function insertPortfolioSnapshot(snapshot: any): Promise<void> {
  if (isFirestore) {
    const db = await fsDb()
    await db.collection("portfolio_snapshots").add({ ...snapshot, created_at: new Date().toISOString() })
    return
  }
  const db = getDb()
  if (isPostgres) {
    await (db as Pool).query(
      "INSERT INTO portfolio_snapshots (equity,cash,buying_power,portfolio_value,profit_loss,profit_loss_pct) VALUES ($1,$2,$3,$4,$5,$6)",
      [snapshot.equity, snapshot.cash, snapshot.buying_power || null, snapshot.portfolio_value || null, snapshot.profit_loss || null, snapshot.profit_loss_pct || null]
    )
  } else {
    (db as any).prepare("INSERT INTO portfolio_snapshots (equity,cash,buying_power,portfolio_value,profit_loss,profit_loss_pct) VALUES (@equity,@cash,@buying_power,@portfolio_value,@profit_loss,@profit_loss_pct)").run(snapshot)
  }
}

export async function getPortfolioSnapshots(limit = 200): Promise<any[]> {
  if (isFirestore) {
    const db = await fsDb()
    const snap = await db.collection("portfolio_snapshots").orderBy("created_at", "asc").limit(limit).get()
    return snap.docs.map(d => ({ id: d.id, ...d.data() }))
  }
  const db = getDb()
  if (isPostgres) return (await (db as Pool).query("SELECT * FROM portfolio_snapshots ORDER BY created_at ASC LIMIT $1", [limit])).rows
  return (db as any).prepare("SELECT * FROM portfolio_snapshots ORDER BY created_at ASC LIMIT ?").all(limit)
}

// ─── trade_signals ────────────────────────────────────────────────────────────

export async function insertTradeSignal(signal: any): Promise<void> {
  if (isFirestore) {
    const db = await fsDb()
    await db.collection("trade_signals").add({ ...signal, was_executed: Boolean(signal.was_executed), created_at: new Date().toISOString() })
    return
  }
  const db = getDb()
  if (isPostgres) {
    await (db as Pool).query(
      "INSERT INTO trade_signals (strategy_id,symbol,action,qty,reason,confidence,price_at_signal,was_executed) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
      [signal.strategy_id, signal.symbol, signal.action, signal.qty, signal.reason || null, signal.confidence || null, signal.price_at_signal || null, signal.was_executed ? 1 : 0]
    )
  } else {
    (db as any).prepare("INSERT INTO trade_signals (strategy_id,symbol,action,qty,reason,confidence,price_at_signal,was_executed) VALUES (@strategy_id,@symbol,@action,@qty,@reason,@confidence,@price_at_signal,@was_executed)").run({ ...signal, was_executed: signal.was_executed ? 1 : 0 })
  }
}

export async function getTradeSignals(limit = 100): Promise<any[]> {
  if (isFirestore) {
    const db = await fsDb()
    const snap = await db.collection("trade_signals").orderBy("created_at", "desc").limit(limit).get()
    return snap.docs.map(d => ({ id: d.id, ...d.data() }))
  }
  const db = getDb()
  if (isPostgres) return (await (db as Pool).query("SELECT * FROM trade_signals ORDER BY created_at DESC LIMIT $1", [limit])).rows
  return (db as any).prepare("SELECT * FROM trade_signals ORDER BY created_at DESC LIMIT ?").all(limit)
}

// ─── telegram_chats ───────────────────────────────────────────────────────────

export async function upsertTelegramChat(chatId: string, username?: string): Promise<void> {
  if (isFirestore) {
    const db = await fsDb()
    await db.collection("telegram_chats").doc(chatId).set({ chat_id: chatId, username: username || null, created_at: new Date().toISOString() }, { merge: true })
    return
  }
  const db = getDb()
  if (isPostgres) {
    await (db as Pool).query(
      "INSERT INTO telegram_chats (chat_id,username) VALUES ($1,$2) ON CONFLICT (chat_id) DO UPDATE SET username=EXCLUDED.username",
      [chatId, username || null]
    )
  } else {
    (db as any).prepare("INSERT OR REPLACE INTO telegram_chats (chat_id,username) VALUES (?,?)").run(chatId, username || null)
  }
}

export async function getAllTelegramChats(): Promise<string[]> {
  if (isFirestore) {
    const db = await fsDb()
    const snap = await db.collection("telegram_chats").get()
    return snap.docs.map(d => d.id)
  }
  const db = getDb()
  const rows = isPostgres
    ? (await (db as Pool).query("SELECT chat_id FROM telegram_chats")).rows
    : (db as any).prepare("SELECT chat_id FROM telegram_chats").all() as any[]
  return rows.map((r: any) => r.chat_id)
}
