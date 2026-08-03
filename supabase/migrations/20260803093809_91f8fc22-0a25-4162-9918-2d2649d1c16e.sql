CREATE TABLE public.challenge_profiles (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  broker_connection_id uuid REFERENCES public.broker_connections(id) ON DELETE SET NULL,
  label text NOT NULL DEFAULT 'Challenge Account',
  provider text NOT NULL DEFAULT 'custom',
  preset_key text NOT NULL DEFAULT 'custom',
  phase text NOT NULL DEFAULT 'evaluation_1',
  account_size numeric NOT NULL DEFAULT 100000,
  currency text NOT NULL DEFAULT 'USD',
  profit_target_pct numeric NOT NULL DEFAULT 8,
  daily_loss_limit_pct numeric NOT NULL DEFAULT 5,
  max_drawdown_pct numeric NOT NULL DEFAULT 10,
  drawdown_type text NOT NULL DEFAULT 'static',
  drawdown_basis text NOT NULL DEFAULT 'equity',
  daily_loss_basis text NOT NULL DEFAULT 'balance',
  consistency_rule_pct numeric,
  min_trading_days integer NOT NULL DEFAULT 0,
  max_trading_days integer,
  news_restriction_minutes integer NOT NULL DEFAULT 0,
  weekend_holding_allowed boolean NOT NULL DEFAULT true,
  overnight_holding_allowed boolean NOT NULL DEFAULT true,
  max_lot_size numeric,
  daily_reset_utc_hour integer NOT NULL DEFAULT 0,
  start_balance numeric NOT NULL DEFAULT 100000,
  start_at timestamp with time zone NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'active',
  auto_enforce boolean NOT NULL DEFAULT true,
  safety_buffer_pct numeric NOT NULL DEFAULT 20,
  restrictions jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.challenge_profiles TO authenticated;
GRANT ALL ON public.challenge_profiles TO service_role;
ALTER TABLE public.challenge_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own challenge profiles" ON public.challenge_profiles FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_challenge_profiles_user ON public.challenge_profiles(user_id, status);

CREATE TABLE public.challenge_daily_stats (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES public.challenge_profiles(id) ON DELETE CASCADE,
  day date NOT NULL,
  start_equity numeric NOT NULL DEFAULT 0,
  peak_equity numeric NOT NULL DEFAULT 0,
  low_equity numeric NOT NULL DEFAULT 0,
  end_equity numeric NOT NULL DEFAULT 0,
  pnl numeric NOT NULL DEFAULT 0,
  trades integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (profile_id, day)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.challenge_daily_stats TO authenticated;
GRANT ALL ON public.challenge_daily_stats TO service_role;
ALTER TABLE public.challenge_daily_stats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own challenge daily stats" ON public.challenge_daily_stats FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_challenge_daily_profile ON public.challenge_daily_stats(profile_id, day DESC);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$
LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_challenge_profiles_updated_at BEFORE UPDATE ON public.challenge_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_challenge_daily_stats_updated_at BEFORE UPDATE ON public.challenge_daily_stats
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();