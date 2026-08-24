-- Ledger TWR V2: a second cached method, written from outside the database.
--
-- `docs/research/competitive/2026-08/requirements-audit.md` D1 asks for the
-- dashboard and the public share to read one V2 cache without leaking amounts.
-- Three facts shaped this migration.
--
-- 1. `performance_history_cache` is already keyed `(user_id, benchmark, method)`
--    but every reader hardcodes `method = 'TWR'`. A V2 row can therefore sit
--    beside the V1 row instead of replacing it, and V1 stays byte-for-byte the
--    default until an owner opts in.
-- 2. The V1 engine (`_performance_history_for_user_fast_base`) has no static
--    definition anywhere: 0029 created it by renaming, and 0037/0043/0047 each
--    patch it in place through `pg_get_functiondef`. Nothing here touches that
--    chain. V2 gets its own clean surface.
-- 3. The reconciled V2 engine is `src/lib/calc/ledgerTwr.ts` — the same code
--    `test:finance` feeds Portfolio Performance 0.86.0's own stored ledger to,
--    reproducing its displayed value, TTWROR and IRR. Porting it to PL/pgSQL
--    would create a second implementation of a reconciled engine, free to
--    drift, with the gate covering only one of them. So the engine stays in
--    TypeScript and runs in the quote Worker under the service role, and this
--    migration provides the write surface it posts to.
--
-- The writer is deliberately not a "store this payload" RPC. It accepts a
-- series, a completeness flag and warnings, validates each against an
-- allowlist, and then *builds* the cached payload itself. A caller cannot put a
-- key into the cache at all, so an absolute amount cannot reach the public
-- boundary even if the caller is wrong or compromised. That is a stronger
-- guarantee than 0051's projection, and 0051 still applies on top of it.

-- ---------------------------------------------------------------- method flag
-- Server-side and per user. The anonymous share reader must never be able to
-- choose a method, so this is stored rather than passed in.
alter table public.settings
  add column if not exists performance_method text not null default 'adjusted_proxy_v1';

do $$
begin
    if not exists (
        select 1 from pg_constraint
        where conname = 'settings_performance_method_check'
          and conrelid = 'public.settings'::regclass
    ) then
        alter table public.settings
          add constraint settings_performance_method_check
          check (performance_method in ('adjusted_proxy_v1', 'ledger_twr_v2'));
    end if;
end;
$$;

comment on column public.settings.performance_method is
    'Which cached performance method the dashboard and the public share read. Defaults to adjusted_proxy_v1; ledger_twr_v2 is the separately gated switch.';

create or replace function public._selected_performance_method_for_user(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
    select coalesce(
        (
            select case
                when performance_method in ('adjusted_proxy_v1', 'ledger_twr_v2')
                    then performance_method
                else 'adjusted_proxy_v1'
            end
            from public.settings
            where user_id = p_user_id
        ),
        'adjusted_proxy_v1'
    );
$$;

revoke all on function public._selected_performance_method_for_user(uuid) from public, anon, authenticated;

-- The cache row's `method` column predates the product-level method name: V1
-- rows have always been stored as 'TWR'. Keep that mapping in one place rather
-- than spreading the literal through the readers.
create or replace function public._performance_cache_method_key(p_method text)
returns text
language sql
immutable
set search_path = public
as $$
    select case when p_method = 'ledger_twr_v2' then 'ledger_twr_v2' else 'TWR' end;
$$;

revoke all on function public._performance_cache_method_key(text) from public, anon, authenticated;

-- ------------------------------------------------------------------ the writer
create or replace function public.write_ledger_performance_cache(
    p_user_id uuid,
    p_benchmark text,
    p_series jsonb,
    p_complete boolean default true,
    p_warnings jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_benchmark text;
    v_series jsonb;
    v_warnings jsonb;
    v_payload jsonb;
    v_bad text;
begin
    if p_user_id is null then
        raise exception 'write_ledger_performance_cache: p_user_id is required';
    end if;
    if jsonb_typeof(p_series) <> 'array' then
        raise exception 'write_ledger_performance_cache: p_series must be a JSON array, got %',
            coalesce(jsonb_typeof(p_series), 'null');
    end if;

    v_benchmark := upper(coalesce(nullif(trim(p_benchmark), ''), 'SPY'));

    -- Every series entry: only these three keys, ever. A key outside the list
    -- is an error rather than a silent drop, so a caller that starts emitting
    -- amounts fails loudly instead of quietly writing them.
    select string_agg(distinct entry.key, ', ')
    into v_bad
    from jsonb_array_elements(p_series) as element(value),
         jsonb_each(element.value) as entry
    where entry.key not in ('date', 'return_pct_user', 'return_pct_spy');

    if v_bad is not null then
        raise exception 'write_ledger_performance_cache: series entries may only carry date, return_pct_user and return_pct_spy; got %', v_bad;
    end if;

    if exists (
        select 1 from jsonb_array_elements(p_series) as element(value)
        where jsonb_typeof(element.value) <> 'object'
           or element.value ->> 'date' is null
           or (element.value ->> 'date') !~ '^\d{4}-\d{2}-\d{2}$'
    ) then
        raise exception 'write_ledger_performance_cache: every series entry needs an ISO yyyy-mm-dd date';
    end if;

    if exists (
        select 1 from jsonb_array_elements(p_series) as element(value)
        where jsonb_typeof(element.value -> 'return_pct_user') not in ('number', 'null')
           or jsonb_typeof(coalesce(element.value -> 'return_pct_spy', 'null'::jsonb)) not in ('number', 'null')
    ) then
        raise exception 'write_ledger_performance_cache: return_pct_user and return_pct_spy must be numbers or null';
    end if;

    -- Units: despite the `_pct` name, V1 stores these as FRACTIONS
    -- (`exp(sum(ln(factor))) - 1` in 0026, no x100), so V2 stores the engine's
    -- `cumulative_return_pct` unscaled and the two methods stay comparable.
    -- The bound stays loose deliberately: a 30-year time-weighted return at the
    -- rates this product projects can legitimately reach a fraction near 1000,
    -- and rejecting real data would break the refresh rather than protect it.
    -- So this catches only gross mistakes -- a NAV like 138499.04 landing in a
    -- return field. It does NOT catch a small amount: 921.53 passes. The
    -- guarantee is the key allowlist above, which makes an amount field
    -- unrepresentable; this check is a smell test layered on top.
    if exists (
        select 1 from jsonb_array_elements(p_series) as element(value)
        where abs(coalesce((element.value ->> 'return_pct_user')::numeric, 0)) > 1000
           or abs(coalesce((element.value ->> 'return_pct_spy')::numeric, 0)) > 1000
    ) then
        raise exception 'write_ledger_performance_cache: a return value exceeded +/-1000 (100,000%%), which is an amount, not a return';
    end if;

    -- Rebuild rather than store: the caller contributes values, never keys.
    select coalesce(
        jsonb_agg(
            jsonb_strip_nulls(jsonb_build_object(
                'date', element.value ->> 'date',
                'return_pct_user', (element.value -> 'return_pct_user'),
                'return_pct_spy', (element.value -> 'return_pct_spy')
            ))
            order by element.value ->> 'date'
        ),
        '[]'::jsonb
    )
    into v_series
    from jsonb_array_elements(p_series) as element(value);

    -- Warnings use the same allowlist the public boundary projects to in 0051,
    -- so the two cannot drift apart.
    if jsonb_typeof(p_warnings) = 'array' then
        select coalesce(
            jsonb_agg(
                coalesce(
                    (
                        select jsonb_object_agg(entry.key, entry.value)
                        from jsonb_each(element.value) as entry
                        where entry.key in ('date', 'type', 'original_date', 'ticker')
                    ),
                    '{}'::jsonb
                )
                order by element.ordinality
            ),
            '[]'::jsonb
        )
        into v_warnings
        from jsonb_array_elements(p_warnings) with ordinality as element(value, ordinality);
    else
        v_warnings := '[]'::jsonb;
    end if;

    v_payload := jsonb_build_object(
        'series', v_series,
        'benchmark', v_benchmark,
        'method', 'ledger_twr_v2',
        'complete', coalesce(p_complete, true),
        'warnings', coalesce(v_warnings, '[]'::jsonb),
        'generated_at', to_jsonb(now())
    );

    insert into public.performance_history_cache as cache
        (user_id, benchmark, method, history, dirty, generated_at, updated_at)
    values
        (p_user_id, v_benchmark, 'ledger_twr_v2', v_payload, false, now(), now())
    on conflict (user_id, benchmark, method) do update set
        history = excluded.history,
        dirty = false,
        generated_at = excluded.generated_at,
        updated_at = now();

    return jsonb_build_object(
        'ok', true,
        'benchmark', v_benchmark,
        'method', 'ledger_twr_v2',
        'points', jsonb_array_length(v_series),
        'complete', coalesce(p_complete, true)
    );
end;
$$;

comment on function public.write_ledger_performance_cache(uuid, text, jsonb, boolean, jsonb) is
    'Service-role writer for the ledger_twr_v2 performance cache. Validates the series and warnings against an allowlist and rebuilds the cached payload server-side, so a caller can never introduce a key -- absolute amounts cannot reach the cache at all.';

revoke all on function public.write_ledger_performance_cache(uuid, text, jsonb, boolean, jsonb)
    from public, anon, authenticated;
grant execute on function public.write_ledger_performance_cache(uuid, text, jsonb, boolean, jsonb)
    to service_role;

-- ----------------------------------------------------------------- the readers
-- Both readers resolve the method from the owner's settings. The V1 path is the
-- existing behaviour, unchanged, and remains the default. The V2 path reads the
-- V2 row and does NOT fall back to V1 when that row is missing: a silent
-- fallback would let the dashboard and the share report different methods,
-- which is exactly the property D1 asks us to guarantee.

create or replace function public.performance_history(p_benchmark text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_benchmark text;
    v_method text;
    v_cached jsonb;
    v_dirty boolean;
    v_updated_at timestamptz;
    v_last_refresh_attempt_at timestamptz;
    v_refresh_ms integer;
begin
    if auth.uid() is null then
        return jsonb_build_object('error', 'not_authenticated');
    end if;

    v_benchmark := public._selected_benchmark_for_user(auth.uid(), p_benchmark);
    v_method := public._selected_performance_method_for_user(auth.uid());

    if v_method = 'ledger_twr_v2' then
        select history, dirty, updated_at
        into v_cached, v_dirty, v_updated_at
        from public.performance_history_cache
        where user_id = auth.uid()
          and benchmark = v_benchmark
          and method = 'ledger_twr_v2';

        if public._history_points_count(v_cached) > 0 then
            return v_cached || jsonb_build_object(
                'dirty', coalesce(v_dirty, false),
                'updated_at', to_jsonb(v_updated_at)
            );
        end if;

        -- No SQL engine computes V2. The quote Worker fills this cache under the
        -- service role, so the honest answer here is "not generated yet".
        return jsonb_build_object(
            'error', 'history_cache_missing',
            'benchmark', v_benchmark,
            'method', 'ledger_twr_v2',
            'series', '[]'::jsonb,
            'generated_at', to_jsonb(now())
        );
    end if;

    select
        history,
        dirty,
        updated_at,
        last_refresh_attempt_at,
        refresh_ms
    into
        v_cached,
        v_dirty,
        v_updated_at,
        v_last_refresh_attempt_at,
        v_refresh_ms
    from public.performance_history_cache
    where user_id = auth.uid()
      and benchmark = v_benchmark
      and method = 'TWR';

    if public._history_points_count(v_cached) > 0 then
        return v_cached || jsonb_build_object(
            'dirty', coalesce(v_dirty, false),
            'updated_at', to_jsonb(v_updated_at),
            'last_refresh_attempt_at', to_jsonb(v_last_refresh_attempt_at),
            'refresh_ms', v_refresh_ms
        );
    end if;

    return public._refresh_performance_history_cache_for_user(auth.uid(), v_benchmark);
end;
$$;

grant execute on function public.performance_history(text) to authenticated;

create or replace function public.shared_performance_history(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user_id uuid;
    v_benchmark text;
    v_method text;
    v_cached jsonb;
    v_dirty boolean;
    v_legacy jsonb;
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

    v_benchmark := public._selected_benchmark_for_user(v_user_id, null);
    v_method := public._selected_performance_method_for_user(v_user_id);
    perform public._record_share_link_access(p_token);

    select history, dirty into v_cached, v_dirty
    from public.performance_history_cache
    where user_id = v_user_id
      and benchmark = v_benchmark
      and method = public._performance_cache_method_key(v_method);

    if public._history_points_count(v_cached) > 0 then
        return public._public_share_sanitize_history(v_cached)
            || jsonb_build_object('dirty', coalesce(v_dirty, false));
    end if;

    -- The legacy mirror only ever held V1. Offering it while the owner is on V2
    -- would answer with a different method than the dashboard shows.
    if v_method = 'ledger_twr_v2' then
        return jsonb_build_object(
            'error', 'history_cache_missing',
            'benchmark', v_benchmark,
            'method', 'ledger_twr_v2',
            'series', '[]'::jsonb,
            'generated_at', to_jsonb(now())
        );
    end if;

    select public_history into v_legacy
    from public.portfolio_history_cache
    where user_id = v_user_id;

    if public._history_points_count(v_legacy) > 0 then
        return public._public_share_sanitize_history(v_legacy)
            || jsonb_build_object('dirty', true);
    end if;

    return jsonb_build_object(
        'error', 'history_cache_missing',
        'benchmark', v_benchmark,
        'series', '[]'::jsonb,
        'generated_at', to_jsonb(now())
    );
end;
$$;

grant execute on function public.shared_performance_history(text) to anon, authenticated;
grant execute on function public.shared_history(text) to anon, authenticated;

-- Which users the quote Worker should compute V2 for. Service-role only: it
-- returns user ids, which is exactly the kind of internal identifier the public
-- surface must never carry.
create or replace function public.ledger_performance_refresh_universe()
returns table (user_id uuid, benchmark text)
language sql
stable
security definer
set search_path = public
as $$
    select s.user_id, public._selected_benchmark_for_user(s.user_id, null) as benchmark
    from public.settings s
    where s.performance_method = 'ledger_twr_v2';
$$;

revoke all on function public.ledger_performance_refresh_universe() from public, anon, authenticated;
grant execute on function public.ledger_performance_refresh_universe() to service_role;
