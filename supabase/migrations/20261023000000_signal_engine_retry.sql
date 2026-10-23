-- Backup run for the hourly signal engine.
--
-- On 2026-10-23 the 13:00 run got "503 upstream connect error" from the gateway, so
-- that hour's setups (a V10 gem) were never issued. Five minutes past each hour this
-- job fires the engine again, but only when the :00 run has no successful answer
-- logged. A second run inside the hour is safe: the engine skips setups it already
-- issued (trigger-candle and same-setup duplicate checks), and the gems and SMC
-- still see the same closed trigger candle until the hour ends.

select cron.schedule(
  'signal-engine-retry',
  '5 * * * *',
  $cron$
  select net.http_post(
    url := 'https://xnqxrcpikburmyejdqvx.supabase.co/functions/v1/signal-engine',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-engine-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'signal_engine_secret')
    ),
    body := jsonb_build_object('action', 'analyze'),
    timeout_milliseconds := 120000
  )
  where not exists (
    select 1 from net._http_response r
    where r.created >= date_trunc('hour', now())
      and r.status_code = 200
      and r.content like '%signals_generated%'
  );
  $cron$
);
