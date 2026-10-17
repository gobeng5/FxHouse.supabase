-- Telegram alert when a trade closes (target, stop or time exit).
--
-- Trades close in two places: the engine's 5-minute outcome check and the web
-- app's own check while it is open. A trigger on the row catches both, and asks
-- the engine to send the alert ('notify_close'), which claims the row first
-- (close_notified_at), so each trade is announced once even if it is reopened
-- by the app's audit and closed again.

-- 1. Delivery record for the close alert, like the open alert's telegram_* columns.
alter table public.generated_signals
  add column if not exists close_notified_at timestamptz,
  add column if not exists close_telegram_status text,
  add column if not exists close_telegram_message_id bigint,
  add column if not exists close_telegram_error text;

-- 2. Pending -> won / lost / breakeven: queue the alert. pg_net sends the request
--    after the transaction commits, so the engine reads the closed row.
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
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := jsonb_build_object('action', 'notify_close', 'id', new.id),
      timeout_milliseconds := 30000
    );
  end if;
  return new;
end;
$$;

drop trigger if exists generated_signals_notify_closed on public.generated_signals;
create trigger generated_signals_notify_closed
  after update of outcome on public.generated_signals
  for each row execute function public.notify_signal_closed();
