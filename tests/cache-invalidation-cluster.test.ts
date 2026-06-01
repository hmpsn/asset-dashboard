/**
 * Task 4.1 — Cache-invalidation cluster wiring guard.
 *
 * These tests verify that every workspace-scoped write site that was missing
 * `invalidateIntelligenceCache` (audit finding A-9/11/12/13) now calls it, so
 * the advisor is never served stale data after a write.
 *
 * Pattern: source-file static analysis (same as scheduler-invalidation.test.ts
 * and ws-intelligence-cache.test.ts). Each assertion is a readFile-ok guard.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (rel: string) =>
  readFileSync(resolve(import.meta.dirname, '..', rel), 'utf-8'); // readFile-ok — wiring guard

describe('Task 4.1 — Cache-invalidation cluster (A-9/11/12/13)', () => {
  // ── approvals.ts service fns ──────────────────────────────────────────────

  it('server/approvals.ts imports invalidateIntelligenceCache', () => {
    expect(read('server/approvals.ts')).toContain('invalidateIntelligenceCache');
  });

  it('server/approvals.ts calls invalidateIntelligenceCache in createBatch', () => {
    const src = read('server/approvals.ts');
    // createBatch ends before listBatches; verify the call appears before that boundary
    const createBatchSection = src.slice(src.indexOf('export function createBatch'), src.indexOf('export function listBatches'));
    expect(createBatchSection).toContain('invalidateIntelligenceCache');
  });

  it('server/approvals.ts calls invalidateIntelligenceCache in markBatchApplied', () => {
    const src = read('server/approvals.ts');
    const markBatchSection = src.slice(src.indexOf('export function markBatchApplied'));
    expect(markBatchSection).toContain('invalidateIntelligenceCache');
  });

  it('server/approvals.ts calls invalidateIntelligenceCache in deleteBatch', () => {
    const src = read('server/approvals.ts');
    const deleteBatchSection = src.slice(src.indexOf('export function deleteBatch'));
    expect(deleteBatchSection).toContain('invalidateIntelligenceCache');
  });

  // ── webflow-schema.ts write endpoints ────────────────────────────────────

  it('server/routes/webflow-schema.ts imports invalidateIntelligenceCache', () => {
    expect(read('server/routes/webflow-schema.ts')).toContain('invalidateIntelligenceCache');
  });

  it('server/routes/webflow-schema.ts calls invalidateIntelligenceCache on schema-publish', () => {
    const src = read('server/routes/webflow-schema.ts');
    const publishSection = src.slice(src.indexOf('/api/webflow/schema-publish/:siteId'));
    expect(publishSection).toContain('invalidateIntelligenceCache');
  });

  it('server/routes/webflow-schema.ts calls invalidateIntelligenceCache on schema-rollback', () => {
    const src = read('server/routes/webflow-schema.ts');
    const rollbackSection = src.slice(src.indexOf('/api/webflow/schema-rollback/:siteId'));
    expect(rollbackSection).toContain('invalidateIntelligenceCache');
  });

  it('server/routes/webflow-schema.ts calls invalidateIntelligenceCache on schema-plan', () => {
    const src = read('server/routes/webflow-schema.ts');
    // plan endpoints: POST, PUT, send-to-client, activate, delete
    const planSection = src.slice(src.indexOf('/api/webflow/schema-plan/:siteId'));
    expect(planSection).toContain('invalidateIntelligenceCache');
  });

  // ── outcomes.ts write endpoints ───────────────────────────────────────────

  it('server/routes/outcomes.ts imports invalidateIntelligenceCache', () => {
    expect(read('server/routes/outcomes.ts')).toContain('invalidateIntelligenceCache');
  });

  it('server/routes/outcomes.ts calls invalidateIntelligenceCache in record-action POST', () => {
    const src = read('server/routes/outcomes.ts');
    const recordSection = src.slice(src.indexOf('/api/outcomes/:workspaceId/actions\''));
    expect(recordSection).toContain('invalidateIntelligenceCache');
  });

  // ── webflow-analysis.ts ───────────────────────────────────────────────────

  it('server/routes/webflow-analysis.ts imports invalidateIntelligenceCache', () => {
    expect(read('server/routes/webflow-analysis.ts')).toContain('invalidateIntelligenceCache');
  });

  it('server/routes/webflow-analysis.ts calls invalidateIntelligenceCache after internal-links recordAction', () => {
    const src = read('server/routes/webflow-analysis.ts');
    const linksSection = src.slice(src.indexOf('/api/webflow/internal-links/:siteId'));
    expect(linksSection).toContain('invalidateIntelligenceCache');
  });

  // ── SEO-change writers ────────────────────────────────────────────────────

  it('server/routes/webflow.ts imports invalidateIntelligenceCache', () => {
    expect(read('server/routes/webflow.ts')).toContain('invalidateIntelligenceCache');
  });

  it('server/routes/webflow.ts calls invalidateIntelligenceCache in the seo-update PUT', () => {
    const src = read('server/routes/webflow.ts');
    const seoSection = src.slice(src.indexOf('/api/webflow/pages/:pageId/seo'));
    expect(seoSection).toContain('invalidateIntelligenceCache');
  });

  it('server/webflow-seo-bulk-accept-fixes-job.ts imports invalidateIntelligenceCache', () => {
    expect(read('server/webflow-seo-bulk-accept-fixes-job.ts')).toContain('invalidateIntelligenceCache');
  });

  it('server/webflow-seo-bulk-accept-fixes-job.ts calls invalidateIntelligenceCache after applying fixes', () => {
    const src = read('server/webflow-seo-bulk-accept-fixes-job.ts');
    // Must appear in the success path (after BULK_OPERATION_COMPLETE broadcast)
    const completionSection = src.slice(src.indexOf('BULK_OPERATION_COMPLETE'));
    expect(completionSection).toContain('invalidateIntelligenceCache');
  });

  it('server/routes/webflow-seo-suggestions.ts imports invalidateIntelligenceCache', () => {
    expect(read('server/routes/webflow-seo-suggestions.ts')).toContain('invalidateIntelligenceCache');
  });

  it('server/routes/webflow-seo-suggestions.ts calls invalidateIntelligenceCache in apply endpoint', () => {
    const src = read('server/routes/webflow-seo-suggestions.ts');
    const applySection = src.slice(src.indexOf('/api/webflow/seo-suggestions/:workspaceId/apply'));
    expect(applySection).toContain('invalidateIntelligenceCache');
  });

  it('server/routes/webflow-seo-apply.ts imports invalidateIntelligenceCache', () => {
    expect(read('server/routes/webflow-seo-apply.ts')).toContain('invalidateIntelligenceCache');
  });

  it('server/routes/webflow-seo-apply.ts calls invalidateIntelligenceCache in seo-pattern-apply', () => {
    const src = read('server/routes/webflow-seo-apply.ts');
    const patternSection = src.slice(src.indexOf('/api/webflow/seo-pattern-apply/:siteId'));
    expect(patternSection).toContain('invalidateIntelligenceCache');
  });
});
