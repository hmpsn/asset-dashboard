/**
 * Pure helpers for the HealthTab "request content improvement" flow.
 * Extracted from src/components/client/HealthTab.tsx so the word-count regex
 * and the request payload composition can be unit-tested. The component
 * imports these helpers and only handles state + the API call.
 */

export interface HealthTabIssue {
  check?: string;
  message?: string;
  severity?: string;
}

export interface HealthTabPage {
  pageId: string;
  page: string;
  slug: string;
  issues: HealthTabIssue[];
}

const CONTENT_ISSUE_CHECKS = [
  'content-length',
  'heading',
  'h1',
  'h1-missing',
  'h1-multiple',
  'word-count',
];

/**
 * Returns true when ANY of the supplied issues looks like a content-related
 * issue (word count too low, missing/multiple H1s, thin-content callouts).
 *
 * Exported (rather than inlined in HealthTab.tsx) so the same predicate is
 * applied for filtering page issues into the request payload AND for deciding
 * which sort/render branches surface the "request improvement" affordance.
 */
export function hasContentIssues(issues: readonly HealthTabIssue[]): boolean {
  return issues.some(i => {
    const chk = i.check?.toLowerCase() || '';
    const msg = i.message?.toLowerCase() || '';
    return CONTENT_ISSUE_CHECKS.some(c => chk.includes(c))
      || msg.includes('thin content')
      || msg.includes('word');
  });
}

/**
 * Pull a numeric word count out of the first content-length issue's message.
 *
 * Returns undefined when there is no matching issue or the message has no
 * "<n> word(s)" fragment. The caller (HealthTab) sends this number along
 * with the content-improvement request so the studio can size the rewrite.
 */
export function extractWordCountFromIssues(issues: readonly HealthTabIssue[]): number | undefined {
  const wordIssue = issues.find(i => i.check?.toLowerCase().includes('content-length'));
  if (!wordIssue) return undefined;
  const wordMatch = wordIssue.message?.match(/(\d+)\s*words?/i);
  if (!wordMatch) return undefined;
  return parseInt(wordMatch[1], 10);
}

export interface ContentImprovementRequestBody {
  pageSlug: string;
  pageName: string;
  issues: string[];
  wordCount: number | undefined;
}

/**
 * Compose the POST body for /api/public/content-request/:wsId/from-audit.
 * Filters down to content-related issue messages so the studio receives a
 * tight list of actionable issues, not the entire audit.
 */
export function buildContentImprovementRequest(page: HealthTabPage): ContentImprovementRequestBody {
  return {
    pageSlug: page.slug,
    pageName: page.page,
    issues: page.issues.filter(i => hasContentIssues([i])).map(i => i.message ?? ''),
    wordCount: extractWordCountFromIssues(page.issues),
  };
}
