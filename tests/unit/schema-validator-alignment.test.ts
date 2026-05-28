import { describe, expect, it } from 'vitest';
import { validateForGoogleRichResults } from '../../server/schema-validator.js';
import { checkRichResultsEligibility } from '../../server/schema/rich-results.js';
import {
  evaluateGoogleSchema,
  hasReviewRatingOrDate,
  hasSchemaField,
  isImageObjectWithUrl,
  publishValidationFromEvaluation,
  richResultEligibilityFromEvaluation,
} from '../../server/schema/schema-validation-core.js';
import { validateLeanSchema } from '../../server/schema/validator.js';

function eligibilityFor(schema: Record<string, unknown>, type: string) {
  return checkRichResultsEligibility(schema).find(result => result.type === type);
}

describe('schema validator alignment', () => {
  it('uses shared helper semantics for opening hours alias and PostalAddress completeness', () => {
    const withOpeningHoursSpec = {
      '@type': 'LocalBusiness',
      openingHoursSpecification: [{ '@type': 'OpeningHoursSpecification', dayOfWeek: 'Monday' }],
    } as Record<string, unknown>;
    const withCompletePostalAddress = {
      '@type': 'LocalBusiness',
      address: {
        '@type': 'PostalAddress',
        streetAddress: '123 Main St',
        addressLocality: 'Austin',
        addressRegion: 'TX',
      },
    } as Record<string, unknown>;
    const withIncompletePostalAddress = {
      '@type': 'LocalBusiness',
      address: {
        '@type': 'PostalAddress',
        streetAddress: '123 Main St',
        addressLocality: 'Austin',
      },
    } as Record<string, unknown>;

    expect(hasSchemaField(withOpeningHoursSpec, 'openingHours')).toBe(true);
    expect(hasSchemaField(withCompletePostalAddress, 'address')).toBe(true);
    expect(hasSchemaField(withIncompletePostalAddress, 'address')).toBe(false);
  });

  it('uses shared helper semantics for review fallback and ImageObject URL validation', () => {
    const reviewWithDateOnly = {
      '@type': 'Review',
      datePublished: '2026-05-20',
    } as Record<string, unknown>;

    expect(hasReviewRatingOrDate(reviewWithDateOnly)).toBe(true);
    expect(isImageObjectWithUrl({ '@type': 'ImageObject', url: 'https://example.com/image.png' })).toBe(true);
    expect(isImageObjectWithUrl({ '@type': 'ImageObject' })).toBe(false);
    expect(isImageObjectWithUrl('https://example.com/image.png')).toBe(false);
  });

  it('keeps LocalBusiness eligibility aligned with publish validation', () => {
    const schema = {
      '@context': 'https://schema.org',
      '@graph': [{
        '@type': 'LocalBusiness',
        name: 'Acme Plumbing',
        address: '123 Main St',
      }],
    };

    const publish = validateForGoogleRichResults(schema);
    const eligibility = eligibilityFor(schema, 'LocalBusiness');

    expect(publish.errors.some(error => error.type === 'LocalBusiness' && error.field === 'address')).toBe(true);
    expect(eligibility).toBeDefined();
    expect(eligibility!.eligible).toBe(false);
    expect(eligibility!.missingFields).toContain('address');
  });

  it('keeps Review rating/date semantics aligned across publish, eligibility, and lean paths', () => {
    const schema = {
      '@context': 'https://schema.org',
      '@graph': [{
        '@type': 'Review',
        itemReviewed: { '@type': 'Service', name: 'Emergency Plumbing' },
        author: { '@type': 'Person', name: 'Taylor' },
      }],
    };

    const publish = validateForGoogleRichResults(schema);
    const eligibility = eligibilityFor(schema, 'Review');
    const leanFindings = validateLeanSchema(schema, 'Review');

    expect(publish.errors.some(error => error.type === 'Review' && error.field === 'reviewRating')).toBe(true);
    expect(eligibility).toBeDefined();
    expect(eligibility!.eligible).toBe(false);
    expect(eligibility!.missingFields).toContain('reviewRating');
    expect(leanFindings.some(finding => finding.ruleId === 'review-rating-or-date-missing')).toBe(true);
  });

  it('normalizes required/recommended message templates across publish and lean validators', () => {
    const requiredMissingSchema = {
      '@context': 'https://schema.org',
      '@graph': [{
        '@type': 'Review',
        author: { '@type': 'Person', name: 'Taylor' },
        reviewRating: { '@type': 'Rating', ratingValue: '5' },
      }],
    };
    const requiredPublish = validateForGoogleRichResults(requiredMissingSchema);
    const requiredLean = validateLeanSchema(requiredMissingSchema, 'Review');
    const publishRequired = requiredPublish.errors.find(error => error.type === 'Review' && error.field === 'itemReviewed');
    const leanRequired = requiredLean.find(finding => finding.type === 'Review' && finding.field === 'itemReviewed' && finding.ruleId === 'required-field-missing');
    expect(publishRequired?.message).toBe('Missing required property "itemReviewed" for Review');
    expect(leanRequired?.message).toBe('Missing required property "itemReviewed" for Review');

    const recommendedMissingSchema = {
      '@context': 'https://schema.org',
      '@graph': [{
        '@type': 'Review',
        itemReviewed: { '@type': 'Service', name: 'Emergency Plumbing' },
        author: { '@type': 'Person', name: 'Taylor' },
        reviewRating: { '@type': 'Rating', ratingValue: '5' },
      }],
    };
    const recommendedPublish = validateForGoogleRichResults(recommendedMissingSchema);
    const recommendedLean = validateLeanSchema(recommendedMissingSchema, 'Review');
    const publishRecommended = recommendedPublish.warnings.find(warning => warning.type === 'Review' && warning.field === 'reviewBody');
    const leanRecommended = recommendedLean.find(finding => finding.type === 'Review' && finding.field === 'reviewBody' && finding.ruleId === 'recommended-field-missing');
    expect(publishRecommended?.message).toBe('Missing recommended property "reviewBody" for Review');
    expect(leanRecommended?.message).toBe('Missing recommended property "reviewBody" for Review');
  });

  it('treats malformed Article image shapes as ineligible and publish-blocking', () => {
    const schema = {
      '@context': 'https://schema.org',
      '@graph': [{
        '@type': 'Article',
        headline: 'How to Choose an HVAC Installer',
        description: 'A practical guide for homeowners.',
        image: { '@type': 'ImageObject' },
        datePublished: '2026-05-20T10:00:00Z',
        dateModified: '2026-05-21T10:00:00Z',
        author: { '@type': 'Person', name: 'Jordan Smith' },
        publisher: {
          '@type': 'Organization',
          name: 'Acme Home Services',
          logo: {
            '@type': 'ImageObject',
            url: 'https://example.com/logo.png',
          },
        },
        isPartOf: { '@id': 'https://example.com/#website' },
        inLanguage: 'en-US',
      }],
    };

    const publish = validateForGoogleRichResults(schema);
    const eligibility = eligibilityFor(schema, 'Article');
    const leanFindings = validateLeanSchema(schema, 'Article');

    expect(publish.errors.some(error => error.type === 'Article' && error.field === 'image')).toBe(true);
    expect(eligibility).toBeDefined();
    expect(eligibility!.eligible).toBe(false);
    expect(eligibility!.missingFields).toContain('image');
    expect(leanFindings.some(finding => finding.ruleId === 'article-image-imageobject-url-missing')).toBe(true);
  });

  it('prevents eligible+publish-error contradictions across representative fixtures', () => {
    const fixtures: Array<Record<string, unknown>> = [
      {
        '@context': 'https://schema.org',
        '@graph': [{ '@type': 'LocalBusiness', name: 'Acme Plumbing', address: '123 Main St' }],
      },
      {
        '@context': 'https://schema.org',
        '@graph': [{
          '@type': 'Review',
          itemReviewed: { '@type': 'Service', name: 'Emergency Plumbing' },
          author: { '@type': 'Person', name: 'Taylor' },
        }],
      },
      {
        '@context': 'https://schema.org',
        '@graph': [{
          '@type': 'Article',
          headline: 'How to Choose an HVAC Installer',
          description: 'A practical guide for homeowners.',
          image: { '@type': 'ImageObject' },
          datePublished: '2026-05-20T10:00:00Z',
          dateModified: '2026-05-21T10:00:00Z',
          author: { '@type': 'Person', name: 'Jordan Smith' },
          publisher: {
            '@type': 'Organization',
            name: 'Acme Home Services',
            logo: { '@type': 'ImageObject', url: 'https://example.com/logo.png' },
          },
          isPartOf: { '@id': 'https://example.com/#website' },
          inLanguage: 'en-US',
        }],
      },
      {
        '@context': 'https://schema.org',
        '@graph': [{
          '@type': 'Article',
          headline: 'How to Choose an HVAC Installer',
          description: 'A practical guide for homeowners.',
          image: 'https://example.com/blog/hvac-installer.jpg',
          datePublished: '2026-05-20T10:00:00Z',
          dateModified: '2026-05-21T10:00:00Z',
          author: { '@type': 'Person', name: 'Jordan Smith' },
          publisher: {
            '@type': 'Organization',
            name: 'Acme Home Services',
            logo: { '@type': 'ImageObject', url: 'https://example.com/logo.png' },
          },
          isPartOf: { '@id': 'https://example.com/#website' },
          inLanguage: 'en-US',
        }],
      },
    ];

    for (const fixture of fixtures) {
      const evaluated = evaluateGoogleSchema(fixture);
      const eligibility = checkRichResultsEligibility(fixture);

      for (const item of eligibility) {
        const publishTypeErrors = evaluated.publish.errors.filter(error => error.type === item.type);
        expect(item.eligible && publishTypeErrors.length > 0).toBe(false);
      }
    }
  });

  it('keeps wrapper callers locked to shared core projections', () => {
    const schema = {
      '@context': 'https://schema.org',
      '@graph': [{
        '@type': 'Review',
        itemReviewed: { '@type': 'Service', name: 'Emergency Plumbing' },
        author: { '@type': 'Person', name: 'Taylor' },
      }, {
        '@type': 'Article',
        headline: 'How to Choose an HVAC Installer',
        description: 'A practical guide for homeowners.',
        image: { '@type': 'ImageObject' },
        datePublished: '2026-05-20T10:00:00Z',
        dateModified: '2026-05-21T10:00:00Z',
        author: { '@type': 'Person', name: 'Jordan Smith' },
        publisher: {
          '@type': 'Organization',
          name: 'Acme Home Services',
          logo: { '@type': 'ImageObject', url: 'https://example.com/logo.png' },
        },
        isPartOf: { '@id': 'https://example.com/#website' },
        inLanguage: 'en-US',
      }],
    };

    const evaluated = evaluateGoogleSchema(schema);
    const publishProjection = publishValidationFromEvaluation(evaluated);
    const eligibilityProjection = richResultEligibilityFromEvaluation(evaluated);
    const publish = validateForGoogleRichResults(schema);
    const eligibility = checkRichResultsEligibility(schema);

    expect(publish).toEqual(publishProjection);
    expect(eligibility).toEqual(eligibilityProjection);

    for (const item of eligibilityProjection) {
      const publishTypeErrors = publishProjection.errors.filter(error => error.type === item.type);
      expect(item.eligible && publishTypeErrors.length > 0).toBe(false);
    }
  });
});
