import { describe, expect, it } from 'vitest';
import {
  buildBriefExperimentPrompt,
  buildExperimentLayout,
  formatBatchReport,
  formatExperimentReport,
  parseBatchExperimentArgs,
  parseExperimentArgs,
  scoreBrief,
  scoreDraft,
  summarizeBatchWinners,
} from '../../scripts/experiment-content-generation.js';
import type { SaveBriefInput } from '../../shared/types/mcp-action-schemas.js';

type BriefContent = SaveBriefInput['content'];

const baseBrief: BriefContent = {
  targetKeyword: 'dental financing sarasota',
  secondaryKeywords: ['payment plans'],
  suggestedTitle: 'Dental Financing in Sarasota',
  suggestedMetaDesc: 'Clear payment options for dental care in Sarasota.',
  outline: [
    { heading: 'Dental Financing in Sarasota', notes: 'Quick answer and fit.', wordCount: 180, keywords: ['dental financing'] },
    { heading: 'Insurance and Membership Options', subheadings: ['Insurance', 'Membership'], notes: 'Explain options clearly.', wordCount: 240, keywords: [] },
    { heading: 'Payment Plans for Treatment', notes: 'Show practical paths.', wordCount: 220, keywords: [] },
    { heading: 'How to Check Your Options', notes: 'Explain how benefits review works.', wordCount: 180, keywords: [] },
    { heading: 'Schedule a Visit', notes: 'Single CTA close.', wordCount: 120, keywords: [] },
  ],
  wordCountTarget: 950,
  intent: 'commercial',
  audience: 'Sarasota dental patients',
  competitorInsights: 'Most competitors explain financing in generic terms.',
  internalLinkSuggestions: ['/dental-financing'],
  pageType: 'service',
  executiveSummary: 'A compact service-page brief for financing questions.',
};

describe('content experiment harness argument parsing', () => {
  it('parses required options and defaults read-only experiment settings', () => {
    const parsed = parseExperimentArgs([
      '--workspace', 'ws_123',
      '--topic', 'Dental financing in Sarasota',
      '--page-type', 'service',
      '--variants', 'current,concise',
    ]);

    expect(parsed.workspaceId).toBe('ws_123');
    expect(parsed.topic).toBe('Dental financing in Sarasota');
    expect(parsed.pageType).toBe('service');
    expect(parsed.variants).toEqual(['current', 'concise']);
    expect(parsed.mcpUrl).toContain('/mcp');
    expect(parsed.includePosts).toBe(false);
  });

  it('supports opt-in post quality audits without persistence flags', () => {
    const parsed = parseExperimentArgs([
      '--workspace', 'ws_123',
      '--topic', 'Dental financing in Sarasota',
      '--page-type', 'service',
      '--include-posts',
    ]);

    expect(parsed.includePosts).toBe(true);
    expect(parsed.variants).toEqual(['current', 'concise', 'blended']);
  });

  it('parses batch mode independently from one-off experiment mode', () => {
    const parsed = parseBatchExperimentArgs([
      '--batch-file', 'content-experiments.batch.json',
      '--variants', 'current,blended',
      '--include-posts',
    ]);

    expect(parsed.batchFile).toBe('content-experiments.batch.json');
    expect(parsed.variants).toEqual(['current', 'blended']);
    expect(parsed.includePosts).toBe(true);
  });

  it('rejects persistence flags because the first harness is read-only', () => {
    expect(() => parseExperimentArgs([
      '--workspace', 'ws_123',
      '--topic', 'Dental financing in Sarasota',
      '--page-type', 'service',
      '--save',
    ])).toThrow(/read-only experiment harness/);
  });
});

describe('content experiment harness prompt contracts', () => {
  it('builds conversion layouts with one CTA-like close', () => {
    const layout = buildExperimentLayout('Dental financing in Sarasota', 'service');
    expect(layout.type).toBe('outline');
    if (layout.type !== 'outline') throw new Error('expected outline layout');

    const ctaSections = layout.structure.sections.filter(section => section.callout === 'cta');
    expect(layout.structure.sections).toHaveLength(5);
    expect(ctaSections).toHaveLength(1);
  });

  it('puts right-sized page rules and brand containment into candidate prompts', () => {
    const layout = buildExperimentLayout('Branding agency Austin', 'location');
    const prompt = buildBriefExperimentPrompt({
      topic: 'Branding agency Austin',
      pageType: 'location',
      variant: {
        id: 'concise',
        label: 'Concise Outline',
        temperature: 0.45,
        instructions: 'Keep it compact.',
      },
      promptContext: 'Brand voice: direct and practical.',
      layout,
    });

    expect(prompt).toContain('Target 900 words, acceptable range 700-1000');
    expect(prompt).toContain('Page type, conversion goal, and word budget outrank brand voice/style');
    expect(prompt).toContain('Location pages must not teach local SEO operations');
    expect(prompt).toContain('Return ONLY valid JSON');
  });
});

describe('content experiment harness deterministic scoring', () => {
  it('scores compact service briefs highly', () => {
    const result = scoreBrief(baseBrief, 'current');

    expect(result.score).toBeGreaterThanOrEqual(90);
    expect(result.warnings).toEqual([]);
  });

  it('penalizes overlong service briefs with duplicate CTA sections and H3 sprawl', () => {
    const result = scoreBrief({
      ...baseBrief,
      wordCountTarget: 1800,
      outline: [
        ...baseBrief.outline,
        { heading: 'Book a Call', notes: 'CTA one.', wordCount: 160, keywords: [] },
        { heading: 'Contact Our Team', notes: 'CTA two.', wordCount: 160, keywords: [] },
        { heading: 'More Questions', subheadings: ['A', 'B', 'C', 'D'], notes: 'Too much structure.', wordCount: 250, keywords: [] },
      ],
    }, 'sprawling');

    expect(result.score).toBeLessThan(70);
    expect(result.warnings.join(' ')).toContain('Word target is above service budget');
    expect(result.warnings.join(' ')).toContain('CTA/contact-like sections');
  });

  it('penalizes location outlines that teach local SEO operations to readers', () => {
    const locationBrief: BriefContent = {
      ...baseBrief,
      pageType: 'location',
      wordCountTarget: 900,
      outline: [
        { heading: 'Branding Agency in Austin', notes: 'Local proof and fit.', wordCount: 220, keywords: [] },
        { heading: 'Keep NAP Consistency Updated', notes: 'Explain directory listings and Google Business Profile hygiene.', wordCount: 220, keywords: [] },
        { heading: 'Austin Client Proof', notes: 'Use real local examples.', wordCount: 220, keywords: [] },
        { heading: 'Contact the Austin Studio', notes: 'One close.', wordCount: 180, keywords: [] },
      ],
    };

    const result = scoreBrief(locationBrief, 'location');
    expect(result.score).toBeLessThan(90);
    expect(result.warnings).toContain('Location outline includes reader-facing local SEO operations language.');
  });

  it('scores readable drafts and flags wall-of-text / duplicate CTA risks', () => {
    const html = `<h1>Dental Financing in Sarasota</h1>
<p>Dental care should be clear before treatment begins.</p>
<h2>Payment options</h2>
<p>${'This sentence repeats the same practical financing idea for patients. '.repeat(18)}</p>
<h2>Schedule a Visit</h2>
<p>Book a visit to check your options.</p>
<h2>Contact Our Team</h2>
<p>Call the office for help.</p>`;

    const result = scoreDraft(html, baseBrief, 'draft');

    expect(result.score).toBeLessThan(100);
    expect(result.warnings.join(' ')).toContain('paragraph');
    expect(result.warnings.join(' ')).toContain('CTA-like H2');
  });

  it('flags internal source commentary in reader-facing drafts', () => {
    const html = `<h1>Dental Financing in Sarasota</h1>
<p>The provided context confirms that payment plans are available.</p>
<h2>Payment Options</h2>
<p>Patients can ask about options before treatment.</p>`;

    const result = scoreDraft(html, baseBrief, 'draft');

    expect(result.warnings).toContain('Draft exposes internal source/context commentary to the reader.');
  });
});

describe('content experiment harness report formatting', () => {
  it('marks reports as read-only and summarizes variants', () => {
    const score = scoreBrief(baseBrief, 'current');
    const report = formatExperimentReport({
      workspaceId: 'ws_123',
      topic: 'Dental financing in Sarasota',
      pageType: 'service',
      mcpUrl: 'http://localhost:3000/mcp',
      generatedAt: '2026-05-26T12:00:00.000Z',
      results: [{
        variant: { id: 'current', label: 'Current Contract', temperature: 0.5, instructions: 'Baseline.' },
        prompt: 'prompt',
        brief: baseBrief,
        score,
        tokens: { prompt: 100, completion: 200, total: 300 },
        draft: {
          html: '<h1>Dental Financing in Sarasota</h1><p>Clear options.</p>',
          score: scoreDraft('<h1>Dental Financing in Sarasota</h1><p>Clear options.</p>', baseBrief, 'current'),
          tokens: { prompt: 120, completion: 80, total: 200 },
        },
      }],
    });

    expect(report).toContain('read-only local experiment');
    expect(report).toContain('| current |');
    expect(report).toContain('Current Contract');
    expect(report).toContain('Draft quality score');
  });

  it('summarizes batch winners by page type', () => {
    const currentScore = scoreBrief(baseBrief, 'current');
    const blendedScore = scoreBrief(baseBrief, 'blended');
    const batch = {
      generatedAt: '2026-05-26T12:00:00.000Z',
      batchFile: 'batch.json',
      mcpUrl: 'https://insights.hmpsn.studio/mcp',
      cases: [{
        id: 'service-rinse',
        outDir: 'artifacts/content-experiments/batch/service-rinse',
        report: {
          workspaceId: 'ws_123',
          topic: 'Dental financing in Sarasota',
          pageType: 'service' as const,
          mcpUrl: 'https://insights.hmpsn.studio/mcp',
          generatedAt: '2026-05-26T12:00:00.000Z',
          results: [
            {
              variant: { id: 'current', label: 'Current Contract', temperature: 0.5, instructions: 'Baseline.' },
              prompt: 'prompt',
              brief: baseBrief,
              score: currentScore,
              tokens: { prompt: 100, completion: 100, total: 200 },
              draft: {
                html: '<h1>Dental Financing in Sarasota</h1><p>Clear options.</p>',
                score: { ...scoreDraft('<h1>Dental Financing in Sarasota</h1><p>Clear options.</p>', baseBrief, 'current'), score: 88 },
                tokens: { prompt: 100, completion: 100, total: 200 },
              },
            },
            {
              variant: { id: 'blended', label: 'Blended Candidate', temperature: 0.5, instructions: 'Blend.' },
              prompt: 'prompt',
              brief: baseBrief,
              score: blendedScore,
              tokens: { prompt: 100, completion: 100, total: 200 },
              draft: {
                html: '<h1>Dental Financing in Sarasota</h1><p>Clear options.</p>',
                score: { ...scoreDraft('<h1>Dental Financing in Sarasota</h1><p>Clear options.</p>', baseBrief, 'blended'), score: 94 },
                tokens: { prompt: 100, completion: 100, total: 200 },
              },
            },
          ],
        },
      }],
    };

    expect(summarizeBatchWinners(batch)).toEqual([{
      pageType: 'service',
      winner: 'blended',
      averageScore: 94,
      cases: 1,
    }]);
    expect(formatBatchReport(batch)).toContain('Recommended Winners By Page Type');
    expect(formatBatchReport(batch)).toContain('| service | blended | 94 | 1 |');
  });
});
