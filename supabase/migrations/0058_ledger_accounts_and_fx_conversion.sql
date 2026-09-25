-- Ledger accounts, daily FX conversion P&L, and a pre-change backup.
--
-- 1. Snapshot transactions and cashflows into the private `ledger_backup`
--    schema before anything changes. Rollback:
--    docs/runbooks/0058-ledger-accounts-rollback.sql.
-- 2. `accounts` (one per broker account) with RLS, plus nullable
--    `transactions.account_id` / `cashflows.account_id`. Existing imported
--    rows are assigned to a Schwab or IBKR account by their import_source;
--    manual rows stay unassigned until the owner chooses. Imports assign new
--    rows automatically through a trigger, so the import RPC is unchanged.
-- 3. `fx_conversion`: the net FX conversion gain or cost inside a broker
--    account, one row per day. Internal to the portfolio (return, not capital).
-- 4. Broker statement cash on the account, for cash reconciliation.

-- 1. Backup -----------------------------------------------------------------
create schema if not exists ledger_backup;
revoke all on schema ledger_backup from public, anon, authenticated;

create table if not exists ledger_backup.transactions_0058 as
    select now() as backed_up_at, t.* from public.transactions t;
create table if not exists ledger_backup.cashflows_0058 as
    select now() as backed_up_at, c.* from public.cashflows c;
revoke all on all tables in schema ledger_backup from public, anon, authenticated;

-- 2. Accounts ---------------------------------------------------------------
create table if not exists public.accounts (
    id                  uuid primary key default gen_random_uuid(),
    user_id             uuid not null references auth.users(id) on delete cascade,
    name                text not null check (char_length(trim(name)) between 1 and 60),
    broker              text not null check (broker in ('schwab', 'ibkr', 'other')),
    base_currency       text not null default 'USD' check (base_currency ~ '^[A-Z]{3}$'),
    statement_cash_usd  numeric(22, 10),
    statement_as_of     date,
    created_at          timestamptz not null default now(),
    constraint accounts_statement_pair check ((statement_cash_usd is null) = (statement_as_of is null)),
    constraint accounts_user_broker_name_key unique (user_id, broker, name)
);
create index if not exists accounts_user_idx on public.accounts (user_id);

alter table public.accounts enable row level security;
drop policy if exists "accounts_owner_select" on public.accounts;
drop policy if exists "accounts_owner_insert" on public.accounts;
drop policy if exists "accounts_owner_update" on public.accounts;
drop policy if exists "accounts_owner_delete" on public.accounts;
create policy "accounts_owner_select" on public.accounts for select using ((select auth.uid()) = user_id);
create policy "accounts_owner_insert" on public.accounts for insert with check ((select auth.uid()) = user_id);
create policy "accounts_owner_update" on public.accounts for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "accounts_owner_delete" on public.accounts for delete using ((select auth.uid()) = user_id);
revoke all on public.accounts from anon;
grant select, insert, update, delete on public.accounts to authenticated;

alter table public.transactions
    add column if not exists account_id uuid references public.accounts(id) on delete set null;
alter table public.cashflows
    add column if not exists account_id uuid references public.accounts(id) on delete set null;
create index if not exists transactions_account_idx on public.transactions (account_id);
create index if not exists cashflows_account_idx on public.cashflows (account_id);

-- An account row for (user, broker), created on first use.
create or replace function public._ledger_account_for(p_user_id uuid, p_broker text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_id uuid;
    v_name text := case p_broker when 'schwab' then 'Schwab' when 'ibkr' then 'IBKR' else 'Other' end;
begin
    select id into v_id
    from public.accounts
    where user_id = p_user_id and broker = p_broker
    order by created_at
    limit 1;
    if v_id is null then
        insert into public.accounts (user_id, name, broker)
        values (p_user_id, v_name, p_broker)
        on conflict (user_id, broker, name) do update set name = excluded.name
        returning id into v_id;
    end if;
    return v_id;
end;
$$;
revoke all on function public._ledger_account_for(uuid, text) from public, anon, authenticated;

-- Imported rows land in their broker's account; an explicit account must
-- belong to the row's owner.
create or replace function public._assign_ledger_account()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if new.account_id is null and new.import_source in ('schwab', 'ibkr') then
        new.account_id := public._ledger_account_for(new.user_id, new.import_source);
    elsif new.account_id is not null and not exists (
        select 1 from public.accounts a where a.id = new.account_id and a.user_id = new.user_id
    ) then
        raise exception 'account_not_owned' using errcode = '42501';
    end if;
    return new;
end;
$$;
revoke all on function public._assign_ledger_account() from public, anon, authenticated;

drop trigger if exists transactions_assign_account on public.transactions;
create trigger transactions_assign_account
before insert or update of account_id, import_source on public.transactions
for each row execute function public._assign_ledger_account();

drop trigger if exists cashflows_assign_account on public.cashflows;
create trigger cashflows_assign_account
before insert or update of account_id, import_source on public.cashflows
for each row execute function public._assign_ledger_account();

-- Backfill existing imported rows. Manual rows (import_source null) are left
-- unassigned and listed by the notice below.
do $$
declare
    v_row record;
    v_manual_txn integer;
    v_manual_cash integer;
begin
    for v_row in
        select distinct user_id, import_source from public.transactions where import_source in ('schwab', 'ibkr')
        union
        select distinct user_id, import_source from public.cashflows where import_source in ('schwab', 'ibkr')
    loop
        perform public._ledger_account_for(v_row.user_id, v_row.import_source);
    end loop;

    update public.transactions t
    set account_id = a.id
    from public.accounts a
    where t.account_id is null and t.import_source in ('schwab', 'ibkr')
      and a.user_id = t.user_id and a.broker = t.import_source;

    update public.cashflows c
    set account_id = a.id
    from public.accounts a
    where c.account_id is null and c.import_source in ('schwab', 'ibkr')
      and a.user_id = c.user_id and a.broker = c.import_source;

    select count(*) into v_manual_txn from public.transactions where account_id is null;
    select count(*) into v_manual_cash from public.cashflows where account_id is null;
    raise notice '0058: unassigned manual rows: % transactions, % cashflows', v_manual_txn, v_manual_cash;
end;
$$;

-- 3. fx_conversion ----------------------------------------------------------
alter table public.cashflows
    drop constraint if exists cashflows_kind_fields_check;

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
            cashflow_kind in ('dividend', 'interest', 'fx_conversion')
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
    );

-- The ledger importer validates event kinds against a literal list. Patch
-- that list in place, exactly once, so the 0054 wrapper keeps its contract.
do $$
declare
    v_def text;
    v_next text;
    v_old text := '''stock_allocation'', ''dividend'', ''interest'', ''tax'', ''fee''';
    v_new text := '''stock_allocation'', ''dividend'', ''interest'', ''tax'', ''fee'', ''fx_conversion''';
begin
    select pg_get_functiondef(
        'public._import_portfolio_ledger_legacy(text,jsonb,jsonb,text)'::regprocedure
    ) into v_def;
    if v_def is null then
        raise exception '_import_portfolio_ledger_legacy is missing';
    end if;
    if position(v_new in v_def) > 0 then
        return;
    end if;
    if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then
        raise exception 'unexpected ledger cash-event kind list';
    end if;
    v_next := replace(v_def, v_old, v_new);
    execute v_next;
end;
$$;

comment on table public.accounts is
    'Broker accounts. statement_cash_usd/statement_as_of hold the latest broker-reported cash for reconciliation.';
comment on column public.cashflows.account_id is
    'Owning broker account; null for manual rows the owner has not assigned.';
