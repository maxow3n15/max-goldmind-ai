CREATE TABLE public.broker_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  broker_id text NOT NULL,
  label text,
  credentials_ciphertext text NOT NULL,
  status text NOT NULL DEFAULT 'disconnected',
  account_name text,
  account_number text,
  account_type text NOT NULL DEFAULT 'demo',
  currency text NOT NULL DEFAULT 'USD',
  balance numeric,
  equity numeric,
  free_margin numeric,
  margin_level numeric,
  open_positions integer NOT NULL DEFAULT 0,
  last_sync_at timestamptz,
  last_error text,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.broker_connections TO authenticated;
GRANT ALL ON public.broker_connections TO service_role;

ALTER TABLE public.broker_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own broker connections" ON public.broker_connections
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX broker_connections_user_idx ON public.broker_connections (user_id);

ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS trading_mode text NOT NULL DEFAULT 'paper';