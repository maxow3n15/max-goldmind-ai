-- Execution modes, per-user webhook routing and advanced risk controls
ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS execution_mode text NOT NULL DEFAULT 'assisted',
  ADD COLUMN IF NOT EXISTS webhook_token text,
  ADD COLUMN IF NOT EXISTS webhook_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS max_risk_per_trade_pct numeric NOT NULL DEFAULT 0.5,
  ADD COLUMN IF NOT EXISTS max_total_exposure_lots numeric NOT NULL DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS max_correlated_trades integer NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS max_drawdown_pct numeric NOT NULL DEFAULT 10.0,
  ADD COLUMN IF NOT EXISTS cooldown_minutes integer NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS recovery_mode_enabled boolean NOT NULL DEFAULT true;

UPDATE public.user_settings SET webhook_token = encode(gen_random_bytes(24), 'hex') WHERE webhook_token IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS user_settings_webhook_token_idx ON public.user_settings (webhook_token);

-- Signals received from TradingView / external alert sources
CREATE TABLE public.webhook_signals (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source text NOT NULL DEFAULT 'tradingview',
  action text NOT NULL,
  symbol text NOT NULL DEFAULT 'XAUUSD',
  price numeric,
  stop_loss numeric,
  take_profit numeric,
  lot_size numeric,
  comment text,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'received',
  ai_verdict text,
  ai_confidence numeric,
  ai_reasoning jsonb NOT NULL DEFAULT '[]'::jsonb,
  error text,
  received_at timestamp with time zone NOT NULL DEFAULT now(),
  processed_at timestamp with time zone
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.webhook_signals TO authenticated;
GRANT ALL ON public.webhook_signals TO service_role;
ALTER TABLE public.webhook_signals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own webhook signals" ON public.webhook_signals
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX webhook_signals_user_time_idx ON public.webhook_signals (user_id, received_at DESC);

-- Stored backtest / walk-forward results
CREATE TABLE public.backtest_runs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label text NOT NULL DEFAULT 'Backtest',
  symbol text NOT NULL DEFAULT 'XAUUSD',
  timeframe text NOT NULL,
  bars integer NOT NULL DEFAULT 0,
  started_at timestamp with time zone,
  ended_at timestamp with time zone,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  equity_curve jsonb NOT NULL DEFAULT '[]'::jsonb,
  trades jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.backtest_runs TO authenticated;
GRANT ALL ON public.backtest_runs TO service_role;
ALTER TABLE public.backtest_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own backtest runs" ON public.backtest_runs
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX backtest_runs_user_time_idx ON public.backtest_runs (user_id, created_at DESC);