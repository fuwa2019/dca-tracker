-- DCA Tracker: service-role daily_prices upsert with an explicit UPDATE WHERE.

create or replace function public.upsert_daily_prices(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_rows bigint := 0;
begin
    with parsed as (
        select
            upper(trim(ticker)) as ticker,
            trade_date,
            close,
            adjusted_close,
            source,
            updated_at
        from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r(
            ticker text,
            trade_date date,
            close numeric,
            adjusted_close numeric,
            source text,
            updated_at timestamptz
        )
    ),
    filtered as (
        select *
        from parsed
        where ticker <> ''
          and trade_date is not null
          and close > 0
    ),
    deduped as (
        select distinct on (ticker, trade_date)
            ticker,
            trade_date,
            close,
            adjusted_close,
            source,
            updated_at
        from filtered
        order by ticker, trade_date, updated_at desc nulls last
    ),
    upserted as (
        insert into public.daily_prices (
            ticker,
            trade_date,
            close,
            adjusted_close,
            source,
            updated_at
        )
        select
            ticker,
            trade_date,
            close,
            adjusted_close,
            source,
            updated_at
        from deduped
        on conflict (ticker, trade_date) do update set
            close = excluded.close,
            adjusted_close = excluded.adjusted_close,
            source = excluded.source,
            updated_at = excluded.updated_at
        where public.daily_prices.close is distinct from excluded.close
           or public.daily_prices.adjusted_close is distinct from excluded.adjusted_close
           or public.daily_prices.source is distinct from excluded.source
           or public.daily_prices.updated_at is distinct from excluded.updated_at
        returning 1
    )
    select count(*) into v_rows
    from upserted;

    return jsonb_build_object('ok', true, 'rows', v_rows);
end;
$$;

revoke all on function public.upsert_daily_prices(jsonb) from public, anon, authenticated;
grant execute on function public.upsert_daily_prices(jsonb) to service_role;
