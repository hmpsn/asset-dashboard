/**
 * Pure helpers for the SeoAudit batch-create-tasks flow.
 *
 * Extracted from `src/components/SeoAudit.tsx` so the issue-selection /
 * task-shape logic can be unit-tested without spinning up the full audit UI.
 * Keep the React side calling these helpers so the unit tests double as a
 * regression net for the in-component behavior.
 */
import type { PageSeoResult, SeoIssue } from '../components/audit/types';
import { normalizePageUrl } from './pathUtils';

export type BatchMode = 'all' | 'errors' | 'filtered';

export type SeverityFilter = SeoIssue['severity'] | 'all';
export type CategoryFilter = NonNullable<SeoIssue['category']> | 'all';

export interface BatchTaskItem {
  title: string;
  description: string;
  category: 'seo';
  priority: 'high' | 'medium';
  pageUrl: string;
}

/** Stable key used to dedupe issues across batch runs. */
export function issueToTaskKey(page: Pick<PageSeoResult, 'pageId'>, issue: Pick<SeoIssue, 'check' | 'message'>): string {
  return `${page.pageId}-${issue.check}-${issue.message.slice(0, 30)}`;
}

/** Build the request payload for a single audit issue. */
export function issueToTaskItem(
  page: Pick<PageSeoResult, 'pageId' | 'page' | 'slug' | 'url' | 'publishedPath'>,
  issue: SeoIssue,
  editedSuggestions: Readonly<Record<string, string>> = {},
): BatchTaskItem {
  const fixKey = `${page.pageId}-${issue.check}`;
  const edited = editedSuggestions[fixKey];
  const suggestion = edited || issue.suggestedFix;
  const sevIcon = issue.severity === 'error' ? '🔴' : issue.severity === 'warning' ? '⚠️' : 'ℹ️';
  return {
    title: `[Audit] ${sevIcon} ${issue.check}: ${issue.message.slice(0, 80)}`,
    description: `Page: ${page.page}\nSlug: ${page.slug}\n\nIssue: ${issue.message}\n\nRecommendation: ${issue.recommendation}${suggestion ? `\n\nAI Suggestion: ${suggestion}` : ''}${issue.value ? `\n\nCurrent value: ${issue.value}` : ''}`,
    category: 'seo',
    priority: issue.severity === 'error' ? 'high' : 'medium',
    pageUrl: normalizePageUrl(page.publishedPath || page.url || page.slug),
  };
}

export interface SelectBatchInput {
  mode: BatchMode;
  pages: ReadonlyArray<PageSeoResult>;
  filteredPages: ReadonlyArray<PageSeoResult>;
  severityFilter: SeverityFilter;
  categoryFilter: CategoryFilter;
  /** Already-created task keys — items keyed in this set are skipped (dedupe). */
  createdTasks: ReadonlySet<string>;
  editedSuggestions?: Readonly<Record<string, string>>;
}

export interface SelectBatchResult {
  items: BatchTaskItem[];
  keys: string[];
}

/**
 * Select issues to include in a batch task creation, given the current mode
 * and filter state. Mirrors the logic inside `batchCreateTasks` in
 * `SeoAudit.tsx`.
 */
export function selectIssuesForBatch({
  mode,
  pages,
  filteredPages,
  severityFilter,
  categoryFilter,
  createdTasks,
  editedSuggestions = {},
}: SelectBatchInput): SelectBatchResult {
  const sourcePages = mode === 'filtered' ? filteredPages : pages;
  const items: BatchTaskItem[] = [];
  const keys: string[] = [];

  for (const page of sourcePages) {
    const issues = mode === 'errors'
      ? page.issues.filter(i => i.severity === 'error')
      : mode === 'filtered'
        ? page.issues
            .filter(i => severityFilter === 'all' || i.severity === severityFilter)
            .filter(i => categoryFilter === 'all' || i.category === categoryFilter)
        : page.issues;

    for (const issue of issues) {
      const key = issueToTaskKey(page, issue);
      if (createdTasks.has(key)) continue;
      items.push(issueToTaskItem(page, issue, editedSuggestions));
      keys.push(key);
    }
  }

  return { items, keys };
}
