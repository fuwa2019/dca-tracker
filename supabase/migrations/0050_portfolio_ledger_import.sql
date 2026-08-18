-- Unified portfolio ledger fields and authenticated source-scoped import.
--
-- This migration is intentionally append-only and local until separately
-- authorized for a development or production Supabase project.

alter table public.cashflows
    add column if not exists effective_date date,
    add column if not exists ticker text,
    add column if not exists source_currency text,
    add column if not exists source_amount numeric(22, 10);

update public.cashflows
set effective_date = coalesce(effective_date, usd_in_date, cny_out_date)
where effective_date is null;

create or replace function public._set_cashflow_effective_date()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    if new.effective_date is null
       or (
           tg_op = 'UPDATE'
           and new.effective_date is not distinct from old.effective_date
           and (
               new.usd_in_date is distinct from old.usd_in_date
               or new.cny_out_date is distinct from old.cny_out_date
           )
       ) then
        new.effective_date := coalesce(new.usd_in_date, new.cny_out_date);
    end if;
    return new;
end;
$$;

revoke all on function public._set_cashflow_effective_date() from public, anon, authenticated;

drop trigger if exists cashflows_set_effective_date on public.cashflows;
create trigger cashflows_set_effective_date
before insert or update of cny_out_date, usd_in_date, effective_date
on public.cashflows
for each row execute function public._set_cashflow_effective_date();

alter table public.cashflows
    alter column effective_date set not null;

alter table public.cashflows
    drop constraint if exists cashflows_kind_fields_check,
    drop constraint if exists cashflows_source_amount_check;

alter table public.cashflows
    add constraint cashflows_kind_fields_check
    check (
        (
            cashflow_kind = 'fx_transfer'
            and (
                (cny_amount > 0 and target_rate > 0)
                or (cny_amount is null and target_rate is null and usd_amount is not null)
            )
        )
        or (
            cashflow_kind = 'broker_deposit'
            and cny_amount is null
            and target_rate is null
            and usd_amount > 0
        )
        or (
            cashflow_kind = 'broker_withdrawal'
            and cny_amount is null
            and target_rate is null
            and usd_amount < 0
        )
        or (
            cashflow_kind = 'stock_allocation'
            and cny_amount is null
            and target_rate is null
            and usd_amount < 0
        )
        or (
            cashflow_kind in ('dividend', 'interest')
            and cny_amount is null
            and target_rate is null
            and usd_amount <> 0
        )
        or (
            cashflow_kind in ('tax', 'fee')
            and cny_amount is null
            and target_rate is null
            and usd_amount < 0
        )
    ),
    add constraint cashflows_source_amount_check
    check (
        (source_amount is null or abs(source_amount) < 1000000000000)
        and (usd_amount is null or abs(usd_amount) < 1000000000000)
        and (source_amount is null or source_amount = round(source_amount, 10))
        and (usd_amount is null or usd_amount = round(usd_amount, 10))
    );

create index if not exists cashflows_user_source_date_idx
    on public.cashflows (user_id, import_source, effective_date desc);

create or replace function public._clear_cashflow_import_identity_on_edit()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    if new.cny_out_date is distinct from old.cny_out_date
       or new.usd_in_date is distinct from old.usd_in_date
       or new.effective_date is distinct from old.effective_date
       or new.ticker is distinct from old.ticker
       or new.source_currency is distinct from old.source_currency
       or new.source_amount is distinct from old.source_amount
       or new.usd_amount is distinct from old.usd_amount
       or new.cashflow_kind is distinct from old.cashflow_kind then
        new.import_source := null;
        new.import_key := null;
        new.source_action := null;
        new.source_description := null;
    end if;
    return new;
end;
$$;

revoke all on function public._clear_cashflow_import_identity_on_edit()
    from public, anon, authenticated;

drop trigger if exists cashflows_clear_import_identity on public.cashflows;
create trigger cashflows_clear_import_identity
before update of cny_out_date, usd_in_date, effective_date, ticker,
    source_currency, source_amount, usd_amount, cashflow_kind
on public.cashflows
for each row execute function public._clear_cashflow_import_identity_on_edit();

-- The live project currently lacks this trigger even though the cache-dirty
-- helper exists. Recreate the dependency explicitly so cash-only imports cannot
-- leave the public percentage cache looking current.
drop trigger if exists cashflows_invalidate_history_cache on public.cashflows;
create trigger cashflows_invalidate_history_cache
after insert or update or delete on public.cashflows
for each row execute function public._mark_performance_history_cache_dirty_for_row();

-- The private daily-PnL cache is intentionally read-only to authenticated
-- clients. Use a narrowly scoped owner-checked helper so the security-invoker
-- import RPC can invalidate the current user's private rows without granting
-- direct DELETE access to the cache table.
create or replace function public._clear_performance_daily_pnl_cache_for_user(
    p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if p_user_id is null or p_user_id is distinct from auth.uid() then
        raise exception 'not_authorized' using errcode = '42501';
    end if;

    delete from public.performance_daily_pnl_cache
    where user_id = p_user_id;
end;
$$;

revoke all on function public._clear_performance_daily_pnl_cache_for_user(uuid)
    from public, anon, authenticated;
grant execute on function public._clear_performance_daily_pnl_cache_for_user(uuid)
    to authenticated;

create or replace function public.import_portfolio_ledger(
    p_source text,
    p_trades jsonb,
    p_cash_events jsonb,
    p_mode text
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
    v_user_id uuid := auth.uid();
    v_source text := lower(trim(coalesce(p_source, '')));
    v_mode text := lower(trim(coalesce(p_mode, '')));
    v_row record;
    v_transactions_added integer := 0;
    v_transactions_unchanged integer := 0;
    v_transactions_removed integer := 0;
    v_cashflows_added integer := 0;
    v_cashflows_unchanged integer := 0;
    v_cashflows_removed integer := 0;
    v_funding_batches_removed integer := 0;
begin
    if v_user_id is null then
        raise exception 'not_authenticated' using errcode = '42501';
    end if;

    if v_source not in ('schwab', 'ibkr', 'tradingview') then
        raise exception 'invalid_import_source' using errcode = '22023';
    end if;

    if v_mode not in ('append', 'replace_source', 'reset_all') then
        raise exception 'invalid_import_mode' using errcode = '22023';
    end if;

    if jsonb_typeof(p_trades) is distinct from 'array' then
        raise exception 'trades_must_be_an_array' using errcode = '22023';
    end if;

    if jsonb_typeof(p_cash_events) is distinct from 'array' then
        raise exception 'cash_events_must_be_an_array' using errcode = '22023';
    end if;

    if jsonb_array_length(p_trades) + jsonb_array_length(p_cash_events) = 0 then
        raise exception 'import_requires_rows' using errcode = '22023';
    end if;

    if jsonb_array_length(p_trades) + jsonb_array_length(p_cash_events) > 10000 then
        raise exception 'too_many_import_rows' using errcode = '22023';
    end if;

    perform pg_advisory_xact_lock(hashtextextended(v_user_id::text, 0));

    create temporary table tmp_portfolio_ledger_trades (
        source_index integer not null,
        source text not null,
        effective_date date not null,
        side text not null,
        ticker text not null,
        shares numeric not null,
        price numeric not null,
        fees_usd numeric not null,
        usd_amount numeric not null,
        source_currency text not null,
        source_action text not null,
        source_description text,
        duplicate_ordinal integer not null,
        import_key text not null primary key,
        kind text not null
    ) on commit drop;

    insert into tmp_portfolio_ledger_trades (
        source_index,
        source,
        effective_date,
        side,
        ticker,
        shares,
        price,
        fees_usd,
        usd_amount,
        source_currency,
        source_action,
        source_description,
        duplicate_ordinal,
        import_key,
        kind
    )
    select
        row_data.source_index,
        coalesce(nullif(lower(trim(row_data.source)), ''), v_source),
        row_data.effective_date,
        lower(trim(row_data.side)),
        upper(trim(row_data.ticker)),
        row_data.shares,
        row_data.price,
        coalesce(row_data.fees_usd, 0),
        row_data.usd_amount,
        upper(coalesce(nullif(trim(row_data.source_currency), ''), 'USD')),
        regexp_replace(trim(coalesce(row_data.source_action, '')), '[[:space:]]+', ' ', 'g'),
        nullif(trim(row_data.source_description), ''),
        row_data.duplicate_ordinal,
        nullif(trim(row_data.import_key), ''),
        coalesce(nullif(lower(trim(row_data.kind)), ''), 'dca')
    from jsonb_to_recordset(p_trades) as row_data(
        source_index integer,
        source text,
        effective_date date,
        side text,
        ticker text,
        shares numeric,
        price numeric,
        fees_usd numeric,
        usd_amount numeric,
        source_currency text,
        source_action text,
        source_description text,
        duplicate_ordinal integer,
        import_key text,
        kind text
    );

    if exists (
        select 1
        from tmp_portfolio_ledger_trades
        where source <> v_source
           or source_index <= 0
           or effective_date is null
           or side not in ('buy', 'sell')
           or ticker !~ '^[A-Z0-9.^-]{1,15}$'
           or source_currency <> 'USD'
           or shares <= 0
           or price <= 0
           or fees_usd < 0
           or abs(usd_amount) >= 1000000000000
           or shares >= 100000000
           or price >= 10000000000
           or fees_usd >= 1000000000000
           or usd_amount = 0
           or usd_amount <> round(usd_amount, 10)
           or shares <> round(shares, 10)
           or price <> round(price, 12)
           or fees_usd <> round(fees_usd, 10)
           or duplicate_ordinal <= 0
           or kind not in ('dca', 'lumpsum')
           or (side = 'buy' and usd_amount >= 0)
           or (side = 'sell' and usd_amount <= 0)
           or (side = 'sell' and fees_usd >= shares * price)
           or abs(
               usd_amount
               - case
                   when side = 'buy' then -(shares * price + fees_usd)
                   else shares * price - fees_usd
                 end
           ) > 0.0200001
    ) then
        raise exception 'invalid_ledger_trade' using errcode = '22023';
    end if;

    create temporary table tmp_portfolio_ledger_cash_events (
        source_index integer not null,
        source text not null,
        effective_date date not null,
        cashflow_kind text not null,
        ticker text,
        source_currency text not null,
        source_amount numeric not null,
        usd_amount numeric not null,
        source_action text not null,
        source_description text,
        duplicate_ordinal integer not null,
        import_key text not null primary key
    ) on commit drop;

    insert into tmp_portfolio_ledger_cash_events (
        source_index,
        source,
        effective_date,
        cashflow_kind,
        ticker,
        source_currency,
        source_amount,
        usd_amount,
        source_action,
        source_description,
        duplicate_ordinal,
        import_key
    )
    select
        row_data.source_index,
        coalesce(nullif(lower(trim(row_data.source)), ''), v_source),
        row_data.effective_date,
        lower(trim(row_data.event_type)),
        nullif(upper(trim(row_data.ticker)), ''),
        upper(coalesce(nullif(trim(row_data.source_currency), ''), 'USD')),
        row_data.source_amount,
        row_data.usd_amount,
        regexp_replace(trim(coalesce(row_data.source_action, '')), '[[:space:]]+', ' ', 'g'),
        nullif(trim(row_data.source_description), ''),
        row_data.duplicate_ordinal,
        nullif(trim(row_data.import_key), '')
    from jsonb_to_recordset(p_cash_events) as row_data(
        source_index integer,
        source text,
        effective_date date,
        event_type text,
        ticker text,
        source_currency text,
        source_amount numeric,
        usd_amount numeric,
        source_action text,
        source_description text,
        duplicate_ordinal integer,
        import_key text
    );

    if exists (
        select 1
        from tmp_portfolio_ledger_cash_events
        where source <> v_source
           or source_index <= 0
           or effective_date is null
           or cashflow_kind not in (
               'fx_transfer', 'broker_deposit', 'broker_withdrawal',
               'stock_allocation', 'dividend', 'interest', 'tax', 'fee'
           )
           or (ticker is not null and ticker !~ '^[A-Z0-9.^-]{1,15}$')
           or source_currency = ''
           or abs(source_amount) >= 1000000000000
           or abs(usd_amount) >= 1000000000000
           or source_amount <> round(source_amount, 10)
           or usd_amount <> round(usd_amount, 10)
           or usd_amount = 0
           or duplicate_ordinal <= 0
           or (
               cashflow_kind = 'broker_deposit'
               and usd_amount <= 0
           )
           or (
               cashflow_kind in ('broker_withdrawal', 'stock_allocation', 'tax', 'fee')
               and usd_amount >= 0
           )
    ) then
        raise exception 'invalid_ledger_cash_event' using errcode = '22023';
    end if;

    if v_mode = 'reset_all' then
        select count(*)::integer into v_transactions_removed
        from public.transactions
        where user_id = v_user_id;

        select count(*)::integer into v_cashflows_removed
        from public.cashflows
        where user_id = v_user_id;

        select count(*)::integer into v_funding_batches_removed
        from public.funding_batches
        where user_id = v_user_id;

        for v_row in
            select id from public.transactions
            where user_id = v_user_id and side = 'sell'
            order by trade_date desc, created_at desc, id desc
        loop
            delete from public.transactions where id = v_row.id and user_id = v_user_id;
        end loop;

        for v_row in
            select id from public.transactions
            where user_id = v_user_id and side = 'buy'
            order by trade_date desc, created_at desc, id desc
        loop
            delete from public.transactions where id = v_row.id and user_id = v_user_id;
        end loop;

        delete from public.cashflows where user_id = v_user_id;
        delete from public.funding_batches where user_id = v_user_id;
    elsif v_mode = 'replace_source' then
        select count(*)::integer into v_transactions_removed
        from public.transactions
        where user_id = v_user_id and import_source = v_source;

        select count(*)::integer into v_cashflows_removed
        from public.cashflows
        where user_id = v_user_id and import_source = v_source;

        for v_row in
            select id from public.transactions
            where user_id = v_user_id and import_source = v_source and side = 'sell'
            order by trade_date desc, created_at desc, id desc
        loop
            delete from public.transactions where id = v_row.id and user_id = v_user_id;
        end loop;

        for v_row in
            select id from public.transactions
            where user_id = v_user_id and import_source = v_source and side = 'buy'
            order by trade_date desc, created_at desc, id desc
        loop
            delete from public.transactions where id = v_row.id and user_id = v_user_id;
        end loop;

        delete from public.cashflows
        where user_id = v_user_id and import_source = v_source;
    else
        select count(*)::integer into v_transactions_unchanged
        from tmp_portfolio_ledger_trades incoming
        where exists (
            select 1 from public.transactions existing
            where existing.user_id = v_user_id
              and existing.import_source = v_source
              and existing.import_key = incoming.import_key
        );

        select count(*)::integer into v_cashflows_unchanged
        from tmp_portfolio_ledger_cash_events incoming
        where exists (
            select 1 from public.cashflows existing
            where existing.user_id = v_user_id
              and existing.import_source = v_source
              and existing.import_key = incoming.import_key
        );
    end if;

    for v_row in
        select incoming.*
        from tmp_portfolio_ledger_trades incoming
        where not exists (
            select 1 from public.transactions existing
            where existing.user_id = v_user_id
              and existing.import_source = v_source
              and existing.import_key = incoming.import_key
        )
        order by incoming.effective_date, incoming.source_index
    loop
        insert into public.transactions (
            user_id,
            trade_date,
            ticker,
            side,
            price,
            shares,
            fees_usd,
            settled_amount_usd,
            kind,
            source_description,
            import_source,
            import_key,
            created_at
        )
        values (
            v_user_id,
            v_row.effective_date,
            v_row.ticker,
            v_row.side,
            v_row.price,
            v_row.shares,
            v_row.fees_usd,
            v_row.usd_amount,
            v_row.kind,
            v_row.source_description,
            v_source,
            v_row.import_key,
            transaction_timestamp() - (v_row.source_index * interval '1 microsecond')
        );
        v_transactions_added := v_transactions_added + 1;
    end loop;

    for v_row in
        select incoming.*
        from tmp_portfolio_ledger_cash_events incoming
        where not exists (
            select 1 from public.cashflows existing
            where existing.user_id = v_user_id
              and existing.import_source = v_source
              and existing.import_key = incoming.import_key
        )
        order by incoming.effective_date, incoming.source_index
    loop
        insert into public.cashflows (
            user_id,
            cny_out_date,
            cny_amount,
            usd_in_date,
            usd_amount,
            target_rate,
            fees_cny,
            fees_usd,
            effective_date,
            ticker,
            source_currency,
            source_amount,
            cashflow_kind,
            source_action,
            source_description,
            import_source,
            import_key,
            created_at
        )
        values (
            v_user_id,
            v_row.effective_date,
            null,
            v_row.effective_date,
            v_row.usd_amount,
            null,
            0,
            0,
            v_row.effective_date,
            v_row.ticker,
            v_row.source_currency,
            v_row.source_amount,
            v_row.cashflow_kind,
            v_row.source_action,
            v_row.source_description,
            v_source,
            v_row.import_key,
            transaction_timestamp() - (v_row.source_index * interval '1 microsecond')
        );
        v_cashflows_added := v_cashflows_added + 1;
    end loop;

    -- Cash events affect private account-value diagnostics even when no trade
    -- row changed. The trigger above invalidates the percentage-only public
    -- cache; this removes private daily PnL rows for the affected owner.
    perform public._clear_performance_daily_pnl_cache_for_user(v_user_id);

    return jsonb_build_object(
        'source', v_source,
        'mode', v_mode,
        'added', v_transactions_added + v_cashflows_added,
        'unchanged', v_transactions_unchanged + v_cashflows_unchanged,
        'removed', v_transactions_removed + v_cashflows_removed + v_funding_batches_removed,
        'transactions_added', v_transactions_added,
        'transactions_unchanged', v_transactions_unchanged,
        'transactions_removed', v_transactions_removed,
        'cashflows_added', v_cashflows_added,
        'cashflows_unchanged', v_cashflows_unchanged,
        'cashflows_removed', v_cashflows_removed,
        'funding_batches_removed', v_funding_batches_removed,
        'errors', 0
    );
end;
$$;

revoke all on function public.import_portfolio_ledger(text, jsonb, jsonb, text)
    from public, anon, authenticated;
grant execute on function public.import_portfolio_ledger(text, jsonb, jsonb, text)
    to authenticated;

-- Keep the existing Schwab signature for the current UI. Legacy append and
-- reset_etf retain their old matching semantics; reset_all is routed through
-- the source-neutral ledger contract.
create or replace function public.import_schwab_transactions(
    p_rows jsonb,
    p_cashflows jsonb,
    p_etf_symbols text[],
    p_mode text
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
    v_user_id uuid := auth.uid();
    v_trades jsonb;
    v_cash_events jsonb;
begin
    if v_user_id is null then
        raise exception 'not_authenticated' using errcode = '42501';
    end if;

    if p_mode in ('append', 'reset_etf') then
        return dca_private._import_schwab_transactions_v1(
            p_rows,
            p_cashflows,
            p_etf_symbols,
            p_mode
        ) || jsonb_build_object('funding_batches_removed', 0);
    end if;

    if p_mode <> 'reset_all'
       or jsonb_typeof(p_rows) is distinct from 'array'
       or jsonb_typeof(p_cashflows) is distinct from 'array' then
        raise exception 'invalid_legacy_schwab_import' using errcode = '22023';
    end if;

    if exists (
        select 1
        from jsonb_array_elements(p_rows) row_data
        where upper(trim(row_data->>'ticker')) <> all(
            coalesce(
                array(select upper(trim(symbol)) from unnest(p_etf_symbols) symbols(symbol)),
                '{}'::text[]
            )
        )
    ) then
        raise exception 'legacy_rows_must_be_confirmed_etfs' using errcode = '22023';
    end if;

    select coalesce(jsonb_agg(
        jsonb_build_object(
            'source', 'schwab',
            'source_index', (row_data->>'source_index')::integer,
            'effective_date', row_data->>'trade_date',
            'side', lower(row_data->>'side'),
            'ticker', upper(trim(row_data->>'ticker')),
            'shares', row_data->>'shares',
            'price', row_data->>'price',
            'fees_usd', coalesce(row_data->>'fees_usd', '0'),
            'usd_amount', row_data->>'amount',
            'source_currency', 'USD',
            'source_action', initcap(lower(row_data->>'side')),
            'source_description', row_data->>'source_description',
            'duplicate_ordinal', (row_data->>'duplicate_ordinal')::integer,
            'import_key', concat_ws(
                '|',
                row_data->>'trade_date',
                lower(row_data->>'side'),
                upper(trim(row_data->>'ticker')),
                to_char((row_data->>'price')::numeric, 'FM999999999999990.000000000000'),
                to_char((row_data->>'shares')::numeric, 'FM999999999999990.0000000000'),
                to_char(coalesce((row_data->>'fees_usd')::numeric, 0), 'FM999999999999990.0000000000'),
                row_data->>'duplicate_ordinal'
            ),
            'kind', coalesce(nullif(lower(row_data->>'kind'), ''), 'dca')
        ) order by (row_data->>'source_index')::integer
    ), '[]'::jsonb)
    into v_trades
    from jsonb_array_elements(p_rows) row_data;

    select coalesce(jsonb_agg(
        jsonb_build_object(
            'source', 'schwab',
            'source_index', (row_data->>'source_index')::integer,
            'effective_date', coalesce(row_data->>'cashflow_date', row_data->>'deposit_date'),
            'event_type', coalesce(nullif(lower(row_data->>'cashflow_kind'), ''), 'broker_deposit'),
            'source_currency', 'USD',
            'source_amount', row_data->>'amount',
            'usd_amount', row_data->>'amount',
            'source_action', row_data->>'source_action',
            'source_description', row_data->>'source_description',
            'duplicate_ordinal', (row_data->>'duplicate_ordinal')::integer,
            'import_key', concat_ws(
                '|',
                coalesce(row_data->>'cashflow_date', row_data->>'deposit_date'),
                case
                    when lower(coalesce(row_data->>'cashflow_kind', '')) = 'stock_allocation'
                        then 'stock allocation'
                    else lower(regexp_replace(trim(row_data->>'source_action'), '[[:space:]]+', ' ', 'g'))
                end,
                coalesce(row_data->>'source_description', ''),
                to_char((row_data->>'amount')::numeric, 'FM999999999999990.0000000000'),
                row_data->>'duplicate_ordinal'
            )
        ) order by (row_data->>'source_index')::integer
    ), '[]'::jsonb)
    into v_cash_events
    from jsonb_array_elements(p_cashflows) row_data;

    return public.import_portfolio_ledger('schwab', v_trades, v_cash_events, 'reset_all');
end;
$$;

revoke all on function public.import_schwab_transactions(jsonb, jsonb, text[], text)
    from public, anon, authenticated;
grant execute on function public.import_schwab_transactions(jsonb, jsonb, text[], text)
    to authenticated;
