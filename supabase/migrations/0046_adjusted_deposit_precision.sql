-- Preserve adjusted Portfolio CSV deposit precision after stock funding is removed.

set lock_timeout = '5s';

-- PostgreSQL tracks UPDATE OF trigger columns as dependencies, so recreate the
-- import-identity trigger around the cash amount type change.
drop trigger if exists cashflows_clear_import_identity on public.cashflows;

alter table public.cashflows
    alter column usd_amount type numeric(22, 10)
        using usd_amount::numeric(22, 10);

create trigger cashflows_clear_import_identity
before update of cny_out_date, usd_in_date, usd_amount, cashflow_kind
on public.cashflows
for each row execute function public._clear_cashflow_import_identity_on_edit();

-- Migration 0044 moved the security-invoker implementation into dca_private.
-- Patch only its deposit precision and identity contract in place.
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
        'to_char(row_data.amount, ''FM999999999999990.00'')',
        'to_char(row_data.amount, ''FM999999999999990.0000000000'')'
    );
    if v_next = v_def then
        raise exception 'could not widen deposit import identity';
    end if;
    v_def := v_next;

    v_next := replace(
        v_def,
        'amount <> round(amount, 2)',
        'amount <> round(amount, 10)'
    );
    if v_next = v_def then
        raise exception 'could not widen deposit validation';
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
