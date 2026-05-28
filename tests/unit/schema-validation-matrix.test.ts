import { describe, expect, it } from 'vitest';
import { validateForGoogleRichResults } from '../../server/schema-validator.js';
import { checkRichResultsEligibility } from '../../server/schema/rich-results.js';
import { validateLeanSchema } from '../../server/schema/validator.js';

type MatrixCase = {
  type: string;
  requiredField: string;
  expectEligibilityEntry?: boolean;
  validNode: Record<string, unknown>;
};

const MATRIX_CASES: MatrixCase[] = [
  {
    type: 'Article',
    requiredField: 'headline',
    validNode: {
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
    },
  },
  {
    type: 'BlogPosting',
    requiredField: 'headline',
    validNode: {
      '@type': 'BlogPosting',
      headline: '5 Plumbing Maintenance Tips',
      description: 'Simple maintenance steps for homeowners.',
      image: 'https://example.com/blog/plumbing-tips.jpg',
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
      articleSection: 'Home Maintenance',
    },
  },
  {
    type: 'LocalBusiness',
    requiredField: 'name',
    validNode: {
      '@type': 'LocalBusiness',
      name: 'Acme Plumbing',
      url: 'https://example.com',
      inLanguage: 'en-US',
      address: {
        '@type': 'PostalAddress',
        streetAddress: '123 Main St',
        addressLocality: 'Austin',
        addressRegion: 'TX',
      },
    },
  },
  {
    type: 'Review',
    requiredField: 'itemReviewed',
    validNode: {
      '@type': 'Review',
      itemReviewed: { '@type': 'Service', name: 'Emergency Plumbing' },
      author: { '@type': 'Person', name: 'Taylor' },
      reviewRating: { '@type': 'Rating', ratingValue: '5' },
      reviewBody: 'Fast and professional service.',
    },
  },
  {
    type: 'Service',
    requiredField: 'name',
    validNode: {
      '@type': 'Service',
      name: 'Emergency Plumbing',
      description: '24/7 plumbing service',
      provider: { '@type': 'Organization', name: 'Acme Plumbing' },
      inLanguage: 'en-US',
    },
  },
  {
    type: 'BreadcrumbList',
    requiredField: 'itemListElement',
    validNode: {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://example.com/' },
        { '@type': 'ListItem', position: 2, name: 'Services', item: 'https://example.com/services' },
      ],
    },
  },
  {
    type: 'Organization',
    requiredField: 'name',
    expectEligibilityEntry: false,
    validNode: {
      '@type': 'Organization',
      name: 'Acme Home Services',
      url: 'https://example.com',
    },
  },
  {
    type: 'WebSite',
    requiredField: 'name',
    expectEligibilityEntry: false,
    validNode: {
      '@type': 'WebSite',
      name: 'Acme Home Services',
      url: 'https://example.com',
      publisher: { '@id': 'https://example.com/#organization' },
      inLanguage: 'en-US',
    },
  },
];

function schemaForNode(node: Record<string, unknown>): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@graph': [node],
  };
}

function removeField(node: Record<string, unknown>, field: string): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(node)) as Record<string, unknown>;
  delete clone[field];
  return clone;
}

function publishErrorsForType(schema: Record<string, unknown>, type: string) {
  return validateForGoogleRichResults(schema).errors.filter(error => error.type === type);
}

function eligibilityForType(schema: Record<string, unknown>, type: string) {
  return checkRichResultsEligibility(schema).find(result => result.type === type);
}

describe('schema validation matrix — core families', () => {
  it('keeps publish and eligibility aligned for valid fixtures', () => {
    for (const testCase of MATRIX_CASES) {
      const schema = schemaForNode(testCase.validNode);
      const publishTypeErrors = publishErrorsForType(schema, testCase.type);
      const eligibility = eligibilityForType(schema, testCase.type);
      const expectEligibilityEntry = testCase.expectEligibilityEntry ?? true;

      expect(publishTypeErrors.length, `${testCase.type} should have no publish errors`).toBe(0);
      if (expectEligibilityEntry) {
        expect(eligibility, `${testCase.type} should be present in eligibility output`).toBeDefined();
        expect(eligibility!.eligible, `${testCase.type} should be eligible`).toBe(true);
      } else {
        expect(eligibility, `${testCase.type} should not be in eligibility output`).toBeUndefined();
      }
    }
  });

  it('fails consistently when a shared required field is removed', () => {
    for (const testCase of MATRIX_CASES) {
      const invalidNode = removeField(testCase.validNode, testCase.requiredField);
      const schema = schemaForNode(invalidNode);

      const publishTypeErrors = publishErrorsForType(schema, testCase.type);
      const eligibility = eligibilityForType(schema, testCase.type);
      const expectEligibilityEntry = testCase.expectEligibilityEntry ?? true;
      const leanErrors = validateLeanSchema(schema, testCase.type)
        .filter(finding => finding.severity === 'error' && finding.type === testCase.type);

      expect(
        publishTypeErrors.some(error => error.field === testCase.requiredField),
        `${testCase.type} should include publish error for ${testCase.requiredField}`,
      ).toBe(true);

      if (expectEligibilityEntry) {
        expect(eligibility, `${testCase.type} should be present in eligibility output`).toBeDefined();
        expect(eligibility!.eligible, `${testCase.type} should be ineligible`).toBe(false);
        expect(
          eligibility!.missingFields?.includes(testCase.requiredField) ?? false,
          `${testCase.type} should include missing field ${testCase.requiredField}`,
        ).toBe(true);
      } else {
        expect(eligibility, `${testCase.type} should not be in eligibility output`).toBeUndefined();
      }

      const hasLeanFieldError = leanErrors.some(finding =>
        finding.field === testCase.requiredField
        || finding.message.includes(testCase.requiredField),
      );
      expect(hasLeanFieldError, `${testCase.type} should surface lean error for ${testCase.requiredField}`).toBe(true);

      // Global contradiction lock: never eligible if publish has errors for the same type.
      expect(!(eligibility?.eligible && publishTypeErrors.length > 0)).toBe(true);
    }
  });

  it('keeps recommended-field semantics consistent with publish-first authority', () => {
    const localBusinessSchema = schemaForNode({
      '@type': 'LocalBusiness',
      name: 'Acme Plumbing',
      url: 'https://example.com',
      inLanguage: 'en-US',
      address: {
        '@type': 'PostalAddress',
        streetAddress: '123 Main St',
        addressLocality: 'Austin',
        addressRegion: 'TX',
      },
      // Intentionally missing publish-recommended fields: telephone, openingHours, geo, image
    });

    const localPublish = validateForGoogleRichResults(localBusinessSchema);
    const localEligibility = eligibilityForType(localBusinessSchema, 'LocalBusiness');
    const localLeanErrors = validateLeanSchema(localBusinessSchema, 'LocalBusiness')
      .filter(finding => finding.severity === 'error' && finding.type === 'LocalBusiness');

    expect(localPublish.status).toBe('warnings');
    expect(localPublish.errors.filter(error => error.type === 'LocalBusiness')).toHaveLength(0);
    expect(localPublish.warnings.filter(warning => warning.type === 'LocalBusiness').length).toBeGreaterThan(0);
    expect(localEligibility?.eligible).toBe(true);
    expect(localLeanErrors).toHaveLength(0);

    const reviewSchema = schemaForNode({
      '@type': 'Review',
      itemReviewed: { '@type': 'Service', name: 'Emergency Plumbing' },
      author: { '@type': 'Person', name: 'Taylor' },
      reviewRating: { '@type': 'Rating', ratingValue: '5' },
      // Intentionally missing recommended review fields: datePublished, reviewBody
    });

    const reviewPublish = validateForGoogleRichResults(reviewSchema);
    const reviewEligibility = eligibilityForType(reviewSchema, 'Review');
    const reviewLeanWarnings = validateLeanSchema(reviewSchema, 'Review')
      .filter(finding => finding.severity === 'warning' && finding.type === 'Review');

    expect(reviewPublish.status).toBe('warnings');
    expect(reviewPublish.errors.filter(error => error.type === 'Review')).toHaveLength(0);
    expect(reviewPublish.warnings.filter(warning => warning.type === 'Review').length).toBeGreaterThan(0);
    expect(reviewEligibility?.eligible).toBe(true);
    expect(reviewLeanWarnings.length).toBeGreaterThan(0);
  });
});
