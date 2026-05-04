export const AEO_CHANGE_TYPES = [
  'rewrite_intro',
  'add_author',
  'add_date',
  'add_section',
  'add_citations',
  'add_schema',
  'add_faq',
  'add_comparison',
  'add_definition',
  'restructure_content',
  'remove_dark_pattern',
  'copy_edit',
] as const;

export type AeoChangeType = typeof AEO_CHANGE_TYPES[number];

export const AEO_EFFORTS = ['quick', 'moderate', 'significant'] as const;

export type AeoEffort = typeof AEO_EFFORTS[number];

export type AeoPriority = 'high' | 'medium' | 'low';

export interface AeoPageChange {
  id: string;
  changeType: AeoChangeType;
  location: string;
  currentContent?: string;
  suggestedChange: string;
  rationale: string;
  effort: AeoEffort;
  priority: AeoPriority;
  aeoImpact: string;
  verifiedSourceEvidence?: string;
  requiresSourceResearch?: boolean;
}

export interface AeoPageReview {
  pageUrl: string;
  pageTitle: string;
  reviewedAt: string;
  overallScore: number;
  summary: string;
  changes: AeoPageChange[];
  quickWinCount: number;
  estimatedTimeMinutes: number;
}

export interface AeoSiteReview {
  workspaceId: string;
  generatedAt: string;
  pages: AeoPageReview[];
  sitewideSummary: string;
  totalChanges: number;
  quickWins: number;
}

export const AEO_EFFORT_MINUTES: Record<AeoEffort, number> = {
  quick: 15,
  moderate: 45,
  significant: 90,
};

export function estimateAeoChangeMinutes(effort: AeoEffort): number {
  return AEO_EFFORT_MINUTES[effort];
}

export function countAeoQuickWins(changes: Pick<AeoPageChange, 'effort'>[]): number {
  return changes.filter(change => change.effort === 'quick').length;
}

export function estimateAeoChangesMinutes(changes: Pick<AeoPageChange, 'effort'>[]): number {
  return changes.reduce((sum, change) => sum + estimateAeoChangeMinutes(change.effort), 0);
}
