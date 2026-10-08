-- Ama: verify the hourly signal-engine job itself, not only Telegram delivery.

-- 1. Health of the 'signal-engine-hourly' job for Ama's report.
--    cron.job_run_details only says the database fired the request; what the
--    engine answered is in pg_net's response log, which is kept for ~6 hours.
--    Each hourly run is matched to the responses logged in the 15 seconds after
--    it fired (the 5-minute outcome check fires in the same second, so a run
--    counts as answered only by a response carrying "signals_generated").
create or replace function public.signal_engine_cron_health()
returns table (
  job_active boolean,
  fired_24h int,
  failed_24h int,
  last_fired timestamptz,
  http_checked int,
  http_ok int,
  http_with_errors int,
  http_timed_out int,
  http_failed int,
  http_missing int
)
language sql security definer set search_path = public, cron, net, pg_catalog as $$
  with job as (
    select jobid, active from cron.job where jobname = 'signal-engine-hourly'
  ),
  runs as (
    select d.start_time, d.status
    from cron.job_run_details d join job using (jobid)
    where d.start_time > now() - interval '24 hours'
  ),
  -- Runs old enough to have finished and recent enough to still be in the response log.
  recent as (
    select start_time from runs
    where start_time > now() - interval '5 hours 30 minutes'
      and start_time < now() - interval '2 minutes'
  ),
  matched as (
    select
      r.start_time,
      coalesce(bool_or(h.status_code = 200 and h.content like '%signals_generated%'), false) as ok,
      coalesce(bool_or(h.status_code = 200 and h.content like '%signals_generated%' and h.content like '%"errors"%'), false) as with_errors,
      coalesce(bool_or(h.timed_out), false) as timed_out,
      coalesce(bool_or(h.status_code >= 400), false) as failed
    from recent r
    left join net._http_response h
      on h.created between r.start_time and r.start_time + interval '15 seconds'
    group by r.start_time
  )
  select
    coalesce((select active from job), false),
    (select count(*)::int from runs),
    (select count(*)::int from runs where status <> 'succeeded'),
    (select max(start_time) from runs),
    (select count(*)::int from matched),
    (select count(*)::int from matched where ok),
    (select count(*)::int from matched where with_errors),
    (select count(*)::int from matched where not ok and timed_out),
    (select count(*)::int from matched where not ok and not timed_out and failed),
    (select count(*)::int from matched where not ok and not timed_out and not failed);
$$;
revoke all on function public.signal_engine_cron_health() from public, anon, authenticated;
grant execute on function public.signal_engine_cron_health() to service_role;

-- 2. The engine normally answers in 16-18s; the job's 30s limit has already
--    been hit. Give it the same 120s the AI-employees job has.
select cron.alter_job(
  jobid,
  command := replace(command, 'timeout_milliseconds := 30000', 'timeout_milliseconds := 120000')
)
from cron.job
where jobname = 'signal-engine-hourly';

-- 3. Description matches what Ama now checks.
update public.ai_employees
  set description = 'Checks the last 24h: the hourly signal-engine job ran and answered, and every engine signal at or above the user''s confidence threshold reached Telegram.'
  where id = 'ama';
