/**
 * batch2-caller-contracts.test.ts
 *
 * Source-scan contracts for Phase 3B batch2 migrated callers.
 * These tests catch regressions when migrated files are modified:
 *   — correct slices requested for buildWorkspaceIntelligence
 *   — correct sections requested for formatForPrompt
 *   — learningsDomain threaded correctly
 *   — formatPageMapForPrompt called without pagePath filter where full cross-page map is needed
 *   — hasMeaningfulContext guard present and complete in keyword-recommendations
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

// ── buildVoiceContext (content-posts-ai.ts) ───────────────────────────────────

describe('buildVoiceContext migration contracts (content-posts-ai.ts)', () => {
  const src = read('content-posts-ai.ts');

  it('requests seoContext + learnings slices', () => {
    expect(src).toContain("slices: ['seoContext', 'learnings']");
  });

  it("uses learningsDomain:'content' for content-specific learnings", () => {
    expect(src).toContain("learningsDomain: 'content'");
  });

  it('formats with seoContext + learnings sections', () => {
    expect(src).toContain("sections: ['seoContext', 'learnings']");
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
    expect(src).toContain("sections: ['seoContext', 'learnings']");
  });
});

// ── content-decay.ts ─────────────────────────────────────────────────────────

describe('content-decay.ts migration contracts', () => {
  const src = read('content-decay.ts');

  it('requests learnings slice', () => {
    expect(src).toContain("'learnings'");
  });

  it('formats with seoContext + learnings sections', () => {
    expect(src).toContain("sections: ['seoContext', 'learnings']");
  });
});

// ── google.ts (search-chat) ───────────────────────────────────────────────────

describe('google.ts search-chat migration contracts', () => {
  const src = readRoute('google.ts');

  it('requests seoContext + learnings slices', () => {
    expect(src).toContain("slices: ['seoContext', 'learnings']");
  });

  it('formats with seoContext + learnings sections', () => {
    expect(src).toContain("sections: ['seoContext', 'learnings']");
  });
});

// ── public-analytics.ts (AI review) ──────────────────────────────────────────

describe('public-analytics.ts AI review migration contracts', () => {
  const src = readRoute('public-analytics.ts');

  it('requests seoContext + learnings slices', () => {
    expect(src).toContain("slices: ['seoContext', 'learnings']");
  });

  it('formats with seoContext + learnings sections', () => {
    expect(src).toContain("sections: ['seoContext', 'learnings']");
  });
});

// ── content-posts.ts (post AI review) ────────────────────────────────────────

describe('content-posts.ts AI review migration contracts', () => {
  const src = readRoute('content-posts.ts');

  it('requests seoContext + learnings slices for post brand-voice review', () => {
    expect(src).toContain("slices: ['seoContext', 'learnings']");
  });

  it('formats with seoContext + learnings sections', () => {
    expect(src).toContain("sections: ['seoContext', 'learnings']");
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
    expect(src).toContain("slices: ['seoContext', 'learnings']");
  });
});

// ── jobs.ts (page-analysis job) ───────────────────────────────────────────────

describe('jobs.ts page-analysis job migration contracts', () => {
  const src = readRoute('jobs.ts');

  it('requests seoContext + learnings slices for PA job AI context', () => {
    // fullContext fed to per-page AI analysis — previously used buildSeoContext().fullContext
    // which included learnings. Must include learnings slice.
    expect(src).toContain("slices: ['seoContext', 'learnings']");
  });

  it('formats with seoContext + learnings sections in PA job', () => {
    expect(src).toContain("sections: ['seoContext', 'learnings']");
  });
});

// ── webflow-keywords.ts — fullContext learnings ───────────────────────────────

describe('webflow-keywords.ts fullContext includes learnings', () => {
  const src = readRoute('webflow-keywords.ts');

  it('formats with seoContext + learnings sections for AI keyword analysis', () => {
    expect(src).toContain("sections: ['seoContext', 'learnings']");
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
