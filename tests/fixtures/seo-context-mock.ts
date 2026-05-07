// tests/fixtures/seo-context-mock.ts
import { vi } from 'vitest';

/**
 * Shared mock factory for the SEO context intelligence source.
 * Usage: vi.mock('../server/intelligence/seo-context-source.js', () => seoContextMock());
 * Override individual fns: vi.mocked(source.getRawBrandVoice).mockReturnValue('Custom');
 */
export function seoContextMock() {
  return {
    buildEffectiveBrandVoiceBlock: vi.fn(() => '\n\nBRAND VOICE & STYLE (you MUST match this voice — do not deviate):\nProfessional, data-driven, and authoritative. No fluff.'),
    getRawBrandVoice: vi.fn(() => 'Professional, data-driven, and authoritative. No fluff.'),
    getRawKnowledge: vi.fn(() => 'We specialize in enterprise SEO analytics with real-time rank tracking and AI-powered insights.'),
  };
}
