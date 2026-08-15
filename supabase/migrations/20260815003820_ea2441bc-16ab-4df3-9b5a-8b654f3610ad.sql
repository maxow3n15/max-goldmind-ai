CREATE TABLE public.system_locks (
  key text PRIMARY KEY,
  locked_until timestamptz NOT NULL,
  holder text,
  acquired_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.system_locks TO service_role;

ALTER TABLE public.system_locks ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.try_acquire_lock(_key text, _ttl_seconds integer, _holder text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  got boolean := false;
BEGIN
  INSERT INTO public.system_locks (key, locked_until, holder, acquired_at)
  VALUES (_key, now() + make_interval(secs => _ttl_seconds), _holder, now())
  ON CONFLICT (key) DO UPDATE
    SET locked_until = now() + make_interval(secs => _ttl_seconds),
        holder = _holder,
        acquired_at = now()
    WHERE public.system_locks.locked_until < now()
  RETURNING true INTO got;
  RETURN COALESCE(got, false);
END;
$$;

CREATE OR REPLACE FUNCTION public.release_lock(_key text, _holder text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.system_locks WHERE key = _key AND holder = _holder;
$$;

REVOKE ALL ON FUNCTION public.try_acquire_lock(text, integer, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_lock(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.try_acquire_lock(text, integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_lock(text, text) TO service_role;