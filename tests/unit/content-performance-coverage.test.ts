import { describe, expect, it } from 'vitest';

import { gradeContentTermCoverage } from '../../server/domains/content/content-performance.js';
import type { ContentBrief, GeneratedPost } from '../../shared/types/content.js';

function makeBrief(overrides: Partial<ContentBrief> = {}): ContentBrief {
  return {
    id: 'brief-coverage',
    workspaceId: 'ws-coverage',
    targetKeyword: 'emergency dentist cost',
    secondaryKeywords: ['same-day extraction', 'after-hours dental care'],
    suggestedTitle: 'Emergency Dentist Cost Guide',
    suggestedMetaDesc: 'Costs and next steps for emergency dental care.',
    outline: [
      {
        heading: 'Emergency care costs',
        notes: 'Explain urgent dental pricing.',
        keywords: ['dental abscess'],
      },
    ],
    wordCountTarget: 1400,
    intent: 'informational',
    audience: 'patients',
    competitorInsights: 'Competitors answer urgent care cost questions.',
    internalLinkSuggestions: [],
    createdAt: '2026-06-14T00:00:00.000Z',
    realPeopleAlsoAsk: ['How much does emergency dental care cost?'],
    topicalEntities: [],
    serpAnalysis: {
      contentType: 'guide',
      avgWordCount: 1300,
      commonElements: ['insurance coverage'],
      gaps: [],
    },
    sourceEvidence: {
      capturedAt: '2026-06-14T00:00:00.000Z',
      serpResults: [
        {
          position: 1,
          title: 'Emergency dentist cost',
          url: 'https://example.com/emergency-dentist',
          snippet: 'Walk-in dentist',
        },
      ],
    },
    ...overrides,
  };
}

function makePost(overrides: Partial<GeneratedPost> = {}): GeneratedPost {
  return {
    id: 'post-coverage',
    workspaceId: 'ws-coverage',
    briefId: 'brief-coverage',
    targetKeyword: 'emergency dentist cost',
    title: 'Emergency Dentist Cost and Same-Day Extraction',
    metaDescription: 'How much emergency dental care costs, including insurance coverage.',
    introduction: '<p>Emergency dentist cost depends on the treatment and insurance coverage.</p>',
    sections: [
      {
        index: 0,
        heading: 'Same-day extraction for a dental abscess',
        content: '<p>Same-day extraction may be needed when a dental abscess is severe.</p>',
        wordCount: 120,
        targetWordCount: 200,
        keywords: ['same-day extraction', 'dental abscess'],
        status: 'done',
      },
    ],
    conclusion: '<p>How much does emergency dental care cost? Ask for pricing before treatment starts.</p>',
    totalWordCount: 500,
    targetWordCount: 1400,
    status: 'approved',
    createdAt: '2026-06-14T00:00:00.000Z',
    updatedAt: '2026-06-14T00:00:00.000Z',
    ...overrides,
  };
}

describe('gradeContentTermCoverage', () => {
  it('grades deterministic brief-prescribed term coverage against generated post text', () => {
    const grade = gradeContentTermCoverage(makeBrief(), makePost());

    expect(grade.status).toBe('partial');
    expect(grade.requiredCount).toBe(7);
    expect(grade.matchedCount).toBe(5);
    expect(grade.missingCount).toBe(2);
    expect(grade.coveragePct).toBe(71);
    expect(grade.missingTerms).toEqual(['after-hours dental care', 'walk-in dentist']);
  });

  it('degrades to unavailable when there is no linked post text to inspect', () => {
    const grade = gradeContentTermCoverage(makeBrief(), undefined);

    expect(grade.status).toBe('unavailable');
    expect(grade.coveragePct).toBeNull();
    expect(grade.requiredCount).toBe(0);
    expect(grade.missingTerms).toEqual([]);
  });
});
