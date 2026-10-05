-- AI Employees: Boss, Kofi, Ama, Yaw, Kobby
-- Admin-only visibility, service-role-only writes (the ai-employees edge
-- function writes; nobody else should).

-- 1. Admin flag on user_settings
alter table public.user_settings
  add column if not exists is_admin boolean not null default false;

-- 2. Employee roster
create table if not exists public.ai_employees (
  id text primary key,                 -- 'boss' | 'kofi' | 'ama' | 'yaw' | 'kobby'
  name text not null,
  role_title text not null,
  description text not null,
  display_order int not null default 0,
  created_at timestamptz not null default now()
);

insert into public.ai_employees (id, name, role_title, description, display_order) values
  ('boss',  'Boss',  'Oversight',       'Reads everyone''s latest reports and sends you one consolidated digest.', 0),
  ('kofi',  'Kofi',  'Security',        'Runs security checks: RLS policy audit, Telegram auth smoke test, config hygiene.', 1),
  ('ama',   'Ama',   'Signal QA',       'Confirms signal generation ran as expected and that Telegram delivery is not silently failing.', 2),
  ('yaw',   'Yaw',   'Market Research', 'Tracks volatility and spike-rate shifts per instrument using real computed stats.', 3),
  ('kobby', 'Kobby', 'Economic News',   'Checks the economic calendar for upcoming high-impact events and their likely market effect.', 4)
on conflict (id) do nothing;

-- 3. Live "desk" status — one row per employee, updated in place.
create table if not exists public.ai_employee_activity (
  employee_id text primary key references public.ai_employees(id),
  status text not null default 'idle',        -- 'idle' | 'working' | 'done' | 'error'
  current_task text,
  last_report text,
  started_at timestamptz,
  updated_at timestamptz not null default now()
);

insert into public.ai_employee_activity (employee_id, status)
  select id, 'idle' from public.ai_employees
on conflict (employee_id) do nothing;

-- 4. Historical log, so Boss can read others' recent history.
create table if not exists public.ai_employee_logs (
  id uuid primary key default gen_random_uuid(),
  employee_id text not null references public.ai_employees(id),
  task text not null,
  status text not null,            -- 'done' | 'error'
  output text,
  created_at timestamptz not null default now()
);
create index if not exists ai_employee_logs_employee_created_idx
  on public.ai_employee_logs (employee_id, created_at desc);

-- 5. RLS: admin-only reads; writes only via service role (edge function).
alter table public.ai_employees enable row level security;
alter table public.ai_employee_activity enable row level security;
alter table public.ai_employee_logs enable row level security;

create policy "Admins can read employees" on public.ai_employees
  for select using (
    exists (select 1 from public.user_settings s where s.user_id = auth.uid() and s.is_admin = true)
  );

create policy "Admins can read activity" on public.ai_employee_activity
  for select using (
    exists (select 1 from public.user_settings s where s.user_id = auth.uid() and s.is_admin = true)
  );

create policy "Admins can read logs" on public.ai_employee_logs
  for select using (
    exists (select 1 from public.user_settings s where s.user_id = auth.uid() and s.is_admin = true)
  );

-- No insert/update/delete policies for any role except service_role (which
-- bypasses RLS entirely) — regular users, including admins, cannot write to
-- these tables directly, only the ai-employees edge function can.

-- 6. Helper RPCs the edge function uses (service-role only; SECURITY DEFINER
-- so they can see system catalogs/net schema that PostgREST doesn't expose).

create or replace function public.security_rls_audit()
returns table (table_name text, rls_enabled boolean, policy_count bigint)
language sql security definer set search_path = public, pg_catalog as $$
  select c.relname::text,
         c.relrowsecurity,
         (select count(*) from pg_policy p where p.polrelid = c.oid)
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
  order by c.relname;
$$;
revoke all on function public.security_rls_audit() from public, anon, authenticated;
grant execute on function public.security_rls_audit() to service_role;

create or replace function public.recent_telegram_http_responses(lookback_minutes int default 180)
returns table (id bigint, status_code int, timed_out boolean, created timestamptz)
language sql security definer set search_path = public, net, pg_catalog as $$
  select r.id, r.status_code, r.timed_out, r.created
  from net._http_response r
  where r.created > now() - make_interval(mins => lookback_minutes)
  order by r.created desc
  limit 50;
$$;
revoke all on function public.recent_telegram_http_responses(int) from public, anon, authenticated;
grant execute on function public.recent_telegram_http_responses(int) to service_role;

-- 7. Flag your own account as admin — replace with your actual user_id.
-- update public.user_settings set is_admin = true where user_id = 'f03e9cc3-f603-4a55-ae82-101be01c88b9';