/**
 * Ledger event-type presentation semantics shared by the transaction list, the
 * cashflow ledger and the import preview.
 *
 * This module is pure data mapping: no React, no network, no Supabase. It maps
 * a stored trade side or `cashflow_kind` to a stable label, a semantic tone and
 * the cash direction the row represents, so every ledger surface labels the
 * same event the same way.
 *
 * Tone follows the existing semantic palette rather than a new theme:
 * gain-coloured events (buy, deposit, dividend, interest) and loss-coloured
 * events (sell, withdrawal, tax, fee) reuse `bg-gain-soft` / `bg-loss-soft`
 * through `StatusBadge`.
 */

import type { LedgerCashflowKind } from '@/lib/database.types';

export type LedgerEventKind = 'buy' | 'sell' | LedgerCashflowKind;

/** Subset of `StatusTone` used by ledger chips. */
export type LedgerEventTone = 'ok' | 'bad' | 'info' | 'neutral';

/** Whether the event adds cash to, removes cash from, or only moves it. */
export type LedgerEventDirection = 'gain' | 'loss' | 'neutral';

export interface LedgerEventChip {
  kind: LedgerEventKind;
  label: string;
  tone: LedgerEventTone;
  direction: LedgerEventDirection;
  group: 'trade' | 'cash';
}

const CHIPS: Record<LedgerEventKind, LedgerEventChip> = {
  buy: { kind: 'buy', label: '买入', tone: 'ok', direction: 'gain', group: 'trade' },
  sell: { kind: 'sell', label: '卖出', tone: 'bad', direction: 'loss', group: 'trade' },
  broker_deposit: { kind: 'broker_deposit', label: '入金', tone: 'ok', direction: 'gain', group: 'cash' },
  broker_withdrawal: { kind: 'broker_withdrawal', label: '提款', tone: 'bad', direction: 'loss', group: 'cash' },
  dividend: { kind: 'dividend', label: '股息', tone: 'ok', direction: 'gain', group: 'cash' },
  interest: { kind: 'interest', label: '利息', tone: 'ok', direction: 'gain', group: 'cash' },
  tax: { kind: 'tax', label: '税款', tone: 'bad', direction: 'loss', group: 'cash' },
  fee: { kind: 'fee', label: '费用', tone: 'bad', direction: 'loss', group: 'cash' },
  // A transfer moves existing money instead of adding or removing portfolio
  // value, so it stays outside the gain/loss colour pair on purpose.
  fx_transfer: { kind: 'fx_transfer', label: '换汇', tone: 'info', direction: 'neutral', group: 'cash' },
  stock_allocation: { kind: 'stock_allocation', label: '个股划转', tone: 'neutral', direction: 'neutral', group: 'cash' },
};

const UNKNOWN_CHIP: LedgerEventChip = {
  kind: 'fx_transfer',
  label: '未知事件',
  tone: 'neutral',
  direction: 'neutral',
  group: 'cash',
};

/**
 * Returns the chip descriptor for a ledger event kind. An unrecognized kind
 * degrades to a visible neutral "未知事件" chip instead of being silently
 * relabelled as a known event.
 */
export function ledgerEventChip(kind: string | null | undefined): LedgerEventChip {
  if (!kind) return UNKNOWN_CHIP;
  return CHIPS[kind as LedgerEventKind] ?? UNKNOWN_CHIP;
}

/** Chip for a transaction row, keyed by its side. */
export function tradeEventChip(side: string | null | undefined): LedgerEventChip {
  return ledgerEventChip(side === 'sell' ? 'sell' : 'buy');
}

/** Chip for a cashflow row, keyed by its stored `cashflow_kind`. */
export function cashEventChip(kind: string | null | undefined): LedgerEventChip {
  return ledgerEventChip(kind);
}

/** True when the cashflow kind is a plain USD amount rather than an FX transfer. */
export function isPlainCashEvent(kind: string | null | undefined): boolean {
  return !!kind && kind !== 'fx_transfer' && kind in CHIPS;
}

export const LEDGER_EVENT_KINDS: readonly LedgerEventKind[] = Object.keys(CHIPS) as LedgerEventKind[];
