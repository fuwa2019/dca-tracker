-- Preserve the precision emitted by Portfolio Analyzer transaction CSV files.

set lock_timeout = '5s';

-- PostgreSQL tracks UPDATE OF trigger column lists as dependencies, so the
-- import-identity trigger must be recreated around the type changes.
drop trigger if exists transactions_clear_import_identity on public.transactions;

alter table public.transactions
    alter column shares type numeric(18, 10)
        using shares::numeric(18, 10),
    alter column price type numeric(22, 12)
        using price::numeric(22, 12),
    alter column fees_usd type numeric(22, 10)
        using fees_usd::numeric(22, 10);

create trigger transactions_clear_import_identity
before update of trade_date, ticker, side, price, shares, fees_usd
on public.transactions
for each row execute function public._clear_transaction_import_identity_on_edit();

-- Migration 0044 moved the original security-invoker implementation into
-- dca_private. Patch that deployed helper so append and reset_all share the
-- widened validation and import-key contract without duplicating its body.
do $$
declare
    v_def text;
    v_next text;
begin
    select pg_get_functiondef(
        'dca_private._import_schwab_transactions_v1(jsonb,jsonb,text[],text)'::regprocedure
    ) into v_def;

    if v_def is null then
        raise exception '_import_schwab_transactions_v1 is missing';
    end if;

    v_next := replace(
        v_def,
        'to_char(row_data.price, ''FM999999999999990.0000'')',
        'to_char(row_data.price, ''FM999999999999990.000000000000'')'
    );
    if v_next = v_def then
        raise exception 'could not widen transaction price import identity';
    end if;
    v_def := v_next;

    v_next := replace(
        v_def,
        'to_char(row_data.shares, ''FM999999999999990.000000'')',
        'to_char(row_data.shares, ''FM999999999999990.0000000000'')'
    );
    if v_next = v_def then
        raise exception 'could not widen transaction shares import identity';
    end if;
    v_def := v_next;

    v_next := replace(
        v_def,
        'to_char(coalesce(row_data.fees_usd, 0), ''FM999999999999990.00'')',
        'to_char(coalesce(row_data.fees_usd, 0), ''FM999999999999990.0000000000'')'
    );
    if v_next = v_def then
        raise exception 'could not widen transaction fee import identity';
    end if;
    v_def := v_next;

    v_next := replace(
        v_def,
        'shares <> round(shares, 6)',
        'shares <> round(shares, 10)'
    );
    if v_next = v_def then
        raise exception 'could not widen transaction shares validation';
    end if;
    v_def := v_next;

    v_next := replace(
        v_def,
        'price <> round(price, 4)',
        'price <> round(price, 12)'
    );
    if v_next = v_def then
        raise exception 'could not widen transaction price validation';
    end if;
    v_def := v_next;

    v_next := replace(
        v_def,
        'fees_usd <> round(fees_usd, 2)',
        'fees_usd <> round(fees_usd, 10)'
    );
    if v_next = v_def then
        raise exception 'could not widen transaction fee validation';
    end if;

    execute v_next;
end;
$$;

alter function dca_private._import_schwab_transactions_v1(jsonb, jsonb, text[], text)
    security invoker;

revoke all on function dca_private._import_schwab_transactions_v1(jsonb, jsonb, text[], text)
    from public, anon, authenticated;
grant execute on function dca_private._import_schwab_transactions_v1(jsonb, jsonb, text[], text)
    to authenticated;

reset lock_timeout;
