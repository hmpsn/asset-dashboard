/** Score color helper — used by MetricRing and any component showing health scores.
 *  Returns WCAG-compliant darker shades when .dashboard-light is active. */
export function scoreColor(score: number): string {
  const light = typeof document !== 'undefined' && !!document.querySelector('.dashboard-light');
  if (light) {
    return score >= 80 ? '#047857' : score >= 60 ? '#b45309' : '#dc2626';
  }
  return score >= 80 ? '#34d399' : score >= 60 ? '#fbbf24' : '#f87171';
}

/** Tailwind class version of scoreColor */
export function scoreColorClass(score: number): string {
  return score >= 80 ? 'text-green-400' : score >= 60 ? 'text-amber-400' : 'text-red-400';
}

/** Score background class (for borders, badges) */
export function scoreBgClass(score: number): string {
  return score >= 80 ? 'bg-green-500/10' : score >= 60 ? 'bg-amber-500/10' : 'bg-red-500/10';
}

/** Date range presets */
export const DATE_PRESETS_SHORT = [
  { label: '7d', value: 7 },
  { label: '28d', value: 28 },
  { label: '90d', value: 90 },
];

export const DATE_PRESETS_FULL = [
  { label: '7d', value: 7 },
  { label: '14d', value: 14 },
  { label: '28d', value: 28 },
  { label: '90d', value: 90 },
  { label: '6mo', value: 180 },
  { label: '1y', value: 365 },
];

export const DATE_PRESETS_SEARCH = [
  { label: '7d', value: 7 },
  { label: '28d', value: 28 },
  { label: '90d', value: 90 },
  { label: '6mo', value: 180 },
  { label: '16mo', value: 480 },
];
