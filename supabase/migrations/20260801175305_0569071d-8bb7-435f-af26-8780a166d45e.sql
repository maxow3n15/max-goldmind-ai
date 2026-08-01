CREATE TABLE public.decision_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  cycle_id text NOT NULL,
  decided_at timestamp with time zone NOT NULL DEFAULT now(),
  symbol text NOT NULL DEFAULT 'XAUUSD',
  timeframe text NOT NULL,
  outcome text NOT NULL,
  direction text,
  confidence numeric,
  technical_score numeric,
  news_score numeric,
  reasoning jsonb NOT NULL DEFAULT '[]'::jsonb,
  blockers jsonb NOT NULL DEFAULT '[]'::jsonb,
  price numeric,
  spread numeric,
  latency jsonb NOT NULL DEFAULT '{}'::jsonb,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT decision_logs_user_cycle_unique UNIQUE (user_id, cycle_id)
);

CREATE INDEX decision_logs_user_time_idx ON public.decision_logs (user_id, decided_at DESC);
CREATE INDEX decision_logs_user_outcome_idx ON public.decision_logs (user_id, outcome, decided_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.decision_logs TO authenticated;
GRANT ALL ON public.decision_logs TO service_role;

ALTER TABLE public.decision_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own decision logs" ON public.decision_logs
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);