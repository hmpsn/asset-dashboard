// tests/fixtures/seo-context-mock.ts
import { vi } from 'vitest';

/**
 * Shared mock factory for seo-context.ts.
 * Usage: vi.mock('../server/seo-context.js', () => seoContextMock());
 * Override individual fns: vi.mocked(seoContext.getRawBrandVoice).mockReturnValue('Custom');
 */
export function seoContextMock() {
  return {
    buildSeoContext: vi.fn(() => ({
      strategy: {
        siteKeywords: ['enterprise seo', 'analytics platform', 'seo tools'],
        pageMap: [{ pagePath: '/features', primaryKeyword: 'enterprise seo', secondaryKeywords: ['seo analytics'] }],
        opportunities: [],
        businessContext: 'Enterprise SEO analytics platform serving Fortune 500 companies',
        generatedAt: new Date().toISOString(),
      },
      brandVoiceBlock: '\n\nBRAND VOICE & STYLE (you MUST match this voice — do not deviate):\nProfessional, data-driven, and authoritative. No fluff.',
      businessContext: 'Enterprise SEO analytics platform serving Fortune 500 companies',
      knowledgeBlock: '\n\nBUSINESS KNOWLEDGE BASE:\nWe specialize in enterprise SEO analytics with real-time rank tracking and AI-powered insights.',
      personasBlock: '',
      keywordBlock: '',
      fullContext: '',
    })),
    getRawBrandVoice: vi.fn(() => 'Professional, data-driven, and authoritative. No fluff.'),
    getRawKnowledge: vi.fn(() => 'We specialize in enterprise SEO analytics with real-time rank tracking and AI-powered insights.'),
    clearSeoContextCache: vi.fn(),
  };
}
