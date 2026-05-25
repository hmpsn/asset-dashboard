import { describe, expect, it } from 'vitest';

import { buildClaimEvidenceLedger } from '../../server/content-review-evidence-ledger.js';
import type { ContentReviewEvidence } from '../../shared/types/content.js';

const SAMPLE_EVIDENCE: ContentReviewEvidence = {
  referenceUrls: [
    'https://www.example.com/reports/revenue-benchmarks',
  ],
  peopleAlsoAsk: [
    'How fast can SaaS revenue grow year over year?',
    'What does healthy subscription retention look like?',
  ],
  topResults: [
    {
      position: 1,
      title: 'SaaS Revenue Benchmarks for 2026',
      url: 'https://www.example.com/reports/saas-revenue-benchmarks-2026',
    },
    {
      position: 2,
      title: 'Retention Metrics Guide',
      url: 'https://www.example.com/guides/retention-metrics',
    },
  ],
  note: 'Reviewer support only.',
};

describe('buildClaimEvidenceLedger', () => {
  it('returns an empty ledger when there are no claims to verify', () => {
    expect(buildClaimEvidenceLedger([], SAMPLE_EVIDENCE)).toEqual([]);
  });

  it('matches claims to saved top results when topic overlap is strong', () => {
    const ledger = buildClaimEvidenceLedger(
      ['Revenue grew 42% in 2026 for top-performing SaaS companies.'],
      SAMPLE_EVIDENCE,
    );

    expect(ledger).toHaveLength(1);
    expect(ledger[0].sourceCandidates.some(candidate => candidate.kind === 'serp_top_result')).toBe(true);
  });

  it('can surface a saved reference URL as a possible source candidate', () => {
    const ledger = buildClaimEvidenceLedger(
      ['Example revenue benchmarks show strong growth for SaaS companies.'],
      SAMPLE_EVIDENCE,
    );

    expect(ledger[0].sourceCandidates.some(candidate => candidate.kind === 'reference_url')).toBe(true);
  });

  it('returns an explicit manual review posture when no likely source is found', () => {
    const ledger = buildClaimEvidenceLedger(
      ['A regional dental office doubled call volume with a direct mail campaign.'],
      SAMPLE_EVIDENCE,
    );

    expect(ledger[0].sourceCandidates).toEqual([
      expect.objectContaining({
        kind: 'manual_unknown',
        label: 'No likely source found in saved evidence',
      }),
    ]);
  });

  it('degrades safely when no source pack exists', () => {
    const ledger = buildClaimEvidenceLedger(
      ['Revenue grew 42% in 2026 for top-performing SaaS companies.'],
      undefined,
    );

    expect(ledger[0].sourceCandidates[0]).toEqual(expect.objectContaining({
      kind: 'manual_unknown',
    }));
  });

  it('degrades safely when reference URLs are malformed', () => {
    const ledger = buildClaimEvidenceLedger(
      ['The not a valid url source mentioned a benchmark footnote.'],
      {
        ...SAMPLE_EVIDENCE,
        referenceUrls: ['not-a-valid-url'],
        topResults: [],
        peopleAlsoAsk: [],
      },
    );

    expect(ledger[0].sourceCandidates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'reference_url',
        label: 'not-a-valid-url',
      }),
    ]));
  });

  it('extracts thousands-separated numeric tokens for candidate matching', () => {
    const ledger = buildClaimEvidenceLedger(
      ['Revenue reached 1,200 qualified leads in 2026.'],
      {
        referenceUrls: [],
        peopleAlsoAsk: [],
        topResults: [
          {
            position: 1,
            title: 'Qualified leads reached 1,200 in 2026 benchmark report',
            url: 'https://www.example.com/reports/qualified-leads-1200',
          },
        ],
        note: 'Reviewer support only.',
      },
    );

    expect(ledger[0].sourceCandidates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'serp_top_result',
        confidence: 'strong',
      }),
    ]));
  });

  it('caps candidate lists at four entries', () => {
    const crowdedEvidence: ContentReviewEvidence = {
      referenceUrls: Array.from({ length: 6 }, (_, index) => `https://www.example.com/reports/revenue-benchmarks-${index}`),
      peopleAlsoAsk: [],
      topResults: [],
      note: 'Reviewer support only.',
    };

    const ledger = buildClaimEvidenceLedger(
      ['Example revenue benchmarks show growth for SaaS companies.'],
      crowdedEvidence,
    );

    expect(ledger[0].sourceCandidates).toHaveLength(4);
  });
});
