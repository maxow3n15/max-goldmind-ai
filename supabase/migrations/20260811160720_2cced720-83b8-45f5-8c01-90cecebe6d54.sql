CREATE TABLE public.ai_health_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source text NOT NULL DEFAULT 'analysis',
  model text,
  status text NOT NULL,
  attempts integer NOT NULL DEFAULT 1,
  timeouts integer NOT NULL DEFAULT 0,
  rate_limits integer NOT NULL DEFAULT 0,
  upstream_errors integer NOT NULL DEFAULT 0,
  empty_responses integer NOT NULL DEFAULT 0,
  parse_errors integer NOT NULL DEFAULT 0,
  validation_rejects integer NOT NULL DEFAULT 0,
  rejection_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  latency_ms integer,
  http_status integer,
  error text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX ai_health_events_user_created_idx ON public.ai_health_events (user_id, created_at DESC);

GRANT SELECT ON public.ai_health_events TO authenticated;
GRANT ALL ON public.ai_health_events TO service_role;

ALTER TABLE public.ai_health_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own ai health events read" ON public.ai_health_events
  FOR SELECT TO authenticated USING (auth.uid() = user_id);