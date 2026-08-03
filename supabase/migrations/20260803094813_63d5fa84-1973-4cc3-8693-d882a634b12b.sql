ALTER TABLE public.trades
  ADD COLUMN IF NOT EXISTS mae numeric,
  ADD COLUMN IF NOT EXISTS mfe numeric,
  ADD COLUMN IF NOT EXISTS mae_r numeric,
  ADD COLUMN IF NOT EXISTS mfe_r numeric,
  ADD COLUMN IF NOT EXISTS excursion_updated_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS client_order_id text;

CREATE UNIQUE INDEX IF NOT EXISTS trades_user_client_order_id_key
  ON public.trades (user_id, client_order_id)
  WHERE client_order_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.engine_heartbeats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  engine text NOT NULL,
  status text NOT NULL DEFAULT 'ok',
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_beat_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (user_id, engine)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.engine_heartbeats TO authenticated;
GRANT ALL ON public.engine_heartbeats TO service_role;

ALTER TABLE public.engine_heartbeats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own heartbeats" ON public.engine_heartbeats
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END; $$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS update_engine_heartbeats_updated_at ON public.engine_heartbeats;
CREATE TRIGGER update_engine_heartbeats_updated_at
  BEFORE UPDATE ON public.engine_heartbeats
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();