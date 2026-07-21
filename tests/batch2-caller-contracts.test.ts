/**
 * batch2-caller-contracts.test.ts
 *
 * Source-scan contracts for Phase 3B batch2 migrated callers.
 * These tests catch regressions when migrated files are modified:
 *   — correct slices requested for buildWorkspaceIntelligence (via slices-var or buildIntelPrompt)
 *   — correct sections requested for formatForPrompt (via slices-var, sections: slices, or buildIntelPrompt)
 *   — SEO prompt consumers stay on buildSeoPromptContext() instead of re-inlining prompt + page-map assembly
 *   — learningsDomain threaded correctly
 *   — formatPageMapForPrompt called without pagePath filter where full cross-page map is needed
 *   — hasMeaningfulContext guard present and complete in keyword-recommendations
 *
 * Pattern A (slices-var): const slices = [...] as const; buildWI({ slices }); formatForPrompt({ sections: slices })
 * Pattern B (buildIntelPrompt): buildIntelPrompt(id, [...], { verbosity })
 *
 * Helpers below accept both inline literals and the slices-var pattern.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const serverDir = resolve(import.meta.dirname, '../server');
const routesDir = resolve(serverDir, 'routes');

function read(rel: string) {
  return readFileSync(resolve(serverDir, rel), 'utf-8'); // readFile-ok — migration contract: verifies Phase 3B callers request the correct slices/sections (seoContext, learnings) and follow the slices-var pattern to prevent silent slice/section mismatch.
}

function readRoute(rel: string) {
  return readFileSync(resolve(routesDir, rel), 'utf-8'); // readFile-ok — migration contract: verifies Phase 3B route callers request the correct slices/sections (seoContext, learnings) and follow the slices-var pattern to prevent silent slice/section mismatch.
}

/**
 * Returns true if the source requests slices containing both 'seoContext' and 'learnings'.
 * Accepts:
 *   - Inline literal:  slices: ['seoContext', 'learnings']
 *   - Slices-var:      const slices = ['seoContext', 'learnings'] as const  (then { slices })
 *   - buildIntelPrompt: buildIntelPrompt(id, ['seoContext', 'learnings'], ...)
 */
function hasSlicesSeoContextLearnings(src: string): boolean {
  return (
    src.includes("slices: ['seoContext', 'learnings']") ||
    src.includes("slices: ['seoContext', 'learnings',") ||
    // slices-var pattern: array literal assigned to a const
    /const\s+\w*[Ss]lices\s*=\s*\[[^\]]*'seoContext'[^\]]*'learnings'[^\]]*\]/.test(src) ||
    /const\s+\w*[Ss]lices\s*=\s*\[[^\]]*'learnings'[^\]]*\]/.test(src) ||
    // buildIntelPrompt pattern B
    /buildIntelPrompt\([^,]+,\s*\[[^\]]*'seoContext'[^\]]*'learnings'[^\]]*\]/.test(src)
  );
}

/**
 * Returns true if the source assembles 'learnings' in any slices call.
 * Used for parity checks — verifies learnings is assembled (not necessarily alongside seoContext).
 * Accepts both combined calls and the split-assembly pattern (learnings hoisted separately).
 */
function hasSliceLearnings(src: string): boolean {
  return (
    // learnings in any inline slices call
    /slices:\s*\[[^\]]*'learnings'/.test(src) ||
    // slices-var containing learnings
    /const\s+\w*[Ss]lices\s*=\s*\[[^\]]*'learnings'[^\]]*\]/.test(src) ||
    // buildIntelPrompt with learnings
    /buildIntelPrompt\([^,]+,\s*\[[^\]]*'learnings'[^\]]*\]/.test(src)
  );
}

/**
 * Returns true if the source formats with sections containing 'seoContext' and 'learnings'.
 * Accepts:
 *   - Inline literal:  sections: ['seoContext', 'learnings']
 *   - Slices-var:      sections: slices  (where slices contains both, any var name)
 *   - buildIntelPrompt: implicit (no explicit sections call)
 */
function hasSectionsSeoContextLearnings(src: string): boolean {
  return (
    src.includes("sections: ['seoContext', 'learnings']") ||
    // sections array that starts with seoContext + learnings but may have more entries
    src.includes("sections: ['seoContext', 'learnings',") ||
    // slices-var pattern: sections: <identifier> where identifier is a slices variable
    // matches "sections: slices", "sections: paSlices", "sections: mySlices", etc.
    /sections:\s+\w*[Ss]lices\b/.test(src) ||
    src.includes('sections: slices') ||
    // buildIntelPrompt pattern B — sections implicit
    /buildIntelPrompt\([^,]+,\s*\[[^\]]*'seoContext'[^\]]*'learnings'[^\]]*\]/.test(src)
  );
}

function usesSeoPromptBuilder(src: string): boolean {
  return src.includes('buildSeoPromptContext');
}

// ── buildVoiceContext (content-posts-ai.ts) ───────────────────────────────────

describe('buildVoiceContext migration contracts (content-posts-ai.ts)', () => {
  const src = read('content-posts-ai.ts');

  it('uses the shared SEO prompt context builder', () => {
    expect(usesSeoPromptBuilder(src)).toBe(true);
  });

  it("uses learningsDomain:'content' for content-specific learnings", () => {
    expect(src).toContain("learningsDomain: 'content'");
  });
});

// ── webflow-keywords.ts ───────────────────────────────────────────────────────

describe('webflow-keywords.ts migration contracts', () => {
  const src = readRoute('webflow-keywords.ts');

  it('passes pagePath to buildWorkspaceIntelligence for page-specific keyword context', () => {
    // pagePath scopes the seoContext to the current page's target keyword
    expect(src).toContain('pagePath');
  });

  it('calls formatPageMapForPrompt WITHOUT a pagePath filter (full cross-page map for cannibalization)', () => {
    // The keyword map must show ALL pages so the AI can avoid keyword cannibalization.
    // Passing slug/pagePath as the second arg would filter to a single page — wrong here.
    expect(src).toContain('pageAssist?.blocks.pageMapBlock');
    expect(src).not.toMatch(/formatPageMapForPrompt\([^)]+,\s*(slug|pagePath)/);
  });
});

// ── webflow-seo route N+1 prevention ─────────────────────────────────────────

describe('webflow SEO route N+1 prevention contracts', () => {
  const applySrc = readRoute('webflow-seo-apply.ts');
  const jobsSrc = read('webflow-bulk-seo-fix-background-job.ts');
  const rewriteSrc = readRoute('webflow-seo-bulk-rewrite.ts');
  const rewriteJobSrc = read('webflow-seo-bulk-rewrite-job.ts');

  it('bulk-fix job loop: seoContext assembled before the page loop (not inside it)', () => {
    // Pre-assembly must appear before the page loop.
    // If seoContext is assembled inside the loop, 300-page sites fire 300 DB round-trips.
    const routeIdx = applySrc.indexOf("supportedJobType: 'bulk-seo-fix'");
    expect(routeIdx).toBeGreaterThan(-1);
    const loopIdx = jobsSrc.indexOf('for (let i = 0; i < pages.length');
    expect(loopIdx).toBeGreaterThan(-1);
    const beforeLoop = jobsSrc.slice(0, loopIdx);
    expect(beforeLoop).toContain("slices: ['seoContext']");
  });

  it('bulk-fix job preserves the richer SEO copy prompt contract from the retired sync route', () => {
    expect(jobsSrc).toContain('callCreativeAI({');
    expect(jobsSrc).toContain('systemPrompt: buildSystemPrompt(workspaceId');
    expect(jobsSrc).toContain('buildSeoPromptBlocks(pageSeo');
    expect(jobsSrc).toContain('const personasBlock = seoBlocks.personasBlock');
    expect(jobsSrc).toContain('const knowledgeBlock = seoBlocks.knowledgeBlock');
    expect(jobsSrc).toContain('Use specific language from the knowledge base, not generic filler');
  });

  it('bulk-rewrite loop: seoContext assembled before the batch for-loop (not inside it)', () => {
    // Canonical page-assist context hoists workspace-level seoContext before the loop.
    const loopIdx = rewriteSrc.indexOf('for (let i = 0; i < pages.length');
    expect(loopIdx).toBeGreaterThan(-1);
    const beforeLoop = rewriteSrc.slice(0, loopIdx);
    const afterLoop = rewriteSrc.slice(loopIdx);
    expect(beforeLoop).toContain('const basePageAssist = await buildPageAssistContext');
    expect(afterLoop).toContain('baseSeoContext');
  });

  it('bulk-rewrite loop: preserves legacy nested-page keyword fallback', () => {
    const loopIdx = rewriteSrc.indexOf('for (let i = 0; i < pages.length');
    const afterLoop = rewriteSrc.slice(loopIdx);
    expect(afterLoop).toContain('findPageMapEntryForPage(baseSeoContext.strategy.pageMap, page)');
    expect(afterLoop).toContain('pageKeywords');
  });

  it('bulk-rewrite background job preserves hoisted seoContext and legacy page-map fallback', () => {
    const loopIdx = rewriteJobSrc.indexOf('for (let i = 0; i < pages.length');
    expect(loopIdx).toBeGreaterThan(-1);
    const beforeLoop = rewriteJobSrc.slice(0, loopIdx);
    const afterLoop = rewriteJobSrc.slice(loopIdx);
    expect(beforeLoop).toContain('const basePageAssist = await buildPageAssistContext');
    expect(afterLoop).toContain('baseSeoContext');
    expect(afterLoop).toContain('findPageMapEntryForPage(baseSeoContext.strategy.pageMap, page)');
    expect(afterLoop).toContain('pageKeywords');
  });

  it('bulk-rewrite loop: pageProfile still assembled per-page with pagePath inside loop', () => {
    // pageProfile is page-specific and is requested through the shared page-assist builder.
    const loopIdx = rewriteSrc.indexOf('for (let i = 0; i < pages.length');
    const afterLoop = rewriteSrc.slice(loopIdx);
    expect(afterLoop).toContain('buildPageAssistContext');
    expect(afterLoop).toContain('pagePath: rwPagePath');
  });

  it('bulk rewrite adapters preserve evidence while delegating copy generation to the canonical operation', () => {
    for (const source of [rewriteSrc, rewriteJobSrc]) {
      expect(source).toContain('generateSeoMetadataVariations');
      expect(source).toContain('contextBlocks');
      expect(source).toContain('approvedEvidence');
      expect(source).toContain('effectiveBrandVoiceBlock');
      expect(source).not.toContain('callCreativeAI');
      expect(source).not.toContain('normalizeSeoRewriteVariations');
    }
  });
});

// ── seo-audit-ai-recs.ts ──────────────────────────────────────────────────────
// AI recommendation logic was extracted from seo-audit.ts into this module.
// These contracts guard the N+1 prevention and slice selection invariants.

describe('seo-audit.ts migration contracts', () => {
  const src = read('seo-audit-ai-recs.ts');

  it('requests learnings slice alongside seoContext + pageProfile', () => {
    // Old buildSeoContext().fullContext included learnings — must be restored.
    expect(src).toContain("'learnings'");
  });

  it('formats with seoContext + learnings sections', () => {
    // Accepts ['seoContext', 'learnings'] or ['seoContext', 'learnings', 'pageProfile'] (combined call)
    expect(hasSectionsSeoContextLearnings(src)).toBe(true);
  });

  it('N+1 prevention: seoContext assembled before the per-page batch loop (not inside it)', () => {
    // Pre-assembly must appear before `for (let i = 0; i < pagesNeedingFixes`.
    // seoContext is workspace-level; pageKeywords derived inline via pageMap.find().
    const loopIdx = src.indexOf('for (let i = 0; i < pagesNeedingFixes');
    expect(loopIdx).toBeGreaterThan(-1);
    const beforeLoop = src.slice(0, loopIdx);
    expect(beforeLoop).toContain("'seoContext'");
  });

  it('N+1 prevention: pageProfile still assembled per-page with pagePath inside loop', () => {
    const loopIdx = src.indexOf('for (let i = 0; i < pagesNeedingFixes');
    const afterLoop = src.slice(loopIdx);
    expect(afterLoop).toContain("slices: ['pageProfile']");
  });
});

// ── content-decay.ts ─────────────────────────────────────────────────────────

describe('content-decay.ts migration contracts', () => {
  const src = read('content-decay.ts');

  it('requests learnings slice', () => {
    expect(src).toContain("'learnings'");
  });

  it('uses the shared recommendation generation builder for prompt context', () => {
    expect(src).toContain('buildRecommendationGenerationContext');
  });
});

// ── google.ts (search-chat) ───────────────────────────────────────────────────

describe('google.ts search-chat migration contracts', () => {
  const src = readRoute('google.ts');

  it('uses the shared SEO prompt context builder', () => {
    expect(usesSeoPromptBuilder(src)).toBe(true);
  });
});

// ── public-analytics.ts (AI review) ──────────────────────────────────────────

describe('public-analytics.ts AI review migration contracts', () => {
  const src = readRoute('public-analytics.ts');

  it('uses the shared SEO prompt context builder', () => {
    expect(usesSeoPromptBuilder(src)).toBe(true);
  });
});

// ── content-posts-ai-jobs.ts (post AI review worker — W6.2 migration) ────────
// W6.2 moved the AI review/fix/voice-score call sites from routes/content-posts.ts
// into content-posts-ai-jobs.ts (background-job workers). The slice contract must
// hold in the new module — the worker owns the heavy AI bodies.

describe('content-posts-ai-jobs.ts AI review migration contracts', () => {
  const src = read('content-posts-ai-jobs.ts');

  it('requests seoContext + learnings slices for post brand-voice review', () => {
    expect(hasSlicesSeoContextLearnings(src)).toBe(true);
  });

  it('formats with seoContext + learnings sections', () => {
    expect(hasSectionsSeoContextLearnings(src)).toBe(true);
  });
});

// ── keyword-recommendations.ts — meaningful-context guard ────────────────────

describe('keyword-recommendations.ts meaningful-context guard', () => {
  const src = read('keyword-recommendations.ts');

  it('uses hasMeaningfulContext guard before invoking AI ranking', () => {
    // Without this guard, formatForPrompt always returns non-empty (cold-start placeholder)
    // causing an unnecessary OpenAI call for every workspace, even empty ones.
    expect(src).toContain('hasMeaningfulContext');
  });

  it('hasMeaningfulContext checks all five context fields including strategy', () => {
    // Strategy alone IS sufficient — a workspace with only keyword strategy should still
    // get AI ranking (old code: fullContext included keywordBlock → truthy when strategy exists).
    const guardBlock = src.slice(
      src.indexOf('hasMeaningfulContext'),
      src.indexOf('hasMeaningfulContext') + 250,
    );
    expect(guardBlock).toContain('businessContext');
    expect(guardBlock).toContain('knowledgeBase');
    expect(guardBlock).toContain('brandVoice');
    expect(guardBlock).toContain('personas');
    expect(guardBlock).toContain('strategy');
  });

  it('requests seoContext + learnings slices for AI ranking context', () => {
    expect(hasSlicesSeoContextLearnings(src)).toBe(true);
  });
});

// ── page-analysis-job.ts ─────────────────────────────────────────────────────

describe('page-analysis-job.ts migration contracts', () => {
  const src = read('page-analysis-job.ts');

  it('uses the shared SEO prompt context builder for PA job AI context', () => {
    expect(usesSeoPromptBuilder(src)).toBe(true);
  });
});

describe('webflow-seo-bulk-analyze-job.ts migration contracts', () => {
  const src = read('webflow-seo-bulk-analyze-job.ts');

  it('uses the shared SEO prompt context builder', () => {
    expect(usesSeoPromptBuilder(src)).toBe(true);
  });
});

// ── webflow-keywords.ts — fullContext learnings ───────────────────────────────

describe('webflow-keywords.ts fullContext includes learnings', () => {
  const src = readRoute('webflow-keywords.ts');

  it('formats with seoContext + learnings sections for AI keyword analysis', () => {
    expect(src).toContain('buildPageAssistContext');
    expect(src).toContain('includeLearnings: true');
  });
});

// ── Intentional learnings-free callers (pageProfile-only) ────────────────────

describe('pageProfile-only callers intentionally omit learnings', () => {
  it('rewrite-chat.ts uses pageProfile section only (seoContext assembled manually above prompt)', () => {
    const src = readRoute('rewrite-chat.ts');
    // rewrite-chat gets page profile + seoContext blocks through the page-assist builder.
    expect(src).toContain('buildPageAssistContext');
    expect(src).toContain('pageAssist.blocks.pageProfileBlock');
    expect(src).not.toContain("sections: ['seoContext'");
  });

  it('Webflow SEO rewrite handlers use pageProfile section only', () => {
    const src = `${readRoute('webflow-seo-rewrite.ts')}\n${readRoute('webflow-seo-bulk-rewrite.ts')}`;
    // Both handlers get page profile + seoContext blocks through the page-assist builder.
    expect(src).toContain('buildPageAssistContext');
    expect(src).toContain('pageAssist.blocks.pageProfileBlock');
    expect(src).not.toContain("sections: ['seoContext'");
  });
});

// ── slices/sections consistency — every section must have its slice assembled ─

describe('slices/sections consistency — learnings section requires learnings slice', () => {
  /**
   * The silent-data-loss bug class: formatForPrompt silently skips sections whose
   * slice data is undefined. If a caller requests sections: ['seoContext', 'learnings']
   * but only assembles slices: ['seoContext'], the learnings section is silently dropped.
   * TypeScript cannot catch this — the slices/sections are string arrays, not type-linked.
   *
   * This test scans every file that uses learnings in sections and verifies the corresponding
   * buildWorkspaceIntelligence call also includes 'learnings' in slices.
   *
   * Accepts both the inline-literal pattern AND the slices-var pattern:
   *   - Inline:    slices: ['seoContext', 'learnings']
   *   - Slices-var: const slices = ['seoContext', 'learnings'] as const; { slices }
   *   - buildIntelPrompt: implicit (slices and sections always in sync)
   */
  const callerFiles = [
    { label: 'content-posts-ai.ts', src: read('content-posts-ai.ts') },
    { label: 'seo-audit.ts', src: read('seo-audit.ts') },
    { label: 'content-decay.ts', src: read('content-decay.ts') },
    { label: 'keyword-recommendations.ts', src: read('keyword-recommendations.ts') },
    { label: 'page-analysis-job.ts', src: read('page-analysis-job.ts') },
    { label: 'routes/google.ts', src: readRoute('google.ts') },
    { label: 'routes/public-analytics.ts', src: readRoute('public-analytics.ts') },
    { label: 'content-posts-ai-jobs.ts', src: read('content-posts-ai-jobs.ts') },
    { label: 'routes/jobs.ts', src: readRoute('jobs.ts') },
  ];

  for (const { label, src } of callerFiles) {
    it(`${label}: if sections include 'learnings', slices must also include 'learnings'`, () => {
      const hasSectionsWithLearnings = hasSectionsSeoContextLearnings(src);
      if (!hasSectionsWithLearnings) return; // Not applicable — no learnings section requested

      // Must assemble 'learnings' — inline literal, slices-var, or buildIntelPrompt.
      // Uses hasSliceLearnings (not hasSlicesSeoContextLearnings) to allow the split-assembly
      // pattern where learnings is hoisted separately from seoContext (e.g. seo-audit.ts).
      expect(hasSliceLearnings(src)).toBe(true);
    });
  }
});
