import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(path, 'utf-8');
}

describe('factual AI output contracts', () => {
  it('keeps factual Page Intelligence analysis on research-mode structured JSON validation', () => {
    for (const path of [
      'server/routes/webflow-keywords.ts',
      'server/page-analysis-job.ts',
      'server/webflow-seo-bulk-analyze-job.ts',
    ]) {
      const text = source(path);
      expect(text, path).toContain('pageAnalysisAiResultSchema');
      expect(text, path).toContain("responseFormat: { type: 'json_object' }");
      expect(text, path).toContain('researchMode: true');
    }
  });

  it('keeps SEO audit and page copy generation grounded, sanitized, and JSON-validated', () => {
    const audit = source('server/seo-audit-ai-recs.ts');
    expect(audit).toContain('buildSystemPrompt');
    expect(audit).toContain('sanitizeForPromptInjection');
    expect(audit).toContain('seoAuditSuggestionSchema');
    expect(audit).toContain('parseJsonSafe');
    expect(audit).toContain("responseFormat: { type: 'json_object' }");
    expect(audit).toContain('researchMode: true');

    const pageTools = source('server/routes/webflow-seo-page-tools.ts');
    expect(pageTools).toContain('sanitizeForPromptInjection');
    expect(pageTools).toContain('seoCopyResponseSchema');
    expect(pageTools).toContain('filterSeoCopyInternalLinks');
    expect(pageTools).toContain("responseFormat: { type: 'json_object' }");
    expect(pageTools).toContain('researchMode: true');
  });

  it('keeps rewrite paths on JSON mode and validated normalization instead of prose fallback padding', () => {
    for (const path of [
      'server/routes/webflow-seo-rewrite.ts',
      'server/routes/webflow-seo-bulk-rewrite.ts',
      'server/webflow-seo-bulk-rewrite-job.ts',
    ]) {
      const text = source(path);
      expect(text, path).toContain('normalizeSeoRewriteVariations');
      expect(text, path).toContain('normalizeSeoRewritePairs');
      expect(text, path).toContain('sanitizeForPromptInjection');
      expect(text, path).toContain('sanitizeQueryForPrompt');
      expect(text, path).toContain('json: true');
      expect(text, path).toContain('researchMode: true');
      expect(text, path).not.toContain('json: false');
    }
  });

  it('keeps internal-link generation constrained to known page paths', () => {
    const text = source('server/internal-links.ts');
    expect(text).toContain('buildSystemPrompt');
    expect(text).toContain('sanitizeForPromptInjection');
    expect(text).toContain('researchMode: true');
    expect(text).toContain('allPaths.has');
    expect(text).toContain('existingEdges.has');
  });
});
