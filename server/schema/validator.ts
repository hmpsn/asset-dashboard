/**
 * Validates lean schema output against Google rich-result requirements.
 * Returns an array of human-readable error strings. Empty = pass.
 */

interface RequiredFields {
  required: string[];
  /** Validators receive the @graph node and return error strings. */
  custom?: Array<(node: Record<string, unknown>, allNodes: Record<string, unknown>[]) => string[]>;
}

const REQUIRED_BY_TYPE: Record<string, RequiredFields> = {
  BlogPosting: {
    required: [
      'headline', 'description', 'image', 'datePublished', 'dateModified',
      'author', 'publisher', 'mainEntityOfPage',
      'isPartOf', 'breadcrumb', 'inLanguage', 'articleSection',
    ],
  },
  Article: {
    required: [
      'headline', 'description', 'image', 'datePublished', 'dateModified',
      'author', 'publisher', 'mainEntityOfPage',
      'isPartOf', 'breadcrumb', 'inLanguage',
    ],
  },
  Service: {
    required: ['name', 'description', 'provider', 'isPartOf', 'breadcrumb', 'inLanguage'],
  },
  Product: {
    required: ['name', 'description', 'isPartOf', 'breadcrumb', 'inLanguage'],
  },
  LocalBusiness: {
    required: ['name', 'url', 'address', 'telephone', 'inLanguage'],
  },
  Organization: {
    required: ['name', 'url', 'logo'],
  },
  WebSite: {
    // potentialAction (sitelinks SearchAction) used to be in this list, but Pillar 2.1
    // dropped the unconditional emission because the site may not have a search endpoint.
    // schema-yoast-parity-fields will re-introduce SearchAction behind a workspace flag
    // (Workspace.siteHasSearch); add potentialAction back here as a conditional required
    // field at that time.
    required: ['name', 'url', 'publisher', 'inLanguage'],
  },
  AboutPage: {
    required: ['name', 'url', 'description', 'isPartOf', 'breadcrumb', 'inLanguage', 'mainEntity'],
  },
  ContactPage: {
    required: ['name', 'url', 'description', 'isPartOf', 'breadcrumb', 'inLanguage'],
  },
  CollectionPage: {
    required: ['name', 'url', 'description', 'isPartOf', 'breadcrumb', 'inLanguage'],
  },
  WebPage: {
    required: ['name', 'url', 'description', 'isPartOf', 'breadcrumb', 'inLanguage'],
  },
};

function validateBreadcrumb(node: Record<string, unknown>): string[] {
  const errors: string[] = [];
  const items = node.itemListElement as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(items)) {
    errors.push('BreadcrumbList missing itemListElement array');
    return errors;
  }
  for (const item of items) {
    if (typeof item.position !== 'number') {
      errors.push('BreadcrumbList ListItem missing position');
    }
    if (typeof item.name !== 'string' || !item.name.trim()) {
      errors.push('BreadcrumbList ListItem missing name');
    }
    if (typeof item.item !== 'string' || !item.item.trim()) {
      errors.push('BreadcrumbList ListItem missing item URL');
    }
  }
  return errors;
}

function isIdRef(v: unknown): v is { '@id': string } {
  return typeof v === 'object' && v !== null && typeof (v as Record<string, unknown>)['@id'] === 'string';
}

function validateCrossRefs(node: Record<string, unknown>, allNodes: Record<string, unknown>[]): string[] {
  const errors: string[] = [];
  const t = node['@type'] as string;

  if (node.isPartOf !== undefined && !isIdRef(node.isPartOf)) {
    errors.push(`${t}.isPartOf must be an @id reference (e.g. {"@id": "...#website"})`);
  }

  if (node.breadcrumb !== undefined) {
    if (!isIdRef(node.breadcrumb)) {
      errors.push(`${t}.breadcrumb must be an @id reference (e.g. {"@id": "...#breadcrumb"})`);
    } else {
      const target = (node.breadcrumb as { '@id': string })['@id'];
      const found = allNodes.some(n => n['@type'] === 'BreadcrumbList' && n['@id'] === target);
      if (!found) {
        errors.push(`${t}.breadcrumb references @id "${target}" but no BreadcrumbList with that @id is in the @graph`);
      }
    }
  }

  if (node.mainEntityOfPage !== undefined && !isIdRef(node.mainEntityOfPage) && typeof node.mainEntityOfPage !== 'string') {
    // mainEntityOfPage may be either a string URL or an @id-ref shape — both are accepted by Google.
    // Reject only objects that are neither.
    const v = node.mainEntityOfPage;
    if (typeof v === 'object' && v !== null && !('@id' in v) && !('@type' in v)) {
      errors.push(`${t}.mainEntityOfPage must be a URL string or {"@id": "..."} reference`);
    }
  }

  return errors;
}

const ISO_8601_RE = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

function validateArticleShape(node: Record<string, unknown>): string[] {
  const errors: string[] = [];
  const t = node['@type'] as string;
  if (t !== 'Article' && t !== 'BlogPosting') return errors;

  // author: must have @type ∈ {Person, Organization} AND non-empty name.
  const author = node.author;
  if (author !== undefined) {
    const ok = typeof author === 'object' && author !== null
      && ((author as Record<string, unknown>)['@type'] === 'Person' || (author as Record<string, unknown>)['@type'] === 'Organization')
      && typeof (author as Record<string, unknown>).name === 'string'
      && ((author as Record<string, unknown>).name as string).trim().length > 0;
    if (!ok) errors.push(`${t}.author must have @type ∈ {Person, Organization} and non-empty name`);
  }

  // publisher: must have @type AND name AND logo (ImageObject with url).
  const publisher = node.publisher as Record<string, unknown> | undefined;
  if (publisher !== undefined) {
    const logo = publisher.logo as Record<string, unknown> | undefined;
    const ok = typeof publisher === 'object' && publisher !== null
      && typeof publisher['@type'] === 'string'
      && typeof publisher.name === 'string' && (publisher.name as string).trim().length > 0
      && logo !== undefined && typeof logo === 'object'
      && logo['@type'] === 'ImageObject'
      && typeof logo.url === 'string' && (logo.url as string).trim().length > 0;
    if (!ok) errors.push(`${t}.publisher must have @type, name, and logo (ImageObject with url) — Google Article rich result requires the publisher logo`);
  }

  // image: string | array | ImageObject.
  const image = node.image;
  if (image !== undefined) {
    const ok = typeof image === 'string'
      || Array.isArray(image)
      || (typeof image === 'object' && image !== null && (image as Record<string, unknown>)['@type'] === 'ImageObject');
    if (!ok) errors.push(`${t}.image must be a string URL, an array of strings/ImageObjects, or an ImageObject`);
  }

  // datePublished / dateModified: ISO 8601.
  for (const field of ['datePublished', 'dateModified'] as const) {
    const v = node[field];
    if (v !== undefined && (typeof v !== 'string' || !ISO_8601_RE.test(v))) {
      errors.push(`${t}.${field} must be ISO 8601 (e.g. "2026-01-15T00:00:00Z")`);
    }
  }

  return errors;
}

function validateBreadcrumbOrdering(node: Record<string, unknown>): string[] {
  if (node['@type'] !== 'BreadcrumbList') return [];
  const items = node.itemListElement as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(items)) return []; // existing validateBreadcrumb catches missing array
  for (let i = 0; i < items.length; i++) {
    if (items[i].position !== i + 1) {
      return ['BreadcrumbList itemListElement positions must start at 1 and be contiguous-ascending'];
    }
  }
  return [];
}

function validateAbsoluteUrls(node: Record<string, unknown>): string[] {
  const errors: string[] = [];
  const t = node['@type'] as string;
  // Only check primary nodes — BreadcrumbList's `item` URLs are inside ListItems and are
  // already required by validateBreadcrumb to be non-empty strings; skip them here.
  if (t === 'BreadcrumbList' || t === 'ListItem') return errors;
  const url = node.url;
  if (typeof url === 'string' && !/^https?:\/\//.test(url)) {
    errors.push(`${t}.url must be an absolute URL (start with http:// or https://)`);
  }
  return errors;
}

export function validateLeanSchema(schema: Record<string, unknown>, _primaryType: string): string[] {
  const errors: string[] = [];
  if (schema['@context'] !== 'https://schema.org') errors.push('Schema missing @context');
  const graph = schema['@graph'] as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(graph)) {
    errors.push('Schema missing @graph array');
    return errors;
  }

  // Duplicate @type detection — the lean rule: at most one node per @type, except
  // ListItem (legitimate breadcrumb children). Homepage may have BOTH Organization +
  // WebSite (different @types), so the rule is per-type, not "exactly one primary".
  const typeCounts = new Map<string, number>();
  for (const node of graph) {
    const t = node['@type'] as string;
    typeCounts.set(t, (typeCounts.get(t) || 0) + 1);
  }
  for (const [t, count] of typeCounts) {
    if (count > 1 && t !== 'ListItem') {
      errors.push(`Duplicate @type in @graph: ${t} (lean output must emit exactly one primary node + optional BreadcrumbList)`);
    }
  }

  for (const node of graph) {
    const t = node['@type'] as string;
    const rules = REQUIRED_BY_TYPE[t];
    if (rules) {
      for (const field of rules.required) {
        if (node[field] === undefined || node[field] === null) {
          errors.push(`${t} missing required field: ${field}`);
        }
      }
    }
    if (t === 'BreadcrumbList') {
      errors.push(...validateBreadcrumb(node));
    }
    errors.push(...validateCrossRefs(node, graph));
    errors.push(...validateArticleShape(node));
    errors.push(...validateBreadcrumbOrdering(node));
    errors.push(...validateAbsoluteUrls(node));
  }

  return errors;
}
