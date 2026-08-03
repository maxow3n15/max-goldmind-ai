ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS kill_switch_active boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS kill_switch_reason text,
  ADD COLUMN IF NOT EXISTS kill_switch_since timestamptz;

ALTER TABLE public.trades
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'auto',
  ADD COLUMN IF NOT EXISTS environment text;

ALTER TABLE public.decision_logs
  ADD COLUMN IF NOT EXISTS environment text,
  ADD COLUMN IF NOT EXISTS environment_confidence numeric;

CREATE INDEX IF NOT EXISTS trades_user_source_idx ON public.trades (user_id, source);
CREATE INDEX IF NOT EXISTS trades_user_environment_idx ON public.trades (user_id, environment);
CREATE INDEX IF NOT EXISTS decision_logs_user_outcome_idx ON public.decision_logs (user_id, outcome, decided_at DESC);

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.unschedule('goldmind-autopilot-tick')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'goldmind-autopilot-tick');

SELECT cron.schedule(
  'goldmind-autopilot-tick',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--e6af7af9-9ab4-44c0-b52b-fe50f301646e.lovable.app/api/public/cron/tick',
    headers := '{"Content-Type": "application/json", "x-cron-secret": "4e870dac7c6ecbc704b0f6c567086fa42f089c3da99dcec0"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  );
  $$
);