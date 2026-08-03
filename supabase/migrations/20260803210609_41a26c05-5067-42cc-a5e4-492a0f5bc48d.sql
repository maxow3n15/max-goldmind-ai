CREATE SCHEMA IF NOT EXISTS extensions;
DROP EXTENSION IF EXISTS pg_net;
CREATE EXTENSION pg_net WITH SCHEMA extensions;

SELECT cron.unschedule('goldmind-autopilot-tick')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'goldmind-autopilot-tick');

SELECT cron.schedule(
  'goldmind-autopilot-tick',
  '* * * * *',
  $$
  SELECT extensions.http_post(
    url := 'https://project--e6af7af9-9ab4-44c0-b52b-fe50f301646e.lovable.app/api/public/cron/tick',
    headers := '{"Content-Type": "application/json", "x-cron-secret": "4e870dac7c6ecbc704b0f6c567086fa42f089c3da99dcec0"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  );
  $$
);