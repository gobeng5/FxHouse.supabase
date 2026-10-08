-- Ama on her own every 6 hours, so every engine answer is checked before
-- pg_net's ~6h response log drops it. The 06:30 slot is the full team's daily
-- run ('ai-employees-daily'), which already includes her.
-- An Ama-only run messages the admin on Telegram straight away when it finds a problem.
select cron.schedule(
  'ai-employees-ama-6h',
  '30 0,12,18 * * *',
  $cron$
  select net.http_post(
    url := 'https://xnqxrcpikburmyejdqvx.supabase.co/functions/v1/ai-employees',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'ai_employees_cron_secret')
    ),
    body := '{"employee":"ama"}'::jsonb,
    timeout_milliseconds := 120000
  );
  $cron$
);
