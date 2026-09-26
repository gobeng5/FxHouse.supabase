
-- User settings table for risk controls and notification preferences
CREATE TABLE public.user_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE,
  -- Risk Controls
  risk_percent_per_trade NUMERIC NOT NULL DEFAULT 1.0,
  max_daily_loss_percent NUMERIC NOT NULL DEFAULT 5.0,
  max_drawdown_percent NUMERIC NOT NULL DEFAULT 15.0,
  max_trades_per_day INTEGER NOT NULL DEFAULT 10,
  auto_disable_on_drawdown BOOLEAN NOT NULL DEFAULT true,
  signals_paused BOOLEAN NOT NULL DEFAULT false,
  -- Telegram Notifications
  telegram_enabled BOOLEAN NOT NULL DEFAULT false,
  telegram_bot_token TEXT,
  telegram_chat_id TEXT,
  notify_min_confidence INTEGER NOT NULL DEFAULT 70,
  notify_instruments TEXT[] DEFAULT ARRAY[]::TEXT[],
  -- Forex-specific filters
  forex_min_rr NUMERIC NOT NULL DEFAULT 2.0,
  synthetic_min_rr NUMERIC NOT NULL DEFAULT 2.5,
  ignore_counter_trend BOOLEAN NOT NULL DEFAULT true,
  -- Engine settings
  auto_engine_enabled BOOLEAN NOT NULL DEFAULT true,
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own settings" ON public.user_settings FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own settings" ON public.user_settings FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own settings" ON public.user_settings FOR UPDATE USING (auth.uid() = user_id);

CREATE TRIGGER update_user_settings_updated_at
  BEFORE UPDATE ON public.user_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Daily performance tracking for risk controls
CREATE TABLE public.daily_performance (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  trade_date DATE NOT NULL DEFAULT CURRENT_DATE,
  signals_generated INTEGER NOT NULL DEFAULT 0,
  signals_won INTEGER NOT NULL DEFAULT 0,
  signals_lost INTEGER NOT NULL DEFAULT 0,
  total_r_multiple NUMERIC NOT NULL DEFAULT 0,
  daily_pnl_percent NUMERIC NOT NULL DEFAULT 0,
  max_drawdown_percent NUMERIC NOT NULL DEFAULT 0,
  signals_paused_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, trade_date)
);

ALTER TABLE public.daily_performance ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own performance" ON public.daily_performance FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own performance" ON public.daily_performance FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own performance" ON public.daily_performance FOR UPDATE USING (auth.uid() = user_id);

CREATE TRIGGER update_daily_performance_updated_at
  BEFORE UPDATE ON public.daily_performance
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Add r_multiple column to generated_signals for performance tracking
ALTER TABLE public.generated_signals ADD COLUMN IF NOT EXISTS r_multiple NUMERIC;
ALTER TABLE public.generated_signals ADD COLUMN IF NOT EXISTS risk_reward_ratio NUMERIC;
ALTER TABLE public.generated_signals ADD COLUMN IF NOT EXISTS duration_minutes INTEGER;
ALTER TABLE public.generated_signals ADD COLUMN IF NOT EXISTS engine_generated BOOLEAN DEFAULT false;

-- Enable pg_cron and pg_net extensions for scheduled execution
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
