/**
 * The tracked Schwab account is operated with near-zero idle cash. Brokerage
 * transfer history is intentionally not imported because partial transfer
 * exports cannot reconstruct a trustworthy cash balance.
 */
export function assumedBrokerCashBalance(): number {
  return 0;
}
