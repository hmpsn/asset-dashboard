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

  it('hasMeaningfulContext checks all four context fields', () => {
    // Strategy alone is not sufficient — business context, KB, brand voice, or personas required.
    const guardBlock = src.slice(
      src.indexOf('hasMeaningfulContext'),
      src.indexOf('hasMeaningfulContext') + 200,
    );
    expect(guardBlock).toContain('businessContext');
    expect(guardBlock).toContain('knowledgeBase');
    expect(guardBlock).toContain('brandVoice');
    expect(guardBlock).toContain('personas');
  });

  it('requests seoContext + learnings slices for AI ranking context', () => {
    expect(src).toContain("slices: ['seoContext', 'learnings']");
  });
});
