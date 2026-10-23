-- Yaw now reports strategy health (live results vs each strategy's backtest band),
-- market regime per instrument, and feed anomalies; he alerts on Telegram when a
-- strategy falls below its band or a losing streak passes the backtest's worst.
update public.ai_employees
  set role_title = 'Strategy Health',
      description = 'Checks each live strategy against its backtest (95% band, losing streaks), the volatility regime of every traded instrument, and feed anomalies. Alerts on Telegram when a strategy is failing.'
  where id = 'yaw';
