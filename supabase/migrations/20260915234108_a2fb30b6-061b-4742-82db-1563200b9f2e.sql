ALTER TABLE public.user_settings ALTER COLUMN synthetic_min_rr SET DEFAULT 2.4;
UPDATE public.user_settings SET synthetic_min_rr = 2.4, updated_at = now() WHERE synthetic_min_rr = 2.5;