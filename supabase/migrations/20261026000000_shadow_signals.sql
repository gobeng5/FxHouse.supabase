-- Shadow (forward-test) signals: candidate strategies run live for admins only,
-- alerted as "SHADOW TEST — do not trade", kept out of user lists and stats, and
-- skipped by the arbiter. Real signals keep shadow = false.
alter table public.generated_signals
  add column if not exists shadow boolean not null default false;
create index if not exists generated_signals_shadow_idx
  on public.generated_signals (shadow) where shadow;
