import { transactionCashEffect, type TransactionAmountInput } from './transactionAmounts.ts';

export interface BrokerCashEventAmount {
  usd_amount: number | string | null;
}

/** Cash in the retained ETF sleeve after imported cash events and ETF trades. */
export function calculateBrokerCashBalance(
  cashEvents: BrokerCashEventAmount[],
  transactions: TransactionAmountInput[],
): number {
  const deposited = cashEvents.reduce((sum, row) => {
    const amount = Number(row.usd_amount);
    return sum + (Number.isFinite(amount) ? amount : 0);
  }, 0);
  const tradeEffect = transactions.reduce(
    (sum, transaction) => sum + transactionCashEffect(transaction),
    0,
  );
  return Number((deposited + tradeEffect).toFixed(10));
}
