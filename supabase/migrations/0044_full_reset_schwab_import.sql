-- Make Schwab reset import a full replacement of user-owned portfolio inputs.
--
-- The public reset_all mode removes every transaction, cashflow, and funding
-- batch for the authenticated user, then rebuilds the confirmed ETF trades and
-- positive deposits from the current file. Settings, share links, market data,
-- and other users' rows are outside this operation.

create schema if not exists dca_private;
revoke all on schema dca_private from public, anon, authenticated;
grant usage on schema dca_private to authenticated;

alter function public.import_schwab_transactions(jsonb, jsonb, text[], text)
    set schema dca_private;
alter function dca_private.import_schwab_transactions(jsonb, jsonb, text[], text)
    rename to _import_schwab_transactions_v1;

revoke all on function dca_private._import_schwab_transactions_v1(jsonb, jsonb, text[], text)
    from public, anon, authenticated;
grant execute on function dca_private._import_schwab_transactions_v1(jsonb, jsonb, text[], text)
    to authenticated;

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
    v_row record;
    v_transactions_removed integer := 0;
    v_cashflows_removed integer := 0;
    v_funding_batches_removed integer := 0;
begin
    if v_user_id is null then
        raise exception 'not_authenticated' using errcode = '42501';
    end if;

    if p_mode not in ('append', 'reset_all', 'reset_etf') then
        raise exception 'invalid_import_mode' using errcode = '22023';
    end if;

    -- Keep the applied 0043 mode available during a migration-first rolling
    -- deploy. Only the new frontend sends reset_all.
    if p_mode in ('append', 'reset_etf') then
        v_result := dca_private._import_schwab_transactions_v1(
            p_rows,
            p_cashflows,
            p_etf_symbols,
            p_mode
        );
        return v_result || jsonb_build_object('funding_batches_removed', 0);
    end if;

    if jsonb_typeof(p_rows) <> 'array' then
        raise exception 'rows_must_be_an_array' using errcode = '22023';
    end if;

    if jsonb_typeof(p_cashflows) <> 'array' then
        raise exception 'cashflows_must_be_an_array' using errcode = '22023';
    end if;

    if jsonb_array_length(p_rows) + jsonb_array_length(p_cashflows) = 0 then
        raise exception 'reset_requires_importable_rows' using errcode = '22023';
    end if;

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

    -- Sells go first so deleting buys cannot create a temporary oversell.
    for v_row in
        select transaction.id
        from public.transactions transaction
        where transaction.user_id = v_user_id
          and transaction.side = 'sell'
        order by
            transaction.trade_date desc,
            transaction.created_at desc,
            transaction.id desc
    loop
        delete from public.transactions
        where id = v_row.id
          and user_id = v_user_id;
    end loop;

    for v_row in
        select transaction.id
        from public.transactions transaction
        where transaction.user_id = v_user_id
          and transaction.side = 'buy'
        order by
            transaction.trade_date desc,
            transaction.created_at desc,
            transaction.id desc
    loop
        delete from public.transactions
        where id = v_row.id
          and user_id = v_user_id;
    end loop;

    delete from public.cashflows cashflow
    where cashflow.user_id = v_user_id;

    delete from public.funding_batches batch
    where batch.user_id = v_user_id;

    -- The old append path performs all row validation and inserts. Any failure
    -- raises inside this same RPC transaction and rolls the deletions back.
    v_result := dca_private._import_schwab_transactions_v1(
        p_rows,
        p_cashflows,
        p_etf_symbols,
        'append'
    );

    return v_result || jsonb_build_object(
        'removed',
            v_transactions_removed
            + v_cashflows_removed
            + v_funding_batches_removed,
        'transactions_removed', v_transactions_removed,
        'cashflows_removed', v_cashflows_removed,
        'funding_batches_removed', v_funding_batches_removed
    );
end;
$$;

revoke all on function public.import_schwab_transactions(jsonb, jsonb, text[], text)
    from public, anon, authenticated;
grant execute on function public.import_schwab_transactions(jsonb, jsonb, text[], text)
    to authenticated;
