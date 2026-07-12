export interface CoreWebVitals {
  LCP: number | null;   // Largest Contentful Paint (ms)
  FID: number | null;   // First Input Delay (ms)
  CLS: number | null;   // Cumulative Layout Shift
  FCP: number | null;   // First Contentful Paint (ms)
  INP: number | null;   // Interaction to Next Paint (ms) — replaces FID
  SI: number | null;    // Speed Index (ms) — lab only
  TBT: number | null;   // Total Blocking Time (ms) — lab only
  TTI: number | null;   // Time to Interactive (ms) — lab only
}

export type CwvAssessment = 'good' | 'needs-improvement' | 'poor' | 'no-data';

export interface CwvAssessmentResult {
  assessment: CwvAssessment;
  fieldDataAvailable: boolean;
  metrics: {
    LCP: { value: number | null; rating: 'good' | 'needs-improvement' | 'poor' | null };
    INP: { value: number | null; rating: 'good' | 'needs-improvement' | 'poor' | null };
    CLS: { value: number | null; rating: 'good' | 'needs-improvement' | 'poor' | null };
  };
}

export interface Opportunity {
  id: string;
  title: string;
  description: string;
  savings: string | null; // e.g. "1.2 s" or "120 KiB"
  score: number;
}

export interface Diagnostic {
  id: string;
  title: string;
  description: string;
  displayValue?: string;
}

export interface PageSpeedResult {
  url: string;
  page: string;
  strategy: 'mobile' | 'desktop';
  score: number;          // Lighthouse lab score (diagnostic, NOT a ranking signal)
  vitals: CoreWebVitals;
  cwvAssessment?: CwvAssessmentResult; // CrUX field-data pass/fail — the actual ranking signal
  opportunities: Opportunity[];
  diagnostics: Diagnostic[];
  fetchedAt: string;
  fieldDataAvailable: boolean; // true = CrUX real-user data used for vitals
}

export interface SiteSpeedResult {
  siteId: string;
  strategy: 'mobile' | 'desktop';
  pages: PageSpeedResult[];
  averageScore: number;
  averageVitals: CoreWebVitals;
  testedAt: string;
}
