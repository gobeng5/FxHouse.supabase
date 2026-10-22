-- Trading balance (USD) the user sizes positions from: with risk_percent_per_trade
-- it sets the suggested lot size on signal cards and in Telegram alerts.
-- Null = not set; no lot size is suggested.
alter table public.user_settings
  add column if not exists account_balance numeric
    check (account_balance is null or account_balance > 0);
