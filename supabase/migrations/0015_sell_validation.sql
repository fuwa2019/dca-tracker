-- DCA Tracker — reject oversells at the database level
--
-- Previously the client-side aggregatePositions() silently capped oversells.
-- This trigger validates that a sell's shares do not exceed the current
-- net position (buys − sells) for the same user + ticker, and rejects the
-- row with a clear error before it lands in the table.

create or replace function public._check_sell_shares()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_net numeric;
begin
    if new.side = 'sell' then
        select coalesce(
            sum(case when side = 'buy' then shares else -shares end),
            0
        ) into v_net
        from public.transactions
        where user_id = new.user_id
          and upper(ticker) = upper(new.ticker)
          and (
              trade_date < new.trade_date
              or (trade_date = new.trade_date and created_at < coalesce(new.created_at, now()))
          )
          and not (tg_op = 'UPDATE' and id = new.id);

        if v_net < new.shares - 1e-9 then
            raise exception 'oversell: % shares of % on % exceeds available % (only trades on or before this date are counted)',
                new.shares, upper(new.ticker), new.trade_date, v_net;
        end if;
    end if;
    return new;
end;
$$;

revoke all on function public._check_sell_shares() from public, anon, authenticated;

drop trigger if exists transactions_check_sell_shares on public.transactions;
create trigger transactions_check_sell_shares
before insert or update on public.transactions
for each row execute function public._check_sell_shares();
