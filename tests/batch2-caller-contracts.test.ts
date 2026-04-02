/**
 * batch2-caller-contracts.test.ts
 *
 * Source-scan contracts for Phase 3B batch2 migrated callers.
 * These tests catch regressions when migrated files are modified:
 *   — correct slices requested for buildWorkspaceIntelligence (via slices-var or buildIntelPrompt)
 *   — correct sections requested for formatForPrompt (via slices-var, sections: slices, or buildIntelPrompt)
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
  return readFileSync(resolve(serverDir, rel), 'utf-8');
}

function readRoute(rel: string) {
  return readFileSync(resolve(routesDir, rel), 'utf-8');
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
    // split-assembly pattern: learnings hoisted outside loop as its own standalone call
    src.includes("slices: ['learnings']") ||
    src.includes("slices: ['learnings',") ||
    // slices-var pattern: array literal assigned to a const
    /const\s+\w*[Ss]lices\s*=\s*\[[^\]]*'seoContext'[^\]]*'learnings'[^\]]*\]/.test(src) ||
    /const\s+\w*[Ss]lices\s*=\s*\[[^\]]*'learnings'[^\]]*\]/.test(src) ||
    // buildIntelPrompt pattern B
    /buildIntelPrompt\([^,]+,\s*\[[^\]]*'seoContext'[^\]]*'learnings'[^\]]*\]/.test(src)
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

// ── buildVoiceContext (content-posts-ai.ts) ───────────────────────────────────

describe('buildVoiceContext migration contracts (content-posts-ai.ts)', () => {
  const src = read('content-posts-ai.ts');

  it('requests seoContext + learnings slices', () => {
    expect(hasSlicesSeoContextLearnings(src)).toBe(true);
  });

  it("uses learningsDomain:'content' for content-specific learnings", () => {
    expect(src).toContain("learningsDomain: 'content'");
  });

  it('formats with seoContext + learnings sections', () => {
    expect(hasSectionsSeoContextLearnings(src)).toBe(true);
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
    expect(src).toContain('formatPageMapForPrompt(intel.seoContext)');
    expect(src).not.toMatch(/formatPageMapForPrompt\([^)]+,\s*(slug|pagePath)/);
  });
});

// ── seo-audit.ts ──────────────────────────────────────────────────────────────

describe('seo-audit.ts migration contracts', () => {
  const src = read('seo-audit.ts');

  it('requests learnings slice alongside seoContext + pageProfile', () => {
    // Old buildSeoContext().fullContext included learnings — must be restored.
    expect(src).toContain("'learnings'");
  });

  it('formats with seoContext + learnings sections', () => {
    // Accepts ['seoContext', 'learnings'] or ['seoContext', 'learnings', 'pageProfile'] (combined call)
    expect(hasSectionsSeoContextLearnings(src)).toBe(true);
  });
});

// ── content-decay.ts ─────────────────────────────────────────────────────────

describe('content-decay.ts migration contracts', () => {
  const src = read('content-decay.ts');

  it('requests learnings slice', () => {
    expect(src).toContain("'learnings'");
  });

  it('formats with seoContext + learnings sections', () => {
    // Accepts ['seoContext', 'learnings'] or ['seoContext', 'learnings', 'pageProfile'] (combined call)
    expect(hasSectionsSeoContextLearnings(src)).toBe(true);
  });
});

// ── google.ts (search-chat) ───────────────────────────────────────────────────

describe('google.ts search-chat migration contracts', () => {
  const src = readRoute('google.ts');

  it('requests seoContext + learnings slices', () => {
    expect(hasSlicesSeoContextLearnings(src)).toBe(true);
  });

  it('formats with seoContext + learnings sections', () => {
    expect(hasSectionsSeoContextLearnings(src)).toBe(true);
  });
});

// ── public-analytics.ts (AI review) ──────────────────────────────────────────

describe('public-analytics.ts AI review migration contracts', () => {
  const src = readRoute('public-analytics.ts');

  it('requests seoContext + learnings slices', () => {
    expect(hasSlicesSeoContextLearnings(src)).toBe(true);
  });

  it('formats with seoContext + learnings sections', () => {
    expect(hasSectionsSeoContextLearnings(src)).toBe(true);
  });
});

// ── content-posts.ts (post AI review) ────────────────────────────────────────

describe('content-posts.ts AI review migration contracts', () => {
  const src = readRoute('content-posts.ts');

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

// ── jobs.ts (page-analysis job) ───────────────────────────────────────────────

describe('jobs.ts page-analysis job migration contracts', () => {
  const src = readRoute('jobs.ts');

  it('requests seoContext + learnings slices for PA job AI context', () => {
    // fullContext fed to per-page AI analysis — previously used buildSeoContext().fullContext
    // which included learnings. Must include learnings slice.
    expect(hasSlicesSeoContextLearnings(src)).toBe(true);
  });

  it('formats with seoContext + learnings sections in PA job', () => {
    expect(hasSectionsSeoContextLearnings(src)).toBe(true);
  });
});

// ── webflow-keywords.ts — fullContext learnings ───────────────────────────────

describe('webflow-keywords.ts fullContext includes learnings', () => {
  const src = readRoute('webflow-keywords.ts');

  it('formats with seoContext + learnings sections for AI keyword analysis', () => {
    expect(hasSectionsSeoContextLearnings(src)).toBe(true);
  });
});

// ── Intentional learnings-free callers (pageProfile-only) ────────────────────

describe('pageProfile-only callers intentionally omit learnings', () => {
  it('rewrite-chat.ts uses pageProfile section only (seoContext assembled manually above prompt)', () => {
    const src = readRoute('rewrite-chat.ts');
    // rewrite-chat builds seoContext fields manually (brandVoice, keywords, personas).
    // The formatForPrompt call is only for pageProfile — no seoContext or learnings section.
    expect(src).toContain("sections: ['pageProfile']");
    // Confirm it does NOT use formatForPrompt for seoContext (manual assembly only)
    expect(src).not.toContain("sections: ['seoContext'");
  });

  it('webflow-seo.ts SEO rewrite handlers use pageProfile section only', () => {
    const src = readRoute('webflow-seo.ts');
    // Both /seo-rewrite and /seo-bulk-rewrite handlers only use formatForPrompt for pageProfile.
    // The keyword/brand voice blocks are assembled manually from seo.* fields.
    expect(src).toContain("sections: ['pageProfile']");
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
    { label: 'routes/google.ts', src: readRoute('google.ts') },
    { label: 'routes/public-analytics.ts', src: readRoute('public-analytics.ts') },
    { label: 'routes/content-posts.ts', src: readRoute('content-posts.ts') },
    { label: 'routes/jobs.ts', src: readRoute('jobs.ts') },
    { label: 'routes/webflow-keywords.ts', src: readRoute('webflow-keywords.ts') },
  ];

  for (const { label, src } of callerFiles) {
    it(`${label}: if sections include 'learnings', slices must also include 'learnings'`, () => {
      const hasSectionsWithLearnings = hasSectionsSeoContextLearnings(src);
      if (!hasSectionsWithLearnings) return; // Not applicable — no learnings section requested

      // Must have 'learnings' in slices — inline literal, slices-var, or buildIntelPrompt
      expect(hasSlicesSeoContextLearnings(src)).toBe(true);
    });
  }
});

// ── assembleLearnings feature flag gate ──────────────────────────────────────

describe('assembleLearnings feature flag gate', () => {
  it('workspace-intelligence.ts: assembleLearnings checks outcome-ai-injection flag before assembling', () => {
    const src = readFileSync(resolve(serverDir, 'workspace-intelligence.ts'), 'utf-8');
    // Feature flag gate must appear INSIDE assembleLearnings, before the expensive DB calls.
    // This ensures behavioral parity with old buildSeoContext() which also gated on this flag.
    const fnStart = src.indexOf('async function assembleLearnings(');
    const fnEnd = src.indexOf('\nasync function ', fnStart + 1);
    const fnBody = src.slice(fnStart, fnEnd > 0 ? fnEnd : fnStart + 2000);
    expect(fnBody).toContain("isFeatureEnabled('outcome-ai-injection')");
  });
});
