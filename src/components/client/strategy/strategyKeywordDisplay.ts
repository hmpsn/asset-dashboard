export type PriorityKeywordStatus = 'client' | 'strategy' | 'suggested';
export type StrategyKeywordRole = 'strategy' | 'page' | 'content' | 'idea';
export type OpportunityTone = 'emerald' | 'amber' | 'blue' | 'zinc';

export interface PriorityKeywordItem {
  label: string;
  normalized: string;
  isTracked: boolean;
  isStrategy: boolean;
  isRequested: boolean;
  status: PriorityKeywordStatus;
}

export interface StrategyKeywordTableRow extends PriorityKeywordItem {
  role: StrategyKeywordRole;
  roleLabel: 'Strategy Keyword' | 'Page Opportunity' | 'Content Opportunity' | 'Keyword Idea';
  roleDetail: string;
  opportunityLabel: string;
  opportunityDetail: string;
  opportunityTone: OpportunityTone;
  opportunityScore?: number;
  nextMoveLabel: string;
  nextMoveDetail: string;
  volume?: number;
  difficulty?: number;
  currentPosition?: number;
  pagePath?: string;
  pageTitle?: string;
  searchIntent?: string;
  impressions?: number;
  clicks?: number;
  metricsSource?: string;
  contextSources: string[];
  rationale?: string;
  trendDirection?: 'rising' | 'declining' | 'stable';
  enrichmentStatus: 'enriched' | 'partial' | 'unenriched';
}

// Single source of truth for role display labels — used in list rows and drawer badge.
export const ROLE_DISPLAY_LABELS: Record<string, string> = {
  content: 'Content to write',
  page: 'Page to optimize',
  strategy: 'Strategy keyword',
  idea: 'Keyword idea',
};

export const SIGNAL_LABELS: Record<string, string> = {
  'Generated strategy': 'Identified in your strategy',
  'Rank tracking': "You're actively tracking this",
  'Client request': 'You added this keyword',
  'Page map': 'Linked to a page on your site',
  'Content recommendation': 'AI-recommended content topic',
  'Competitor gap': "Competitors rank here — you don't yet",
};

export const fmtNum = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n.toLocaleString();

export const intentColor = (intent?: string) => {
  switch (intent) {
    case 'commercial': return 'text-accent-info bg-blue-500/10 border-blue-500/20';
    case 'informational': return 'text-accent-success bg-emerald-500/10 border-emerald-500/20';
    case 'transactional': return 'text-accent-warning bg-amber-500/10 border-amber-500/20';
    case 'navigational': return 'text-accent-info bg-blue-500/10 border-blue-500/20';
    default: return 'text-[var(--brand-text-muted)] bg-[var(--surface-3)]/10 border-[var(--brand-border)]/20';
  }
};

export const kdColor = (kd?: number) =>
  !kd
    ? 'text-[var(--brand-text-muted)]'
    : kd <= 30
      ? 'text-accent-success'
      : kd <= 60
        ? 'text-accent-warning'
        : 'text-accent-danger';

export function fmtAudience(volume?: number): string {
  if (volume == null) return 'Gathering…';
  if (volume === 0) return 'Very niche or emerging term';
  if (volume < 100) return 'Small, focused audience';
  return `~${fmtNum(volume)} searches/month`;
}

export function fmtMomentum(direction?: 'rising' | 'declining' | 'stable'): string {
  if (!direction) return 'Gathering…';
  if (direction === 'rising') return 'Interest growing';
  if (direction === 'stable') return 'Steady demand';
  return 'Declining — worth reviewing timing';
}

export function confidenceStatement(row: StrategyKeywordTableRow): string {
  if (row.enrichmentStatus === 'unenriched') return 'Gathering data';
  if (row.enrichmentStatus === 'partial') return 'Partial signal';
  if ((row.opportunityScore ?? 0) >= 60) return 'Strong opportunity';
  if ((row.opportunityScore ?? 0) >= 30) return 'Moderate opportunity';
  return 'In your strategy';
}

export function confidenceColor(row: StrategyKeywordTableRow): string {
  if (row.enrichmentStatus === 'unenriched') return 'text-[var(--brand-text-muted)]';
  if (row.enrichmentStatus === 'partial') return 'text-amber-400';
  if ((row.opportunityScore ?? 0) >= 60) return 'text-emerald-400';
  if ((row.opportunityScore ?? 0) >= 30) return 'text-teal-400';
  return 'text-[var(--brand-text-muted)]';
}

export const roleBadgeClass = (role: StrategyKeywordRole): string => {
  switch (role) {
    case 'content':  return 'border-emerald-500/20 bg-emerald-500/10 text-accent-success';
    case 'page':     return 'border-blue-500/20 bg-blue-500/10 text-accent-info';
    case 'strategy': return 'border-teal-500/20 bg-teal-500/10 text-accent-brand';
    case 'idea':     return 'border-[var(--brand-border)] bg-[var(--surface-3)] text-[var(--brand-text-muted)]';
  }
};
