ALTER TABLE public.generated_signals
  ADD COLUMN IF NOT EXISTS effective_entry numeric,
  ADD COLUMN IF NOT EXISTS spread_applied numeric;

ALTER TABLE public.trades
  ADD COLUMN IF NOT EXISTS effective_entry numeric,
  ADD COLUMN IF NOT EXISTS spread_applied numeric;