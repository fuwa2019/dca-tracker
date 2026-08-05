-- Preserve broker-settled transaction cash and keep excluded-stock funding on
-- the stock trade date instead of moving it back to an earlier deposit.

set lock_timeout = '5s';

alter table public.transactions
    add column if not exists settled_amount_usd numeric(22, 10);

alter table public.transactions
    drop constraint if exists transactions_settled_amount_check;

alter table public.transactions
    add constraint transactions_settled_amount_check
    check (
        settled_amount_usd is null
        or (
            abs(settled_amount_usd) < 1000000000000
            and (
                (side = 'buy' and settled_amount_usd < 0)
                or (side = 'sell' and settled_amount_usd > 0)
            )
            and abs(
                settled_amount_usd
                - case
                    when side = 'buy' then -(shares * price + coalesce(fees_usd, 0))
                    else shares * price - coalesce(fees_usd, 0)
                  end
            ) <= 0.0200001
        )
    );

alter table public.cashflows
    drop constraint if exists cashflows_usd_amount_check,
    drop constraint if exists cashflows_kind_fields_check;

alter table public.cashflows
    add constraint cashflows_kind_fields_check
    check (
        (
            cashflow_kind = 'fx_transfer'
            and cny_amount > 0
            and target_rate > 0
        )
        or (
            cashflow_kind = 'broker_deposit'
            and cny_amount is null
            and target_rate is null
            and usd_in_date is not null
            and usd_amount > 0
        )
        or (
            cashflow_kind = 'stock_allocation'
            and cny_amount is null
            and target_rate is null
            and usd_in_date is not null
            and usd_amount < 0
        )
    );

create or replace function public._clear_transaction_import_identity_on_edit()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    if new.trade_date is distinct from old.trade_date
       or new.ticker is distinct from old.ticker
       or new.side is distinct from old.side
       or new.price is distinct from old.price
       or new.shares is distinct from old.shares
       or new.fees_usd is distinct from old.fees_usd then
        new.import_source := null;
        new.import_key := null;
        new.source_description := null;
        new.settled_amount_usd := null;
    end if;
    return new;
end;
$$;

revoke all on function public._clear_transaction_import_identity_on_edit()
    from public, anon, authenticated;

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
    v_result jsonb;
    v_deposit_payload jsonb := '[]'::jsonb;
    v_row record;
    v_transactions_removed integer := 0;
    v_cashflows_removed integer := 0;
    v_funding_batches_removed integer := 0;
    v_allocations_added integer := 0;
begin
    if v_user_id is null then
        raise exception 'not_authenticated' using errcode = '42501';
    end if;

    if p_mode not in ('append', 'reset_all', 'reset_etf') then
        raise exception 'invalid_import_mode' using errcode = '22023';
    end if;

    if jsonb_typeof(p_rows) <> 'array' then
        raise exception 'rows_must_be_an_array' using errcode = '22023';
    end if;

    if jsonb_typeof(p_cashflows) <> 'array' then
        raise exception 'cashflows_must_be_an_array' using errcode = '22023';
    end if;

    if jsonb_array_length(p_rows) + jsonb_array_length(p_cashflows) > 10000 then
        raise exception 'too_many_import_rows' using errcode = '22023';
    end if;

    if p_mode = 'reset_all'
       and jsonb_array_length(p_rows) + jsonb_array_length(p_cashflows) = 0 then
        raise exception 'reset_requires_importable_rows' using errcode = '22023';
    end if;

    create temporary table tmp_schwab_cashflow_v2 (
        source_index integer not null,
        cashflow_kind text not null,
        cashflow_date date not null,
        source_action text not null,
        source_description text,
        amount numeric not null,
        duplicate_ordinal integer not null,
        import_key text not null
    ) on commit drop;

    insert into tmp_schwab_cashflow_v2 (
        source_index,
        cashflow_kind,
        cashflow_date,
        source_action,
        source_description,
        amount,
        duplicate_ordinal,
        import_key
    )
    select
        row_data.source_index,
        coalesce(nullif(lower(trim(row_data.cashflow_kind)), ''), 'broker_deposit'),
        coalesce(row_data.cashflow_date, row_data.deposit_date),
        regexp_replace(trim(row_data.source_action), '[[:space:]]+', ' ', 'g'),
        nullif(trim(row_data.source_description), ''),
        row_data.amount,
        row_data.duplicate_ordinal,
        concat_ws(
            '|',
            coalesce(row_data.cashflow_date, row_data.deposit_date)::text,
            lower(regexp_replace(trim(row_data.source_action), '[[:space:]]+', ' ', 'g')),
            trim(coalesce(row_data.source_description, '')),
            to_char(row_data.amount, 'FM999999999999990.0000000000'),
            row_data.duplicate_ordinal::text
        )
    from jsonb_to_recordset(p_cashflows) as row_data(
        source_index integer,
        cashflow_kind text,
        cashflow_date date,
        deposit_date date,
        source_action text,
        source_description text,
        amount numeric,
        duplicate_ordinal integer
    );

    if exists (
        select 1
        from tmp_schwab_cashflow_v2
        where source_index <= 0
           or cashflow_kind not in ('broker_deposit', 'stock_allocation')
           or amount = 0
           or abs(amount) >= 1000000000000
           or amount <> round(amount, 10)
           or duplicate_ordinal <= 0
           or (
               cashflow_kind = 'broker_deposit'
               and (
                   amount <= 0
                   or lower(source_action) <> all(array[
                       'ach transfer',
                       'cash deposit',
                       'cash transfer',
                       'deposit',
                       'direct deposit',
                       'electronic funds transfer',
                       'funds received',
                       'moneylink transfer',
                       'wire received'
                   ])
               )
           )
           or (
               cashflow_kind = 'stock_allocation'
               and (amount >= 0 or lower(source_action) <> 'stock allocation')
           )
    ) then
        raise exception 'invalid_cashflow_import_row' using errcode = '22023';
    end if;

    if exists (
        select import_key
        from tmp_schwab_cashflow_v2
        group by import_key
        having count(*) > 1
    ) then
        raise exception 'duplicate_cashflow_import_key_in_file' using errcode = '22023';
    end if;

    if exists (
        select 1
        from tmp_schwab_cashflow_v2
        group by cashflow_kind, cashflow_date, source_action, source_description, amount
        having min(duplicate_ordinal) <> 1
            or max(duplicate_ordinal) <> count(*)
    ) then
        raise exception 'invalid_cashflow_duplicate_ordinal_sequence' using errcode = '22023';
    end if;

    if p_mode <> 'reset_all' and exists (
        select 1 from tmp_schwab_cashflow_v2 where cashflow_kind = 'stock_allocation'
    ) then
        raise exception 'stock_allocations_require_reset_all' using errcode = '22023';
    end if;

    select coalesce(jsonb_agg(
        jsonb_build_object(
            'source_index', source_index,
            'deposit_date', cashflow_date,
            'source_action', source_action,
            'source_description', source_description,
            'amount', amount,
            'duplicate_ordinal', duplicate_ordinal
        ) order by source_index
    ), '[]'::jsonb)
    into v_deposit_payload
    from tmp_schwab_cashflow_v2
    where cashflow_kind = 'broker_deposit';

    create temporary table tmp_schwab_settled_amounts (
        import_key text primary key,
        amount numeric not null
    ) on commit drop;

    insert into tmp_schwab_settled_amounts (import_key, amount)
    select
        concat_ws(
            '|',
            row_data.trade_date::text,
            lower(trim(row_data.side)),
            upper(trim(row_data.ticker)),
            to_char(row_data.price, 'FM999999999999990.000000000000'),
            to_char(row_data.shares, 'FM999999999999990.0000000000'),
            to_char(coalesce(row_data.fees_usd, 0), 'FM999999999999990.0000000000'),
            row_data.duplicate_ordinal::text
        ),
        round(row_data.amount, 10)
    from jsonb_to_recordset(p_rows) as row_data(
        trade_date date,
        side text,
        ticker text,
        shares numeric,
        price numeric,
        fees_usd numeric,
        amount numeric,
        duplicate_ordinal integer
    );

    if exists (
        select 1
        from tmp_schwab_settled_amounts
        where amount = 0
           or abs(amount) >= 1000000000000
    ) then
        raise exception 'invalid_import_row' using errcode = '22023';
    end if;

    if p_mode in ('append', 'reset_etf') then
        v_result := dca_private._import_schwab_transactions_v1(
            p_rows,
            v_deposit_payload,
            p_etf_symbols,
            p_mode
        );
    else
        perform pg_advisory_xact_lock(hashtextextended(v_user_id::text, 0));

        select count(*)::integer
        into v_transactions_removed
        from public.transactions transaction
        where transaction.user_id = v_user_id;

        select count(*)::integer
        into v_cashflows_removed
        from public.cashflows cashflow
        where cashflow.user_id = v_user_id;

        select count(*)::integer
        into v_funding_batches_removed
        from public.funding_batches batch
        where batch.user_id = v_user_id;

        for v_row in
            select transaction.id
            from public.transactions transaction
            where transaction.user_id = v_user_id
              and transaction.side = 'sell'
            order by transaction.trade_date desc, transaction.created_at desc, transaction.id desc
        loop
            delete from public.transactions
            where id = v_row.id and user_id = v_user_id;
        end loop;

        for v_row in
            select transaction.id
            from public.transactions transaction
            where transaction.user_id = v_user_id
              and transaction.side = 'buy'
            order by transaction.trade_date desc, transaction.created_at desc, transaction.id desc
        loop
            delete from public.transactions
            where id = v_row.id and user_id = v_user_id;
        end loop;

        delete from public.cashflows cashflow
        where cashflow.user_id = v_user_id;

        delete from public.funding_batches batch
        where batch.user_id = v_user_id;

        v_result := dca_private._import_schwab_transactions_v1(
            p_rows,
            v_deposit_payload,
            p_etf_symbols,
            'append'
        );
    end if;

    update public.transactions transaction
    set settled_amount_usd = imported.amount
    from tmp_schwab_settled_amounts imported
    where transaction.user_id = v_user_id
      and transaction.import_source = 'schwab'
      and transaction.import_key = imported.import_key
      and transaction.settled_amount_usd is distinct from imported.amount;

    insert into public.cashflows (
        user_id,
        cny_out_date,
        cny_amount,
        usd_in_date,
        usd_amount,
        target_rate,
        fees_cny,
        fees_usd,
        cashflow_kind,
        source_action,
        source_description,
        import_source,
        import_key,
        created_at
    )
    select
        v_user_id,
        imported.cashflow_date,
        null,
        imported.cashflow_date,
        imported.amount,
        null,
        0,
        0,
        'stock_allocation',
        imported.source_action,
        imported.source_description,
        'schwab',
        imported.import_key,
        transaction_timestamp() - (imported.source_index * interval '1 microsecond')
    from tmp_schwab_cashflow_v2 imported
    where imported.cashflow_kind = 'stock_allocation';

    get diagnostics v_allocations_added = row_count;

    return v_result || jsonb_build_object(
        'added', coalesce((v_result ->> 'added')::integer, 0) + v_allocations_added,
        'removed', case
            when p_mode = 'reset_all' then
                v_transactions_removed + v_cashflows_removed + v_funding_batches_removed
            else coalesce((v_result ->> 'removed')::integer, 0)
        end,
        'transactions_removed', case
            when p_mode = 'reset_all' then v_transactions_removed
            else coalesce((v_result ->> 'transactions_removed')::integer, 0)
        end,
        'cashflows_added', coalesce((v_result ->> 'cashflows_added')::integer, 0) + v_allocations_added,
        'cashflows_removed', case
            when p_mode = 'reset_all' then v_cashflows_removed
            else coalesce((v_result ->> 'cashflows_removed')::integer, 0)
        end,
        'funding_batches_removed', v_funding_batches_removed
    );
end;
$$;

revoke all on function public.import_schwab_transactions(jsonb, jsonb, text[], text)
    from public, anon, authenticated;
grant execute on function public.import_schwab_transactions(jsonb, jsonb, text[], text)
    to authenticated;

-- The cached performance functions use the settled broker cash whenever it is
-- available and retain the existing price-times-quantity fallback for manual rows.
do $$
declare
    v_signature text;
    v_def text;
    v_next text;
begin
    foreach v_signature in array array[
        'public._performance_history_for_user_fast_base(uuid,text)',
        'public._performance_daily_pnl_for_user(uuid,text)'
    ]
    loop
        select pg_get_functiondef(v_signature::regprocedure) into v_def;
        if v_def is null then
            raise exception '% is missing', v_signature;
        end if;

        v_next := replace(
            v_def,
            'case when side = ''buy'' then (shares * price + coalesce(fees_usd, 0))::numeric else 0::numeric end as buy_notional',
            'case when side = ''buy'' then coalesce(abs(settled_amount_usd), shares * price + coalesce(fees_usd, 0))::numeric else 0::numeric end as buy_notional'
        );
        if v_next = v_def then
            raise exception 'could not patch % buy cash amount', v_signature;
        end if;
        v_def := v_next;

        v_next := replace(
            v_def,
            'case when side = ''sell'' then (shares * price - coalesce(fees_usd, 0))::numeric else 0::numeric end as sell_notional',
            'case when side = ''sell'' then coalesce(abs(settled_amount_usd), shares * price - coalesce(fees_usd, 0))::numeric else 0::numeric end as sell_notional'
        );
        if v_next = v_def then
            raise exception 'could not patch % sell cash amount', v_signature;
        end if;
        v_def := v_next;

        v_next := replace(
            v_def,
            '(case when side = ''buy'' then shares * price + coalesce(fees_usd, 0) else -(shares * price - coalesce(fees_usd, 0)) end)::numeric as notional_delta,',
            'coalesce(-settled_amount_usd, case when side = ''buy'' then shares * price + coalesce(fees_usd, 0) else -(shares * price - coalesce(fees_usd, 0)) end)::numeric as notional_delta,'
        );
        if v_next = v_def then
            raise exception 'could not patch % transaction cash event', v_signature;
        end if;

        execute v_next;
    end loop;
end;
$$;

create or replace function public._performance_source_hash(
    p_user_id uuid,
    p_benchmark text default 'SPY'
)
returns text
language sql
stable
security definer
set search_path = public
as $$
    select md5(coalesce((
        select string_agg(item, '|' order by item)
        from (
            select concat_ws(
                ':',
                'txn',
                id,
                trade_date,
                upper(ticker),
                side,
                price,
                shares,
                fees_usd,
                settled_amount_usd,
                kind,
                updated_at
            ) as item
            from public.transactions
            where user_id = p_user_id

            union all

            select concat_ws(
                ':',
                'price',
                ticker,
                max(trade_date),
                count(*),
                max(updated_at)
            ) as item
            from public.daily_prices
            where ticker = upper(coalesce(nullif(trim(p_benchmark), ''), 'SPY'))
               or ticker in (
                   select distinct upper(ticker)
                   from public.transactions
                   where user_id = p_user_id
               )
            group by ticker
        ) source_rows
    ), 'empty'));
$$;

revoke all on function public._performance_source_hash(uuid, text)
    from public, anon, authenticated;

do $$
declare
    v_def text;
    v_next text;
begin
    select pg_get_functiondef('public.shared_portfolio(text)'::regprocedure)
    into v_def;

    if v_def is null then
        raise exception 'shared_portfolio is missing';
    end if;

    v_next := replace(
        v_def,
        'sum(case when t.side = ''buy'' then t.shares * t.price + coalesce(t.fees_usd, 0) else 0 end)',
        'sum(case when t.side = ''buy'' then coalesce(abs(t.settled_amount_usd), t.shares * t.price + coalesce(t.fees_usd, 0)) else 0 end)'
    );
    if v_next = v_def then
        raise exception 'could not patch shared portfolio average cost';
    end if;
    v_def := v_next;

    v_next := replace(
        v_def,
        'select sum(t.shares * t.price + coalesce(t.fees_usd, 0))',
        'select sum(coalesce(abs(t.settled_amount_usd), t.shares * t.price + coalesce(t.fees_usd, 0)))'
    );
    if v_next = v_def then
        raise exception 'could not patch shared portfolio buy cash amount';
    end if;
    v_def := v_next;

    v_next := replace(
        v_def,
        'select sum(t.shares * t.price - coalesce(t.fees_usd, 0))',
        'select sum(coalesce(abs(t.settled_amount_usd), t.shares * t.price - coalesce(t.fees_usd, 0)))'
    );
    if v_next = v_def then
        raise exception 'could not patch shared portfolio sell cash amount';
    end if;

    execute v_next;
end;
$$;

update public.performance_history_cache
set dirty = true,
    source_hash = null,
    updated_at = now();

delete from public.performance_daily_pnl_cache;

reset lock_timeout;
