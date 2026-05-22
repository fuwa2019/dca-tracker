-- DCA Tracker — shared_history v1
-- Returns the per-day return-pct series for both the share owner's portfolio
-- and an SPY benchmark aligned to the same cashflow schedule.
--
-- All absolute USD values stay inside this function — the only fields emitted
-- are dates and percentages. This matches the privacy contract of the share view.
--
-- Mirror of frontend buildEquityHistory() in src/lib/calc/history.ts:
--   - Iterate calendar days from earliest event to today
--   - On cashflow dates: invest cash (queue SPY purchase if no close today)
--   - On trade dates: adjust netShares + costBasis
--   - End of day: navUser = Σ shares × close + (invested − costBasis)
--                 navSpy  = spyShares × spyClose
--   - returnPct = (nav − invested) / invested

create extension if not exists hstore;

create or replace function public.shared_history(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user_id uuid;
    v_start date;
    v_today date := current_date;
    v_d date;
    v_invested numeric := 0;
    v_cost_basis numeric := 0;
    v_spy_shares numeric := 0;
    v_pending_spy numeric := 0;
    v_stock_mv numeric := 0;
    v_cash_on_day numeric := 0;
    v_nav_user numeric := 0;
    v_nav_spy numeric := 0;
    v_spy_close numeric;
    v_flow numeric;
    v_results jsonb := '[]'::jsonb;
    v_last_close hstore := ''::hstore;  -- ticker → last seen close as text
    v_net_shares hstore := ''::hstore;
    r record;
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

    -- Earliest event: min(usd_in_date, trade_date)
    select least(
        (select min(usd_in_date) from public.cashflows where user_id = v_user_id and usd_in_date is not null),
        (select min(trade_date) from public.transactions where user_id = v_user_id)
    ) into v_start;

    if v_start is null then
        return jsonb_build_object('series', '[]'::jsonb, 'generated_at', to_jsonb(now()));
    end if;

    v_d := v_start;
    while v_d <= v_today loop
        -- 1) Update forward-fill last_close for every ticker that has a close on v_d
        for r in
            select ticker, close from public.daily_prices where trade_date = v_d
        loop
            v_last_close := v_last_close || hstore(r.ticker, r.close::text);
        end loop;

        -- 2) Apply today's cashflow
        select coalesce(sum(usd_amount), 0) into v_flow
        from public.cashflows
        where user_id = v_user_id and usd_in_date = v_d;
        if v_flow > 0 then
            v_invested := v_invested + v_flow;
            v_pending_spy := v_pending_spy + v_flow;
        end if;

        -- 3) Drain pending SPY cash if today has a real SPY close
        v_spy_close := (select close from public.daily_prices where ticker = 'SPY' and trade_date = v_d);
        if v_spy_close is not null and v_spy_close > 0 and v_pending_spy > 0 then
            v_spy_shares := v_spy_shares + v_pending_spy / v_spy_close;
            v_pending_spy := 0;
        end if;

        -- 4) Apply today's trades: adjust netShares + costBasis
        for r in
            select ticker, side, shares, price
            from public.transactions
            where user_id = v_user_id and trade_date = v_d
        loop
            declare
                cur_shares numeric := coalesce((v_net_shares -> r.ticker)::numeric, 0);
                delta numeric := case when r.side = 'buy' then r.shares else -r.shares end;
            begin
                v_net_shares := v_net_shares || hstore(r.ticker, (cur_shares + delta)::text);
                v_cost_basis := v_cost_basis + case when r.side = 'buy' then r.shares * r.price else -r.shares * r.price end;
            end;
        end loop;

        -- 5) Compute end-of-day NAV
        v_stock_mv := 0;
        for r in select skey, svalue from each(v_net_shares) loop
            declare
                sh numeric := r.svalue::numeric;
                px text := v_last_close -> r.skey;
            begin
                if sh <> 0 and px is not null then
                    v_stock_mv := v_stock_mv + sh * px::numeric;
                end if;
            end;
        end loop;
        v_cash_on_day := v_invested - v_cost_basis;
        v_nav_user := v_stock_mv + v_cash_on_day;

        declare
            spy_px text := v_last_close -> 'SPY';
        begin
            v_nav_spy := case when spy_px is not null then v_spy_shares * spy_px::numeric else 0 end;
        end;

        v_results := v_results || jsonb_build_array(jsonb_build_object(
            'date', v_d,
            'return_pct_user', case when v_invested > 0 then (v_nav_user - v_invested) / v_invested else 0 end,
            'return_pct_spy',  case when v_invested > 0 then (v_nav_spy  - v_invested) / v_invested else 0 end
        ));

        v_d := v_d + 1;
    end loop;

    return jsonb_build_object('series', v_results, 'generated_at', to_jsonb(now()));
end;
$$;

grant execute on function public.shared_history(text) to anon, authenticated;
