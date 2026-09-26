-- Create table for storing generated trade signals
CREATE TABLE public.generated_signals (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id),
  instrument TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('bullish', 'bearish', 'ranging')),
  trade_type TEXT NOT NULL CHECK (trade_type IN ('swing', 'day')),
  confidence INTEGER NOT NULL,
  setup_type TEXT,
  entry_price NUMERIC NOT NULL,
  stop_loss NUMERIC NOT NULL,
  take_profit_1 NUMERIC NOT NULL,
  take_profit_2 NUMERIC NOT NULL,
  take_profit_3 NUMERIC NOT NULL,
  reasoning TEXT,
  outcome TEXT CHECK (outcome IN ('pending', 'won', 'lost', 'breakeven', 'cancelled')),
  actual_exit_price NUMERIC,
  actual_pnl_pips NUMERIC,
  notes TEXT,
  session TEXT,
  generated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  closed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.generated_signals ENABLE ROW LEVEL SECURITY;

-- Create policies - signals can be viewed by anyone (for public history) but only modified by owner
CREATE POLICY "Anyone can view generated signals"
ON public.generated_signals
FOR SELECT
USING (true);

CREATE POLICY "Authenticated users can create signals"
ON public.generated_signals
FOR INSERT
WITH CHECK (auth.uid() = user_id OR user_id IS NULL);

CREATE POLICY "Users can update their own signals"
ON public.generated_signals
FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own signals"
ON public.generated_signals
FOR DELETE
USING (auth.uid() = user_id);

-- Create index for faster queries
CREATE INDEX idx_generated_signals_instrument ON public.generated_signals(instrument);
CREATE INDEX idx_generated_signals_outcome ON public.generated_signals(outcome);
CREATE INDEX idx_generated_signals_generated_at ON public.generated_signals(generated_at DESC);

-- Create trigger for updated_at
CREATE TRIGGER update_generated_signals_updated_at
BEFORE UPDATE ON public.generated_signals
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();