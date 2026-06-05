-- DCA Tracker - keep tracked_symbols helper private while allowing triggers
-- fired by authenticated table writes to update the registry.

alter function public._upsert_tracked_symbol(text, text, text, text, date)
    security definer;
alter function public._upsert_tracked_symbol(text, text, text, text, date)
    set search_path = public;

revoke all on function public._upsert_tracked_symbol(text, text, text, text, date)
from public, anon, authenticated;

alter function public.add_tracked_symbol(text, text, text, text, date)
    security definer;
alter function public.add_tracked_symbol(text, text, text, text, date)
    set search_path = public;

revoke all on function public.add_tracked_symbol(text, text, text, text, date)
from public, anon;
grant execute on function public.add_tracked_symbol(text, text, text, text, date)
to authenticated, service_role;

alter function public._track_transaction_symbol()
    security definer;
alter function public._track_transaction_symbol()
    set search_path = public;

alter function public._track_settings_symbols()
    security definer;
alter function public._track_settings_symbols()
    set search_path = public;

alter function public._track_market_data_symbol()
    security definer;
alter function public._track_market_data_symbol()
    set search_path = public;
