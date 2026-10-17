-- signal-engine accepts only callers that send the shared secret.
--
-- The function runs with verify_jwt = false, so before this anyone with the URL
-- could run 'analyze' (fake signals, Telegram spam), 'reresolve' (rewrite trade
-- history) or 'notify_close'. Its only callers are the two cron jobs below and
-- the close-alert trigger; the web app never calls it.
--
-- The secret lives in Vault as 'signal_engine_secret' and as the function's
-- SIGNAL_ENGINE_SECRET secret. Both were created out of band so it never lands
-- in git:
--   select vault.create_secret('<random value>', 'signal_engine_secret');
--   supabase secrets set SIGNAL_ENGINE_SECRET=<same value>
--
-- This also takes the service-role key out of the hourly job's command, where it
-- sat in plain text.

select cron.alter_job(
  (select jobid from cron.job where jobname = 'signal-engine-hourly'),
  command := $cron$
  select net.http_post(
    url := 'https://xnqxrcpikburmyejdqvx.supabase.co/functions/v1/signal-engine',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-engine-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'signal_engine_secret')
    ),
    body := jsonb_build_object('action', 'analyze'),
    timeout_milliseconds := 120000
  );
  $cron$
);

select cron.alter_job(
  (select jobid from cron.job where jobname = 'signal-outcome-check-5min'),
  command := $cron$
  select net.http_post(
    url := 'https://xnqxrcpikburmyejdqvx.supabase.co/functions/v1/signal-engine',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-engine-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'signal_engine_secret')
    ),
    body := jsonb_build_object('action', 'check_outcomes'),
    timeout_milliseconds := 15000
  );
  $cron$
);

create or replace function public.notify_signal_closed()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if old.outcome = 'pending'
     and new.outcome in ('won', 'lost', 'breakeven')
     and new.close_notified_at is null then
    perform net.http_post(
      url := 'https://xnqxrcpikburmyejdqvx.supabase.co/functions/v1/signal-engine',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-engine-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'signal_engine_secret')
      ),
      body := jsonb_build_object('action', 'notify_close', 'id', new.id),
      timeout_milliseconds := 30000
    );
  end if;
  return new;
end;
$$;
