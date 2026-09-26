ALTER TABLE public.generated_signals ADD COLUMN IF NOT EXISTS confluence_breakdown jsonb;
ALTER TABLE public.generated_signals ADD COLUMN IF NOT EXISTS confluence_score_total numeric;
ALTER TABLE public.generated_signals ADD COLUMN IF NOT EXISTS confluence_score_max numeric;