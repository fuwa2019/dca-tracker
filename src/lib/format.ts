export const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
});

export const usd0 = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

export const cny = new Intl.NumberFormat('zh-CN', {
  style: 'currency',
  currency: 'CNY',
  maximumFractionDigits: 2,
});

export const num4 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 });
export const num6 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 });

export function pct(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(digits)}%`;
}

export function signedPct(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return '—';
  const sign = value > 0 ? '+' : value < 0 ? '' : '';
  return `${sign}${(value * 100).toFixed(digits)}%`;
}

export function signedUsd(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${usd.format(value)}`;
}

export function shortDate(iso: string): string {
  // YYYY-MM-DD → MM/DD
  const [, m, d] = iso.split('-');
  return `${m}/${d}`;
}

export function ymOf(iso: string): string {
  return iso.slice(0, 7);
}

/** Returns YYYY-MM-DD in Asia/Shanghai. Use for form defaults so 早上录入不会变成"前一天"。 */
export function todayLocalIso(): string {
  // en-CA emits YYYY-MM-DD; timeZone fixes the offset.
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
}

/** Returns a Tailwind text-color class based on sign. */
export function changeColor(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'text-muted-foreground';
  if (value > 0) return 'text-success';
  if (value < 0) return 'text-danger';
  return 'text-muted-foreground';
}
