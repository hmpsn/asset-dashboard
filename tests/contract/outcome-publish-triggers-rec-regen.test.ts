/**
 * Contract tests — Task 1.3: outcome/publish paths enqueue debounced rec regen.
 *
 * These are source-level grep tests (no server boot needed). They verify that
 * every publish/measure path that changes workspace SEO state calls
 * queueKeywordStrategyPostUpdateFollowOns so recommendations stay fresh.
 *
 * The shared recommendation regen scheduler prevents overlapping per-workspace
 * generateRecommendations calls when bulk publish/measure flows touch the same
 * workspace repeatedly — this test confirms the shared authority is present.
 */
import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

describe('outcome-crons: measure/learnings enqueue rec regen', () => {
  const cronSrc = readFileSync('server/outcome-crons.ts', 'utf-8'); // readFile-ok - wiring contract

  it('imports queueKeywordStrategyPostUpdateFollowOns at the top of outcome-crons.ts', () => {
    // The import must be at the top of the file (before any runtime code) per CLAUDE.md import rule
    const importIdx = cronSrc.indexOf("from './keyword-strategy-follow-ons.js'");
    expect(importIdx, 'import missing from outcome-crons.ts').toBeGreaterThan(0);
    // Ensure it is before the first export function (the import block precedes runtime code)
    const firstExportIdx = cronSrc.indexOf('export function startOutcomeCrons');
    expect(importIdx).toBeLessThan(firstExportIdx);
  });

  it('calls queueKeywordStrategyPostUpdateFollowOns inside runMeasure for each workspace id', () => {
    // The call must appear in the runMeasure closure (before runLearnings)
    const runMeasureStart = cronSrc.indexOf('const runMeasure = async');
    const runLearningsStart = cronSrc.indexOf('const runLearnings = async');
    expect(runMeasureStart).toBeGreaterThan(0);
    expect(runLearningsStart).toBeGreaterThan(runMeasureStart);

    const measureSlice = cronSrc.slice(runMeasureStart, runLearningsStart);
    expect(measureSlice).toContain('queueKeywordStrategyPostUpdateFollowOns({ workspaceId: wsId })');
  });

  it('calls queueKeywordStrategyPostUpdateFollowOns inside runLearnings for each workspace id', () => {
    const runLearningsStart = cronSrc.indexOf('const runLearnings = async');
    const runDetectionStart = cronSrc.indexOf('const runDetection = async');
    expect(runLearningsStart).toBeGreaterThan(0);
    expect(runDetectionStart).toBeGreaterThan(runLearningsStart);

    const learningsSlice = cronSrc.slice(runLearningsStart, runDetectionStart);
    expect(learningsSlice).toContain('queueKeywordStrategyPostUpdateFollowOns({ workspaceId: wsId })');
  });
});

describe('keyword-strategy-follow-ons: per-workspace regen scheduler is present', () => {
  const followOnsSrc = readFileSync('server/keyword-strategy-follow-ons.ts', 'utf-8'); // readFile-ok - debounce contract
  const schedulerSrc = readFileSync('server/recommendation-regen-scheduler.ts', 'utf-8'); // readFile-ok - debounce contract

  it('routes follow-ons through the shared delayed regen queue', () => {
    expect(followOnsSrc).toContain("from './recommendation-regen-scheduler.js'");
    expect(followOnsSrc).toContain("queueDelayedRecommendationRegen(workspaceId, 'keyword_strategy_follow_on', RECOMMENDATION_REFRESH_DELAY_MS)");
  });

  it('keeps a shared per-workspace single-flight guard in the scheduler', () => {
    expect(schedulerSrc).toContain('const inflight = new Map<string, Promise<void>>()');
    expect(schedulerSrc).toContain('const delayed = new Map<string, ReturnType<typeof setTimeout>>()');
    expect(schedulerSrc).toContain('const existing = inflight.get(workspaceId)');
  });
});

describe('publish service (C3): BOTH publish paths enqueue rec regen via the shared service', () => {
  // C3 (audit item #12) extracted ONE publishPostToWebflow() service consumed by BOTH the manual
  // publish route AND the auto-publish-on-approval job. The rec-regen follow-on lives inside that
  // service so it fires on BOTH paths — before C3 the auto-publish path silently skipped it.
  const serviceSrc = readFileSync('server/domains/content/publish-post-to-webflow.ts', 'utf-8'); // readFile-ok - wiring contract
  const manualRouteSrc = readFileSync('server/routes/content-publish.ts', 'utf-8'); // readFile-ok - wiring contract
  const autoRouteSrc = readFileSync('server/routes/content-posts.ts', 'utf-8'); // readFile-ok - wiring contract
  const jobSrc = readFileSync('server/content-publish-job.ts', 'utf-8'); // readFile-ok - wiring contract

  it('imports queueKeywordStrategyPostUpdateFollowOns at the top of the shared service', () => {
    const importIdx = serviceSrc.indexOf("from '../../keyword-strategy-follow-ons.js'");
    expect(importIdx, 'follow-ons import missing from publish service').toBeGreaterThan(0);
    const fnIdx = serviceSrc.indexOf('export async function publishPostToWebflow');
    expect(importIdx).toBeLessThan(fnIdx);
  });

  it('calls queueKeywordStrategyPostUpdateFollowOns inside the shared service (single site)', () => {
    expect(serviceSrc).toContain('queueKeywordStrategyPostUpdateFollowOns({ workspaceId });');
  });

  it('the MANUAL publish route consumes the shared publishPostToWebflow service', () => {
    expect(manualRouteSrc).toContain("from '../domains/content/publish-post-to-webflow.js'");
    expect(manualRouteSrc).toContain('publishPostToWebflow(workspaceId, postId');
  });

  it('the AUTO-publish-on-approval path dispatches the CONTENT_PUBLISH job (which calls the service)', () => {
    expect(autoRouteSrc).toContain("from '../content-publish-job.js'");
    expect(autoRouteSrc).toContain('BACKGROUND_JOB_TYPES.CONTENT_PUBLISH');
    expect(autoRouteSrc).toContain('runContentPublishJob({');
    // The job runner is the bridge from the auto path to the shared service.
    expect(jobSrc).toContain("from './domains/content/publish-post-to-webflow.js'");
    expect(jobSrc).toContain('publishPostToWebflow(workspaceId, postId');
  });
});

describe('webflow-schema: schema publish paths enqueue rec regen', () => {
  const schemaSrc = readFileSync('server/routes/webflow-schema.ts', 'utf-8'); // readFile-ok - wiring contract

  it('imports queueKeywordStrategyPostUpdateFollowOns at the top of webflow-schema.ts', () => {
    const importIdx = schemaSrc.indexOf("from '../keyword-strategy-follow-ons.js'");
    expect(importIdx, 'import missing from webflow-schema.ts').toBeGreaterThan(0);
    // Must appear before the schema-publish route handler
    const routeIdx = schemaSrc.indexOf("router.post('/api/webflow/schema-publish/");
    expect(importIdx).toBeLessThan(routeIdx);
  });

  it('calls queueKeywordStrategyPostUpdateFollowOns in the CMS field delivery branch', () => {
    // The CMS delivery branch returns early — the call must be inside that branch
    const cmsDeliveryStart = schemaSrc.indexOf('if (cmsDelivery) {');
    expect(cmsDeliveryStart).toBeGreaterThan(0);
    // Find the closing region of the cmsDelivery block (ends before "publishSchemaToPage")
    const directPublishStart = schemaSrc.indexOf('const result = await publishSchemaToPage(');
    const cmsSlice = schemaSrc.slice(cmsDeliveryStart, directPublishStart);
    expect(cmsSlice).toContain('queueKeywordStrategyPostUpdateFollowOns({ workspaceId');
  });

  it('calls queueKeywordStrategyPostUpdateFollowOns in the direct publish branch', () => {
    // The direct-publish branch runs after publishSchemaToPage succeeds
    const directPublishStart = schemaSrc.indexOf('const result = await publishSchemaToPage(');
    expect(directPublishStart).toBeGreaterThan(0);
    const directSlice = schemaSrc.slice(directPublishStart);
    expect(directSlice).toContain('queueKeywordStrategyPostUpdateFollowOns({ workspaceId');
  });
});
