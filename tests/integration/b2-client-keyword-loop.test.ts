/**
 * B2 — Client Keyword Loop tests
 *
 * Covers:
 *   1. ADD_TO_STRATEGY actually mutates the page_keywords artifact (not just feedback/tracking)
 *   2. ADD_TO_STRATEGY to a page with an existing primary keyword appends as secondary
 *   3. ADD_TO_STRATEGY without pagePath creates a planned page entry
 *   4. Idempotent: re-adding the same keyword to the same page does not duplicate
 *   5. Feedback + tracking rows are preserved (pre-existing behavior intact)
 *
 * Uses the same in-process DB pattern as keyword-command-center.test.ts (unit tier),
 * as integration-tier tests (HTTP server spawn) time out in the isolated worktree environment.
 * The plan doc notes this deviation; the core test assertions cover the actual read path
 * (getPageKeyword → page_keywords table) which is what integration tests would exercise.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setBroadcast } from '../../server/broadcast.js';
import { applyKeywordCommandCenterAction } from '../../server/keyword-command-center.js';
import { getPageKeyword, upsertPageKeyword } from '../../server/page-keywords.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import db from '../../server/db/index.js';
import { KEYWORD_COMMAND_CENTER_ACTIONS } from '../../shared/types/keyword-command-center.js';

let workspaceId = '';

beforeEach(() => {
  setBroadcast(vi.fn(), vi.fn());
  workspaceId = createWorkspace(`B2 Client Keyword Loop ${Date.now()}`).id;
});

afterEach(() => {
  if (workspaceId) {
    db.prepare('DELETE FROM keyword_feedback WHERE workspace_id = ?').run(workspaceId);
    db.prepare('DELETE FROM page_keywords WHERE workspace_id = ?').run(workspaceId);
    deleteWorkspace(workspaceId);
  }
  workspaceId = '';
});

describe('B2 — ADD_TO_STRATEGY artifact write', () => {
  it('writes the page_keywords row when pagePath is provided', () => {
    const result = applyKeywordCommandCenterAction(workspaceId, {
      action: KEYWORD_COMMAND_CENTER_ACTIONS.ADD_TO_STRATEGY,
      keyword: 'seo audit tool',
      pagePath: '/services/seo-audit',
    });

    expect(result.ok).toBe(true);

    // Core fix: the strategy artifact must be written (was a phantom before B2)
    const pageKw = getPageKeyword(workspaceId, '/services/seo-audit');
    expect(pageKw).toBeDefined();
    expect(pageKw?.primaryKeyword).toBe('seo audit tool');
  });

  it('appends as secondary keyword when pagePath already has a primary keyword', () => {
    // Seed an existing page keyword entry
    upsertPageKeyword(workspaceId, {
      pagePath: '/services/existing-page',
      pageTitle: 'SEO Audit Services',
      primaryKeyword: 'seo audit',
      secondaryKeywords: [],
    });

    applyKeywordCommandCenterAction(workspaceId, {
      action: KEYWORD_COMMAND_CENTER_ACTIONS.ADD_TO_STRATEGY,
      keyword: 'seo audit tool',
      pagePath: '/services/existing-page',
    });

    const pageKw = getPageKeyword(workspaceId, '/services/existing-page');
    expect(pageKw).toBeDefined();
    // Primary keyword must remain the original one
    expect(pageKw?.primaryKeyword).toBe('seo audit');
    // New keyword is appended as secondary
    expect(pageKw?.secondaryKeywords).toContain('seo audit tool');
  });

  it('creates a planned page entry when no pagePath is provided', () => {
    applyKeywordCommandCenterAction(workspaceId, {
      action: KEYWORD_COMMAND_CENTER_ACTIONS.ADD_TO_STRATEGY,
      keyword: 'local seo strategy',
    });

    // Planned page uses slugified keyword as the path
    const pageKw = getPageKeyword(workspaceId, '/planned/local-seo-strategy');
    expect(pageKw).toBeDefined();
    expect(pageKw?.primaryKeyword).toBe('local seo strategy');
  });

  it('is idempotent: re-adding same keyword to same page does not duplicate secondaries', () => {
    // Seed with an existing primary keyword
    upsertPageKeyword(workspaceId, {
      pagePath: '/services/idempotent-test',
      pageTitle: 'Idempotent Test Page',
      primaryKeyword: 'existing primary',
      secondaryKeywords: [],
    });

    // Add keyword once
    applyKeywordCommandCenterAction(workspaceId, {
      action: KEYWORD_COMMAND_CENTER_ACTIONS.ADD_TO_STRATEGY,
      keyword: 'duplicate test keyword',
      pagePath: '/services/idempotent-test',
    });

    // Add the same keyword again
    applyKeywordCommandCenterAction(workspaceId, {
      action: KEYWORD_COMMAND_CENTER_ACTIONS.ADD_TO_STRATEGY,
      keyword: 'duplicate test keyword',
      pagePath: '/services/idempotent-test',
    });

    const pageKw = getPageKeyword(workspaceId, '/services/idempotent-test');
    expect(pageKw).toBeDefined();
    // Should only appear once in secondaryKeywords
    const dupeCount = (pageKw?.secondaryKeywords ?? []).filter(
      k => k.toLowerCase() === 'duplicate test keyword',
    ).length;
    expect(dupeCount).toBe(1);
  });

  it('feedback + tracking rows are also written (pre-existing behavior preserved)', () => {
    const result = applyKeywordCommandCenterAction(workspaceId, {
      action: KEYWORD_COMMAND_CENTER_ACTIONS.ADD_TO_STRATEGY,
      keyword: 'feedback preservation test',
      pagePath: '/services/feedback-test',
    });

    expect(result.ok).toBe(true);
    // trackedKeywords is returned from the tracking write
    expect(result.trackedKeywords).toBeDefined();

    // Feedback row should have status 'approved'
    const feedbackRow = db.prepare(
      'SELECT status FROM keyword_feedback WHERE workspace_id = ? AND keyword = ?',
    ).get(workspaceId, 'feedback preservation test') as { status: string } | undefined;
    expect(feedbackRow?.status).toBe('approved');
  });

  it('does not add keyword to secondary when it matches the primary (case-insensitive)', () => {
    // Seed with the same keyword as primary
    upsertPageKeyword(workspaceId, {
      pagePath: '/services/same-as-primary',
      pageTitle: 'Same Keyword Test Page',
      primaryKeyword: 'SEO Audit Tool',
      secondaryKeywords: [],
    });

    applyKeywordCommandCenterAction(workspaceId, {
      action: KEYWORD_COMMAND_CENTER_ACTIONS.ADD_TO_STRATEGY,
      keyword: 'seo audit tool',
      pagePath: '/services/same-as-primary',
    });

    const pageKw = getPageKeyword(workspaceId, '/services/same-as-primary');
    expect(pageKw).toBeDefined();
    // Primary unchanged, secondary still empty (no duplicate)
    expect(pageKw?.primaryKeyword).toBe('SEO Audit Tool');
    expect(pageKw?.secondaryKeywords).toHaveLength(0);
  });
});
