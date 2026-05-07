/**
 * Unit tests for src/lib/audit-batch.ts — covers `selectIssuesForBatch`
 * across the three SeoAudit batch modes ('all' | 'errors' | 'filtered'),
 * including dedupe and the task-shape helpers.
 */
import { describe, it, expect } from 'vitest';
import {
  issueToTaskKey,
  issueToTaskItem,
  selectIssuesForBatch,
  type BatchMode,
  type SelectBatchInput,
} from '../../src/lib/audit-batch';
import type { PageSeoResult, SeoIssue, CheckCategory } from '../../src/components/audit/types';

const issue = (overrides: Partial<SeoIssue> & Pick<SeoIssue, 'check' | 'severity'>): SeoIssue => ({
  message: `Issue: ${overrides.check}`,
  recommendation: `Fix: ${overrides.check}`,
  ...overrides,
});

const page = (
  pageId: string,
  slug: string,
  issues: SeoIssue[],
): PageSeoResult => ({
  pageId,
  page: slug,
  slug,
  url: `https://example.com/${slug}`,
  score: 100,
  issues,
});

const PAGES: PageSeoResult[] = [
  page('p1', 'home', [
    issue({ check: 'title', severity: 'error', category: 'content' }),
    issue({ check: 'og-tags', severity: 'warning', category: 'social' }),
    issue({ check: 'analytics-tag', severity: 'info', category: 'technical' }),
  ]),
  page('p2', 'about', [
    issue({ check: 'meta-description', severity: 'error', category: 'content' }),
    issue({ check: 'img-alt', severity: 'warning', category: 'accessibility' }),
  ]),
];

const baseInput = (overrides: Partial<SelectBatchInput> = {}): SelectBatchInput => ({
  mode: 'all',
  pages: PAGES,
  filteredPages: PAGES,
  severityFilter: 'all',
  categoryFilter: 'all',
  createdTasks: new Set(),
  ...overrides,
});

// ── issueToTaskKey ──

describe('issueToTaskKey', () => {
  it('combines pageId, check, and message slice into a stable key', () => {
    const p = PAGES[0];
    const i = p.issues[0];
    expect(issueToTaskKey(p, i)).toBe(`p1-title-${i.message.slice(0, 30)}`);
  });

  it('truncates long messages at 30 characters so similar issues collide deliberately', () => {
    const p = PAGES[0];
    const longMessage = 'X'.repeat(120);
    const i = issue({ check: 'title', severity: 'error', message: longMessage });
    const key = issueToTaskKey(p, i);
    expect(key).toBe(`p1-title-${'X'.repeat(30)}`);
  });
});

// ── issueToTaskItem ──

describe('issueToTaskItem', () => {
  it('formats title with severity icon, check name, and trimmed message', () => {
    const i = issue({ check: 'title', severity: 'error', message: 'Title is missing on this page' });
    const item = issueToTaskItem(PAGES[0], i);
    expect(item.title.startsWith('[Audit] 🔴 title:')).toBe(true);
    expect(item.title).toContain('Title is missing on this page');
  });

  it('uses the warning icon for warnings and info icon for info', () => {
    const w = issueToTaskItem(PAGES[0], issue({ check: 'og-tags', severity: 'warning' }));
    expect(w.title).toContain('⚠️');
    const inf = issueToTaskItem(PAGES[0], issue({ check: 'analytics', severity: 'info' }));
    expect(inf.title).toContain('ℹ️');
  });

  it('marks errors as high priority and other severities as medium', () => {
    expect(issueToTaskItem(PAGES[0], issue({ check: 'x', severity: 'error' })).priority).toBe('high');
    expect(issueToTaskItem(PAGES[0], issue({ check: 'x', severity: 'warning' })).priority).toBe('medium');
    expect(issueToTaskItem(PAGES[0], issue({ check: 'x', severity: 'info' })).priority).toBe('medium');
  });

  it('prefers an edited suggestion over the AI suggestedFix', () => {
    const i = issue({ check: 'title', severity: 'error', suggestedFix: 'AI suggestion' });
    const item = issueToTaskItem(PAGES[0], i, { 'p1-title': 'My edit' });
    expect(item.description).toContain('AI Suggestion: My edit');
    expect(item.description).not.toContain('AI Suggestion: AI suggestion');
  });

  it('includes the original AI suggestion when nothing is edited', () => {
    const i = issue({ check: 'title', severity: 'error', suggestedFix: 'AI suggestion' });
    const item = issueToTaskItem(PAGES[0], i);
    expect(item.description).toContain('AI Suggestion: AI suggestion');
  });

  it('omits "AI Suggestion:" entirely when there is no suggestion or edit', () => {
    const i = issue({ check: 'title', severity: 'error' });
    const item = issueToTaskItem(PAGES[0], i);
    expect(item.description).not.toContain('AI Suggestion:');
  });

  it('includes the current value when present', () => {
    const i = issue({ check: 'title', severity: 'error', value: 'Old title' });
    const item = issueToTaskItem(PAGES[0], i);
    expect(item.description).toContain('Current value: Old title');
  });

  it('hard-codes category as "seo" and uses page slug as pageUrl', () => {
    const item = issueToTaskItem(PAGES[1], PAGES[1].issues[0]);
    expect(item.category).toBe('seo');
    expect(item.pageUrl).toBe('about');
  });
});

// ── selectIssuesForBatch ──

describe('selectIssuesForBatch — mode "all"', () => {
  it('returns every issue across the source pages list (data.pages)', () => {
    const { items, keys } = selectIssuesForBatch(baseInput({ mode: 'all' }));
    expect(items).toHaveLength(5);
    expect(keys).toHaveLength(5);
  });

  it('uses `pages` not `filteredPages` in mode "all"', () => {
    const onlyHome = [PAGES[0]];
    const { items } = selectIssuesForBatch(baseInput({ mode: 'all', filteredPages: onlyHome }));
    // Should still include 'about' issues — filteredPages is ignored in 'all'.
    expect(items.some(i => i.pageUrl === 'about')).toBe(true);
  });
});

describe('selectIssuesForBatch — mode "errors"', () => {
  it('keeps only severity === "error" issues', () => {
    const { items } = selectIssuesForBatch(baseInput({ mode: 'errors' }));
    expect(items).toHaveLength(2);
    expect(items.every(i => i.priority === 'high')).toBe(true); // every-ok — guarded by toHaveLength(2) above
  });

  it('uses the full `pages` list (not filteredPages) for selection', () => {
    const { items } = selectIssuesForBatch(baseInput({
      mode: 'errors',
      filteredPages: [PAGES[0]], // Should be ignored in 'errors' mode
    }));
    // Both error issues across both pages should be returned.
    expect(items).toHaveLength(2);
  });
});

describe('selectIssuesForBatch — mode "filtered"', () => {
  it('uses `filteredPages` as the source list', () => {
    const onlyHome = [PAGES[0]];
    const { items } = selectIssuesForBatch(baseInput({
      mode: 'filtered',
      filteredPages: onlyHome,
    }));
    // Three issues from home, no 'about'
    expect(items).toHaveLength(3);
    expect(items.every(i => i.pageUrl === 'home')).toBe(true); // every-ok — guarded by toHaveLength(3) above
  });

  it('applies severityFilter when not "all"', () => {
    const { items } = selectIssuesForBatch(baseInput({
      mode: 'filtered',
      severityFilter: 'warning',
    }));
    // Two warnings total: og-tags (home) + img-alt (about)
    expect(items).toHaveLength(2);
    expect(items.every(i => i.title.includes('⚠️'))).toBe(true); // every-ok — guarded by toHaveLength(2) above
  });

  it('applies categoryFilter when not "all"', () => {
    const cat: CheckCategory = 'content';
    const { items } = selectIssuesForBatch(baseInput({
      mode: 'filtered',
      categoryFilter: cat,
    }));
    // Two content issues: title (home) + meta-description (about)
    expect(items).toHaveLength(2);
    expect(items.map(i => i.title.match(/(\w[\w-]*):/)?.[1])).toEqual(
      expect.arrayContaining(['title', 'meta-description']),
    );
  });

  it('applies severity AND category filters together', () => {
    const { items } = selectIssuesForBatch(baseInput({
      mode: 'filtered',
      severityFilter: 'error',
      categoryFilter: 'content',
    }));
    expect(items).toHaveLength(2);
    expect(items.every(i => i.priority === 'high')).toBe(true); // every-ok — guarded by toHaveLength(2) above
  });

  it('returns empty when filters exclude everything', () => {
    const { items, keys } = selectIssuesForBatch(baseInput({
      mode: 'filtered',
      severityFilter: 'error',
      categoryFilter: 'performance',
    }));
    expect(items).toEqual([]);
    expect(keys).toEqual([]);
  });
});

// ── Dedupe via createdTasks ──

describe('selectIssuesForBatch — dedupe', () => {
  it('skips issues whose key is already in createdTasks', () => {
    const homeTitleKey = issueToTaskKey(PAGES[0], PAGES[0].issues[0]);
    const { items, keys } = selectIssuesForBatch(baseInput({
      mode: 'all',
      createdTasks: new Set([homeTitleKey]),
    }));
    expect(items).toHaveLength(4);
    expect(keys).not.toContain(homeTitleKey);
  });

  it('returns the same length for items and keys (parity invariant)', () => {
    const modes: BatchMode[] = ['all', 'errors', 'filtered'];
    for (const mode of modes) {
      const { items, keys } = selectIssuesForBatch(baseInput({ mode }));
      expect(items).toHaveLength(keys.length);
    }
  });
});
