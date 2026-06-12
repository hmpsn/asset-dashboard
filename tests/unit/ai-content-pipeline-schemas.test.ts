import { describe, expect, it } from 'vitest';
import { parseGeneratedPageCopy, parseRegeneratedSectionCopy } from '../../server/schemas/ai-copy-generation.js';
import { parseWebflowFieldMapping } from '../../server/schemas/ai-content-publish.js';

describe('content pipeline AI output schemas', () => {
  it('validates full-page copy generation output', () => {
    const parsed = parseGeneratedPageCopy(JSON.stringify({
      sections: [
        {
          sectionPlanItemId: 'sec-hero',
          copy: 'Generated copy',
          annotation: 'Direct response',
          reasoning: 'Matches the brief',
        },
      ],
      seoTitle: 'SEO title',
      metaDescription: 'Meta description',
      ogTitle: 'OG title',
      ogDescription: 'OG description',
    }));

    expect(parsed.sections[0].sectionPlanItemId).toBe('sec-hero');
  });

  it('rejects malformed copy generation JSON', () => {
    expect(() => parseGeneratedPageCopy(JSON.stringify({
      sections: [{ sectionPlanItemId: 'sec-hero', copy: 'Missing metadata' }],
      seoTitle: 'SEO title',
      metaDescription: 'Meta description',
    }))).toThrow();
  });

  it('validates section regeneration output', () => {
    const parsed = parseRegeneratedSectionCopy('```json\n{"copy":"Fresh copy","annotation":"Why","reasoning":"Because"}\n```');
    expect(parsed.copy).toBe('Fresh copy');
  });

  it('rejects malformed Webflow field mapping output', () => {
    expect(() => parseWebflowFieldMapping(JSON.stringify({
      title: 'name',
      unknownField: 'surprise',
    }))).toThrow();
  });
});
