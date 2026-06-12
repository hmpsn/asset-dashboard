export function pct(rate: number | null | undefined): string {
  if (rate == null || isNaN(rate)) return 'n/a';
  return `${Math.round(rate * 100)}%`;
}
