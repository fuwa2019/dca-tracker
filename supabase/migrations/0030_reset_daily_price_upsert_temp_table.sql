-- DCA Tracker - allow repeated daily-price upserts inside one transaction.
--
-- The Worker normally invokes each RPC in a separate HTTP transaction, but
-- operational scripts and future database callers may batch multiple calls.

create or replace function public.upsert_daily_prices(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_updated bigint := 0;
    v_inserted bigint := 0;
begin
    drop table if exists pg_temp.tmp_daily_prices_upsert;

    create temporary table tmp_daily_prices_upsert (
        ticker text not null,
        trade_date date not null,
        close numeric not null,
        adjusted_close numeric,
        source text,
        as_of_timestamp timestamptz not null,
        is_provisional boolean not null,
        updated_at timestamptz not null
    ) on commit drop;

    insert into tmp_daily_prices_upsert (
        ticker,
        trade_date,
        close,
        adjusted_close,
        source,
        as_of_timestamp,
        is_provisional,
        updated_at
    )
    select distinct on (ticker, trade_date)
        ticker,
        trade_date,
        close,
        adjusted_close,
        source,
        coalesce(as_of_timestamp, updated_at, now()),
        coalesce(is_provisional, false),
        coalesce(updated_at, now())
    from (
        select
            upper(trim(ticker)) as ticker,
            trade_date,
            close,
            adjusted_close,
            source,
            as_of_timestamp,
            is_provisional,
            updated_at
        from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r(
            ticker text,
            trade_date date,
            close numeric,
            adjusted_close numeric,
            source text,
            as_of_timestamp timestamptz,
            is_provisional boolean,
            updated_at timestamptz
        )
    ) parsed
    where ticker <> ''
      and trade_date is not null
      and close > 0
    order by ticker, trade_date, updated_at desc nulls last;

    update public.daily_prices dp
    set
        close = d.close,
        adjusted_close = d.adjusted_close,
        source = d.source,
        as_of_timestamp = d.as_of_timestamp,
        is_provisional = d.is_provisional,
        updated_at = d.updated_at
    from tmp_daily_prices_upsert d
    where dp.ticker = d.ticker
      and dp.trade_date = d.trade_date
      and (
        (dp.is_provisional and not d.is_provisional)
        or (
          dp.is_provisional = d.is_provisional
          and (
            dp.close is distinct from d.close
            or dp.adjusted_close is distinct from d.adjusted_close
            or dp.source is distinct from d.source
            or dp.as_of_timestamp is distinct from d.as_of_timestamp
          )
        )
      );

    get diagnostics v_updated = row_count;

    insert into public.daily_prices (
        ticker,
        trade_date,
        close,
        adjusted_close,
        source,
        as_of_timestamp,
        is_provisional,
        updated_at
    )
    select
        d.ticker,
        d.trade_date,
        d.close,
        d.adjusted_close,
        d.source,
        d.as_of_timestamp,
        d.is_provisional,
        d.updated_at
    from tmp_daily_prices_upsert d
    where not exists (
        select 1
        from public.daily_prices dp
        where dp.ticker = d.ticker
          and dp.trade_date = d.trade_date
    )
    on conflict (ticker, trade_date) do nothing;

    get diagnostics v_inserted = row_count;

    return jsonb_build_object(
        'ok', true,
        'updated', v_updated,
        'inserted', v_inserted,
        'rows', v_updated + v_inserted
    );
end;
$$;

revoke all on function public.upsert_daily_prices(jsonb) from public, anon, authenticated;
grant execute on function public.upsert_daily_prices(jsonb) to service_role;
