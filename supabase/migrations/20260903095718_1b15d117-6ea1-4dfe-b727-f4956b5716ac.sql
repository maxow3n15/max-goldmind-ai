-- lovable-cron-fallback-reviewed: 1440 runs/day; pre-existing autopilot tick cadence, unchanged by this migration — it only removes the plaintext secret from the job command.
-- Phase 0: rotate the scheduler shared secret out of version control.
--
-- The previous value was embedded as a literal in two committed migrations and
-- in the cron job's own command text. Both exposures are removed here:
--   * a fresh value is generated inside the database (never in a file),
--   * the job reads it from Vault at execution time,
--   * the application verifies it through a security-definer function.

create extension if not exists supabase_vault with schema vault;

do $$
declare
  v_id uuid;
  v_new text := encode(gen_random_bytes(32), 'hex');
begin
  select id into v_id from vault.secrets where name = 'autopilot_cron_secret';
  if v_id is null then
    perform vault.create_secret(v_new, 'autopilot_cron_secret',
      'GoldMind autopilot scheduled tick shared secret. Rotate with vault.update_secret.');
  else
    perform vault.update_secret(v_id, v_new);
  end if;
end $$;

create or replace function public.verify_cron_secret(_provided text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, vault
as $$
declare
  v_secret text;
begin
  if _provided is null or length(_provided) = 0 then
    return false;
  end if;
  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'autopilot_cron_secret';
  if v_secret is null then
    return false;
  end if;
  -- Fixed-length digest comparison: neither length nor content is leaked by
  -- how long the comparison takes.
  return md5(v_secret) = md5(_provided);
end;
$$;

revoke all on function public.verify_cron_secret(text) from public;
revoke all on function public.verify_cron_secret(text) from anon;
revoke all on function public.verify_cron_secret(text) from authenticated;
grant execute on function public.verify_cron_secret(text) to service_role;

-- Re-schedule the tick so the job command no longer contains the secret.
select cron.unschedule('goldmind-autopilot-tick')
where exists (select 1 from cron.job where jobname = 'goldmind-autopilot-tick');

select cron.schedule(
  'goldmind-autopilot-tick',
  '* * * * *',
  $job$
  select extensions.http_post(
    url := 'https://project--e6af7af9-9ab4-44c0-b52b-fe50f301646e.lovable.app/api/public/cron/tick',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'autopilot_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  );
  $job$
);