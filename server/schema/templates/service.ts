/**
 * Service and Product templates.
 * Service uses provider @id reference (no duplicated Organization).
 * Product never emits zero-price offers.
 */
import type { PageData, BusinessProfile } from '../data-sources.js';
import type { SemanticPageData } from '../../../shared/types/page-elements.js';
import { dropUndefined, orgRef, localBusinessRef, withBreadcrumb, webSiteRef, breadcrumbRef, filterHttpUrls } from './helpers.js';

export interface ServiceInput {
  baseUrl: string;
  pageData: PageData;
  businessProfile?: BusinessProfile | null;
  semantics?: SemanticPageData;
}

export function buildServiceSchema(input: ServiceInput): Record<string, unknown> {
  const { pageData, baseUrl } = input;
  const { semantics } = input;
  const serviceId = `${pageData.canonicalUrl}#service`;

  const semanticsRating = semantics?.aggregateRating
    ? dropUndefined({
        '@type': 'AggregateRating' as const,
        'ratingValue': semantics.aggregateRating.ratingValue,
        'reviewCount': semantics.aggregateRating.reviewCount,
        'bestRating': 5,
        'worstRating': 1,
      })
    : undefined;

  const semanticsOffers = semantics?.offers?.length
    ? semantics.offers.map((o, i) => dropUndefined({
        '@type': 'Offer' as const,
        '@id': `${pageData.canonicalUrl}#offer-${i}`,
        'name': o.name,
        'price': o.price,
        'priceCurrency': o.priceCurrency || undefined,
        'description': o.description,
      }))
    : undefined;

  const staffNodes: Array<Record<string, unknown>> = (semantics?.staff ?? []).map((s, i) => dropUndefined({
    '@type': 'Person' as const,
    '@id': `${pageData.canonicalUrl}#person-${i}`,
    'name': s.name,
    'jobTitle': s.jobTitle,
    'hasCredential': s.credentials,
    'image': filterHttpUrls([s.image ?? ''])[0],
  }));

  // PR2: AggregateRating from testimonials WITH ratings
  // Filter must match the Review[] emission gate below — both require author + rating.
  // Review nodes are skipped when either is missing, so AggregateRating.reviewCount
  // must use the same filter or it can exceed the visible Review count in @graph.
  const ratedTestimonials = (pageData.elements?.testimonials ?? []).filter(t => t.rating != null && !!t.author);
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
    'image': filterHttpUrls([semantics?.primaryImage ?? '', pageData.image ?? ''])[0],
    'url': pageData.canonicalUrl,
    'provider': (input.businessProfile?.address?.street || input.businessProfile?.address?.city)
      ? localBusinessRef(baseUrl)
      : dropUndefined({
          '@type': 'Organization',
          ...orgRef(baseUrl),
          'name': pageData.publisher.name,
        }),
    'isPartOf': webSiteRef(baseUrl),
    'breadcrumb': breadcrumbRef(pageData.canonicalUrl, pageData.breadcrumbs),
    'inLanguage': pageData.inLanguage,
    'areaServed': semantics?.areaServed?.length
      ? semantics.areaServed.map(a => ({ '@type': 'Place' as const, 'name': a }))
      : (pageData.areaServed ? { '@type': 'Place' as const, name: pageData.areaServed } : undefined),
    'serviceType': pageData.serviceType,
    'aggregateRating': semanticsRating || aggregateRating,
    'hasOfferCatalog': semanticsOffers ? {
      '@type': 'OfferCatalog' as const,
      'name': pageData.cleanTitle,
      'itemListElement': semanticsOffers,
    } : undefined,
    'award': semantics?.certifications?.length ? semantics.certifications : undefined,
    'priceRange': semantics?.priceRange,
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

  // PR2: ImageGallery from informative images (≥2 required, non-empty name required).
  // filterHttpUrls drops javascript:/data:/relative — extracted img.src is
  // attacker-influenced; emitting non-http(s) into JSON-LD would fail validation
  // and is a defense-in-depth measure (mirrors PR1 citation extractor).
  const informativeImages = (pageData.elements?.images ?? []).filter(i => i.role === 'informative');
  const galleryName = pageData.cleanTitle || pageData.title;
  const galleryImageUrls = filterHttpUrls(informativeImages.map(i => i.src));
  const canEmitGallery = galleryImageUrls.length >= 2 && !!galleryName;
  const imageGallery = canEmitGallery ? dropUndefined({
    '@type': 'ImageGallery' as const,
    '@id': `${pageData.canonicalUrl}#gallery`,
    'name': galleryName,
    'image': galleryImageUrls,
  }) : undefined;

  const nodes: Array<Record<string, unknown>> = [primary, ...reviews, ...staffNodes];
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
