-- The 5-minute outcome check ran at :00 beside the hourly engine (which checks outcomes
-- itself) with a 15s timeout, and timed out now and then. Skip :00 and allow 60s.
select cron.schedule(
  'signal-outcome-check-5min',
  '5-55/5 * * * *',
  $$
  select net.http_post(
    url := 'https://xnqxrcpikburmyejdqvx.supabase.co/functions/v1/signal-engine',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-engine-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'signal_engine_secret')
    ),
    body := jsonb_build_object('action', 'check_outcomes'),
    timeout_milliseconds := 60000
  );
  $$
);

-- EUR/USD SMC 62778685 was closed by hand on 2026-11-05 at 1.1256 before manual closes
-- stored pips and R: fill 1.11914, stop 1.1135, so +64.6 pips = +1.15R.
update public.generated_signals
set actual_pnl_pips = 64.6,
    r_multiple = 1.15,
    duration_minutes = 4365
where id = '62778685-3491-4474-917c-94df65ba896b' and r_multiple is null;
