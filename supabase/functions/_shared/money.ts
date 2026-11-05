export function formatMoney(amount: number, code = 'USD') {
  const value = Number(amount);
  if (!Number.isFinite(value)) return '';
  const currency = String(code || 'USD').toUpperCase();
  const prefix = currency === 'USD' ? '$' : currency === 'ZAR' ? 'R' : `${currency} `;
  const formatted = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(value));
  return `${value < 0 ? '-' : ''}${prefix}${formatted}`;
}
export const toCents = (n: number | string) => Math.round(Number(n) * 100);
