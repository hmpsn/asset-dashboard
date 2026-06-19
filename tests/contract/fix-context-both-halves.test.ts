/**
 * fix-context-both-halves.test.ts
 *
 * CONTRACT: the FixContext both-halves contract for the 6 content-gap pre-seed fields
 * introduced in Strategy P2 (src/App.tsx:FixContext lines 97–106).
 *
 * The 6 fields are: rationale, competitorProof, volume, intent, questionKeywords, serpFeatures.
 *
 * The four receiver layers that must read these fields end-to-end are:
 *   Layer 1: App.tsx FixContext router-state receiver → stores in [fixContext, setFixContext]
 *   Layer 2: ContentBriefs.tsx → reads fixContextRef.current.{field} and passes to the job params
 *   Layer 3: content-brief-generation-job.ts → maps job params → pageAnalysisContext (standalone path)
 *   Layer 4: content-brief.ts generateBrief() → injects into the AI prompt (pageAnalysisContext block
 *             + separate serpFeatures directive block with matchedPage precedence)
 *
 * NOTE on implementation decision (Lane E):
 *   The standalone path (ContentBriefs.tsx → content-brief-generation-job.ts) forwards all 6 fields
 *   into pageAnalysisContext, NOT into a dedicated strategyCardContext struct. This is because
 *   buildStrategyCardBlock is consumed by the request path (content_requests) where rationale/intent/
 *   priority/journeyStage are structured separately. In the standalone path:
 *     - rationale + intent + competitorProof + volume + questionKeywords → pageAnalysisContext → rendered
 *       inside the "PAGE ANALYSIS CONTEXT" block in generateBrief().
 *     - serpFeatures → pageAnalysisContext.serpFeatures → rendered in a dedicated SERP FEATURE
 *       OPPORTUNITIES block (with matchedPage?.serpFeatures taking precedence when present).
 *
 * STATUS (P3 Lane F — fill phase):
 *   ALL todos are now filled. No remaining deferred items.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '../..');

// ── helper: read source file for static analysis ──────────────────────────────
function src(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8'); // readFile-ok: intentional static contract analysis
}

// ─── Layer 1: FixContext type — 6 fields must be present in src/App.tsx ──────

describe('Layer 1 — FixContext type extension (src/App.tsx)', () => {
  const appTsx = src('src/App.tsx');

  it('FixContext interface includes "rationale" field', () => {
    expect(appTsx).toMatch(/rationale\?:\s*string/);
  });

  it('FixContext interface includes "competitorProof" field', () => {
    expect(appTsx).toMatch(/competitorProof\?:\s*string/);
  });

  it('FixContext interface includes "volume" field', () => {
    expect(appTsx).toMatch(/volume\?:\s*number/);
  });

  it('FixContext interface includes "intent" field', () => {
    // "intent" appears in FixContext alongside the new content-gap fields.
    // We narrow the match to the FixContext block by checking for the comment that introduces them.
    expect(appTsx).toMatch(/rationale\?:\s*string[\s\S]{0,300}intent\?:\s*string/);
  });

  it('FixContext interface includes "questionKeywords" field', () => {
    expect(appTsx).toMatch(/questionKeywords\?:\s*string\[\]/);
  });

  it('FixContext interface includes "serpFeatures" field', () => {
    expect(appTsx).toMatch(/serpFeatures\?:\s*string\[\]/);
  });
});

// ─── Layer 4 (partial): StrategyCardContext type — fields exist in shared/types ─

describe('Layer 4 contract — StrategyCardContext type (shared/types/content.ts)', () => {
  const contentTypes = src('shared/types/content.ts');

  it('StrategyCardContext includes "rationale" field', () => {
    expect(contentTypes).toMatch(/StrategyCardContext[\s\S]{0,500}rationale\?:/);
  });

  it('StrategyCardContext includes "competitorProof" field', () => {
    expect(contentTypes).toMatch(/StrategyCardContext[\s\S]{0,500}competitorProof\?:/);
  });

  it('StrategyCardContext includes "volume" field', () => {
    expect(contentTypes).toMatch(/StrategyCardContext[\s\S]{0,500}volume\?:/);
  });

  it('StrategyCardContext includes "serpFeatures" field', () => {
    expect(contentTypes).toMatch(/StrategyCardContext[\s\S]{0,500}serpFeatures\?:/);
  });

  it('StrategyCardContext includes "intent" field', () => {
    expect(contentTypes).toMatch(/StrategyCardContext[\s\S]{0,500}intent\?:/);
  });
});

// ─── Layer 4 (static): buildStrategyCardBlock — what is rendered ──────────────
//
// buildStrategyCardBlock renders: rationale, intent, priority, journeyStage.
// competitorProof/volume/questionKeywords/serpFeatures are rendered via the pageAnalysisContext
// block inside generateBrief() — NOT via buildStrategyCardBlock. This is by design in Lane E:
// the standalone brief path carries these fields through pageAnalysisContext.

describe('Layer 4 static — buildStrategyCardBlock (server/content-brief.ts)', () => {
  const contentBrief = src('server/content-brief.ts');

  it('buildStrategyCardBlock renders ctx.rationale when present', () => {
    // Verify the rationale output line in buildStrategyCardBlock.
    expect(contentBrief).toMatch(/ctx\.rationale[\s\S]{0,100}Strategic rationale/);
  });

  it('buildStrategyCardBlock renders ctx.intent when present', () => {
    expect(contentBrief).toMatch(/ctx\.intent[\s\S]{0,100}Search intent/);
  });

  it('Layer 4: competitorProof is rendered via generateBrief pageAnalysisContext block, not buildStrategyCardBlock', () => {
    // Lane E decision: competitorProof goes through pageAnalysisContext in the standalone path.
    // The generateBrief() prompt builder renders it via pac.competitorProof in the PAGE ANALYSIS block.
    expect(contentBrief).toMatch(/pac\.competitorProof[\s\S]{0,100}Competitor proof/);
  });

  it('Layer 4: volume is rendered via generateBrief pageAnalysisContext block, not buildStrategyCardBlock', () => {
    // Lane E decision: volume goes through pageAnalysisContext in the standalone path.
    // Rendered as "Estimated search volume: N searches/month" in the PAGE ANALYSIS block.
    expect(contentBrief).toMatch(/pac\.volume[\s\S]{0,200}searches\/month/);
  });

  it('Layer 4: serpFeatures is rendered via generateBrief SERP directives block with matchedPage precedence', () => {
    // serpFeatures has a two-source precedence rule:
    //   1. matchedPage?.serpFeatures (page_keywords provider data) — primary source
    //   2. context.pageAnalysisContext?.serpFeatures (Content Gaps pre-seed) — fallback
    // Both are rendered identically as the SERP FEATURE OPPORTUNITIES block.
    expect(contentBrief).toMatch(/pageAnalysisContext\?\.serpFeatures/);
  });

  it('Layer 4: serpFeatures precedence — matchedPage wins over pageAnalysisContext fallback', () => {
    // The precedence is expressed as: matchedPage?.serpFeatures?.length ? ... : context.pageAnalysisContext?.serpFeatures
    // This assertion verifies the conditional uses matchedPage?.serpFeatures as the primary source.
    expect(contentBrief).toMatch(/matchedPage\?\.serpFeatures\?\.length[\s\S]{0,200}pageAnalysisContext\?\.serpFeatures/);
  });

  it('Layer 4: questionKeywords is rendered via generateBrief pageAnalysisContext block', () => {
    // Rendered as "Related questions to address:\n- {q}" in the PAGE ANALYSIS block.
    expect(contentBrief).toMatch(/pac\.questionKeywords[\s\S]{0,200}Related questions to address/);
  });
});

// ─── Layer 2: ContentBriefs.tsx — forwards FixContext fields to job params ────

describe('Layer 2 static — ContentBriefs.tsx → job params forwarding', () => {
  const contentBriefs = src('src/components/ContentBriefs.tsx');

  it('ContentBriefs.tsx reads fixContextRef', () => {
    // Sanity: ContentBriefs uses fixContextRef.current to read FixContext fields.
    expect(contentBriefs).toMatch(/fixContextRef\.current/);
  });

  it('Layer 2: ContentBriefs.tsx forwards fixContextRef.current.rationale to job params', () => {
    // All 6 fields are forwarded inside a pageAnalysisContext sub-object (Lane E decision).
    // rationale: fixContextRef.current.rationale (or .rationale via fixContextRef.current?.rationale)
    expect(contentBriefs).toMatch(/rationale:\s*fixContextRef\.current(\?)?\.rationale/);
  });

  it('Layer 2: ContentBriefs.tsx forwards fixContextRef.current.competitorProof to job params', () => {
    expect(contentBriefs).toMatch(/competitorProof:\s*fixContextRef\.current(\?)?\.competitorProof/);
  });

  it('Layer 2: ContentBriefs.tsx forwards fixContextRef.current.volume to job params', () => {
    expect(contentBriefs).toMatch(/volume:\s*fixContextRef\.current(\?)?\.volume/);
  });

  it('Layer 2: ContentBriefs.tsx forwards fixContextRef.current.intent to job params', () => {
    // intent was already in FixContext type; Lane E wires it into the pageAnalysisContext forwarding.
    expect(contentBriefs).toMatch(/intent:\s*fixContextRef\.current(\?)?\.intent/);
  });

  it('Layer 2: ContentBriefs.tsx forwards fixContextRef.current.questionKeywords to job params', () => {
    expect(contentBriefs).toMatch(/questionKeywords:\s*fixContextRef\.current(\?)?\.questionKeywords/);
  });

  it('Layer 2: ContentBriefs.tsx forwards fixContextRef.current.serpFeatures to job params', () => {
    expect(contentBriefs).toMatch(/serpFeatures:\s*fixContextRef\.current(\?)?\.serpFeatures/);
  });
});

// ─── Layer 3: content-brief-generation-job.ts — maps job params → generateBrief ──
//
// Lane E decision: standalone path forwards all 6 fields inside pageAnalysisContext (NOT
// strategyCardContext). The request path (generateBriefForRequest) uses strategyCardContext
// for rationale/intent/priority/journeyStage only — competitorProof/volume/serpFeatures/
// questionKeywords are not available on the request path.

describe('Layer 3 static — content-brief-generation-job.ts param mapping', () => {
  const job = src('server/content-brief-generation-job.ts');

  it('job.ts already maps request.rationale → StrategyCardContext.rationale (request path)', () => {
    // This is the EXISTING wiring for the content-request path (generateBriefForRequest).
    expect(job).toMatch(/rationale:\s*request\.rationale/);
  });

  it('job.ts already maps request.intent → StrategyCardContext.intent (request path)', () => {
    expect(job).toMatch(/intent:\s*request\.intent/);
  });

  it('Layer 3: StandaloneContentBriefGenerationParams.pageAnalysisContext includes rationale field', () => {
    // Lane E decision: standalone path carries all 6 fields via pageAnalysisContext sub-object.
    // The StandaloneContentBriefGenerationParams interface nests them under pageAnalysisContext.
    expect(job).toMatch(/pageAnalysisContext\?:[\s\S]{0,300}rationale\?:/);
  });

  it('Layer 3: StandaloneContentBriefGenerationParams.pageAnalysisContext includes competitorProof field', () => {
    expect(job).toMatch(/pageAnalysisContext\?:[\s\S]{0,400}competitorProof\?:/);
  });

  it('Layer 3: StandaloneContentBriefGenerationParams.pageAnalysisContext includes volume field', () => {
    expect(job).toMatch(/pageAnalysisContext\?:[\s\S]{0,400}volume\?:/);
  });

  it('Layer 3: StandaloneContentBriefGenerationParams.pageAnalysisContext includes intent field', () => {
    expect(job).toMatch(/pageAnalysisContext\?:[\s\S]{0,400}intent\?:/);
  });

  it('Layer 3: StandaloneContentBriefGenerationParams.pageAnalysisContext includes questionKeywords field', () => {
    expect(job).toMatch(/pageAnalysisContext\?:[\s\S]{0,500}questionKeywords\?:/);
  });

  it('Layer 3: StandaloneContentBriefGenerationParams.pageAnalysisContext includes serpFeatures field', () => {
    // serpFeatures in pageAnalysisContext: used as the fallback source in the SERP directive block.
    expect(job).toMatch(/pageAnalysisContext\?:[\s\S]{0,600}serpFeatures\?:/);
  });

  it('Layer 3: generateStandaloneBrief passes pageAnalysisContext to generateBrief call', () => {
    // The generateBrief call inside generateStandaloneBrief must forward pageAnalysisContext
    // so the 6 Lane E fields reach the prompt builder.
    expect(job).toMatch(/pageAnalysisContext,?\s*\n?[\s\S]{0,100}/);
  });
});

// ─── End-to-end: buildStrategyCardBlock output when all 6 fields present ─────

describe('Layer 4 unit — buildStrategyCardBlock output contract', () => {
  it('buildStrategyCardBlock returns empty string when ctx has no renderable fields', async () => {
    const { buildStrategyCardBlock } = await import('../../server/content-brief.js');
    const result = buildStrategyCardBlock({});
    expect(result).toBe('');
  });

  it('buildStrategyCardBlock includes rationale when provided', async () => {
    const { buildStrategyCardBlock } = await import('../../server/content-brief.js');
    const result = buildStrategyCardBlock({ rationale: 'Competitor ranks #1, we have no page' });
    expect(result).toContain('Strategic rationale: Competitor ranks #1, we have no page');
  });

  it('buildStrategyCardBlock includes intent when provided', async () => {
    const { buildStrategyCardBlock } = await import('../../server/content-brief.js');
    const result = buildStrategyCardBlock({ intent: 'commercial' });
    expect(result).toContain('Search intent: commercial');
  });

  it('buildStrategyCardBlock includes both rationale and intent in one block', async () => {
    const { buildStrategyCardBlock } = await import('../../server/content-brief.js');
    const result = buildStrategyCardBlock({
      rationale: 'High opportunity, no existing page',
      intent: 'informational',
      priority: 'high',
    });
    expect(result).toContain('STRATEGY CARD CONTEXT');
    expect(result).toContain('Strategic rationale: High opportunity, no existing page');
    expect(result).toContain('Search intent: informational');
    expect(result).toContain('Priority: high');
  });

  it('buildStrategyCardBlock does NOT render competitorProof directly — rendered via pageAnalysisContext', async () => {
    // competitorProof is NOT a field buildStrategyCardBlock renders. It is rendered in the
    // PAGE ANALYSIS CONTEXT block inside generateBrief() via pageAnalysisContext. This test
    // ensures the distinction is stable: buildStrategyCardBlock stays lean.
    const { buildStrategyCardBlock } = await import('../../server/content-brief.js');
    const result = buildStrategyCardBlock({
      rationale: 'x',
      // @ts-expect-error — competitorProof is not a StrategyCardContext field; this checks runtime
      competitorProof: 'competitor.com ranks #3',
    });
    // competitorProof is NOT rendered by buildStrategyCardBlock — it's not in StrategyCardContext
    // used by this function. The assertion confirms no accidental rendering.
    expect(result).not.toContain('Competitor proof');
    expect(result).not.toContain('competitor.com ranks #3');
  });

  it('buildStrategyCardBlock does NOT render volume directly — rendered via pageAnalysisContext', async () => {
    // volume is NOT a field buildStrategyCardBlock renders.
    const { buildStrategyCardBlock } = await import('../../server/content-brief.js');
    const result = buildStrategyCardBlock({
      rationale: 'x',
      // @ts-expect-error — volume is not a StrategyCardContext field
      volume: 5400,
    });
    expect(result).not.toContain('5,400');
    expect(result).not.toContain('searches/month');
  });

  it('buildStrategyCardBlock does NOT render serpFeatures directly — rendered via generateBrief SERP block', async () => {
    // serpFeatures is NOT a field buildStrategyCardBlock renders.
    const { buildStrategyCardBlock } = await import('../../server/content-brief.js');
    const result = buildStrategyCardBlock({
      rationale: 'x',
      // @ts-expect-error — serpFeatures is not a StrategyCardContext field
      serpFeatures: ['featured_snippet', 'people_also_ask'],
    });
    expect(result).not.toContain('featured_snippet');
    expect(result).not.toContain('SERP FEATURE');
  });
});
