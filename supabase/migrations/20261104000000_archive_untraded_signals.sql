-- Signal history keeps only instruments and strategies traded today, so its stats
-- describe what users can actually take. Removed rows are kept in the archive table.
--   Untraded instruments: V25, V50, V100.
--   Retired strategies: breakout, trend_continuation, gem_v10_donchian,
--   gem_boom1000_momentum, gem_gbpjpy_momentum.
begin;

create table if not exists public.generated_signals_archive (like public.generated_signals including all);
alter table public.generated_signals_archive add column if not exists archived_at timestamptz not null default now();
alter table public.generated_signals_archive enable row level security;

with gone as (
  delete from public.generated_signals
  where shadow = false
    and (instrument in ('V25', 'V50', 'V100')
      or setup_type in ('breakout', 'trend_continuation', 'gem_v10_donchian', 'gem_boom1000_momentum', 'gem_gbpjpy_momentum'))
  returning *
)
insert into public.generated_signals_archive select *, now() from gone;

commit;
