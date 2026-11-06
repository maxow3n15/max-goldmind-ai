ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS demo_confidence_floor integer;

ALTER TABLE public.user_settings
  DROP CONSTRAINT IF EXISTS user_settings_demo_confidence_floor_check;

ALTER TABLE public.user_settings
  ADD CONSTRAINT user_settings_demo_confidence_floor_check
  CHECK (demo_confidence_floor IS NULL OR (demo_confidence_floor >= 50 AND demo_confidence_floor <= 88));

COMMENT ON COLUMN public.user_settings.demo_confidence_floor IS
  'Confidence gate for paper and verified demo/practice broker accounts only. NULL = 88 (the live standard). Real-money live trading always uses 88 regardless of this value.';