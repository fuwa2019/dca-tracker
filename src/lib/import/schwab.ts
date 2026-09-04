/**
 * Public compatibility entry point for the Schwab portfolio adapter.
 *
 * The implementation lives in schwabLedger.ts so the unified import path and
 * direct legacy imports share the same native eight-column action mapping.
 */
export { schwabLedgerImportAdapter as schwabImportAdapter } from './schwabLedger.ts';
