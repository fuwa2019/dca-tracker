/**
 * Account-level NAV bridge over a display window of the cached performance
 * history: starting NAV + external net flow + period P&L = ending NAV.
 *
 * The bridge reads only the cached series (same contract as the dashboard and
 * public share) and never recomputes performance. `identity_gap_usd` reports
 * how far the cached points deviate from the pointwise identity
 * `navUser = invested + pnlUser`; a consistent cache yields a zero gap.
 */

export interface NavBridgePoint {
  date: string;
  /** Cumulative external trade-funding flows up to and including this day. */
  invested: number;
  navUser: number;
  /** Cumulative P&L, defined by the cache contract as navUser - invested. */
  pnlUser: number;
  /** Cumulative daily-linked TWR up to and including this day. */
  returnPctUser: number;
}

export interface NavBridge {
  start_date: string;
  end_date: string;
  /** NAV of the last point before the window; 0 when the window opens the series. */
  starting_nav_usd: number;
  /** External net flow inside the window: invested(end) - invested(before). */
  external_flow_usd: number;
  /** P&L inside the window: pnlUser(end) - pnlUser(before). */
  pnl_usd: number;
  ending_nav_usd: number;
  /** ending - (starting + flow + pnl); non-zero flags an inconsistent cache. */
  identity_gap_usd: number;
  /** Daily-linked TWR chained over the window; null when undefined. */
  period_return_pct: number | null;
}

export function computeNavBridge(
  history: readonly NavBridgePoint[],
  windowPoints: readonly NavBridgePoint[],
): NavBridge | null {
  if (history.length === 0 || windowPoints.length === 0) return null;
  const first = windowPoints[0];
  const last = windowPoints[windowPoints.length - 1];
  const firstIndex = history.findIndex((point) => point.date === first.date);
  if (firstIndex < 0) return null;
  const before = firstIndex > 0 ? history[firstIndex - 1] : null;

  const startingNav = before?.navUser ?? 0;
  const externalFlow = last.invested - (before?.invested ?? 0);
  const pnl = last.pnlUser - (before?.pnlUser ?? 0);
  const endingNav = last.navUser;
  const identityGap = endingNav - (startingNav + externalFlow + pnl);

  const previousFactor = 1 + (before?.returnPctUser ?? 0);
  const endingFactor = 1 + last.returnPctUser;
  const chained = previousFactor > 0 ? endingFactor / previousFactor - 1 : null;

  return {
    start_date: first.date,
    end_date: last.date,
    starting_nav_usd: startingNav,
    external_flow_usd: externalFlow,
    pnl_usd: pnl,
    ending_nav_usd: endingNav,
    identity_gap_usd: identityGap,
    period_return_pct: chained !== null && Number.isFinite(chained) ? chained : null,
  };
}
