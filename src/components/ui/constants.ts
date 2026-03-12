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

/** Solid score background class (for progress bar fills) */
export function scoreBgBarClass(score: number): string {
  return score >= 80 ? 'bg-green-500' : score >= 60 ? 'bg-amber-500' : score >= 40 ? 'bg-orange-500' : 'bg-red-500';
}

/** AEO score color — 4-tier scale (80/60/30) for AEO readiness scores */
export function aeoScoreColorClass(score: number): string {
  if (score >= 80) return 'text-green-400';
  if (score >= 60) return 'text-teal-400';
  if (score >= 30) return 'text-amber-400';
  return 'text-red-400';
}

/** AEO score bar fill — 4-tier solid background */
export function aeoScoreBgBarClass(score: number): string {
  if (score >= 80) return 'bg-green-500';
  if (score >= 60) return 'bg-teal-500';
  if (score >= 30) return 'bg-amber-500';
  return 'bg-red-500';
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
