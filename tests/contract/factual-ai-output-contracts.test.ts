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
      expect(text, path).toContain('sanitizeForPromptInjection');
      expect(text, path).toContain("responseFormat: { type: 'json_object' }");
      expect(text, path).toContain('researchMode: true');
    }
  });

  it('keeps SEO audit grounded and routes page copy through its validated named operation', () => {
    const audit = source('server/seo-audit-ai-recs.ts');
    expect(audit).toContain('buildSystemPrompt');
    expect(audit).toContain('sanitizeForPromptInjection');
    expect(audit).toContain('seoAuditSuggestionSchema');
    expect(audit).toContain('parseJsonSafe');
    expect(audit).toContain("responseFormat: { type: 'json_object' }");
    expect(audit).toContain('researchMode: true');

    const pageTools = source('server/routes/webflow-seo-page-tools.ts');
    expect(pageTools).toContain('generateSeoPageCopySet');
    expect(pageTools).toContain('approvedEvidence');
    expect(pageTools).not.toContain('callAI');
    expect(pageTools).not.toContain('seoCopyResponseSchema');
  });

  it('routes bulk rewrite generation through the named validated metadata operation', () => {
    for (const path of [
      'server/routes/webflow-seo-bulk-rewrite.ts',
      'server/webflow-seo-bulk-rewrite-job.ts',
    ]) {
      const text = source(path);
      expect(text, path).toContain('generateSeoMetadataVariations');
      expect(text, path).toContain('approvedEvidence');
      expect(text, path).not.toContain('callCreativeAI');
      expect(text, path).not.toContain('parseJsonFallback');
      expect(text, path).not.toContain('normalizeSeoRewriteVariations');
      expect(text, path).not.toContain('normalizeSeoRewritePairs');
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

  it('keeps admin chat on research-mode grounding for factual analysis', () => {
    const text = source('server/routes/ai.ts');
    expect(text).toContain("feature: 'admin-chat'");
    expect(text).toContain('researchMode: true');
  });
});
