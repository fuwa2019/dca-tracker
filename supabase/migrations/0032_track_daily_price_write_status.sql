-- DCA Tracker - daily-price writes always clear pending/missing backfill state.
--
-- Worker paths already patch tracked_symbols after a backfill. This trigger
-- keeps the registry correct for SQL maintenance and any future writer too.

create or replace function public._track_market_data_symbol()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    perform public._upsert_tracked_symbol(new.ticker, null, null, tg_table_name, null);
    if tg_table_name = 'daily_prices' then
        update public.tracked_symbols
        set
            backfill_status = 'ok',
            backfill_error = null,
            last_backfill_at = now(),
            updated_at = now()
        where symbol = public.normalize_symbol(new.ticker);
    end if;
    return new;
end;
$$;
