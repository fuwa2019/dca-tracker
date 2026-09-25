-- Rollback for supabase/migrations/0058_ledger_accounts_and_fx_conversion.sql.
-- Production use requires explicit authorization for this exact operation.
-- Run in one transaction. Section B is optional and restores row data.

begin;

-- A. Schema rollback -------------------------------------------------------
-- fx_conversion rows become imported FX legs (fx_transfer without CNY), the
-- representation 0050-0057 already accepted and the ledger treats as internal.
update public.cashflows
set cashflow_kind = 'fx_transfer'
where cashflow_kind = 'fx_conversion';

alter table public.cashflows drop constraint if exists cashflows_kind_fields_check;
alter table public.cashflows
    add constraint cashflows_kind_fields_check
    check (
        (cashflow_kind = 'fx_transfer' and ((cny_amount > 0 and target_rate > 0)
            or (cny_amount is null and target_rate is null and usd_amount is not null)))
        or (cashflow_kind = 'broker_deposit' and cny_amount is null and target_rate is null and usd_amount > 0)
        or (cashflow_kind = 'broker_withdrawal' and cny_amount is null and target_rate is null and usd_amount < 0)
        or (cashflow_kind = 'stock_allocation' and cny_amount is null and target_rate is null and usd_amount < 0)
        or (cashflow_kind in ('dividend', 'interest') and cny_amount is null and target_rate is null and usd_amount <> 0)
        or (cashflow_kind in ('tax', 'fee') and cny_amount is null and target_rate is null and usd_amount < 0)
    );

do $$
declare
    v_def text;
begin
    select pg_get_functiondef('public._import_portfolio_ledger_legacy(text,jsonb,jsonb,text)'::regprocedure) into v_def;
    execute replace(v_def,
        '''stock_allocation'', ''dividend'', ''interest'', ''tax'', ''fee'', ''fx_conversion''',
        '''stock_allocation'', ''dividend'', ''interest'', ''tax'', ''fee''');
end;
$$;

drop trigger if exists transactions_assign_account on public.transactions;
drop trigger if exists cashflows_assign_account on public.cashflows;
drop function if exists public._assign_ledger_account();
drop function if exists public._ledger_account_for(uuid, text);
alter table public.transactions drop column if exists account_id;
alter table public.cashflows drop column if exists account_id;
drop table if exists public.accounts;

-- B. Optional data restore to the moment 0058 ran ----------------------------
-- Replaces current rows with the backup; anything imported after 0058 is lost.
-- The backup tables carry an extra leading `backed_up_at` column, so restore
-- with an explicit column list (the current columns of each table):
--   delete from public.transactions;
--   insert into public.transactions (<columns>) select <columns> from ledger_backup.transactions_0058;
--   delete from public.cashflows;
--   insert into public.cashflows (<columns>) select <columns> from ledger_backup.cashflows_0058;

commit;
