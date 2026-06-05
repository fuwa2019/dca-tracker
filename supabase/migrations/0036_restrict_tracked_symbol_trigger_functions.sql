-- DCA Tracker - tracked-symbol trigger functions are internal entry points.
-- They run from table triggers and should not be directly executable via API roles.

revoke all on function public._track_transaction_symbol()
from public, anon, authenticated;

revoke all on function public._track_settings_symbols()
from public, anon, authenticated;

revoke all on function public._track_market_data_symbol()
from public, anon, authenticated;

grant execute on function public._track_transaction_symbol()
to service_role;

grant execute on function public._track_settings_symbols()
to service_role;

grant execute on function public._track_market_data_symbol()
to service_role;
