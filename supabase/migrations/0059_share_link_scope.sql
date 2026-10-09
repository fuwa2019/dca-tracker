-- Share link scope: "report" (the original percentage-only share) or "full"
-- (an owner-authorized read-only view of every page except settings, with
-- absolute amounts). Decision record:
-- docs/decisions/2026-10-09-full-read-only-share-scope.md.
--
-- 1. `share_links.scope`, default 'report', so every existing link keeps the
--    percentage-only contract until the owner raises it.
-- 2. `shared_link_scope(token)`: tells the share page which view to open. It
--    carries no portfolio data and does not count a visit.
-- 3. `shared_full_ledger(token)`: the rows the private pages compute from,
--    for a valid, unexpired, unrevoked link whose scope is 'full' only. Every
--    row is rebuilt from an explicit column allowlist: no user id, no import
--    key, no batch id, no reminder email. A report-scope token gets an error
--    and nothing else. Writes stay owner-only through RLS; this function only
--    reads.

alter table public.share_links
    add column if not exists scope text not null default 'report';

do $$
begin
    if not exists (
        select 1 from pg_constraint
        where conname = 'share_links_scope_check'
          and conrelid = 'public.share_links'::regclass
    ) then
        alter table public.share_links
            add constraint share_links_scope_check check (scope in ('report', 'full'));
    end if;
end;
$$;

create or replace function public.shared_link_scope(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_scope text;
begin
    select scope into v_scope
    from public.share_links
    where token = p_token
      and revoked = false
      and (expires_at is null or expires_at > now())
    limit 1;

    if v_scope is null then
        return jsonb_build_object('error', 'invalid_or_expired_token');
    end if;
    return jsonb_build_object('scope', v_scope);
end;
$$;

revoke all on function public.shared_link_scope(text) from public;
grant execute on function public.shared_link_scope(text) to anon, authenticated;

create or replace function public.shared_full_ledger(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user_id uuid;
    v_settings jsonb;
    v_accounts jsonb;
    v_transactions jsonb;
    v_cashflows jsonb;
begin
    select user_id into v_user_id
    from public.share_links
    where token = p_token
      and scope = 'full'
      and revoked = false
      and (expires_at is null or expires_at > now())
    limit 1;

    if v_user_id is null then
        return jsonb_build_object('error', 'invalid_or_expired_token');
    end if;

    perform public._record_share_link_access(p_token);

    select jsonb_build_object(
        'target_usd', s.target_usd,
        'expected_annual_ret', s.expected_annual_ret,
        'monthly_dca_usd', s.monthly_dca_usd,
        'cost_basis_default', s.cost_basis_default,
        'watchlist', s.watchlist,
        'benchmarks', s.benchmarks,
        'selected_benchmark', s.selected_benchmark,
        'performance_method', s.performance_method,
        'updated_at', s.updated_at
    )
    into v_settings
    from public.settings s
    where s.user_id = v_user_id;

    select coalesce(jsonb_agg(jsonb_build_object(
        'id', a.id,
        'name', a.name,
        'broker', a.broker,
        'base_currency', a.base_currency,
        'statement_cash_usd', a.statement_cash_usd,
        'statement_as_of', a.statement_as_of,
        'created_at', a.created_at
    ) order by a.created_at), '[]'::jsonb)
    into v_accounts
    from public.accounts a
    where a.user_id = v_user_id;

    select coalesce(jsonb_agg(jsonb_build_object(
        'id', t.id,
        'account_id', t.account_id,
        'trade_date', t.trade_date,
        'ticker', t.ticker,
        'side', t.side,
        'price', t.price,
        'shares', t.shares,
        'fees_usd', t.fees_usd,
        'settled_amount_usd', t.settled_amount_usd,
        'source_currency', t.source_currency,
        'source_price', t.source_price,
        'source_amount', t.source_amount,
        'fx_rate_to_usd', t.fx_rate_to_usd,
        'kind', t.kind,
        'note', t.note,
        'source_description', t.source_description,
        'import_source', t.import_source,
        'created_at', t.created_at,
        'updated_at', t.updated_at
    ) order by t.trade_date desc, t.created_at desc), '[]'::jsonb)
    into v_transactions
    from public.transactions t
    where t.user_id = v_user_id;

    select coalesce(jsonb_agg(jsonb_build_object(
        'id', c.id,
        'account_id', c.account_id,
        'cny_out_date', c.cny_out_date,
        'cny_amount', c.cny_amount,
        'usd_in_date', c.usd_in_date,
        'usd_amount', c.usd_amount,
        'effective_date', c.effective_date,
        'ticker', c.ticker,
        'source_currency', c.source_currency,
        'source_amount', c.source_amount,
        'fx_rate_to_usd', c.fx_rate_to_usd,
        'target_rate', c.target_rate,
        'fees_cny', c.fees_cny,
        'fees_usd', c.fees_usd,
        'cashflow_kind', c.cashflow_kind,
        'source_action', c.source_action,
        'source_description', c.source_description,
        'import_source', c.import_source,
        'note', c.note,
        'created_at', c.created_at
    ) order by c.cny_out_date desc, c.created_at desc), '[]'::jsonb)
    into v_cashflows
    from public.cashflows c
    where c.user_id = v_user_id;

    return jsonb_build_object(
        'scope', 'full',
        'generated_at', now(),
        'settings', v_settings,
        'accounts', v_accounts,
        'transactions', v_transactions,
        'cashflows', v_cashflows
    );
end;
$$;

revoke all on function public.shared_full_ledger(text) from public;
grant execute on function public.shared_full_ledger(text) to anon, authenticated;
