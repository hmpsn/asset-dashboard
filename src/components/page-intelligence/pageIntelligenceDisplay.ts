import type { PageKeywordMap } from '../../../shared/types/workspace.js';

export function positionColor(pos?: number): string {
  // Search positions are 1-based; 0 and undefined both mean no ranking data in this view.
  if (!pos) return 'text-[var(--brand-text-muted)]';
  if (pos <= 3) return 'text-accent-success';
  if (pos <= 10) return 'text-accent-brand';
  if (pos <= 20) return 'text-accent-warning';
  return 'text-accent-danger';
}

export function kdColor(kd?: number): string {
  if (kd === undefined) return 'text-[var(--brand-text-muted)]';
  if (kd <= 30) return 'text-accent-success';
  if (kd <= 50) return 'text-accent-warning';
  if (kd <= 70) return 'text-accent-orange';
  return 'text-accent-danger';
}

export function kdLabel(kd?: number): string {
  if (kd === undefined) return '';
  if (kd <= 30) return 'Easy';
  if (kd <= 50) return 'Medium';
  if (kd <= 70) return 'Hard';
  return 'Very Hard';
}

export function intentColor(intent?: string): string {
  switch (intent) {
    case 'commercial': return 'text-accent-info bg-blue-500/10 border-blue-500/20';
    case 'informational': return 'text-accent-success bg-emerald-500/10 border-emerald-500/20';
    case 'transactional': return 'text-accent-warning bg-amber-500/10 border-amber-500/20';
    case 'navigational': return 'text-accent-cyan bg-cyan-500/10 border-cyan-500/20';
    default: return 'text-[var(--brand-text)] bg-[var(--surface-3)]/50 border-[var(--brand-border)]';
  }
}

export function intentIcon(intent: string): string {
  if (intent === 'informational') return 'i';
  if (intent === 'transactional') return '$';
  if (intent === 'navigational') return '→';
  return '?';
}

export function difficultyTextColor(d: string): string {
  if (d === 'low') return 'text-accent-success';
  if (d === 'medium') return 'text-accent-warning';
  return 'text-accent-danger';
}

export function opportunityScore(p: PageKeywordMap): number {
  const pos = p.currentPosition || 999;
  const imp = p.impressions || 0;
  const vol = p.volume || 0;
  if (pos >= 4 && pos <= 20 && imp > 0) return imp * (21 - pos);
  if (pos > 20 && imp > 0) return imp * 2;
  if (pos <= 3) return imp * 0.5;
  if (vol > 0) return vol;
  return 1;
}
