ALTER TABLE public.generated_signals
  ADD COLUMN IF NOT EXISTS atr_percentile_at_entry numeric,
  ADD COLUMN IF NOT EXISTS spread_multiplier_applied numeric;

ALTER TABLE public.trades
  ADD COLUMN IF NOT EXISTS atr_percentile_at_entry numeric,
  ADD COLUMN IF NOT EXISTS spread_multiplier_applied numeric;