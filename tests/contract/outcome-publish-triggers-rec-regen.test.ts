/**
 * Contract tests — Task 1.3: outcome/publish paths enqueue debounced rec regen.
 *
 * These are source-level grep tests (no server boot needed). They verify that
 * every publish/measure path that changes workspace SEO state calls
 * queueKeywordStrategyPostUpdateFollowOns so recommendations stay fresh.
 *
 * The debounce guard (recsInFlight Set in keyword-strategy-follow-ons.ts)
 * prevents N concurrent generateRecommendations calls when a bulk publish
 * touches N workspaces — this test confirms the guard is present.
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

describe('keyword-strategy-follow-ons: per-workspace debounce guard is present', () => {
  const followOnsSrc = readFileSync('server/keyword-strategy-follow-ons.ts', 'utf-8'); // readFile-ok - debounce contract

  it('uses a recsInFlight Set to prevent concurrent regen for the same workspace', () => {
    expect(followOnsSrc).toContain('const recsInFlight = new Set<string>()');
    expect(followOnsSrc).toContain('recsInFlight.has(workspaceId)');
    expect(followOnsSrc).toContain('recsInFlight.add(workspaceId)');
    expect(followOnsSrc).toContain('recsInFlight.delete(workspaceId)');
  });
});

describe('content-publish: publish path enqueues rec regen', () => {
  const publishSrc = readFileSync('server/routes/content-publish.ts', 'utf-8'); // readFile-ok - wiring contract

  it('imports queueKeywordStrategyPostUpdateFollowOns at the top of content-publish.ts', () => {
    const importIdx = publishSrc.indexOf("from '../keyword-strategy-follow-ons.js'");
    expect(importIdx, 'import missing from content-publish.ts').toBeGreaterThan(0);
    // Must appear before the router.post handler
    const routerIdx = publishSrc.indexOf('router.post(');
    expect(importIdx).toBeLessThan(routerIdx);
  });

  it('calls queueKeywordStrategyPostUpdateFollowOns in the publish-to-webflow handler', () => {
    expect(publishSrc).toContain('queueKeywordStrategyPostUpdateFollowOns({ workspaceId');
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
