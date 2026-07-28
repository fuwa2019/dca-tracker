export interface CashflowAmountLike {
  cny_amount: number | string | null;
  usd_amount: number | string | null;
  target_rate: number | string | null;
  fees_cny?: number | string | null;
}

export interface CashflowSummary {
  totalLoss: number;
  totalCny: number;
  totalUsdActual: number;
  totalUsdIdeal: number;
  lossPct: number;
}

export function summarizeCashflows(cashflows: CashflowAmountLike[]): CashflowSummary {
  let totalLoss = 0;
  let totalCny = 0;
  let totalUsdActual = 0;
  let totalUsdIdeal = 0;

  for (const cashflow of cashflows) {
    const cny = Number(cashflow.cny_amount) || 0;
    const feesCny = Number(cashflow.fees_cny) || 0;
    const usd = Number(cashflow.usd_amount) || 0;
    const rate = Number(cashflow.target_rate) || 0;
    if (rate > 0) {
      const ideal = (cny + feesCny) / rate;
      totalUsdIdeal += ideal;
      totalLoss += ideal - usd;
    }
    totalCny += cny + feesCny;
    totalUsdActual += usd;
  }

  return {
    totalLoss,
    totalCny,
    totalUsdActual,
    totalUsdIdeal,
    lossPct: totalUsdIdeal > 0 ? totalLoss / totalUsdIdeal : 0,
  };
}
