export interface TransactionAmountInput {
  side: 'buy' | 'sell';
  shares: number | string;
  price: number | string;
  fees_usd?: number | string | null;
  /** Signed settled cash from the broker: negative buy, positive sell. */
  settled_amount_usd?: number | string | null;
}

function settledCashEffect(transaction: TransactionAmountInput): number | null {
  if (transaction.settled_amount_usd == null || transaction.settled_amount_usd === '') return null;
  const amount = Number(transaction.settled_amount_usd);
  if (!Number.isFinite(amount)) return null;
  if (transaction.side === 'buy' && amount < 0) return amount;
  if (transaction.side === 'sell' && amount > 0) return amount;
  return null;
}

export function transactionFee(transaction: TransactionAmountInput): number {
  const fee = Number(transaction.fees_usd ?? 0);
  return Number.isFinite(fee) && fee > 0 ? fee : 0;
}

export function transactionNotional(transaction: TransactionAmountInput): number {
  const shares = Number(transaction.shares);
  const price = Number(transaction.price);
  if (!Number.isFinite(shares) || !Number.isFinite(price)) return 0;
  return shares * price;
}

export function transactionCashAmount(transaction: TransactionAmountInput): number {
  const settled = settledCashEffect(transaction);
  if (settled != null) return Math.abs(settled);
  const notional = transactionNotional(transaction);
  const fee = transactionFee(transaction);
  return transaction.side === 'buy' ? notional + fee : notional - fee;
}

export function transactionCashEffect(transaction: TransactionAmountInput): number {
  return settledCashEffect(transaction)
    ?? (transaction.side === 'buy'
      ? -transactionCashAmount(transaction)
      : transactionCashAmount(transaction));
}
