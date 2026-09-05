-- Preserve source-file order for same-day trades in the source-neutral importer.
--
-- 0050 inserted rows in source_index order but assigned
-- `transaction_timestamp() - source_index * 1 microsecond`. Because the
-- timeline validator sorts created_at ascending, a later source row received
-- an earlier timestamp. A same-day Buy followed by Sell was therefore
-- validated as Sell followed by Buy and rolled back.
--
-- Patch the already-renamed legacy function in place so the 0054 wrapper keeps
-- its public contract and multi-currency normalization unchanged.
do $$
declare
    v_def text;
    v_next text;
    v_old text := 'transaction_timestamp() - (v_row.source_index * interval ''1 microsecond'')';
    v_new text := 'transaction_timestamp() + (v_row.source_index * interval ''1 microsecond'')';
begin
    select pg_get_functiondef(
        'public._import_portfolio_ledger_legacy(text,jsonb,jsonb,text)'::regprocedure
    ) into v_def;

    if v_def is null then
        raise exception '_import_portfolio_ledger_legacy is missing';
    end if;

    if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 2 then
        raise exception 'unexpected source-order timestamp contract';
    end if;

    v_next := replace(v_def, v_old, v_new);
    if v_next = v_def then
        raise exception 'could not fix source-order timestamp contract';
    end if;

    execute v_next;
end;
$$;
