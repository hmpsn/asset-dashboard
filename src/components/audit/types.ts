/**
 * Shared types and constants for SEO audit components — extracted from SeoAudit.tsx
 */
import { AlertTriangle, AlertCircle, Info } from 'lucide-react';

export type Severity = 'error' | 'warning' | 'info';

export type CheckCategory = 'content' | 'technical' | 'social' | 'performance' | 'accessibility';

export interface SeoIssue {
  check: string;
  severity: Severity;
  category?: CheckCategory;
  message: string;
  recommendation: string;
  value?: string;
  suggestedFix?: string;
}

export interface PageSeoResult {
  pageId: string;
  page: string;
  slug: string;
  url: string;
  score: number;
  issues: SeoIssue[];
  noindex?: boolean;
}

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

export interface DeadLinkItem {
  url: string;
  status: number | string;
  statusText: string;
  foundOn: string;
  foundOnSlug: string;
  anchorText: string;
  type: 'internal' | 'external';
}

export interface SeoAuditResult {
  siteScore: number;
  totalPages: number;
  errors: number;
  warnings: number;
  infos: number;
  pages: PageSeoResult[];
  siteWideIssues: SeoIssue[];
  cwvSummary?: CwvSummary;
  deadLinkSummary?: { total: number; internal: number; external: number; redirects: number };
  deadLinkDetails?: DeadLinkItem[];
}

export interface SnapshotSummary {
  id: string;
  createdAt: string;
  siteScore: number;
  totalPages: number;
  errors: number;
  warnings: number;
  infos: number;
}

export const CATEGORY_CONFIG: Record<CheckCategory, { label: string; color: string }> = {
  content: { label: 'Content', color: 'text-emerald-400' },
  technical: { label: 'Technical', color: 'text-teal-400' },
  social: { label: 'Social', color: 'text-cyan-400' },
  performance: { label: 'Performance', color: 'text-orange-400' },
  accessibility: { label: 'Accessibility', color: 'text-sky-400' },
};

export const ISSUE_FIX_MAP: Record<string, string> = {
  'title': 'seo-editor', 'title_length': 'seo-editor', 'missing_title': 'seo-editor',
  'meta-description': 'seo-editor', 'meta_length': 'seo-editor', 'missing_meta': 'seo-editor',
  'missing_h1': 'seo-editor', 'duplicate_h1': 'seo-editor', 'og-tags': 'seo-editor',
  'missing_schema': 'seo-schema', 'schema_errors': 'seo-schema',
  'redirect_chain': 'links', 'broken_link': 'links', 'missing_canonical': 'links',
  'thin_content': 'seo-briefs', 'low_word_count': 'seo-briefs',
};

export const FIX_TAB_LABELS: Record<string, string> = {
  'seo-editor': 'SEO Editor', 'seo-schema': 'Schema Generator', 'links': 'Links',
  'seo-briefs': 'Content Briefs', 'performance': 'Performance',
};

export function getFixTab(issue: SeoIssue): string | null {
  if (ISSUE_FIX_MAP[issue.check]) return ISSUE_FIX_MAP[issue.check];
  if (issue.category === 'performance') return 'performance';
  return null;
}

export const SEVERITY_CONFIG: Record<Severity, { label: string; color: string; bg: string; icon: typeof AlertTriangle }> = {
  error: { label: 'Error', color: 'text-red-400/80', bg: 'bg-red-500/8 border-red-500/30', icon: AlertCircle },
  warning: { label: 'Warning', color: 'text-amber-400/80', bg: 'bg-amber-500/8 border-amber-500/30', icon: AlertTriangle },
  info: { label: 'Info', color: 'text-blue-400', bg: 'bg-blue-500/10 border-blue-500/30', icon: Info },
};

// Scoring constants (must match server/audit-page.ts)
// Weights calibrated to industry tools (SEMRush, Ahrefs):
//   error: critical -15, other -10
//   warning: critical -5, moderate -3, other -2
//   info: 0 (no score impact)
export const CRITICAL_CHECKS = new Set(['title', 'meta-description', 'canonical', 'h1', 'robots', 'duplicate-title', 'mixed-content', 'ssl', 'robots-txt']);
export const MODERATE_CHECKS = new Set(['content-length', 'heading-hierarchy', 'internal-links', 'img-alt', 'og-tags', 'og-image', 'link-text', 'url', 'lang', 'viewport', 'duplicate-description', 'img-filesize', 'html-size']);
