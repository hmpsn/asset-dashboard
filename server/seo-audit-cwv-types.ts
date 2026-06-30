export interface CwvMetricSummary {
  value: number | null;
  rating: 'good' | 'needs-improvement' | 'poor' | null;
}

export interface CwvStrategyResult {
  assessment: 'good' | 'needs-improvement' | 'poor' | 'no-data';
  fieldDataAvailable: boolean;
  lighthouseScore: number;
  metrics: {
    LCP: CwvMetricSummary;
    INP: CwvMetricSummary;
    CLS: CwvMetricSummary;
  };
}

export interface CwvSummary {
  mobile?: CwvStrategyResult;
  desktop?: CwvStrategyResult;
}
