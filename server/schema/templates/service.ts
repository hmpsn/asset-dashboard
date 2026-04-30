/**
 * Service and Product templates.
 * Service uses provider @id reference (no duplicated Organization).
 * Product never emits zero-price offers.
 */
import type { PageData } from '../data-sources.js';
import { dropUndefined, orgRef, withBreadcrumb, webSiteRef, breadcrumbRef } from './helpers.js';

export interface ServiceInput {
  baseUrl: string;
  pageData: PageData;
}

export function buildServiceSchema(input: ServiceInput): Record<string, unknown> {
  const { pageData, baseUrl } = input;
  const serviceId = `${pageData.canonicalUrl}#service`;

  // PR2: AggregateRating from testimonials WITH ratings
  const ratedTestimonials = (pageData.elements?.testimonials ?? []).filter(t => t.rating != null);
  const aggregateRating = ratedTestimonials.length > 0
    ? dropUndefined({
        '@type': 'AggregateRating' as const,
        'ratingValue': Number((ratedTestimonials.reduce((s, t) => s + (t.rating ?? 0), 0) / ratedTestimonials.length).toFixed(2)),
        'reviewCount': ratedTestimonials.length,
        'bestRating': 5,
        'worstRating': 1,
      })
    : undefined;

  // PR2: Table mainEntity when isPricingLike OR isComparisonLike
  const interestingTable = (pageData.elements?.tables ?? [])
    .find(t => t.isPricingLike || t.isComparisonLike);
  const tableAbout = interestingTable?.caption
    || (interestingTable?.isPricingLike ? 'Pricing' : interestingTable?.isComparisonLike ? 'Comparison' : undefined);
  const tableMainEntity = interestingTable && tableAbout
    ? dropUndefined({
        '@type': 'Table' as const,
        '@id': `${pageData.canonicalUrl}#table-0`,
        'about': tableAbout,
      })
    : undefined;

  const primary = dropUndefined({
    '@type': 'Service',
    '@id': serviceId,
    'name': pageData.cleanTitle,
    'description': pageData.description,
    'image': pageData.image,
    'url': pageData.canonicalUrl,
    'provider': dropUndefined({
      '@type': 'Organization',
      ...orgRef(baseUrl),
      'name': pageData.publisher.name,
    }),
    'isPartOf': webSiteRef(baseUrl),
    'breadcrumb': breadcrumbRef(pageData.canonicalUrl, pageData.breadcrumbs),
    'inLanguage': pageData.inLanguage,
    'areaServed': pageData.areaServed ? { '@type': 'Place' as const, name: pageData.areaServed } : undefined,
    'serviceType': pageData.serviceType,
    'aggregateRating': aggregateRating,
    'mainEntity': tableMainEntity,
  });

  // PR2: Review[] graph nodes (one per testimonial with author + rating)
  // Google requires reviewRating on Review nodes; skip any testimonial missing either.
  const reviews: Record<string, unknown>[] = [];
  (pageData.elements?.testimonials ?? []).forEach((t, idx) => {
    if (!t.author || t.rating == null) return;
    reviews.push(dropUndefined({
      '@type': 'Review' as const,
      '@id': `${pageData.canonicalUrl}#review-${idx}`,
      'itemReviewed': { '@id': serviceId },
      'reviewRating': dropUndefined({
        '@type': 'Rating' as const,
        'ratingValue': t.rating,
        'bestRating': 5,
        'worstRating': 1,
      }),
      'author': { '@type': 'Person' as const, 'name': t.author },
      'reviewBody': t.quote,
    } as Record<string, unknown>));
  });

  // PR2: ImageGallery from informative images (≥2 required, non-empty name required)
  const informativeImages = (pageData.elements?.images ?? []).filter(i => i.role === 'informative');
  const galleryName = pageData.cleanTitle || pageData.title;
  const canEmitGallery = informativeImages.length >= 2 && !!galleryName;
  const imageGallery = canEmitGallery ? dropUndefined({
    '@type': 'ImageGallery' as const,
    '@id': `${pageData.canonicalUrl}#gallery`,
    'name': galleryName,
    'image': informativeImages.map(i => i.src),
  }) : undefined;

  const nodes: Array<Record<string, unknown>> = [primary, ...reviews];
  if (imageGallery) nodes.push(imageGallery);

  return withBreadcrumb(nodes, pageData);
}

export function buildProductSchema(input: ServiceInput): Record<string, unknown> {
  const { pageData, baseUrl } = input;

  const primary = dropUndefined({
    '@type': 'Product',
    '@id': `${pageData.canonicalUrl}#product`,
    'name': pageData.cleanTitle,
    'description': pageData.description,
    'image': pageData.image ? [pageData.image] : undefined,
    'url': pageData.canonicalUrl,
    'brand': { '@type': 'Brand', 'name': pageData.publisher.name },
    'isPartOf': webSiteRef(baseUrl),
    'breadcrumb': breadcrumbRef(pageData.canonicalUrl, pageData.breadcrumbs),
    'inLanguage': pageData.inLanguage,
    // Intentionally NO offers — emitting offers without a verified price is spammy
    // and Google penalises it. Add via intelligence layer when business profile has price.
  });

  return withBreadcrumb(primary, pageData);
}
