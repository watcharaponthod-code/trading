-- Trading Platform Database Schema

-- Trades table to store all executed trades
CREATE TABLE IF NOT EXISTS trades (
  id SERIAL PRIMARY KEY,
  symbol VARCHAR(20) NOT NULL,
  side VARCHAR(10) NOT NULL CHECK (side IN ('buy', 'sell')),
  qty DECIMAL(18, 8) NOT NULL,
  price DECIMAL(18, 8),
  order_id VARCHAR(100),
  status VARCHAR(20) DEFAULT 'pending',
  strategy_id VARCHAR(50),
  signal_reason TEXT,
  confidence DECIMAL(5, 4),
  pnl DECIMAL(18, 8),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  executed_at TIMESTAMP WITH TIME ZONE,
  filled_avg_price DECIMAL(18, 8),
  filled_qty DECIMAL(18, 8)
);

-- Strategy configurations table
CREATE TABLE IF NOT EXISTS strategy_configs (
  id SERIAL PRIMARY KEY,
  strategy_id VARCHAR(50) NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  symbols TEXT[] NOT NULL,
  params JSONB NOT NULL DEFAULT '{}',
  is_active BOOLEAN DEFAULT FALSE,
  auto_execute BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Portfolio snapshots for tracking performance over time
CREATE TABLE IF NOT EXISTS portfolio_snapshots (
  id SERIAL PRIMARY KEY,
  equity DECIMAL(18, 8) NOT NULL,
  cash DECIMAL(18, 8) NOT NULL,
  buying_power DECIMAL(18, 8),
  portfolio_value DECIMAL(18, 8),
  profit_loss DECIMAL(18, 8),
  profit_loss_pct DECIMAL(10, 6),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Trade signals log for analysis
CREATE TABLE IF NOT EXISTS trade_signals (
  id SERIAL PRIMARY KEY,
  strategy_id VARCHAR(50) NOT NULL,
  symbol VARCHAR(20) NOT NULL,
  action VARCHAR(10) NOT NULL CHECK (action IN ('buy', 'sell', 'hold')),
  qty DECIMAL(18, 8) NOT NULL,
  reason TEXT,
  confidence DECIMAL(5, 4),
  price_at_signal DECIMAL(18, 8),
  was_executed BOOLEAN DEFAULT FALSE,
  trade_id INTEGER REFERENCES trades(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_trades_created_at ON trades(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trades_symbol ON trades(symbol);
CREATE INDEX IF NOT EXISTS idx_trades_strategy ON trades(strategy_id);
CREATE INDEX IF NOT EXISTS idx_portfolio_created_at ON portfolio_snapshots(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_signals_created_at ON trade_signals(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_signals_strategy ON trade_signals(strategy_id);

-- Insert default strategies
INSERT INTO strategy_configs (strategy_id, name, description, symbols, params, is_active)
VALUES 
  ('stat_arb', 'Statistical Arbitrage', 'Exploits mean-reverting spread between two correlated assets using z-score analysis.', ARRAY['SPY', 'QQQ'], '{"period": 20, "zThreshold": 2.0, "qty": 1}', false),
  ('mean_reversion', 'Mean Reversion', 'Buys oversold and sells overbought conditions using Bollinger Bands + RSI confirmation.', ARRAY['AAPL', 'MSFT', 'GOOGL'], '{"period": 20, "bbMultiplier": 2.0, "rsiOversold": 30, "rsiOverbought": 70, "qty": 1}', false),
  ('momentum', 'EMA Momentum', 'Trades EMA crossovers to capture short-term momentum in trending assets.', ARRAY['TSLA', 'NVDA', 'AMD'], '{"fastPeriod": 10, "slowPeriod": 30, "qty": 1}', false),
  ('pairs_trading', 'Pairs Trading', 'Long/short pairs strategy on highly correlated stocks to capture convergence.', ARRAY['GLD', 'SLV'], '{"period": 30, "zThreshold": 1.8, "qty": 2}', false)
ON CONFLICT (strategy_id) DO NOTHING;
