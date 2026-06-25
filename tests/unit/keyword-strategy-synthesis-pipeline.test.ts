import { describe, expect, it } from 'vitest';
import {
  buildCandidateIds,
  buildClosedSetBlock,
  buildClosedSetPageAssignmentPrompt,
  buildClosedSetSiteSynthesisPrompt,
  resolveClosedSetKeyword,
} from '../../server/keyword-strategy-synthesis/prompts.js';
import { siteSynthesisResponseSchema } from '../../server/schemas/keyword-strategy-schemas.js';
import type { KeywordCandidate } from '../../shared/types/keyword-universe.js';

const candidates: KeywordCandidate[] = [
  {
    keyword: 'platform analytics',
    volume: 1200,
    difficulty: 24,
    requested: true,
    voteWeight: 3,
    priority: 'high',
  },
  {
    keyword: 'declined analytics',
    volume: 900,
    difficulty: 20,
    declined: true,
  },
];

describe('keyword strategy synthesis prompt stages', () => {
  it('builds a closed candidate block that annotates requested candidates and hides declined candidates', () => {
    const block = buildClosedSetBlock(candidates);

    expect(block).toContain('CLOSED CANDIDATE SET');
    expect(block).toContain('id:"platform analytics"');
    expect(block).toContain('CLIENT-REQUESTED');
    expect(block).toContain('votes:3');
    expect(block).toContain('priority:high');
    expect(block).not.toContain('declined analytics');
  });

  it('resolves only in-set source IDs or keywords', () => {
    const ids = buildCandidateIds(candidates);

    expect(resolveClosedSetKeyword(ids, 'platform analytics', 'invented')).toBe('platform analytics');
    expect(resolveClosedSetKeyword(ids, 'invented', 'platform analytics')).toBe('platform analytics');
    expect(resolveClosedSetKeyword(ids, 'invented', 'also invented')).toBeNull();
  });

  it('keeps OP1 closed-set prompt clauses stable', () => {
    const prompt = buildClosedSetPageAssignmentPrompt({
      businessSection: 'BUSINESS',
      closedSetBlock: buildClosedSetBlock(candidates),
      batchPages: '- /services: "Services"',
      batchLength: 1,
    });

    expect(prompt).toContain('Return a JSON OBJECT');
    expect(prompt).toContain('primaryKeywordSourceId');
    expect(prompt).toContain('MUST come from the CLOSED CANDIDATE SET');
    expect(prompt).toContain('Cover ALL 1 pages');
  });

  it('keeps OP2 closed-set prompt clauses stable', () => {
    const prompt = buildClosedSetSiteSynthesisPrompt({
      businessSection: 'BUSINESS',
      pageMappingCount: 1,
      keywordSummary: '/services: "platform analytics"',
      conflictNote: '',
      gscSummary: '',
      ga4Context: '',
      auditContext: '',
      providerContext: '',
      intelligenceBlock: '',
      closedSetBlock: buildClosedSetBlock(candidates),
      effectiveBusinessPriorities: ['growth'],
      hasProviderContext: true,
      hasKeywordGaps: true,
      competitorDomains: ['competitor.example'],
      competitorBrandTokens: ['competitor'],
      conflictsCount: 0,
    });

    expect(prompt).toContain('targetKeywordSourceId');
    expect(prompt).toContain('CLIENT-REQUESTED candidates');
    expect(prompt).toContain('BUSINESS PRIORITIES');
    expect(prompt).toContain('NEVER suggest a keyword that contains a competitor');
  });

  it('normalizes partial or invalid OP2 content gaps to persistence-safe values', () => {
    const parsed = siteSynthesisResponseSchema.parse({
      contentGaps: [
        {
          topic: 'Analytics guide',
          targetKeyword: 'analytics guide',
          intent: 'not-real',
          priority: 'urgent',
          suggestedPageType: 'microsite',
        },
      ],
    });

    expect(parsed.contentGaps).toEqual([
      {
        topic: 'Analytics guide',
        targetKeyword: 'analytics guide',
        intent: 'informational',
        priority: 'medium',
        rationale: 'AI-identified keyword opportunity.',
        suggestedPageType: undefined,
      },
    ]);
  });
});
