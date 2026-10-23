-- Strategy research: a weekly GitHub Actions job (.github/workflows/strategy-research.yml)
-- backtests a library of rule families on a fresh year of Deriv candles and records
-- any candidate that beats the live strategy for an instrument. Esi reads these,
-- has DeepSeek explain each one from its numbers, and alerts the admin.
-- Suggestions are never applied automatically.

create table if not exists public.strategy_research_runs (
  id uuid primary key default gen_random_uuid(),
  run_at timestamptz not null default now(),
  data_from timestamptz,
  data_to timestamptz,
  configs_tested int not null default 0,
  -- Per instrument: the incumbent's numbers and the best candidate tested, pass or not.
  summary jsonb not null default '{}'::jsonb
);

create table if not exists public.strategy_suggestions (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.strategy_research_runs(id) on delete cascade,
  instrument text not null,
  family text not null,
  params jsonb not null,
  candidate jsonb not null,        -- full / train / holdout stats, luck share
  incumbent jsonb,                 -- same for the live strategy; null when the instrument has none
  reason text,                     -- written by Esi (DeepSeek, from the numbers)
  status text not null default 'new' check (status in ('new', 'reviewed', 'rejected', 'adopted')),
  created_at timestamptz not null default now()
);
create index if not exists strategy_suggestions_run_idx on public.strategy_suggestions (run_id);

alter table public.strategy_research_runs enable row level security;
alter table public.strategy_suggestions enable row level security;

create policy "Admins can read research runs" on public.strategy_research_runs
  for select using (exists (select 1 from public.user_settings s where s.user_id = auth.uid() and s.is_admin = true));
create policy "Admins can read suggestions" on public.strategy_suggestions
  for select using (exists (select 1 from public.user_settings s where s.user_id = auth.uid() and s.is_admin = true));
-- Writes only with the secret key (the research job and the ai-employees function).

insert into public.ai_employees (id, name, role_title, description, display_order) values
  ('esi', 'Esi', 'Strategy Research',
   'Reads the weekly strategy research run: rule families backtested on a fresh year of data. Suggests a strategy only when it beats the live one on holdout R, win rate and drawdown and passes the luck test, and explains why.',
   5)
on conflict (id) do nothing;

insert into public.ai_employee_activity (employee_id, status) values ('esi', 'idle')
on conflict (employee_id) do nothing;
