export interface SeoIssue {
  check: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
}

export interface PageSection {
  level: number;
  heading: string;
  body: string;
}

export interface PageData {
  title: string;
  sections: PageSection[];
  bodyText: string;
  html: string;
  issues: SeoIssue[];
  slug: string;
  url?: string;
  preamble?: string;
}

export interface SitemapPage {
  slug: string;
  title: string;
  url: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  /** Heading name parsed from **Rewriting: X** prefix; present on AI rewrite messages only */
  sectionTarget?: string;
}

// Document-body rendering classes — applied to contenteditable DOM nodes via
// className assignment, not to React UI chrome. Exempt from Phase 5
// arbitrary-px rule (kickoff §6.4 document-content exception).
export const HEADING_CLASSES: Record<string, string> = { // arbitrary-text-ok
  h1: 'text-[20px] font-bold text-slate-100 mb-2 mt-5', // arbitrary-text-ok
  h2: 'text-[15px] font-semibold text-slate-300 mb-2 mt-5', // arbitrary-text-ok
  h3: 'text-[12px] font-medium text-slate-400 mb-1.5 mt-4 ml-3 pl-2 border-l-2 border-slate-700', // arbitrary-text-ok
};

export const QUICK_PROMPTS = [
  'Rewrite the intro paragraph to lead with a direct answer',
  'Suggest an FAQ section with schema-ready Q&A pairs',
  'Optimize all headings for search intent and AEO',
  'Add citation-ready data points and statistics',
  'Rewrite this page in our brand voice with AEO best practices',
  'Identify sections that need better keyword integration',
];

export function createRewriteSessionId(now = Date.now(), random = Math.random()): string {
  return `rewrite-${now}-${random.toString(36).slice(2, 8)}`;
}

export function toSectionSlug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function getIndentLevel(slug: string): number {
  const segs = slug.replace(/^\/|\/$/g, '').split('/');
  return Math.max(0, segs.length - 1);
}

export function isUrlQuery(query: string): boolean {
  const trimmed = query.trim();
  return trimmed.startsWith('https://') || trimmed.startsWith('http://');
}
