-- DCA Tracker — expose sanitized cash weight for shared portfolio reports.
-- positions[].weight_pct remains the weight within securities only.
-- cash_weight_pct is uninvested cash / total NAV; no absolute amount is exposed.

create or replace function public.shared_portfolio(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user_id uuid;
    v_result  jsonb;
    v_has_snapshot boolean;
begin
    select user_id into v_user_id
    from public.share_links
    where token = p_token
      and revoked = false
      and (expires_at is null or expires_at > now())
    limit 1;

    if v_user_id is null then
        return jsonb_build_object('error', 'invalid_or_expired_token');
    end if;

    select exists (
        select 1
        from public.transactions t
        join public.quote_snapshots q on q.ticker = upper(t.ticker)
        where t.user_id = v_user_id
          and q.price is not null
    ) into v_has_snapshot;

    with stats as (
        select
            t.ticker,
            sum(case when t.side = 'buy' then t.shares else 0 end)               as buy_shares,
            sum(case when t.side = 'buy' then t.shares * t.price else 0 end)     as buy_notional,
            sum(case when t.side = 'sell' then t.shares else 0 end)              as sell_shares,
            sum(case when t.side = 'buy' then t.shares else -t.shares end)       as net_shares
        from public.transactions t
        where t.user_id = v_user_id
        group by t.ticker
    ),
    pos as (
        select
            ticker,
            net_shares,
            case when buy_shares > 0 then buy_notional / buy_shares else 0 end as avg_buy_price,
            case when buy_shares > 0
                 then (buy_notional / buy_shares) * net_shares
                 else 0 end as remaining_cost
        from stats
        where net_shares > 0
    ),
    enriched as (
        select
            p.ticker,
            p.net_shares,
            p.avg_buy_price,
            q.price as current_price,
            q.change_pct as day_change_pct,
            p.net_shares * coalesce(q.price, p.avg_buy_price) as market_value,
            case when p.remaining_cost > 0
                 then (p.net_shares * coalesce(q.price, p.avg_buy_price) - p.remaining_cost) / p.remaining_cost
                 else 0 end as return_pct
        from pos p
        left join public.quote_snapshots q on q.ticker = p.ticker
    ),
    totals as (
        select
            coalesce(sum(e.market_value), 0) as total_mv,
            greatest(
                coalesce((
                    select sum(coalesce(c.usd_amount, 0))
                    from public.cashflows c
                    where c.user_id = v_user_id
                ), 0)
                - coalesce((
                    select sum(t.shares * t.price)
                    from public.transactions t
                    where t.user_id = v_user_id
                      and t.side = 'buy'
                ), 0)
                + coalesce((
                    select sum(t.shares * t.price)
                    from public.transactions t
                    where t.user_id = v_user_id
                      and t.side = 'sell'
                ), 0),
                0
            ) as cash_mv
        from enriched e
    ),
    nav as (
        select total_mv, cash_mv, total_mv + cash_mv as total_nav
        from totals
    )
    select jsonb_build_object(
        'positions', coalesce(
            (select jsonb_agg(jsonb_build_object(
                'ticker', ticker,
                -- Explicitly securities-only; the caller can combine this with cash_weight_pct.
                'weight_pct', case when (select total_mv from nav) > 0
                                   then market_value / (select total_mv from nav)
                                   else 0 end,
                'return_pct', return_pct,
                'day_change_pct', day_change_pct
            ) order by market_value desc) from enriched),
            '[]'::jsonb
        ),
        'total_return_pct', coalesce(
            (select sum(return_pct * (market_value / nullif((select total_mv from nav), 0))) from enriched),
            0
        ),
        'cash_weight_pct', case when (select total_nav from nav) > 0
                               then (select cash_mv from nav) / (select total_nav from nav)
                               else 0 end,
        'has_snapshot_price', v_has_snapshot,
        'generated_at', to_jsonb(now())
    ) into v_result;

    return v_result;
end;
$$;

grant execute on function public.shared_portfolio(text) to anon, authenticated;
