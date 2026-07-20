import { describe, expect, it } from 'vitest';

import type { PersistedGeneratedPost } from '../../shared/types/content.js';
import type { ResolvedPageBlockManifest } from '../../shared/types/matrix-generation.js';
import {
  MatrixHeadingContractError,
  synchronizeMatrixGenerationPostHeadings,
} from '../../server/domains/content/matrix-generation/heading-contract.js';

function manifest(): ResolvedPageBlockManifest {
  return {
    generationContractVersion: 1,
    fingerprint: 'a'.repeat(64),
    totalWordCountTarget: 200,
    blocks: [
      {
        id: 'system:introduction',
        source: 'system',
        generationRole: 'introduction',
        order: 0,
        heading: { level: null, renderedText: null, locked: true },
        guidance: 'Open directly.',
        aeoContract: { modes: [], required: false },
        ctaContract: { role: 'none', required: false },
      },
      {
        id: 'template:locked',
        source: 'template',
        sourceSectionId: 'locked',
        generationRole: 'definition',
        order: 1,
        heading: { level: 2, renderedText: 'What does this service cost?', locked: true },
        guidance: 'Answer the question.',
        wordCountTarget: 100,
        aeoContract: { modes: ['definition'], required: true },
        ctaContract: { role: 'none', required: false },
      },
      {
        id: 'template:unlocked',
        source: 'template',
        sourceSectionId: 'unlocked',
        generationRole: 'proof',
        order: 2,
        heading: { level: 2, renderedText: 'Proof', locked: false },
        guidance: 'Show verified proof.',
        wordCountTarget: 100,
        aeoContract: { modes: [], required: false },
        ctaContract: { role: 'none', required: false },
      },
      {
        id: 'system:conclusion',
        source: 'system',
        generationRole: 'conclusion',
        order: 3,
        heading: { level: 2, renderedText: null, locked: false },
        guidance: 'Close clearly.',
        aeoContract: { modes: [], required: false },
        ctaContract: { role: 'primary', required: true },
      },
    ],
  };
}

function post(): PersistedGeneratedPost {
  return {
    id: 'post-heading-contract',
    workspaceId: 'ws-heading-contract',
    briefId: 'brief-heading-contract',
    targetKeyword: 'verified service',
    title: 'Verified service',
    metaDescription: 'Verified service details.',
    introduction: '<p>Start here.</p>',
    sections: [
      {
        index: 0,
        heading: 'What does this service cost?',
        content: '<h2>What does this service cost?</h2><p>Verified answer.</p>',
        wordCount: 6,
        targetWordCount: 100,
        keywords: [],
        status: 'done',
      },
      {
        index: 1,
        heading: 'Stale metadata',
        content: '<h2>Confidence without the hard sell</h2><p>Verified proof.</p>',
        wordCount: 7,
        targetWordCount: 100,
        keywords: [],
        status: 'done',
      },
    ],
    conclusion: '<h2>Ready when you are</h2><p>Take the next step.</p>',
    totalWordCount: 20,
    targetWordCount: 200,
    status: 'draft',
    generationRevision: 1,
    generationProvenance: null,
    createdAt: '2026-07-20T00:00:00.000Z',
    updatedAt: '2026-07-20T00:00:00.000Z',
  };
}

function expectReason(run: () => unknown, reason: MatrixHeadingContractError['issues'][number]['reason']) {
  try {
    run();
    throw new Error('Expected heading synchronization to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(MatrixHeadingContractError);
    expect((error as MatrixHeadingContractError).issues.map(issue => issue.reason)).toContain(reason);
  }
}

describe('matrix heading metadata/body contract', () => {
  it('derives unlocked metadata while preserving exact locked authority', () => {
    const original = post();
    const synchronized = synchronizeMatrixGenerationPostHeadings(manifest(), original);

    expect(synchronized).not.toBe(original);
    expect(synchronized.sections[0].heading).toBe('What does this service cost?');
    expect(synchronized.sections[1].heading).toBe('Confidence without the hard sell');
    expect(original.sections[1].heading).toBe('Stale metadata');
  });

  it('rejects an H2 in a headingless block', () => {
    const candidate = post();
    candidate.introduction = '<h2>Leaked heading</h2><p>Start here.</p>';
    expectReason(() => synchronizeMatrixGenerationPostHeadings(manifest(), candidate), 'heading_unexpected');
  });

  it('rejects multiple H2s in one visible block', () => {
    const candidate = post();
    candidate.sections[1].content = '<h2>First</h2><p>Proof.</p><h2>Second</h2>';
    expectReason(() => synchronizeMatrixGenerationPostHeadings(manifest(), candidate), 'heading_multiple');
  });

  it('requires byte-exact locked heading text', () => {
    const candidate = post();
    candidate.sections[0].content = '<h2>What does this service cost? </h2><p>Answer.</p>';
    expectReason(() => synchronizeMatrixGenerationPostHeadings(manifest(), candidate), 'locked_heading_mismatch');
  });

  it('rejects a missing visible conclusion heading', () => {
    const candidate = post();
    candidate.conclusion = '<p>Take the next step.</p>';
    expectReason(() => synchronizeMatrixGenerationPostHeadings(manifest(), candidate), 'heading_absent');
  });
});
