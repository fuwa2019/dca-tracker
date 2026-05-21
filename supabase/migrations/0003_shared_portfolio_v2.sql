-- DCA Tracker — shared_portfolio v2
-- Fixes: after a sell, the v1 function used unscaled cumulative buy notional
-- as the cost basis, inflating returns. v2 amortizes cost basis proportionally
-- to net_shares remaining (matches the avg-cost behavior in the dashboard).

create or replace function public.shared_portfolio(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user_id uuid;
    v_result  jsonb;
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
            -- average buy price across all buys
            case when buy_shares > 0 then buy_notional / buy_shares else 0 end as avg_buy_price,
            -- remaining cost basis after sells amortized at the average buy price
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
    total as (
        select sum(market_value) as total_mv from enriched
    )
    select jsonb_build_object(
        'positions', coalesce(
            (select jsonb_agg(jsonb_build_object(
                'ticker', ticker,
                'weight_pct', case when (select total_mv from total) > 0
                                   then market_value / (select total_mv from total)
                                   else 0 end,
                'return_pct', return_pct,
                'day_change_pct', day_change_pct
            ) order by market_value desc) from enriched),
            '[]'::jsonb
        ),
        'total_return_pct', coalesce(
            (select sum(return_pct * (market_value / nullif((select total_mv from total), 0))) from enriched),
            0
        ),
        'generated_at', to_jsonb(now())
    ) into v_result;

    return v_result;
end;
$$;

grant execute on function public.shared_portfolio(text) to anon, authenticated;
