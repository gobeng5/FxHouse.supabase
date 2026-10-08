-- AI Employees: daily schedule, live desk updates, and honest role descriptions.

-- 1. Live desk status on the admin page. Realtime still applies the admin-only
--    SELECT policy, so only admins receive these changes.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'ai_employee_activity'
  ) then
    alter publication supabase_realtime add table public.ai_employee_activity;
  end if;
end $$;

-- 2. Descriptions now match what each employee actually checks.
update public.ai_employees
  set description = 'Runs security checks: RLS policy audit and failed or timed-out scheduled calls to the edge functions.'
  where id = 'kofi';
update public.ai_employees
  set description = 'Tracks ATR-percentile volatility shifts per instrument using real computed stats.'
  where id = 'yaw';

-- 3. Daily run at 06:30 UTC, ahead of the London open.
--    The function rejects callers without the shared secret, which lives in
--    Vault under the name 'ai_employees_cron_secret' (and as the function's
--    AI_EMPLOYEES_CRON_SECRET secret). It is created out of band so it never
--    lands in git:
--      select vault.create_secret('<random value>', 'ai_employees_cron_secret');
select cron.schedule(
  'ai-employees-daily',
  '30 6 * * *',
  $cron$
  select net.http_post(
    url := 'https://xnqxrcpikburmyejdqvx.supabase.co/functions/v1/ai-employees',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'ai_employees_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $cron$
);
