/**
 * PR7 · Spine B — wiring contract tests (source-level greps, no server boot).
 *
 * Verifies that the event-driven re-ranking detectors + apply tail are wired in
 * their default-on posture, and that the regen helper breaks the
 * recommendations.ts ↔ event-store cycle via a dynamic import.
 */
import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

describe('competitor cron → opportunity event + regen', () => {
  const src = readFileSync('server/intelligence-crons.ts', 'utf-8'); // readFile-ok - wiring contract

  it('writes competitor events without an extra runtime feature gate', () => {
    expect(src).not.toContain("isFeatureEnabled('opportunity-value-events')");
  });
  it('writes a competitor opportunity event', () => {
    expect(src).toContain("type: 'competitor'");
    expect(src).toContain('insertOpportunityEvent');
  });
  it('triggers a debounced regen after writing competitor events', () => {
    expect(src).toContain('triggerOpportunityRegen(ws.id)');
  });
  it('does NOT mint a defensive recommendation (deferred)', () => {
    // The competitor detector raises a timing boost on EXISTING recs; it must not
    // create a net-new rec. Guard against accidental rec minting in the cron.
    expect(src).not.toContain('generateRecommendations');
  });
});

describe('apply tail → opportunity regen', () => {
  const src = readFileSync('server/recommendations.ts', 'utf-8'); // readFile-ok - wiring contract
  const generationSrc = readFileSync('server/domains/recommendations/generation-service.ts', 'utf-8'); // readFile-ok - wiring contract
  const resolutionSrc = readFileSync('server/domains/recommendations/resolution-service.ts', 'utf-8'); // readFile-ok - wiring contract
  const producerSrc = [
    'server/domains/recommendations/audit-producers.ts',
    'server/domains/recommendations/strategy-producers.ts',
    'server/domains/recommendations/local-visibility-producers.ts',
    'server/domains/recommendations/maintenance-producers.ts',
  ].map(file => readFileSync(file, 'utf-8')).join('\n'); // readFile-ok - wiring contract across producer family modules

  it('triggers a debounced regen on resolveRecommendationsForChange', () => {
    const fnStart = resolutionSrc.indexOf('export function resolveRecommendationsForChange');
    expect(fnStart).toBeGreaterThan(0);
    const fnSrc = resolutionSrc.slice(fnStart, resolutionSrc.indexOf('export function resolveRecommendationsForPageIds'));
    expect(resolutionSrc).toContain("from '../../scoring/opportunity-regen.js'");
    expect(fnSrc).toContain('triggerOpportunityRegen(workspaceId)');
    expect(src).toContain("from './domains/recommendations/resolution-service.js'");
  });

  it('threads a decaying timingBoost into every computeOpportunityValue call', () => {
    // Each OV push site must carry a timingBoost computed from the rec's pages.
    const ovSource = `${src}\n${producerSrc}`;
    const ovCalls = (ovSource.match(/computeOpportunityValue\(\{/g) ?? []).length;
    const timingBoosts = (ovSource.match(/timingBoost: maxBoostForPages\((?:ctx\.)?timingBoosts,/g) ?? []).length;
    expect(ovCalls).toBeGreaterThan(0);
    expect(timingBoosts).toBe(ovCalls);
  });

  it('generateRecommendations does NOT call triggerOpportunityRegen (no recursion)', () => {
    const genStart = generationSrc.indexOf('export async function generateRecommendations');
    expect(genStart).toBeGreaterThan(0);
    const genSrc = generationSrc.slice(genStart);
    expect(genSrc).not.toContain('triggerOpportunityRegen');
  });
});

describe('opportunity-regen breaks the recommendations cycle', () => {
  const regenSrc = readFileSync('server/scoring/opportunity-regen.ts', 'utf-8'); // readFile-ok - cycle contract
  const schedulerSrc = readFileSync('server/recommendation-regen-scheduler.ts', 'utf-8'); // readFile-ok - cycle contract
  const recommendationFacade = readFileSync('server/recommendations.ts', 'utf-8'); // readFile-ok - cycle contract

  it('keeps the dynamic-import cycle break in the shared scheduler', () => {
    expect(schedulerSrc).toContain("await import('./recommendations.js')");
    expect(schedulerSrc).not.toContain("from './recommendations.js'");
  });
  it('keeps recommendation generation lazy behind the public facade', () => {
    expect(recommendationFacade).toContain("const generationServicePath = './domains/recommendations/generation-service.js'");
    expect(recommendationFacade).toContain('await import(generationServicePath)');
    expect(recommendationFacade).not.toContain("from './domains/recommendations/generation-service.js'");
  });
  it('is built on debounceBridge with the opportunity event source id', () => {
    expect(regenSrc).toContain("debounceBridge('opportunity-value-events'");
  });
  it('routes the debounced event path through the shared single-flight scheduler', () => {
    expect(regenSrc).toContain('schedulerModulePath()');
    expect(regenSrc).not.toContain("from '../recommendation-regen-scheduler.js'");
    expect(regenSrc).toContain("runRecommendationRegen(workspaceId, 'opportunity_value_event')");
  });
});

describe('outcome-crons registers the decay + rank-decline detectors', () => {
  const src = readFileSync('server/outcome-crons.ts', 'utf-8'); // readFile-ok - wiring contract

  it('schedules runDecayScan and runRankDeclineScan', () => {
    expect(src).toContain('runDecayScan');
    expect(src).toContain('runRankDeclineScan');
    expect(src).toContain('decayScanInterval = setInterval');
    expect(src).toContain('rankDeclineScanInterval = setInterval');
  });
  it('cleans up the new intervals in stopOutcomeCrons', () => {
    const stopStart = src.indexOf('export function stopOutcomeCrons');
    const stopSrc = src.slice(stopStart);
    expect(stopSrc).toContain('clearInterval(decayScanInterval)');
    expect(stopSrc).toContain('clearInterval(rankDeclineScanInterval)');
  });
});
