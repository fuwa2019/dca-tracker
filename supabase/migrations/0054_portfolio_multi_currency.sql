-- Preserve broker-native prices, cash amounts and FX rates alongside the
-- existing USD canonical ledger. The old calculations continue to consume
-- transactions.price, fees_usd and settled_amount_usd as USD values.

alter table public.transactions
    add column if not exists source_currency text not null default 'USD',
    add column if not exists source_price numeric(22, 12),
    add column if not exists source_amount numeric(22, 10),
    add column if not exists fx_rate_to_usd numeric(22, 12);

alter table public.cashflows
    add column if not exists fx_rate_to_usd numeric(22, 12);

update public.transactions
set source_currency = upper(trim(coalesce(source_currency, 'USD'))),
    source_price = coalesce(source_price, price),
    source_amount = coalesce(
        source_amount,
        settled_amount_usd,
        case
            when side = 'buy' then -(shares * price + coalesce(fees_usd, 0))
            else shares * price - coalesce(fees_usd, 0)
        end
    ),
    fx_rate_to_usd = coalesce(fx_rate_to_usd, 1)
where source_currency is distinct from upper(trim(coalesce(source_currency, 'USD')))
   or source_price is null
   or source_amount is null
   or fx_rate_to_usd is null;

update public.cashflows
set source_currency = upper(trim(source_currency))
where source_currency is not null
  and source_currency is distinct from upper(trim(source_currency));

alter table public.transactions
    drop constraint if exists transactions_source_currency_check,
    drop constraint if exists transactions_source_price_check,
    drop constraint if exists transactions_source_amount_check,
    drop constraint if exists transactions_fx_rate_to_usd_check;

alter table public.transactions
    add constraint transactions_source_currency_check
        check (source_currency ~ '^[A-Z]{3}$'),
    add constraint transactions_source_price_check
        check (source_price is null or (source_price > 0 and source_price = round(source_price, 12))),
    add constraint transactions_source_amount_check
        check (source_amount is null or (abs(source_amount) < 1000000000000 and source_amount = round(source_amount, 10))),
    add constraint transactions_fx_rate_to_usd_check
        check (fx_rate_to_usd is null or (fx_rate_to_usd > 0 and fx_rate_to_usd = round(fx_rate_to_usd, 12)));

alter table public.cashflows
    drop constraint if exists cashflows_source_currency_check,
    drop constraint if exists cashflows_fx_rate_to_usd_check;

alter table public.cashflows
    add constraint cashflows_source_currency_check
        check (source_currency is null or source_currency ~ '^[A-Z]{3}$'),
    add constraint cashflows_fx_rate_to_usd_check
        check (fx_rate_to_usd is null or (fx_rate_to_usd > 0 and fx_rate_to_usd = round(fx_rate_to_usd, 12)));

create or replace function public._clear_transaction_import_identity_on_edit()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    -- The source-neutral import wrapper enriches a row immediately after the
    -- legacy insert path. Its transaction-local marker keeps that enrichment
    -- from looking like a hand edit and preserves the import identity.
    if current_setting('dca.import_portfolio_ledger', true) = '1' then
        return new;
    end if;

    if new.trade_date is distinct from old.trade_date
       or new.ticker is distinct from old.ticker
       or new.side is distinct from old.side
       or new.price is distinct from old.price
       or new.shares is distinct from old.shares
       or new.fees_usd is distinct from old.fees_usd
       or new.settled_amount_usd is distinct from old.settled_amount_usd
       or new.source_currency is distinct from old.source_currency
       or new.source_price is distinct from old.source_price
       or new.source_amount is distinct from old.source_amount
       or new.fx_rate_to_usd is distinct from old.fx_rate_to_usd then
        new.import_source := null;
        new.import_key := null;
        new.source_description := null;
    end if;
    return new;
end;
$$;

drop trigger if exists transactions_clear_import_identity on public.transactions;
create trigger transactions_clear_import_identity
before update of trade_date, ticker, side, price, shares, fees_usd,
    settled_amount_usd, source_currency, source_price, source_amount, fx_rate_to_usd
on public.transactions
for each row execute function public._clear_transaction_import_identity_on_edit();

create or replace function public._clear_cashflow_import_identity_on_edit()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    if current_setting('dca.import_portfolio_ledger', true) = '1' then
        return new;
    end if;

    if new.cny_out_date is distinct from old.cny_out_date
       or new.usd_in_date is distinct from old.usd_in_date
       or new.effective_date is distinct from old.effective_date
       or new.ticker is distinct from old.ticker
       or new.source_currency is distinct from old.source_currency
       or new.source_amount is distinct from old.source_amount
       or new.fx_rate_to_usd is distinct from old.fx_rate_to_usd
       or new.usd_amount is distinct from old.usd_amount
       or new.cashflow_kind is distinct from old.cashflow_kind then
        new.import_source := null;
        new.import_key := null;
        new.source_action := null;
        new.source_description := null;
    end if;
    return new;
end;
$$;

drop trigger if exists cashflows_clear_import_identity on public.cashflows;
create trigger cashflows_clear_import_identity
before update of cny_out_date, usd_in_date, effective_date, ticker,
    source_currency, source_amount, fx_rate_to_usd, usd_amount, cashflow_kind
on public.cashflows
for each row execute function public._clear_cashflow_import_identity_on_edit();

-- Keep the already validated, source-neutral implementation as the canonical
-- USD write primitive. The new public entry point below normalizes native
-- currency fields before delegating to it, then restores the original fields.
alter function public.import_portfolio_ledger(text, jsonb, jsonb, text)
    rename to _import_portfolio_ledger_legacy;

create or replace function public.import_portfolio_ledger(
    p_source text,
    p_trades jsonb,
    p_cash_events jsonb,
    p_mode text
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
    v_user_id uuid := auth.uid();
    v_source text := lower(trim(coalesce(p_source, '')));
    v_mode text := lower(trim(coalesce(p_mode, '')));
    v_row jsonb;
    v_currency text;
    v_source_price numeric;
    v_source_amount numeric;
    v_fx_rate numeric;
    v_usd_amount numeric;
    v_canonical_price numeric;
    v_fees_usd numeric;
    v_import_key text;
    v_trades jsonb := '[]'::jsonb;
    v_cash_events jsonb := '[]'::jsonb;
    v_result jsonb;
begin
    if v_user_id is null then
        raise exception 'not_authenticated' using errcode = '42501';
    end if;
    if v_source not in ('schwab', 'ibkr', 'tradingview') then
        raise exception 'invalid_import_source' using errcode = '22023';
    end if;
    if v_mode not in ('append', 'replace_source', 'reset_all') then
        raise exception 'invalid_import_mode' using errcode = '22023';
    end if;
    if jsonb_typeof(p_trades) is distinct from 'array' then
        raise exception 'trades_must_be_an_array' using errcode = '22023';
    end if;
    if jsonb_typeof(p_cash_events) is distinct from 'array' then
        raise exception 'cash_events_must_be_an_array' using errcode = '22023';
    end if;
    if jsonb_array_length(p_trades) + jsonb_array_length(p_cash_events) = 0 then
        raise exception 'import_requires_rows' using errcode = '22023';
    end if;
    if jsonb_array_length(p_trades) + jsonb_array_length(p_cash_events) > 10000 then
        raise exception 'too_many_import_rows' using errcode = '22023';
    end if;

    for v_row in select value from jsonb_array_elements(p_trades) as entries(value)
    loop
        v_currency := upper(coalesce(nullif(trim(v_row->>'source_currency'), ''), 'USD'));
        v_source_price := coalesce(
            nullif(nullif(trim(coalesce(v_row->>'source_price', '')), ''), 'null')::numeric,
            nullif(nullif(trim(coalesce(v_row->>'price', '')), ''), 'null')::numeric
        );
        v_source_amount := nullif(nullif(trim(coalesce(v_row->>'source_amount', '')), ''), 'null')::numeric;
        v_fx_rate := nullif(nullif(trim(coalesce(v_row->>'fx_rate_to_usd', '')), ''), 'null')::numeric;
        v_usd_amount := nullif(nullif(trim(coalesce(v_row->>'usd_amount', '')), ''), 'null')::numeric;
        v_fees_usd := coalesce(nullif(nullif(trim(coalesce(v_row->>'fees_usd', '')), ''), 'null')::numeric, 0);

        if v_currency !~ '^[A-Z]{3}$' then
            raise exception 'invalid_source_currency' using errcode = '22023';
        end if;
        if v_currency = 'USD' then
            v_fx_rate := 1;
            v_source_amount := coalesce(v_source_amount, v_usd_amount);
            v_usd_amount := coalesce(v_usd_amount, v_source_amount);
            v_canonical_price := v_source_price;
        else
            if v_source_amount is null and v_usd_amount is not null and v_fx_rate is not null and v_fx_rate > 0 then
                v_source_amount := v_usd_amount / v_fx_rate;
            end if;
            if v_fx_rate is null and v_source_amount is not null and v_usd_amount is not null and v_source_amount <> 0 then
                v_fx_rate := abs(v_usd_amount / v_source_amount);
            end if;
            if v_fx_rate is null or v_fx_rate <= 0 or v_source_amount is null then
                raise exception 'invalid_multi_currency_conversion' using errcode = '22023';
            end if;
            v_usd_amount := coalesce(v_usd_amount, v_source_amount * v_fx_rate);
            v_canonical_price := v_source_price * v_fx_rate;
        end if;

        if lower(trim(coalesce(v_row->>'side', ''))) in ('buy', 'sell')
           and (v_source_price is null or v_source_price <= 0 or v_canonical_price is null or v_canonical_price <= 0) then
            raise exception 'invalid_multi_currency_trade_price' using errcode = '22023';
        end if;
        if v_source_amount is null or v_usd_amount is null or v_fx_rate is null then
            raise exception 'invalid_multi_currency_amount' using errcode = '22023';
        end if;

        v_trades := v_trades || jsonb_build_array(
            v_row || jsonb_build_object(
                'price', v_canonical_price,
                'fees_usd', v_fees_usd,
                'usd_amount', v_usd_amount,
                'source_currency', 'USD'
            )
        );
    end loop;

    for v_row in select value from jsonb_array_elements(p_cash_events) as entries(value)
    loop
        v_currency := upper(coalesce(nullif(trim(v_row->>'source_currency'), ''), 'USD'));
        v_source_amount := nullif(nullif(trim(coalesce(v_row->>'source_amount', '')), ''), 'null')::numeric;
        v_fx_rate := nullif(nullif(trim(coalesce(v_row->>'fx_rate_to_usd', '')), ''), 'null')::numeric;
        v_usd_amount := nullif(nullif(trim(coalesce(v_row->>'usd_amount', '')), ''), 'null')::numeric;

        if v_currency !~ '^[A-Z]{3}$' then
            raise exception 'invalid_source_currency' using errcode = '22023';
        end if;
        if v_currency = 'USD' then
            v_fx_rate := 1;
            v_source_amount := coalesce(v_source_amount, v_usd_amount);
            v_usd_amount := coalesce(v_usd_amount, v_source_amount);
        else
            if v_source_amount is null and v_usd_amount is not null and v_fx_rate is not null and v_fx_rate > 0 then
                v_source_amount := v_usd_amount / v_fx_rate;
            end if;
            if v_fx_rate is null and v_source_amount is not null and v_usd_amount is not null and v_source_amount <> 0 then
                v_fx_rate := abs(v_usd_amount / v_source_amount);
            end if;
            if v_fx_rate is null or v_fx_rate <= 0 or v_source_amount is null then
                raise exception 'invalid_multi_currency_conversion' using errcode = '22023';
            end if;
            v_usd_amount := coalesce(v_usd_amount, v_source_amount * v_fx_rate);
        end if;
        if v_source_amount is null or v_usd_amount is null or v_fx_rate is null then
            raise exception 'invalid_multi_currency_amount' using errcode = '22023';
        end if;

        v_cash_events := v_cash_events || jsonb_build_array(
            v_row || jsonb_build_object(
                'source_amount', v_usd_amount,
                'usd_amount', v_usd_amount,
                'source_currency', 'USD'
            )
        );
    end loop;

    -- The marker is local to this transaction and is checked by both identity
    -- triggers while the canonical write is enriched with native fields.
    perform set_config('dca.import_portfolio_ledger', '1', true);
    v_result := public._import_portfolio_ledger_legacy(v_source, v_trades, v_cash_events, v_mode);

    for v_row in select value from jsonb_array_elements(p_trades) as entries(value)
    loop
        v_import_key := nullif(trim(v_row->>'import_key'), '');
        if v_import_key is null then continue; end if;
        v_currency := upper(coalesce(nullif(trim(v_row->>'source_currency'), ''), 'USD'));
        v_source_price := coalesce(
            nullif(nullif(trim(coalesce(v_row->>'source_price', '')), ''), 'null')::numeric,
            nullif(nullif(trim(coalesce(v_row->>'price', '')), ''), 'null')::numeric
        );
        v_source_amount := coalesce(
            nullif(nullif(trim(coalesce(v_row->>'source_amount', '')), ''), 'null')::numeric,
            nullif(nullif(trim(coalesce(v_row->>'usd_amount', '')), ''), 'null')::numeric
        );
        v_fx_rate := case when v_currency = 'USD' then 1 else nullif(nullif(trim(coalesce(v_row->>'fx_rate_to_usd', '')), ''), 'null')::numeric end;
        update public.transactions
        set source_currency = v_currency,
            source_price = v_source_price,
            source_amount = v_source_amount,
            fx_rate_to_usd = v_fx_rate
        where user_id = v_user_id
          and import_source = v_source
          and import_key = v_import_key;
    end loop;

    for v_row in select value from jsonb_array_elements(p_cash_events) as entries(value)
    loop
        v_import_key := nullif(trim(v_row->>'import_key'), '');
        if v_import_key is null then continue; end if;
        v_currency := upper(coalesce(nullif(trim(v_row->>'source_currency'), ''), 'USD'));
        v_source_amount := coalesce(
            nullif(nullif(trim(coalesce(v_row->>'source_amount', '')), ''), 'null')::numeric,
            nullif(nullif(trim(coalesce(v_row->>'usd_amount', '')), ''), 'null')::numeric
        );
        v_fx_rate := case when v_currency = 'USD' then 1 else nullif(nullif(trim(coalesce(v_row->>'fx_rate_to_usd', '')), ''), 'null')::numeric end;
        update public.cashflows
        set source_currency = v_currency,
            source_amount = v_source_amount,
            fx_rate_to_usd = v_fx_rate
        where user_id = v_user_id
          and import_source = v_source
          and import_key = v_import_key;
    end loop;

    return v_result;
end;
$$;

revoke all on function public._import_portfolio_ledger_legacy(text, jsonb, jsonb, text)
    from public, anon, authenticated;
grant execute on function public._import_portfolio_ledger_legacy(text, jsonb, jsonb, text)
    to authenticated;

revoke all on function public.import_portfolio_ledger(text, jsonb, jsonb, text)
    from public, anon, authenticated;
grant execute on function public.import_portfolio_ledger(text, jsonb, jsonb, text)
    to authenticated;
