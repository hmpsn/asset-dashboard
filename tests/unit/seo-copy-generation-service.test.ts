import { describe, expect, it } from 'vitest';

import {
  filterVerifiedInternalLinks,
  parseSeoMetadataOutput,
  parseSeoPageCopyOutput,
  renderSeoMetadataTask,
  renderSeoPageCopyTask,
} from '../../server/domains/seo-health/seo-copy-generation.js';

const metadataEvidence = {
  pageTitle: 'Family Dentistry',
  currentSeoTitle: 'Dentist Services',
  currentDescription: 'Learn about available dental services.',
  pageContent: 'A plain-language overview of preventive and restorative care.',
};

describe('SEO copy generation service contracts', () => {
  it('renders the same canonical metadata task for sync, bulk, and background adapters', () => {
    const shared = {
      field: 'both' as const,
      evidence: {
        ...metadataEvidence,
        searchPerformance: [{
          query: 'family dentist near me', clicks: 2, impressions: 200, position: 4, ctr: 1,
        }],
        siblingMetadata: ['Cosmetic Dentistry | Example Dental'],
      },
      authority: {
        primaryKeyword: 'family dentist',
        searchIntent: 'commercial' as const,
        brandName: 'Example Dental',
      },
    };

    const sync = renderSeoMetadataTask({ ...shared, adapterHint: 'sync' });
    const bulk = renderSeoMetadataTask({ ...shared, adapterHint: 'bulk' });
    const background = renderSeoMetadataTask({ ...shared, adapterHint: 'background' });

    expect(sync).toEqual(bulk);
    expect(sync).toEqual(background);
    expect(sync.userPrompt).toContain('family dentist');
    expect(sync.userPrompt).toContain('Example Dental');
    expect(sync.userPrompt.match(/family dentist near me/g)).toHaveLength(1);
    expect(sync.userPrompt).toContain('CTR UNDERPERFORMANCE');
    expect(sync.userPrompt).toContain('Cosmetic Dentistry | Example Dental');
  });

  it('makes factual specificity conditional on supplied authority', () => {
    const withoutAuthority = renderSeoMetadataTask({
      field: 'description',
      evidence: metadataEvidence,
      authority: {},
    }).userPrompt;

    expect(withoutAuthority).toContain('Do not invent');
    expect(withoutAuthority).not.toMatch(/lead with (?:a )?concrete (?:number|result)/i);
    expect(withoutAuthority).not.toMatch(/mention real (?:services|outcomes|differentiators)/i);

    const withAuthority = renderSeoMetadataTask({
      field: 'description',
      evidence: metadataEvidence,
      authority: {
        differentiators: ['Same-day emergency appointments'],
        proofPoints: ['Serving the community since 1998'],
        locations: ['Sarasota, Florida'],
      },
    }).userPrompt;

    expect(withAuthority).toContain('Same-day emergency appointments');
    expect(withAuthority).toContain('Serving the community since 1998');
    expect(withAuthority).toContain('Sarasota, Florida');
    expect(withAuthority).toMatch(/only when supported by supplied authority/i);

    const withApprovedKnowledge = renderSeoMetadataTask({
      field: 'description',
      evidence: metadataEvidence,
      authority: {
        approvedEvidence: ['APPROVED KNOWLEDGE: Same-day emergency appointments are available.'],
      },
    }).userPrompt;
    expect(withApprovedKnowledge).toContain('Same-day emergency appointments are available.');
    expect(withApprovedKnowledge).toMatch(/only when supported by supplied authority/i);
  });

  it('strictly rejects malformed metadata output and enforces exact field limits', () => {
    expect(parseSeoMetadataOutput('{"variations":["one",7,"three"]}', { field: 'title' })).toBeNull();
    expect(parseSeoMetadataOutput('{"pairs":[{"title":"Only a title"}]}', { field: 'both' })).toBeNull();
    expect(parseSeoMetadataOutput('not json', { field: 'description' })).toBeNull();

    const title = 'A title with enough words to guarantee it exceeds the sixty character maximum by a lot';
    const description = 'A long description with enough words to exceed the one hundred and sixty character maximum while still providing a deterministic word boundary for truncation and preserving valid plain text output for callers.';
    const parsed = parseSeoMetadataOutput(JSON.stringify({
      pairs: [
        { title: `First ${title}`, description: `First ${description}` },
        { title: `Second ${title}`, description: `Second ${description}` },
        { title: `Third ${title}`, description: `Third ${description}` },
      ],
    }), { field: 'both' });

    expect(parsed).not.toBeNull();
    expect(parsed?.pairs).toHaveLength(3);
    expect(parsed?.pairs.every(pair => pair.title.length <= 60)).toBe(true);
    expect(parsed?.pairs.every(pair => pair.description.length <= 160)).toBe(true);
  });

  it('rejects duplicate metadata choices after deterministic limits are applied', () => {
    expect(parseSeoMetadataOutput(JSON.stringify({
      variations: ['Same title', ' same   title ', 'SAME TITLE'],
    }), { field: 'title' })).toBeNull();

    const sharedPrefix = 'A'.repeat(65);
    expect(parseSeoMetadataOutput(JSON.stringify({
      variations: [`${sharedPrefix} one`, `${sharedPrefix} two`, `${sharedPrefix} three`],
    }), { field: 'title' })).toBeNull();

    expect(parseSeoMetadataOutput(JSON.stringify({
      pairs: [
        { title: 'Same title', description: 'Same description' },
        { title: ' same title ', description: 'same  description' },
        { title: 'SAME TITLE', description: 'SAME DESCRIPTION' },
      ],
    }), { field: 'both' })).toBeNull();

    expect(parseSeoMetadataOutput(JSON.stringify({
      pairs: [
        { title: 'Same title', description: 'First description' },
        { title: 'Same title', description: 'Second description' },
        { title: 'Same title', description: 'Third description' },
      ],
    }), { field: 'both' })).toBeNull();

    expect(parseSeoMetadataOutput(JSON.stringify({
      pairs: [
        { title: 'First title', description: 'Same description' },
        { title: 'Second title', description: 'Same description' },
        { title: 'Third title', description: 'Same description' },
      ],
    }), { field: 'both' })).toBeNull();
  });

  it('renders a bounded page-copy task and rejects malformed structured output', () => {
    const task = renderSeoPageCopyTask({
      currentPath: '/services/family-dentistry',
      evidence: metadataEvidence,
      authority: { primaryKeyword: 'family dentistry' },
      verifiedInternalLinks: [
        { path: '/services/emergency-dentistry', label: 'Emergency dentistry' },
      ],
    });

    expect(task.userPrompt).toContain('/services/emergency-dentistry');
    expect(task.userPrompt).toContain('family dentistry');
    expect(parseSeoPageCopyOutput('{"seoTitle":42}')).toBeNull();
    expect(parseSeoPageCopyOutput('{"internalLinkSuggestions":[{"targetPath":"/x"}]}')).toBeNull();

    const parsed = parseSeoPageCopyOutput(JSON.stringify({
      seoTitle: 'Family Dentistry for Every Stage of Life in Sarasota, Florida',
      metaDescription: 'Thoughtful family dentistry with preventive and restorative care for every stage of life. Explore treatment options and plan your visit today.',
      h1: 'Family Dentistry for Every Stage of Life',
      introParagraph: 'Family dentistry should make preventive and restorative care easier to understand. See what to expect and choose the next step that fits your needs.',
      internalLinkSuggestions: [{
        targetPath: '/services/emergency-dentistry',
        anchorText: 'emergency dental care',
        context: 'Link from the urgent-care paragraph.',
      }],
      changes: ['Aligned the opening with the page intent.'],
    }));

    expect(parsed).not.toBeNull();
    expect(parsed?.seoTitle?.length).toBeLessThanOrEqual(60);
    expect(parsed?.metaDescription?.length).toBeLessThanOrEqual(160);
  });

  it('keeps only verified relative internal links and rejects self references', () => {
    const suggestions = [
      { targetPath: '/services/emergency-dentistry/', anchorText: 'emergency care', context: 'Relevant care.' },
      { targetPath: '/services/family-dentistry', anchorText: 'this page', context: 'Self reference.' },
      { targetPath: '/unknown', anchorText: 'unknown page', context: 'Unknown.' },
      { targetPath: 'https://evil.example/services/emergency-dentistry', anchorText: 'external', context: 'External.' },
      { targetPath: '//evil.example/services/emergency-dentistry', anchorText: 'scheme relative', context: 'External.' },
    ];

    expect(filterVerifiedInternalLinks(
      suggestions,
      '/services/family-dentistry/',
      new Set(['/services/emergency-dentistry']),
    )).toEqual([
      { targetPath: '/services/emergency-dentistry', anchorText: 'emergency care', context: 'Relevant care.' },
    ]);
  });

  it('rejects a self reference when the current page is supplied as an absolute URL', () => {
    expect(filterVerifiedInternalLinks(
      [
        { targetPath: '/about', anchorText: 'about', context: 'Self reference.' },
        { targetPath: '/contact', anchorText: 'contact', context: 'Related page.' },
      ],
      'https://example.com/about',
      new Set(['/about', '/contact']),
    )).toEqual([
      { targetPath: '/contact', anchorText: 'contact', context: 'Related page.' },
    ]);
  });
});
