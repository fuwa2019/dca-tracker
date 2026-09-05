-- Validate an imported ledger after the full batch is present.
--
-- The transactions table stores a trade date, not an intraday execution time.
-- A row-level trigger cannot safely validate a same-day buy/sell pair while the
-- other row is still being inserted. During the authenticated import wrapper,
-- defer the row-level check and validate each ticker's running position after
-- netting all trades on each date. Manual writes keep the strict trigger.

create or replace function public._validate_import_transaction_timelines(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_day record;
    v_running numeric := 0;
    v_ticker text := null;
begin
    for v_day in
        select
            upper(ticker) as ticker,
            trade_date,
            coalesce(sum(case when side = 'buy' then shares else -shares end), 0) as net_change
        from public.transactions
        where user_id = p_user_id
        group by upper(ticker), trade_date
        order by upper(ticker), trade_date
    loop
        if v_ticker is distinct from v_day.ticker then
            v_ticker := v_day.ticker;
            v_running := 0;
        end if;

        v_running := v_running + v_day.net_change;
        if v_running < -1e-9 then
            raise exception
                'import would create negative shares: ticker=%, date=%, net_change=%, running=%',
                v_day.ticker, v_day.trade_date, v_day.net_change, v_running
                using errcode = '23514';
        end if;
    end loop;
end;
$$;

revoke all on function public._validate_import_transaction_timelines(uuid)
    from public, anon, authenticated;

do $$
declare
    v_def text;
    v_next text;
    v_old text := $patch$begin
    if tg_op = 'INSERT' then$patch$;
    v_new text := $patch$begin
    if current_setting('dca.import_portfolio_ledger', true) = '1' then
        if tg_op = 'DELETE' then
            return old;
        end if;
        return new;
    end if;

    if tg_op = 'INSERT' then$patch$;
begin
    select pg_get_functiondef('public._check_sell_shares()'::regprocedure)
    into v_def;

    if v_def is null then
        raise exception '_check_sell_shares is missing';
    end if;
    if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then
        raise exception 'unexpected sell-check function contract';
    end if;

    v_next := replace(v_def, v_old, v_new);
    execute v_next;
end;
$$;

do $$
declare
    v_def text;
    v_next text;
    v_marker text := '    return jsonb_build_object(';
begin
    select pg_get_functiondef(
        'public._import_portfolio_ledger_legacy(text,jsonb,jsonb,text)'::regprocedure
    ) into v_def;

    if v_def is null then
        raise exception '_import_portfolio_ledger_legacy is missing';
    end if;
    if (length(v_def) - length(replace(v_def, v_marker, ''))) / length(v_marker) <> 1 then
        raise exception 'unexpected import function return contract';
    end if;

    v_next := replace(
        v_def,
        v_marker,
        '    perform public._validate_import_transaction_timelines(v_user_id);' || chr(10) || chr(10) || v_marker
    );
    execute v_next;
end;
$$;
