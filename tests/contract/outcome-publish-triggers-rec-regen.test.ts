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

describe('publish-schema-to-live (G1): BOTH schema publish paths enqueue rec regen via the shared service', () => {
  // G1 extracted ONE publishSchemaToLive() service consumed by BOTH the admin
  // schema-publish route AND the MCP `publish_schema` tool. The rec-regen
  // follow-on (plus recordSeoChange + llms.txt) now lives inside that service so
  // it fires on BOTH paths and across BOTH the CMS-field and static-page publish
  // branches — before G1 the MCP path silently skipped recordSeoChange/llms.txt/
  // rec-regen and imported publishSchemaToCmsField straight from the route.
  const serviceSrc = readFileSync('server/domains/schema/publish-schema-to-live.ts', 'utf-8'); // readFile-ok - wiring contract
  const routeSrc = readFileSync('server/routes/webflow-schema.ts', 'utf-8'); // readFile-ok - wiring contract
  const mcpToolSrc = readFileSync('server/mcp/tools/schema-actions.ts', 'utf-8'); // readFile-ok - wiring contract

  it('imports queueKeywordStrategyPostUpdateFollowOns at the top of the shared service', () => {
    const importIdx = serviceSrc.indexOf("from '../../keyword-strategy-follow-ons.js'");
    expect(importIdx, 'follow-ons import missing from publish-schema-to-live.ts').toBeGreaterThan(0);
    const fnIdx = serviceSrc.indexOf('export async function publishSchemaToLive');
    expect(importIdx).toBeLessThan(fnIdx);
  });

  it('runs the full follow-on set (rec regen + recordSeoChange + llms.txt) inside the shared service', () => {
    expect(serviceSrc).toContain('queueKeywordStrategyPostUpdateFollowOns({ workspaceId }');
    expect(serviceSrc).toContain('recordSeoChange(');
    expect(serviceSrc).toContain("queueLlmsTxtRegeneration(workspaceId, 'schema_published')");
  });

  it('the admin schema-publish route consumes the shared publishSchemaToLive service', () => {
    expect(routeSrc).toContain("from '../domains/schema/publish-schema-to-live.js'");
    expect(routeSrc).toContain('publishSchemaToLive({');
  });

  it('the MCP publish_schema tool consumes the shared service (and not the route)', () => {
    expect(mcpToolSrc).toContain("from '../../domains/schema/publish-schema-to-live.js'");
    expect(mcpToolSrc).toContain('publishSchemaToLive({');
    // The tool→route import smell must be gone: no import from server/routes/.
    expect(mcpToolSrc).not.toContain("from '../../routes/");
  });
});
