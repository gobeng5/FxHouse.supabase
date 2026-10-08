alter table public.generated_signals
  add column if not exists telegram_status text,
  add column if not exists telegram_message_id bigint,
  add column if not exists telegram_error text;

comment on column public.generated_signals.telegram_status is
  'Telegram delivery status: sent, failed, skipped, or null if not attempted';

comment on column public.generated_signals.telegram_message_id is
  'Telegram message_id returned by Telegram Bot API';

comment on column public.generated_signals.telegram_error is
  'Telegram delivery error returned by the sender';
