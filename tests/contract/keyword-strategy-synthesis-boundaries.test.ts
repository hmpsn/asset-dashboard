import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

const facade = readFileSync('server/keyword-strategy-ai-synthesis.ts', 'utf8'); // readFile-ok: source-boundary contract for decomposition guard
const prompts = readFileSync('server/keyword-strategy-synthesis/prompts.ts', 'utf8'); // readFile-ok: source-boundary contract for prompt ownership
const types = readFileSync('server/keyword-strategy-synthesis/types.ts', 'utf8'); // readFile-ok: source-boundary contract for stage type ownership
const pageAssignment = readFileSync('server/keyword-strategy-synthesis/page-assignment.ts', 'utf8'); // readFile-ok: source-boundary contract for OP1 stage ownership
const siteSynthesis = readFileSync('server/keyword-strategy-synthesis/site-synthesis.ts', 'utf8'); // readFile-ok: source-boundary contract for OP2 stage ownership
const siteSynthesisContext = readFileSync('server/keyword-strategy-synthesis/site-synthesis-context.ts', 'utf8'); // readFile-ok: source-boundary contract for OP2 context ownership

describe('keyword strategy synthesis decomposition boundaries', () => {
  it('keeps synthesis-only stage types out of the public facade', () => {
    expect(facade).not.toMatch(/\btype\s+PageMapping\b/);
    expect(facade).not.toMatch(/\binterface\s+PageMapping\b/);
    expect(facade).not.toMatch(/\btype\s+MasterStrategyData\b/);
    expect(facade).not.toMatch(/\binterface\s+MasterStrategyData\b/);
    expect(types).toContain('export interface PageMapping');
    expect(types).toContain('export interface MasterStrategyData');
  });

  it('keeps large AI prompt templates in the prompt stage module', () => {
    expect(facade).not.toContain('Return JSON with this EXACT structure');
    expect(facade).not.toContain('Return a JSON OBJECT (not a bare array)');
    expect(facade).not.toContain('Return a JSON array with one entry per page');
    expect(prompts).toContain('Return JSON with this EXACT structure');
    expect(prompts).toContain('Return a JSON OBJECT (not a bare array)');
    expect(prompts).toContain('Return a JSON array with one entry per page');
  });

  it('keeps OP1 page-assignment batching outside the public facade', () => {
    expect(facade).toContain('runPageAssignmentBatches');
    expect(facade).not.toContain('const runBatch = async');
    expect(facade).not.toContain('postProcessBatch');
    expect(facade).not.toContain('perPageFallbackBatch');
    expect(pageAssignment).toContain('export async function runPageAssignmentBatches');
    expect(pageAssignment).toContain('CONCURRENCY = 3');
    expect(pageAssignment).toContain('pageAssignmentResponseSchema.safeParse');
    expect(pageAssignment).toContain('keyword-page-assignment');
  });

  it('keeps OP2 site-synthesis AI parsing outside the public facade', () => {
    expect(facade).toContain('runSiteSynthesis');
    expect(facade).not.toContain('siteSynthesisResponseSchema.safeParse');
    expect(facade).not.toContain('Master closed-set OP2 failed validation');
    expect(facade).not.toContain('AI returned invalid JSON in master synthesis');
    expect(siteSynthesis).toContain('export async function runSiteSynthesis');
    expect(siteSynthesis).toContain('siteSynthesisResponseSchema.safeParse');
    expect(siteSynthesis).toContain('keyword-site-synthesis');
    expect(siteSynthesis).toContain('AI returned invalid JSON in master synthesis');
  });

  it('keeps OP2 evidence/context assembly outside the public facade', () => {
    expect(facade).toContain('buildSiteSynthesisContext');
    expect(facade).not.toContain('Top GSC queries (last 90 days)');
    expect(facade).not.toContain('GA4 ORGANIC LANDING PAGES not in keyword map');
    expect(facade).not.toContain('SEO AUDIT: HIGH-TRAFFIC PAGES WITH ERRORS');
    expect(facade).not.toContain('STRATEGY SIGNALS (analytics feedback loop');
    expect(siteSynthesisContext).toContain('export async function buildSiteSynthesisContext');
    expect(siteSynthesisContext).toContain('Top GSC queries (last 90 days)');
    expect(siteSynthesisContext).toContain('GA4 ORGANIC LANDING PAGES not in keyword map');
    expect(siteSynthesisContext).toContain('SEO AUDIT: HIGH-TRAFFIC PAGES WITH ERRORS');
    expect(siteSynthesisContext).toContain('STRATEGY SIGNALS (analytics feedback loop');
  });
});
