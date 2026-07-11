/**
 * Task 4.3 — Admin-chat context builder routes all assembled slices to the model prompt.
 *
 * B-10 finding: admin-chat-context-builder assembles operational/siteHealth/clientSignals/
 * insights/contentPipeline/localSeo but only formatForPrompt's seoContext + learnings —
 * the other slices never reach the model prompt.
 *
 * This test suite verifies the fix: the context block for category-gated questions
 * includes formatting output from the additionally assembled slices.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceIntelligence, OperationalSlice, SiteHealthSlice, ClientSignalsSlice } from '../shared/types/intelligence.js';
import {
  buildAdminChatIntelligenceContext,
  hasBacklinkIntent,
  selectAdminChatSlices,
} from '../server/intelligence/admin-chat-context-builder.js';
import {
  buildWorkspaceIntelligence,
  formatForPrompt,
  formatPageMapForPrompt,
} from '../server/workspace-intelligence.js';

vi.mock('../server/workspace-intelligence.js', () => ({
  buildWorkspaceIntelligence: vi.fn(),
  formatForPrompt: vi.fn(),
  formatPageMapForPrompt: vi.fn(),
  formatKeywordsForPrompt: vi.fn(),
  formatKnowledgeBaseForPrompt: vi.fn(),
  formatPersonasForPrompt: vi.fn(),
}));

const mockOperational: OperationalSlice = {
  recentActivity: [{ type: 'approval', description: 'Batch applied', timestamp: '2026-05-31T10:00:00Z' }],
  annotations: [],
  pendingJobs: 0,
  approvalQueue: { pending: 3, oldestAge: 48 },
  recommendationQueue: { fixNow: 2, fixSoon: 5, fixLater: 8 },
  actionBacklog: { pendingMeasurement: 4, oldestAge: null },
  clientActionQueue: { pending: 1, oldestAge: null },
};

const mockSiteHealth: SiteHealthSlice = {
  auditScore: 78,
  auditScoreDelta: 3,
  deadLinks: 2,
  redirectChains: 1,
  schemaErrors: 0,
  orphanPages: 4,
  cwvPassRate: { mobile: 0.6, desktop: 0.8 },
  anomalyCount: 1,
  anomalyTypes: ['traffic_drop'],
};

const mockClientSignals: ClientSignalsSlice = {
  keywordFeedback: { approved: ['seo agency'], rejected: [], patterns: { approveRate: 0.9, topRejectionReasons: [] } },
  contentGapVotes: [],
  businessPriorities: ['Increase organic traffic'],
  effectiveBusinessPriorities: ['Increase organic traffic', 'Grow local presence'],
  approvalPatterns: { approvalRate: 0.75, avgResponseTime: null },
  recentChatTopics: ['content performance', 'local SEO'],
  churnRisk: 'low',
};

const mockIntelligence: WorkspaceIntelligence = {
  version: 1,
  workspaceId: 'ws-4-3',
  assembledAt: '2026-05-31T00:00:00.000Z',
  seoContext: {
    strategy: undefined,
    brandVoice: '',
    effectiveBrandVoiceBlock: '[Voice]',
    businessContext: 'SEO agency',
    personas: [],
    knowledgeBase: null,
  },
  learnings: {
    availability: 'ready',
    summary: null,
    confidence: null,
    topActionTypes: [],
    overallWinRate: 0,
    recentTrend: null,
    playbooks: [],
  },
  operational: mockOperational,
  siteHealth: mockSiteHealth,
  clientSignals: mockClientSignals,
  insights: {
    all: [],
    byType: {},
    bySeverity: { critical: 0, warning: 0, opportunity: 0, positive: 0 },
    topByImpact: [],
  },
};

describe('admin-chat context builder — B-10 slice formatter routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(buildWorkspaceIntelligence).mockResolvedValue(mockIntelligence);
    vi.mocked(formatPageMapForPrompt).mockReturnValue('');
    // formatForPrompt returns different content based on sections requested
    vi.mocked(formatForPrompt).mockImplementation((_intel, opts) => {
      const sections = opts?.sections ?? [];
      if (sections.includes('seoContext')) return '## SEO Context\nBusiness: SEO agency';
      if (sections.includes('learnings')) return '## Outcome Learnings\nWin rate: n/a';
      // For the other slices block, return a block with ## headers
      const nonSeoSections = sections.filter(s => s !== 'seoContext' && s !== 'learnings');
      if (nonSeoSections.length > 0) {
        return `## Operational\nPending: 3 approvals\n## Site Health\nAudit score: 78`;
      }
      return '';
    });
  });

  it('selects operational and siteHealth slices for approvals category', () => {
    const slices = selectAdminChatSlices('What approvals are pending?', new Set(['approvals']));
    expect(slices).toContain('operational');
  });

  it('selects siteHealth slice for performance category', () => {
    const slices = selectAdminChatSlices('How is performance?', new Set(['performance']));
    expect(slices).toContain('siteHealth');
  });

  it('formatForPrompt is called with non-seoContext, non-learnings slices for approvals question', async () => {
    await buildAdminChatIntelligenceContext('ws-4-3', 'What approvals are pending?', new Set(['approvals']));

    // The builder should call formatForPrompt at least once with operational in sections
    const allCalls = vi.mocked(formatForPrompt).mock.calls;
    const hasOperationalFormatCall = allCalls.some(
      ([, opts]) => Array.isArray(opts?.sections) && opts.sections.includes('operational'),
    );
    expect(hasOperationalFormatCall).toBe(true);
  });

  it('formatForPrompt is called with siteHealth in sections for performance question', async () => {
    await buildAdminChatIntelligenceContext('ws-4-3', 'How is site performance?', new Set(['performance']));

    const allCalls = vi.mocked(formatForPrompt).mock.calls;
    const hasSiteHealthFormatCall = allCalls.some(
      ([, opts]) => Array.isArray(opts?.sections) && opts.sections.includes('siteHealth'),
    );
    expect(hasSiteHealthFormatCall).toBe(true);
  });

  it('workspaceContextBlock includes operational/siteHealth content for approvals/performance question', async () => {
    const result = await buildAdminChatIntelligenceContext(
      'ws-4-3',
      'What approvals are pending and how is performance?',
      new Set(['approvals', 'performance']),
    );

    // The assembled operational/siteHealth data must reach the context block
    expect(result.workspaceContextBlock).toContain('## Operational');
    expect(result.workspaceContextBlock).toContain('## Site Health');
  });

  it('dataSources reflects assembled slices beyond just seoContext', async () => {
    const result = await buildAdminChatIntelligenceContext(
      'ws-4-3',
      'What approvals are pending?',
      new Set(['approvals']),
    );

    // Should list more data sources than just SEO Context
    expect(result.dataSources.length).toBeGreaterThan(0);
    // At minimum the operational slice should be acknowledged
    const hasOperationalSource = result.dataSources.some(s => /operational/i.test(s));
    expect(hasOperationalSource).toBe(true);
  });

  it('does not duplicate seoContext and learnings in the other-slices call', async () => {
    await buildAdminChatIntelligenceContext('ws-4-3', 'general status', new Set(['general']));

    const allCalls = vi.mocked(formatForPrompt).mock.calls;
    // Find the "other slices" call — it should not include seoContext or learnings
    const otherSlicesCall = allCalls.find(
      ([, opts]) =>
        Array.isArray(opts?.sections) &&
        !opts.sections.includes('seoContext') &&
        !opts.sections.includes('learnings') &&
        !opts.sections.includes('insights') &&
        opts.sections.length > 0,
    );
    expect(otherSlicesCall).toBeDefined();
  });

  it('does not format insights twice when the caller owns the richer analytics-intelligence renderer', async () => {
    await buildAdminChatIntelligenceContext(
      'ws-4-3',
      'What are the highest-impact insights?',
      new Set(['insights']),
    );

    const formattedSections = vi.mocked(formatForPrompt).mock.calls.flatMap(([, opts]) => opts?.sections ?? []);
    expect(formattedSections.filter(section => section === 'insights')).toHaveLength(0);
  });

  it('does not request paid backlink enrichment for ordinary or internal-link questions', async () => {
    await buildAdminChatIntelligenceContext(
      'ws-4-3',
      'Which broken internal links should we fix?',
      new Set(['audit']),
    );

    expect(buildWorkspaceIntelligence).toHaveBeenCalledWith(
      'ws-4-3',
      expect.objectContaining({ enrichWithBacklinks: false }),
    );
  });

  it('retains backlink data for explicit backlink and link-authority questions', async () => {
    const intelligenceWithBacklinks: WorkspaceIntelligence = {
      ...mockIntelligence,
      seoContext: {
        ...mockIntelligence.seoContext!,
        backlinkProfile: { totalBacklinks: 1500, referringDomains: 230 },
      },
    };
    vi.mocked(buildWorkspaceIntelligence).mockResolvedValue(intelligenceWithBacklinks);
    vi.mocked(formatForPrompt).mockImplementation((intel, opts) => {
      const sections = opts?.sections ?? [];
      if (sections.includes('seoContext')) {
        const backlinks = intel.seoContext?.backlinkProfile;
        return `[Workspace Intelligence]\n\n## SEO Context\nBacklinks: ${backlinks?.totalBacklinks} total, ${backlinks?.referringDomains} referring domains`;
      }
      if (sections.includes('learnings')) return '[Workspace Intelligence]\n\n## Outcome Learnings\nWin rate: n/a';
      return '';
    });

    const result = await buildAdminChatIntelligenceContext(
      'ws-4-3',
      'How strong is our backlink profile and domain authority?',
      new Set(['strategy']),
    );

    expect(buildWorkspaceIntelligence).toHaveBeenCalledWith(
      'ws-4-3',
      expect.objectContaining({ enrichWithBacklinks: true }),
    );
    expect(result.workspaceContextBlock).toContain('Backlinks: 1500 total, 230 referring domains');
  });

  it('keeps one Workspace Intelligence wrapper across separately formatted prompt fragments', async () => {
    vi.mocked(formatForPrompt).mockImplementation((_intel, opts) => {
      const sections = opts?.sections ?? [];
      if (sections.includes('seoContext')) return '[Workspace Intelligence]\n\n## SEO Context\nBusiness: SEO agency';
      if (sections.includes('learnings')) return '[Workspace Intelligence]\n\n## Outcome Learnings\nWin rate: 75%';
      if (sections.length > 0) return '[Workspace Intelligence]\n\n## Operational\nPending: 3 approvals';
      return '';
    });

    const result = await buildAdminChatIntelligenceContext(
      'ws-4-3',
      'Give me a general status overview',
      new Set(['general']),
    );
    const finalFragments = `${result.workspaceContextBlock}\n${result.learningsBlock}`;

    expect(finalFragments.match(/\[Workspace Intelligence\]/g)).toHaveLength(1);
    expect(finalFragments).toContain('## SEO Context');
    expect(finalFragments).toContain('## Operational');
    expect(finalFragments).toContain('## Outcome Learnings');
  });

  // ── FIX E: dataSources must not falsely list 'SEO Context' when seoContext
  //          produced no formatted content (regression guard). ─────────────────
  it('does NOT list SEO Context in dataSources when seoContext is empty but operational is populated', async () => {
    // Override the formatter so the seoContext block formats to NOTHING (no `## `
    // header) while the additional-slices block still produces real content.
    vi.mocked(formatForPrompt).mockImplementation((_intel, opts) => {
      const sections = opts?.sections ?? [];
      if (sections.includes('seoContext')) return ''; // empty SEO context
      if (sections.includes('learnings')) return '## Outcome Learnings\nWin rate: n/a';
      const nonSeoSections = sections.filter(s => s !== 'seoContext' && s !== 'learnings');
      if (nonSeoSections.length > 0) {
        return `## Operational\nPending: 3 approvals`;
      }
      return '';
    });

    const result = await buildAdminChatIntelligenceContext(
      'ws-4-3',
      'What approvals are pending?',
      new Set(['approvals']),
    );

    // SEO Context must NOT appear — it formatted to nothing, so claiming it as a
    // data source would be a false attribution.
    const hasSeoContextSource = result.dataSources.some(s => s === 'Workspace Intelligence: SEO Context');
    expect(hasSeoContextSource).toBe(false);

    // …but the additional slices that DID produce content MUST still be listed.
    const hasOperationalSource = result.dataSources.some(s => /operational/i.test(s));
    expect(hasOperationalSource).toBe(true);

    // And the operational content must still reach the context block.
    expect(result.workspaceContextBlock).toContain('## Operational');
  });

  it('DOES list SEO Context in dataSources when seoContext produced content', async () => {
    // Sanity counterpart: with the default formatter (seoContext non-empty), the
    // label must be present — guards against the gate being overzealous.
    const result = await buildAdminChatIntelligenceContext(
      'ws-4-3',
      'What approvals are pending?',
      new Set(['approvals']),
    );
    expect(result.dataSources).toContain('Workspace Intelligence: SEO Context');
  });
});

describe('admin-chat backlink intent routing', () => {
  it.each([
    'Show our backlinks',
    'How many referring domains do we have?',
    'Evaluate our domain rating and link authority',
    'Do we need an off-page SEO campaign?',
  ])('recognizes explicit off-site authority intent: %s', (question) => {
    expect(hasBacklinkIntent(question)).toBe(true);
  });

  it.each([
    'Which internal links should we add?',
    'Find broken links on the homepage',
    'Show navigation links',
    'Give me a general status overview',
  ])('does not charge for generic link or unrelated intent: %s', (question) => {
    expect(hasBacklinkIntent(question)).toBe(false);
  });
});
