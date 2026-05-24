-- DCA Tracker: validate both old and new transaction timelines on UPDATE.
--
-- 0016 made sell validation timeline-based, but its UPDATE branch only checked
-- NEW.user_id + NEW.ticker. If a historical buy was moved to another ticker or
-- user, the OLD ticker/user timeline could be left with a past oversell.

create or replace function public._check_sell_shares()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_txn record;
    v_running numeric;
    v_old_uid uuid;
    v_new_uid uuid;
    v_old_ticker text;
    v_new_ticker text;
begin
    if tg_op = 'INSERT' then
        v_new_uid := new.user_id;
        v_new_ticker := upper(new.ticker);
        v_running := 0;

        for v_txn in
            select id, side, shares, trade_date, created_at
            from (
                select id, side, shares, trade_date, created_at
                from public.transactions
                where user_id = v_new_uid
                  and upper(ticker) = v_new_ticker

                union all

                select new.id, new.side, new.shares, new.trade_date, coalesce(new.created_at, now())
            ) t
            order by trade_date, created_at, id
        loop
            v_running := v_running
                + case when v_txn.side = 'buy' then v_txn.shares else -v_txn.shares end;

            if v_running < -1e-9 then
                raise exception
                    'transaction would create negative shares: ticker=%, date=%, side=%, shares=%, running=%',
                    v_new_ticker, v_txn.trade_date, v_txn.side, v_txn.shares, v_running
                    using errcode = '23514';
            end if;
        end loop;

        return new;
    elsif tg_op = 'DELETE' then
        v_old_uid := old.user_id;
        v_old_ticker := upper(old.ticker);
        v_running := 0;

        for v_txn in
            select id, side, shares, trade_date, created_at
            from public.transactions
            where user_id = v_old_uid
              and upper(ticker) = v_old_ticker
              and id <> old.id
            order by trade_date, created_at, id
        loop
            v_running := v_running
                + case when v_txn.side = 'buy' then v_txn.shares else -v_txn.shares end;

            if v_running < -1e-9 then
                raise exception
                    'transaction would create negative shares: ticker=%, date=%, side=%, shares=%, running=%',
                    v_old_ticker, v_txn.trade_date, v_txn.side, v_txn.shares, v_running
                    using errcode = '23514';
            end if;
        end loop;

        return old;
    elsif tg_op = 'UPDATE' then
        v_old_uid := old.user_id;
        v_new_uid := new.user_id;
        v_old_ticker := upper(old.ticker);
        v_new_ticker := upper(new.ticker);

        if v_old_uid = v_new_uid and v_old_ticker = v_new_ticker then
            v_running := 0;

            for v_txn in
                select id, side, shares, trade_date, created_at
                from (
                    select id, side, shares, trade_date, created_at
                    from public.transactions
                    where user_id = v_new_uid
                      and upper(ticker) = v_new_ticker
                      and id <> old.id

                    union all

                    select new.id, new.side, new.shares, new.trade_date, coalesce(new.created_at, now())
                ) t
                order by trade_date, created_at, id
            loop
                v_running := v_running
                    + case when v_txn.side = 'buy' then v_txn.shares else -v_txn.shares end;

                if v_running < -1e-9 then
                    raise exception
                        'transaction would create negative shares: ticker=%, date=%, side=%, shares=%, running=%',
                        v_new_ticker, v_txn.trade_date, v_txn.side, v_txn.shares, v_running
                        using errcode = '23514';
                end if;
            end loop;
        else
            -- OLD timeline after removing OLD.
            v_running := 0;

            for v_txn in
                select id, side, shares, trade_date, created_at
                from public.transactions
                where user_id = v_old_uid
                  and upper(ticker) = v_old_ticker
                  and id <> old.id
                order by trade_date, created_at, id
            loop
                v_running := v_running
                    + case when v_txn.side = 'buy' then v_txn.shares else -v_txn.shares end;

                if v_running < -1e-9 then
                    raise exception
                        'transaction would create negative shares: ticker=%, date=%, side=%, shares=%, running=%',
                        v_old_ticker, v_txn.trade_date, v_txn.side, v_txn.shares, v_running
                        using errcode = '23514';
                end if;
            end loop;

            -- NEW timeline after adding NEW.
            v_running := 0;

            for v_txn in
                select id, side, shares, trade_date, created_at
                from (
                    select id, side, shares, trade_date, created_at
                    from public.transactions
                    where user_id = v_new_uid
                      and upper(ticker) = v_new_ticker
                      and id <> old.id

                    union all

                    select new.id, new.side, new.shares, new.trade_date, coalesce(new.created_at, now())
                ) t
                order by trade_date, created_at, id
            loop
                v_running := v_running
                    + case when v_txn.side = 'buy' then v_txn.shares else -v_txn.shares end;

                if v_running < -1e-9 then
                    raise exception
                        'transaction would create negative shares: ticker=%, date=%, side=%, shares=%, running=%',
                        v_new_ticker, v_txn.trade_date, v_txn.side, v_txn.shares, v_running
                        using errcode = '23514';
                end if;
            end loop;
        end if;

        return new;
    end if;

    return null;
end;
$$;

revoke all on function public._check_sell_shares() from public, anon, authenticated;

drop trigger if exists transactions_check_sell_shares on public.transactions;
create trigger transactions_check_sell_shares
before insert or update or delete on public.transactions
for each row execute function public._check_sell_shares();
