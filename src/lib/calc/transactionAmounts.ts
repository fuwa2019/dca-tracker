export interface TransactionAmountInput {
  side: 'buy' | 'sell';
  shares: number | string;
  price: number | string;
  fees_usd?: number | string | null;
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
  const notional = transactionNotional(transaction);
  const fee = transactionFee(transaction);
  return transaction.side === 'buy' ? notional + fee : notional - fee;
}

export function transactionCashEffect(transaction: TransactionAmountInput): number {
  const amount = transactionCashAmount(transaction);
  return transaction.side === 'buy' ? -amount : amount;
}
