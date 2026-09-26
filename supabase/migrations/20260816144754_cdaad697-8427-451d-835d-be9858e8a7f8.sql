ALTER TABLE public.generated_signals ADD COLUMN IF NOT EXISTS resolution_method text;
ALTER TABLE public.trades ADD COLUMN IF NOT EXISTS resolution_method text;

UPDATE public.generated_signals SET resolution_method = 'tick' WHERE resolution_method IS NULL AND outcome IS NOT NULL AND outcome <> 'pending';
UPDATE public.trades SET resolution_method = 'tick' WHERE resolution_method IS NULL AND outcome IS NOT NULL AND outcome NOT IN ('PENDING','ACTIVE');

ALTER TABLE public.generated_signals DROP CONSTRAINT IF EXISTS generated_signals_resolution_method_check;
ALTER TABLE public.generated_signals ADD CONSTRAINT generated_signals_resolution_method_check CHECK (resolution_method IS NULL OR resolution_method IN ('tick','wick'));
ALTER TABLE public.trades DROP CONSTRAINT IF EXISTS trades_resolution_method_check;
ALTER TABLE public.trades ADD CONSTRAINT trades_resolution_method_check CHECK (resolution_method IS NULL OR resolution_method IN ('tick','wick'));