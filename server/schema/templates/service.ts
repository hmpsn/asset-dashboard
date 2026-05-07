/**
 * Service and Product templates.
 * Service uses provider @id reference (no duplicated Organization).
 * Product never emits zero-price offers.
 */
import type { PageData, BusinessProfile } from '../data-sources.js';
import { dropUndefined, orgRef, localBusinessRef, withBreadcrumb, webSiteRef, breadcrumbRef, filterHttpUrls } from './helpers.js';

export interface ServiceInput {
  baseUrl: string;
  pageData: PageData;
  businessProfile?: BusinessProfile | null;
  offers?: Array<{ name?: string; price: string; priceCurrency: string; description?: string }>;
}

function isOpaqueIdentifier(value: string): boolean {
  const trimmed = value.trim();
  return /^[a-f0-9]{24}$/i.test(trimmed) || /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trimmed);
}

function safeText(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const cleaned = value.replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\s+/g, ' ').trim();
  if (!cleaned || isOpaqueIdentifier(cleaned)) return undefined;
  return cleaned;
}

export function buildServiceSchema(input: ServiceInput): Record<string, unknown> {
  const { pageData, baseUrl } = input;
  const serviceId = `${pageData.canonicalUrl}#service`;
  const safeAreaServed = safeText(pageData.areaServed);
  const serviceName = safeText(pageData.serviceName) || pageData.cleanTitle;
  const offers = (input.offers ?? pageData.offers ?? []).filter(offer => safeText(offer.price) && safeText(offer.priceCurrency));

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
    'name': serviceName,
    'description': pageData.description,
    'image': pageData.image,
    'url': pageData.canonicalUrl,
    'provider': (input.businessProfile?.address?.street || input.businessProfile?.address?.city)
      ? localBusinessRef(baseUrl)
      : dropUndefined({
          '@type': 'Organization',
          ...orgRef(baseUrl),
          'name': pageData.publisher.name,
        }),
    'breadcrumb': breadcrumbRef(pageData.canonicalUrl, pageData.breadcrumbs),
    'inLanguage': pageData.inLanguage,
    'areaServed': safeAreaServed ? { '@type': 'Place' as const, name: safeAreaServed } : undefined,
    'serviceType': pageData.serviceType,
    'offers': offers.length > 0
      ? offers.map((offer, idx) => dropUndefined({
          '@type': 'Offer' as const,
          '@id': `${pageData.canonicalUrl}#offer-${idx}`,
          'name': safeText(offer.name) || serviceName,
          'price': safeText(offer.price),
          'priceCurrency': safeText(offer.priceCurrency),
          'description': safeText(offer.description),
          'url': pageData.canonicalUrl,
        }))
      : undefined,
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

  const webPageNode = dropUndefined({
    '@type': 'WebPage' as const,
    '@id': `${pageData.canonicalUrl}#webpage`,
    'url': pageData.canonicalUrl,
    'name': pageData.cleanTitle,
    'description': pageData.description,
    'isPartOf': webSiteRef(baseUrl),
    'about': { '@id': serviceId },
    'inLanguage': pageData.inLanguage,
    'breadcrumb': breadcrumbRef(pageData.canonicalUrl, pageData.breadcrumbs),
  });

  const nodes: Array<Record<string, unknown>> = [primary, webPageNode, ...reviews];
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
    'offers': input.offers && input.offers.length > 0
      ? input.offers.map((offer, idx) => dropUndefined({
          '@type': 'Offer' as const,
          '@id': `${pageData.canonicalUrl}#offer-${idx}`,
          'name': offer.name,
          'price': offer.price,
          'priceCurrency': offer.priceCurrency,
          'description': offer.description,
          'url': pageData.canonicalUrl,
        }))
      : undefined,
    'isPartOf': webSiteRef(baseUrl),
    'breadcrumb': breadcrumbRef(pageData.canonicalUrl, pageData.breadcrumbs),
    'inLanguage': pageData.inLanguage,
  });

  return withBreadcrumb(primary, pageData);
}
