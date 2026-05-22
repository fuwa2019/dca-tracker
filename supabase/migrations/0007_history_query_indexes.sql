-- DCA Tracker — history RPC query indexes
--
-- The portfolio/share history functions iterate day by day and need to look up
-- daily_prices by trade_date. The primary key is (ticker, trade_date), which is
-- not enough for date-only scans, so large price tables can make shared_history
-- appear to hang.

create index if not exists daily_prices_trade_date_ticker_idx
    on public.daily_prices (trade_date, ticker);

create index if not exists cashflows_user_usd_in_date_idx
    on public.cashflows (user_id, usd_in_date)
    where usd_in_date is not null;
