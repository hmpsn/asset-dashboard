export type CockpitVerdictStatus = 'on_track' | 'watch' | 'at_risk' | 'establishing';

export interface CockpitVerdictEvidence {
  label: string;
  value: string | number;
  tone?: 'neutral' | 'positive' | 'warning' | 'danger';
}

export interface CockpitVerdict {
  status: CockpitVerdictStatus;
  headline: string;
  narrative: string;
  generatedAt: string;
  evidence: CockpitVerdictEvidence[];
}
