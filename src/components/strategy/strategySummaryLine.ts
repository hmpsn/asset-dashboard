interface SummaryCounts {
  contentGaps: number;
  requested: number;
  quickWins: number;
}

export function buildStrategySummaryLine(counts: SummaryCounts): string {
  const clauses: string[] = [];

  if (counts.contentGaps > 0) {
    const label = counts.contentGaps === 1 ? 'gap to brief' : 'gaps to brief';
    clauses.push(`${counts.contentGaps} ${label}`);
  }

  if (counts.requested > 0) {
    const label = counts.requested === 1 ? 'requested keyword' : 'requested keywords';
    clauses.push(`${counts.requested} ${label}`);
  }

  if (counts.quickWins > 0) {
    const label = counts.quickWins === 1 ? 'quick win' : 'quick wins';
    clauses.push(`${counts.quickWins} ${label}`);
  }

  return clauses.join(' · ');
}
