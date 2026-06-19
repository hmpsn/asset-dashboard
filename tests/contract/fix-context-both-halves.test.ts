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
 *   Layer 3: content-brief-generation-job.ts → maps job params → StrategyCardContext / brief inputs
 *   Layer 4: content-brief.ts buildStrategyCardBlock() → injects into the AI prompt
 *
 * STATUS (P3 Lane B — scaffold phase):
 *   - Layer 1: DONE in P2 pre-commit (FixContext type extension, no runtime wiring needed)
 *   - Layer 4: rationale + intent ALREADY wired (buildStrategyCardBlock reads both)
 *   - Layer 4: competitorProof, volume, serpFeatures ARE in StrategyCardContext type but NOT
 *     yet rendered by buildStrategyCardBlock
 *   - Layer 2+3: The P3 new fields (rationale/competitorProof/volume/intent/questionKeywords/
 *     serpFeatures) are NOT yet forwarded by ContentBriefs.tsx → job params — this is Lane E's work
 *
 * Read-path assertions that depend on Lane E's implementation are marked it.todo.
 * The STATIC shape assertions (Layer 4 - what is already in buildStrategyCardBlock + types)
 * are REAL tests.
 *
 * Lane F fills in the it.todo bodies once Lane E lands.
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

// ─── Layer 4 (static): buildStrategyCardBlock — what is already rendered ──────

describe('Layer 4 static — buildStrategyCardBlock (server/content-brief.ts)', () => {
  const contentBrief = src('server/content-brief.ts');

  it('buildStrategyCardBlock renders ctx.rationale when present', () => {
    // Verify the rationale output line in buildStrategyCardBlock.
    expect(contentBrief).toMatch(/ctx\.rationale[\s\S]{0,100}Strategic rationale/);
  });

  it('buildStrategyCardBlock renders ctx.intent when present', () => {
    expect(contentBrief).toMatch(/ctx\.intent[\s\S]{0,100}Search intent/);
  });

  it.todo(
    'Layer 4: buildStrategyCardBlock renders ctx.competitorProof — Lane E adds this to the prompt block',
    // Expected: content-brief.ts:buildStrategyCardBlock adds:
    //   if (ctx.competitorProof) lines.push(`- Competitor proof: ${ctx.competitorProof}`);
    // so the AI knows a competitor ranks for this keyword.
  );

  it.todo(
    'Layer 4: buildStrategyCardBlock renders ctx.volume — Lane E adds volume to the prompt block',
    // Expected: content-brief.ts:buildStrategyCardBlock adds:
    //   if (ctx.volume) lines.push(`- Monthly search volume: ~${ctx.volume.toLocaleString()}`);
  );

  it.todo(
    'Layer 4: buildStrategyCardBlock renders ctx.serpFeatures — Lane E adds SERP feature context',
    // Expected: content-brief.ts:buildStrategyCardBlock adds serpFeatures to the prompt so the
    // brief generator can structure content to target featured-snippet / PAA / etc.
    // Note: the existing matchedPage?.serpFeatures path (content-brief.ts:1240) draws from the
    // page_keywords table; this field draws from the ContentGap.serpFeatures at brief-trigger time.
    // Lane E must ensure these two sources compose correctly (union or precedence decision).
  );
});

// ─── Layer 2: ContentBriefs.tsx — forwards FixContext fields to job params ────

describe('Layer 2 static — ContentBriefs.tsx → job params forwarding', () => {
  const contentBriefs = src('src/components/ContentBriefs.tsx');

  it('ContentBriefs.tsx reads fixContextRef', () => {
    // Sanity: ContentBriefs uses fixContextRef.current to read FixContext fields.
    expect(contentBriefs).toMatch(/fixContextRef\.current/);
  });

  it.todo(
    'Layer 2: ContentBriefs.tsx forwards fixContextRef.current.rationale to job params',
    // Expected after Lane E:
    //   rationale: fixContextRef.current?.rationale,
    // passed into the startBriefGenerationJob({ ... }) call (around line 474-491).
    // Layer 4 receiver: content-brief-generation-job.ts maps params.rationale → StrategyCardContext.rationale
  );

  it.todo(
    'Layer 2: ContentBriefs.tsx forwards fixContextRef.current.competitorProof to job params',
  );

  it.todo(
    'Layer 2: ContentBriefs.tsx forwards fixContextRef.current.volume to job params',
  );

  it.todo(
    'Layer 2: ContentBriefs.tsx forwards fixContextRef.current.intent to job params',
    // Note: FixContext.intent was already in the type (FixContext:104); the SENDER (ContentGaps.tsx)
    // was NOT forwarding it pre-Lane E. Lane E must add it to the ContentBriefs → job params path.
  );

  it.todo(
    'Layer 2: ContentBriefs.tsx forwards fixContextRef.current.questionKeywords to job params',
  );

  it.todo(
    'Layer 2: ContentBriefs.tsx forwards fixContextRef.current.serpFeatures to job params',
  );
});

// ─── Layer 3: content-brief-generation-job.ts — maps job params → StrategyCardContext ──

describe('Layer 3 static — content-brief-generation-job.ts param mapping', () => {
  const job = src('server/content-brief-generation-job.ts');

  it('job.ts already maps request.rationale → StrategyCardContext.rationale', () => {
    // This is the EXISTING wiring for the content-request path.
    // The standalone path (StandaloneContentBriefGenerationParams) needs the same treatment in Lane E.
    expect(job).toMatch(/rationale:\s*request\.rationale/);
  });

  it('job.ts already maps request.intent → StrategyCardContext.intent', () => {
    expect(job).toMatch(/intent:\s*request\.intent/);
  });

  it.todo(
    'Layer 3: job.ts maps StandaloneContentBriefGenerationParams.rationale → StrategyCardContext.rationale',
    // The existing mapping at content-brief-generation-job.ts:340 is for the `request` path
    // (source: 'request' / RequestContentBriefGenerationParams). Lane E must add the same
    // rationale/intent/competitorProof/volume/serpFeatures/questionKeywords mapping for the
    // standalone path (source: 'standalone' / StandaloneContentBriefGenerationParams):
    //   strategyCardContext: {
    //     rationale: params.rationale,
    //     intent: params.intent,
    //     competitorProof: params.competitorProof,
    //     volume: params.volume,
    //     serpFeatures: params.serpFeatures,
    //     journeyStage: deriveJourneyStage(params.intent),
    //   }
  );

  it.todo(
    'Layer 3: job.ts maps params.questionKeywords into the brief generation context',
    // questionKeywords does not currently appear in StrategyCardContext. Lane E must decide whether
    // to add it to StrategyCardContext or pass it as a separate relatedQueries enrichment field.
    // Canonical decision must be made by Lane E and documented in a comment in the job file.
  );
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

  it.todo(
    'buildStrategyCardBlock includes competitorProof when provided — Lane E adds this field render',
    // After Lane E adds `if (ctx.competitorProof) lines.push(...)` to buildStrategyCardBlock:
    // const result = buildStrategyCardBlock({ rationale: 'x', competitorProof: 'competitor.com ranks #3' });
    // expect(result).toContain('Competitor proof: competitor.com ranks #3');
  );

  it.todo(
    'buildStrategyCardBlock includes volume when provided — Lane E adds this field render',
    // After Lane E:
    // const result = buildStrategyCardBlock({ rationale: 'x', volume: 5400 });
    // expect(result).toContain('5,400'); // or the locale-formatted number
  );

  it.todo(
    'buildStrategyCardBlock includes serpFeatures when provided — Lane E adds this field render',
    // After Lane E:
    // const result = buildStrategyCardBlock({ rationale: 'x', serpFeatures: ['featured_snippet', 'people_also_ask'] });
    // expect(result).toContain('featured_snippet');
  );
});
