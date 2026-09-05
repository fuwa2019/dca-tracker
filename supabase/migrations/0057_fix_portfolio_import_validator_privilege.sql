-- The batch importer calls the private timeline validator after inserting its
-- complete payload. Keep the validator private and run the importer under its
-- owner privileges so authenticated callers do not need direct EXECUTE access
-- to an internal function that accepts an arbitrary user id.
alter function public._import_portfolio_ledger_legacy(text, jsonb, jsonb, text)
    security definer;

revoke all on function public._validate_import_transaction_timelines(uuid)
    from public, anon, authenticated;
