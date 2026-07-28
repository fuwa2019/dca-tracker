-- DCA Tracker - Schwab ETF transactions, broker deposits, export metadata, and fees.

alter table public.transactions
    add column if not exists fees_usd numeric(14, 2) not null default 0
        check (fees_usd >= 0),
    add column if not exists source_description text,
    add column if not exists import_source text,
    add column if not exists import_key text;

alter table public.transactions
    drop constraint if exists transactions_user_import_source_key_key;

alter table public.transactions
    drop constraint if exists transactions_sell_fee_less_than_notional_check;

alter table public.transactions
    add constraint transactions_sell_fee_less_than_notional_check
    check (side = 'buy' or fees_usd < shares * price);

alter table public.transactions
    add constraint transactions_user_import_source_key_key
    unique (user_id, import_source, import_key);

alter table public.cashflows
    add column if not exists cashflow_kind text not null default 'fx_transfer',
    add column if not exists source_action text,
    add column if not exists source_description text,
    add column if not exists import_source text,
    add column if not exists import_key text;

alter table public.cashflows
    alter column cny_amount drop not null,
    alter column target_rate drop not null;

alter table public.cashflows
    drop constraint if exists cashflows_cny_amount_check,
    drop constraint if exists cashflows_target_rate_check,
    drop constraint if exists cashflows_kind_fields_check,
    drop constraint if exists cashflows_user_import_source_key_key;

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
    ),
    add constraint cashflows_user_import_source_key_key
    unique (user_id, import_source, import_key);

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
    end if;
    return new;
end;
$$;

revoke all on function public._clear_transaction_import_identity_on_edit()
    from public, anon, authenticated;

drop trigger if exists transactions_clear_import_identity on public.transactions;
create trigger transactions_clear_import_identity
before update of trade_date, ticker, side, price, shares, fees_usd
on public.transactions
for each row execute function public._clear_transaction_import_identity_on_edit();

create or replace function public._clear_cashflow_import_identity_on_edit()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    if new.cny_out_date is distinct from old.cny_out_date
       or new.usd_in_date is distinct from old.usd_in_date
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
before update of cny_out_date, usd_in_date, usd_amount, cashflow_kind
on public.cashflows
for each row execute function public._clear_cashflow_import_identity_on_edit();

drop function if exists public.import_schwab_transactions(jsonb, text[], text);

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
    v_etf_symbols text[];
    v_row record;
    v_match_id uuid;
    v_added integer := 0;
    v_unchanged integer := 0;
    v_removed integer := 0;
    v_cashflow_added integer := 0;
    v_cashflow_unchanged integer := 0;
    v_cashflow_removed integer := 0;
begin
    if v_user_id is null then
        raise exception 'not_authenticated' using errcode = '42501';
    end if;

    if p_mode not in ('append', 'reset_etf') then
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

    select coalesce(array_agg(symbol order by symbol), '{}'::text[])
    into v_etf_symbols
    from (
        select distinct upper(trim(value)) as symbol
        from unnest(coalesce(p_etf_symbols, '{}'::text[])) as symbols(value)
        where trim(value) <> ''
    ) normalized;

    if exists (
        select 1
        from unnest(v_etf_symbols) as symbols(symbol)
        where symbol !~ '^[A-Z0-9.^-]{1,15}$'
    ) then
        raise exception 'invalid_etf_symbol' using errcode = '22023';
    end if;

    if p_mode = 'reset_etf'
       and cardinality(v_etf_symbols) = 0
       and jsonb_array_length(p_cashflows) = 0 then
        raise exception 'reset_requires_importable_rows' using errcode = '22023';
    end if;

    -- Serialize imports for one user, including the initially empty account case.
    perform pg_advisory_xact_lock(hashtextextended(v_user_id::text, 0));

    create temporary table tmp_schwab_import (
        source_index integer not null,
        trade_date date not null,
        side text not null,
        ticker text not null,
        source_description text,
        shares numeric not null,
        price numeric not null,
        fees_usd numeric not null,
        amount numeric not null,
        duplicate_ordinal integer not null,
        import_key text not null,
        kind text not null
    ) on commit drop;

    insert into tmp_schwab_import (
        source_index,
        trade_date,
        side,
        ticker,
        source_description,
        shares,
        price,
        fees_usd,
        amount,
        duplicate_ordinal,
        import_key,
        kind
    )
    select
        row_data.source_index,
        row_data.trade_date,
        lower(trim(row_data.side)),
        upper(trim(row_data.ticker)),
        nullif(trim(row_data.source_description), ''),
        row_data.shares,
        row_data.price,
        coalesce(row_data.fees_usd, 0),
        row_data.amount,
        row_data.duplicate_ordinal,
        concat_ws(
            '|',
            row_data.trade_date::text,
            lower(trim(row_data.side)),
            upper(trim(row_data.ticker)),
            to_char(row_data.price, 'FM999999999999990.0000'),
            to_char(row_data.shares, 'FM999999999999990.000000'),
            to_char(coalesce(row_data.fees_usd, 0), 'FM999999999999990.00'),
            row_data.duplicate_ordinal::text
        ),
        coalesce(nullif(lower(trim(row_data.kind)), ''), 'dca')
    from jsonb_to_recordset(p_rows) as row_data(
        source_index integer,
        trade_date date,
        side text,
        ticker text,
        source_description text,
        shares numeric,
        price numeric,
        fees_usd numeric,
        amount numeric,
        duplicate_ordinal integer,
        kind text
    );

    if exists (
        select 1
        from tmp_schwab_import
        where source_index <= 0
           or side not in ('buy', 'sell')
           or ticker !~ '^[A-Z0-9.^-]{1,15}$'
           or not ticker = any(v_etf_symbols)
           or shares <= 0
           or price <= 0
           or fees_usd < 0
           or shares >= 100000000
           or price >= 10000000000
           or fees_usd >= 1000000000000
           or shares <> round(shares, 6)
           or price <> round(price, 4)
           or fees_usd <> round(fees_usd, 2)
           or duplicate_ordinal <= 0
           or kind not in ('dca', 'lumpsum')
           or (side = 'buy' and amount >= 0)
           or (side = 'sell' and amount <= 0)
           or (side = 'sell' and fees_usd >= shares * price)
           or (
               side = 'buy'
               and abs(amount + shares * price + fees_usd) > 0.0200001
           )
           or (
               side = 'sell'
               and abs(amount - (shares * price - fees_usd)) > 0.0200001
           )
    ) then
        raise exception 'invalid_import_row' using errcode = '22023';
    end if;

    if exists (
        select import_key
        from tmp_schwab_import
        group by import_key
        having count(*) > 1
    ) then
        raise exception 'duplicate_import_key_in_file' using errcode = '22023';
    end if;

    if exists (
        select 1
        from tmp_schwab_import
        group by trade_date, side, ticker, price, shares, fees_usd
        having min(duplicate_ordinal) <> 1
            or max(duplicate_ordinal) <> count(*)
    ) then
        raise exception 'invalid_duplicate_ordinal_sequence' using errcode = '22023';
    end if;

    create temporary table tmp_schwab_cashflow_import (
        source_index integer not null,
        deposit_date date not null,
        source_action text not null,
        source_description text,
        amount numeric not null,
        duplicate_ordinal integer not null,
        import_key text not null
    ) on commit drop;

    insert into tmp_schwab_cashflow_import (
        source_index,
        deposit_date,
        source_action,
        source_description,
        amount,
        duplicate_ordinal,
        import_key
    )
    select
        row_data.source_index,
        row_data.deposit_date,
        regexp_replace(trim(row_data.source_action), '[[:space:]]+', ' ', 'g'),
        nullif(trim(row_data.source_description), ''),
        row_data.amount,
        row_data.duplicate_ordinal,
        concat_ws(
            '|',
            row_data.deposit_date::text,
            lower(regexp_replace(trim(row_data.source_action), '[[:space:]]+', ' ', 'g')),
            trim(coalesce(row_data.source_description, '')),
            to_char(row_data.amount, 'FM999999999999990.00'),
            row_data.duplicate_ordinal::text
        )
    from jsonb_to_recordset(p_cashflows) as row_data(
        source_index integer,
        deposit_date date,
        source_action text,
        source_description text,
        amount numeric,
        duplicate_ordinal integer
    );

    if exists (
        select 1
        from tmp_schwab_cashflow_import
        where source_index <= 0
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
           or amount <= 0
           or amount >= 1000000000000
           or amount <> round(amount, 2)
           or duplicate_ordinal <= 0
    ) then
        raise exception 'invalid_cashflow_import_row' using errcode = '22023';
    end if;

    if exists (
        select import_key
        from tmp_schwab_cashflow_import
        group by import_key
        having count(*) > 1
    ) then
        raise exception 'duplicate_cashflow_import_key_in_file' using errcode = '22023';
    end if;

    if exists (
        select 1
        from tmp_schwab_cashflow_import
        group by deposit_date, source_action, source_description, amount
        having min(duplicate_ordinal) <> 1
            or max(duplicate_ordinal) <> count(*)
    ) then
        raise exception 'invalid_cashflow_duplicate_ordinal_sequence' using errcode = '22023';
    end if;

    create temporary table tmp_schwab_matches (
        import_key text primary key,
        transaction_id uuid not null unique
    ) on commit drop;

    if p_mode = 'append' then
        for v_row in
            select *
            from tmp_schwab_import
            order by source_index
        loop
            v_match_id := null;

            select id
            into v_match_id
            from public.transactions
            where user_id = v_user_id
              and import_source = 'schwab'
              and import_key = v_row.import_key
            limit 1;

            if v_match_id is null then
                select transaction.id
                into v_match_id
                from public.transactions transaction
                where transaction.user_id = v_user_id
                  and transaction.trade_date = v_row.trade_date
                  and transaction.side = v_row.side
                  and upper(transaction.ticker) = v_row.ticker
                  and transaction.price = v_row.price
                  and transaction.shares = v_row.shares
                  and coalesce(transaction.fees_usd, 0) = v_row.fees_usd
                  and not exists (
                      select 1
                      from tmp_schwab_matches matched
                      where matched.transaction_id = transaction.id
                  )
                order by transaction.created_at, transaction.id
                limit 1;
            end if;

            if v_match_id is not null then
                insert into tmp_schwab_matches (import_key, transaction_id)
                values (v_row.import_key, v_match_id);
                v_unchanged := v_unchanged + 1;
            end if;
        end loop;

        update public.transactions transaction
        set import_source = 'schwab',
            import_key = imported.import_key,
            source_description = imported.source_description
        from tmp_schwab_matches matched
        join tmp_schwab_import imported using (import_key)
        where transaction.id = matched.transaction_id
          and transaction.user_id = v_user_id
          and (
              transaction.import_source is distinct from 'schwab'
              or transaction.import_key is distinct from imported.import_key
              or transaction.source_description is distinct from imported.source_description
          );
    else
        select count(*)::integer
        into v_removed
        from public.transactions transaction
        where transaction.user_id = v_user_id
          and upper(transaction.ticker) = any(v_etf_symbols);

        -- Strict reset deletes every confirmed ETF row before rebuilding.
        -- Sells go first so deleting buys cannot create a temporary oversell.
        for v_row in
            select transaction.id
            from public.transactions transaction
            where transaction.user_id = v_user_id
              and upper(transaction.ticker) = any(v_etf_symbols)
              and transaction.side = 'sell'
            order by transaction.trade_date desc, transaction.created_at desc, transaction.id desc
        loop
            delete from public.transactions
            where id = v_row.id
              and user_id = v_user_id;
        end loop;

        for v_row in
            select transaction.id
            from public.transactions transaction
            where transaction.user_id = v_user_id
              and upper(transaction.ticker) = any(v_etf_symbols)
              and transaction.side = 'buy'
            order by transaction.trade_date desc, transaction.created_at desc, transaction.id desc
        loop
            delete from public.transactions
            where id = v_row.id
              and user_id = v_user_id;
        end loop;
    end if;

    -- The source is newest-first. Insert oldest-first so sell validation sees
    -- each symbol's reconstructed timeline in execution order.
    for v_row in
        select imported.*
        from tmp_schwab_import imported
        where p_mode = 'reset_etf'
           or not exists (
               select 1
               from tmp_schwab_matches matched
               where matched.import_key = imported.import_key
           )
        order by imported.trade_date, imported.source_index desc
    loop
        insert into public.transactions (
            user_id,
            trade_date,
            ticker,
            side,
            price,
            shares,
            fees_usd,
            kind,
            source_description,
            import_source,
            import_key,
            created_at
        )
        values (
            v_user_id,
            v_row.trade_date,
            v_row.ticker,
            v_row.side,
            v_row.price,
            v_row.shares,
            v_row.fees_usd,
            v_row.kind,
            v_row.source_description,
            'schwab',
            v_row.import_key,
            transaction_timestamp() - (v_row.source_index * interval '1 microsecond')
        );
        v_added := v_added + 1;
    end loop;

    create temporary table tmp_schwab_cashflow_matches (
        import_key text primary key,
        cashflow_id uuid not null unique
    ) on commit drop;

    if p_mode = 'reset_etf' then
        select count(*)::integer
        into v_cashflow_removed
        from public.cashflows cashflow
        where cashflow.user_id = v_user_id
          and cashflow.cashflow_kind = 'broker_deposit'
          and cashflow.import_source = 'schwab';

        delete from public.cashflows cashflow
        where cashflow.user_id = v_user_id
          and cashflow.cashflow_kind = 'broker_deposit'
          and cashflow.import_source = 'schwab';

        -- A manually-entered FX transfer can carry Schwab identity after an
        -- earlier amount/date match. Keep the cashflow, but rematch its source
        -- fields against the replacement file.
        update public.cashflows cashflow
        set import_source = null,
            import_key = null,
            source_action = null,
            source_description = null
        where cashflow.user_id = v_user_id
          and cashflow.cashflow_kind = 'fx_transfer'
          and cashflow.import_source = 'schwab';
    end if;

    for v_row in
        select *
        from tmp_schwab_cashflow_import
        order by source_index
    loop
        v_match_id := null;

        select id
        into v_match_id
        from public.cashflows
        where user_id = v_user_id
          and import_source = 'schwab'
          and import_key = v_row.import_key
        limit 1;

        if v_match_id is null then
            select cashflow.id
            into v_match_id
            from public.cashflows cashflow
            where cashflow.user_id = v_user_id
              and cashflow.usd_in_date = v_row.deposit_date
              and cashflow.usd_amount = v_row.amount
              and not exists (
                  select 1
                  from tmp_schwab_cashflow_matches matched
                  where matched.cashflow_id = cashflow.id
              )
            order by cashflow.created_at, cashflow.id
            limit 1;
        end if;

        if v_match_id is not null then
            insert into tmp_schwab_cashflow_matches (import_key, cashflow_id)
            values (v_row.import_key, v_match_id);
            v_cashflow_unchanged := v_cashflow_unchanged + 1;
        end if;
    end loop;

    -- Keep a matching manual FX transfer's financial fields and kind intact,
    -- while recording enough Schwab source identity for complete re-export.
    update public.cashflows cashflow
    set import_source = 'schwab',
        import_key = imported.import_key,
        source_action = imported.source_action,
        source_description = imported.source_description
    from tmp_schwab_cashflow_matches matched
    join tmp_schwab_cashflow_import imported using (import_key)
    where cashflow.id = matched.cashflow_id
      and cashflow.user_id = v_user_id
      and (
          cashflow.import_source is distinct from 'schwab'
          or cashflow.import_key is distinct from imported.import_key
          or cashflow.source_action is distinct from imported.source_action
          or cashflow.source_description is distinct from imported.source_description
      );

    for v_row in
        select imported.*
        from tmp_schwab_cashflow_import imported
        where not exists (
            select 1
            from tmp_schwab_cashflow_matches matched
            where matched.import_key = imported.import_key
        )
        order by imported.deposit_date, imported.source_index desc
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
            cashflow_kind,
            source_action,
            source_description,
            import_source,
            import_key,
            created_at
        )
        values (
            v_user_id,
            v_row.deposit_date,
            null,
            v_row.deposit_date,
            v_row.amount,
            null,
            0,
            0,
            'broker_deposit',
            v_row.source_action,
            v_row.source_description,
            'schwab',
            v_row.import_key,
            transaction_timestamp() - (v_row.source_index * interval '1 microsecond')
        );
        v_cashflow_added := v_cashflow_added + 1;
    end loop;

    return jsonb_build_object(
        'added', v_added + v_cashflow_added,
        'unchanged', v_unchanged + v_cashflow_unchanged,
        'removed', v_removed + v_cashflow_removed,
        'transactions_added', v_added,
        'transactions_unchanged', v_unchanged,
        'transactions_removed', v_removed,
        'cashflows_added', v_cashflow_added,
        'cashflows_unchanged', v_cashflow_unchanged,
        'cashflows_removed', v_cashflow_removed,
        'errors', 0
    );
end;
$$;

revoke all on function public.import_schwab_transactions(jsonb, jsonb, text[], text)
    from public, anon, authenticated;
grant execute on function public.import_schwab_transactions(jsonb, jsonb, text[], text)
    to authenticated;

-- Apply fees to the final cached TWR implementation while retaining its
-- benchmark-calendar behavior from migration 0037.
do $$
declare
    v_def text;
    v_next text;
begin
    select pg_get_functiondef(
        'public._performance_history_for_user_fast_base(uuid,text)'::regprocedure
    ) into v_def;

    if v_def is null then
        raise exception '_performance_history_for_user_fast_base is missing';
    end if;

    v_next := regexp_replace(
        v_def,
        'case when side = ''buy'' then \(shares \* price\)::numeric else 0::numeric end as buy_notional',
        'case when side = ''buy'' then (shares * price + coalesce(fees_usd, 0))::numeric else 0::numeric end as buy_notional'
    );
    if v_next = v_def then
        raise exception 'could not patch TWR buy cash amount';
    end if;
    v_def := v_next;

    v_next := regexp_replace(
        v_def,
        'case when side = ''sell'' then \(shares \* price\)::numeric else 0::numeric end as sell_notional',
        'case when side = ''sell'' then (shares * price - coalesce(fees_usd, 0))::numeric else 0::numeric end as sell_notional'
    );
    if v_next = v_def then
        raise exception 'could not patch TWR sell cash amount';
    end if;
    v_def := v_next;

    v_next := regexp_replace(
        v_def,
        '\(case when side = ''buy'' then shares \* price else -shares \* price end\)::numeric as notional_delta,',
        '(case when side = ''buy'' then shares * price else -shares * price end)::numeric as unit_notional_delta,
                (case when side = ''buy'' then shares * price + coalesce(fees_usd, 0) else -(shares * price - coalesce(fees_usd, 0)) end)::numeric as notional_delta,'
    );
    if v_next = v_def then
        raise exception 'could not patch TWR transaction event cash amount';
    end if;
    v_def := v_next;

    v_next := regexp_replace(
        v_def,
        'e\.notional_delta / nullif\(coalesce\(tpx\.price, e\.trade_price\), 0\) as unit_delta',
        'e.unit_notional_delta / nullif(coalesce(tpx.price, e.trade_price), 0) as unit_delta'
    );
    if v_next = v_def then
        raise exception 'could not preserve fee-independent TWR holding units';
    end if;

    execute v_next;
end;
$$;

-- The private daily PnL cache uses the same trade-funding model.
do $$
declare
    v_def text;
    v_next text;
begin
    select pg_get_functiondef(
        'public._performance_daily_pnl_for_user(uuid,text)'::regprocedure
    ) into v_def;

    if v_def is null then
        raise exception '_performance_daily_pnl_for_user is missing';
    end if;

    v_next := regexp_replace(
        v_def,
        'case when side = ''buy'' then \(shares \* price\)::numeric else 0::numeric end as buy_notional',
        'case when side = ''buy'' then (shares * price + coalesce(fees_usd, 0))::numeric else 0::numeric end as buy_notional'
    );
    if v_next = v_def then
        raise exception 'could not patch daily PnL buy cash amount';
    end if;
    v_def := v_next;

    v_next := regexp_replace(
        v_def,
        'case when side = ''sell'' then \(shares \* price\)::numeric else 0::numeric end as sell_notional',
        'case when side = ''sell'' then (shares * price - coalesce(fees_usd, 0))::numeric else 0::numeric end as sell_notional'
    );
    if v_next = v_def then
        raise exception 'could not patch daily PnL sell cash amount';
    end if;
    v_def := v_next;

    v_next := regexp_replace(
        v_def,
        '\(case when side = ''buy'' then shares \* price else -shares \* price end\)::numeric as notional_delta,',
        '(case when side = ''buy'' then shares * price else -shares * price end)::numeric as unit_notional_delta,
            (case when side = ''buy'' then shares * price + coalesce(fees_usd, 0) else -(shares * price - coalesce(fees_usd, 0)) end)::numeric as notional_delta,'
    );
    if v_next = v_def then
        raise exception 'could not patch daily PnL transaction event cash amount';
    end if;
    v_def := v_next;

    v_next := regexp_replace(
        v_def,
        'e\.notional_delta / nullif\(coalesce\(tpx\.price, e\.trade_price\), 0\) as unit_delta',
        'e.unit_notional_delta / nullif(coalesce(tpx.price, e.trade_price), 0) as unit_delta'
    );
    if v_next = v_def then
        raise exception 'could not preserve fee-independent daily PnL holding units';
    end if;

    execute v_next;
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

create or replace function public._performance_source_hash(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
    select public._performance_source_hash(p_user_id, 'SPY');
$$;

revoke all on function public._performance_source_hash(uuid)
    from public, anon, authenticated;

-- Keep the sanitized shared portfolio's percentages and cash weight fee-aware
-- without adding any transaction, fee, or absolute-amount fields.
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

    v_next := regexp_replace(
        v_def,
        'sum\(case when t\.side = ''buy'' then t\.shares \* t\.price else 0 end\)',
        'sum(case when t.side = ''buy'' then t.shares * t.price + coalesce(t.fees_usd, 0) else 0 end)'
    );
    if v_next = v_def then
        raise exception 'could not patch shared portfolio average cost';
    end if;
    v_def := v_next;

    v_next := regexp_replace(
        v_def,
        'select sum\(t\.shares \* t\.price\)',
        'select sum(t.shares * t.price + coalesce(t.fees_usd, 0))'
    );
    if v_next = v_def then
        raise exception 'could not patch shared portfolio buy cash amount';
    end if;
    v_def := v_next;

    v_next := regexp_replace(
        v_def,
        'select sum\(t\.shares \* t\.price\)',
        'select sum(t.shares * t.price - coalesce(t.fees_usd, 0))'
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
