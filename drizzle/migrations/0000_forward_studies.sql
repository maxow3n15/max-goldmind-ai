CREATE TABLE public.forward_studies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  broker_connection_id uuid NOT NULL,
  floor integer NOT NULL DEFAULT 88 CHECK (floor = 88),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','ended')),
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.forward_studies TO authenticated;
GRANT ALL ON public.forward_studies TO service_role;
ALTER TABLE public.forward_studies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own studies select" ON public.forward_studies FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own studies insert" ON public.forward_studies FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own studies update" ON public.forward_studies FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE UNIQUE INDEX forward_studies_one_open ON public.forward_studies(user_id) WHERE status <> 'ended';

ALTER TABLE public.trades ADD COLUMN IF NOT EXISTS study_id uuid;
ALTER TABLE public.decision_logs ADD COLUMN IF NOT EXISTS study_id uuid;
CREATE INDEX IF NOT EXISTS trades_study_idx ON public.trades(study_id);
CREATE INDEX IF NOT EXISTS decision_logs_study_idx ON public.decision_logs(study_id);

-- Stamp the active study onto every new decision/trade, regardless of code path.
CREATE OR REPLACE FUNCTION public.stamp_forward_study()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.study_id IS NULL THEN
    SELECT id INTO NEW.study_id FROM public.forward_studies
     WHERE user_id = NEW.user_id AND status = 'active' LIMIT 1;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trades_stamp_study BEFORE INSERT ON public.trades FOR EACH ROW EXECUTE FUNCTION public.stamp_forward_study();
CREATE TRIGGER decision_logs_stamp_study BEFORE INSERT ON public.decision_logs FOR EACH ROW EXECUTE FUNCTION public.stamp_forward_study();

-- While a study is open, the demo floor cannot be lowered: the study runs at 88%.
CREATE OR REPLACE FUNCTION public.lock_floor_during_study()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.demo_confidence_floor IS NOT NULL AND NEW.demo_confidence_floor < 88
     AND EXISTS (SELECT 1 FROM public.forward_studies WHERE user_id = NEW.user_id AND status <> 'ended') THEN
    RAISE EXCEPTION 'A forward study is running at the 88%% gate; end it before lowering the demo floor';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER user_settings_lock_floor BEFORE UPDATE ON public.user_settings FOR EACH ROW EXECUTE FUNCTION public.lock_floor_during_study();
REVOKE EXECUTE ON FUNCTION public.stamp_forward_study() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.lock_floor_during_study() FROM PUBLIC, anon, authenticated;