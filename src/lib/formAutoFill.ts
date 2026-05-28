export interface AutoFillState {
  isEdit: boolean;
  touched: boolean;
  currentValue: string;
}

export function shouldAutoFillField({ isEdit, touched, currentValue }: AutoFillState): boolean {
  if (isEdit || touched) return false;
  return currentValue.trim() === '';
}

export function formatDefaultNumber(value: number, decimals: number): string {
  if (!Number.isFinite(value) || value <= 0) return '';
  return value.toFixed(decimals).replace(/\.?0+$/, '');
}
