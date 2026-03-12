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
}

export interface SeoAuditResult {
  siteScore: number;
  totalPages: number;
  errors: number;
  warnings: number;
  infos: number;
  pages: PageSeoResult[];
  siteWideIssues: SeoIssue[];
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
  error: { label: 'Error', color: 'text-red-400', bg: 'bg-red-500/10 border-red-500/30', icon: AlertCircle },
  warning: { label: 'Warning', color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/30', icon: AlertTriangle },
  info: { label: 'Info', color: 'text-blue-400', bg: 'bg-blue-500/10 border-blue-500/30', icon: Info },
};

// Scoring constants (must match server/seo-audit.ts)
export const CRITICAL_CHECKS = new Set(['title', 'meta-description', 'canonical', 'h1', 'robots', 'duplicate-title', 'mixed-content', 'ssl', 'robots-txt']);
export const MODERATE_CHECKS = new Set(['content-length', 'heading-hierarchy', 'internal-links', 'img-alt', 'og-tags', 'og-image', 'link-text', 'url', 'lang', 'viewport', 'duplicate-description', 'img-filesize', 'html-size']);
